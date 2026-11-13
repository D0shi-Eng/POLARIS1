// عميل HTTP/1.1 صغير.
//
// لماذا ليس مكتبة HTTP كاملة: المطلوب ضيّق ومحدّد — طلب واحد لكل اتصال، بلا
// إعادة توجيه، بجسم محدود، بمهلة مطلقة، وبإلغاء يغلق المقبس فعلًا. مكتبة كاملة
// تجلب تجمّع اتصالات، وتتبّع إعادة توجيه، ووكلاء من البيئة — وكلها أبواب لا نريدها
// مفتوحة على طريق مفتاح API. TLS من نظام التشغيل عبر native-tls، وتحليل الرأس عبر
// httparse؛ لا تشفير ولا تحليل معقّد مكتوب هنا.

use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use native_tls::{Protocol, TlsConnector};

use super::body::{BodyReader, Framing};
use super::cancel::CancelToken;
use super::endpoint::{EndpointError, ResolvedEndpoint, Scheme};
use super::sliced::SlicedStream;

/// أقصى حجم لرأس الاستجابة.
const MAX_HEAD_BYTES: usize = 64 * 1024;
/// أقصى زمن لمحاولة اتصال واحدة.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(2500);
/// أقصى انتظار لقراءة واحدة قبل إعادة فحص الإلغاء والمهلة.
const READ_SLICE: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportErrorKind {
    ConnectionRefused,
    NetworkUnreachable,
    NameResolution,
    PolicyDenied,
    /// مهلة أثناء *إنشاء* الاتصال: لم يُقبل اتصال بعدُ. تختلف عن `Timeout` القراءة
    /// لأن فشل الإنشاء قياسٌ حقيقي لتعذّر الوصول، لا خادمٌ قبِل ثم صمت. ويندوز
    /// لا يعيد رفضًا فوريًا على منفذ محلي مغلق بل يستنفد المهلة (بلا errno)، فلا
    /// يُعتمد على شكل خطأ واحد.
    ConnectTimeout,
    /// مهلة *قراءة* بعد نجاح الاتصال.
    Timeout,
    Cancelled,
    Tls,
    Io,
    ResponseTooLarge,
    MalformedResponse,
}

#[derive(Debug, Clone)]
pub struct TransportError {
    pub kind: TransportErrorKind,
    pub detail: String,
}

impl TransportError {
    pub fn new(kind: TransportErrorKind, detail: impl Into<String>) -> Self {
        Self { kind, detail: detail.into() }
    }
}

pub struct HttpRequest<'a> {
    pub method: &'a str,
    pub path: String,
    pub headers: Vec<(&'static str, String)>,
    pub body: Option<Vec<u8>>,
    pub deadline: Instant,
    /// مهلة الخمول (Phase-08): أقصى صمت بين بايتين مستلمين. `None` تعني المهلة المطلقة وحدها.
    /// بثّ يتقدّم لا يُقطع قبل السقف المطلق؛ بثّ صامت يُقطع عند الخمول.
    pub idle: Option<Duration>,
}

pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: BodyReader,
    /// من إرسال الطلب إلى وصول أول بايت من الاستجابة.
    pub first_byte_ms: u64,
}

impl HttpResponse {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// اتصال واحد: نصّ صريح على الحلقة المحلية، أو TLS.
///
/// الطبقتان تقومان على `SlicedStream` لا على المقبس الخام (ADR-020): مصافحة TLS
/// تقرأ هي الأخرى بسقف شريحة، فلا يبقى في عمر الطلب موضع تُصدَر فيه قراءة لا
/// يُفحص الإلغاء خلالها.
pub(crate) enum Connection {
    Plain(SlicedStream),
    Tls(Box<native_tls::TlsStream<SlicedStream>>),
}

impl Connection {
    #[allow(dead_code)]
    fn socket(&self) -> &TcpStream {
        match self {
            Self::Plain(s) => s.socket(),
            Self::Tls(s) => s.get_ref().socket(),
        }
    }
}

impl Read for Connection {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Plain(s) => s.read(buf),
            Self::Tls(s) => s.read(buf),
        }
    }
}

impl Write for Connection {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Self::Plain(s) => s.write(buf),
            Self::Tls(s) => s.write(buf),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        match self {
            Self::Plain(s) => s.flush(),
            Self::Tls(s) => s.flush(),
        }
    }
}

/// قارئ يحترم المهلة المطلقة والإلغاء في كل قراءة.
pub(crate) struct GuardedConnection {
    conn: Connection,
    deadline: Instant,
    cancel: CancelToken,
}

impl GuardedConnection {
    /// يعيد ما تبقّى من المهلة. القيمة تُستعمل حيث يلزم سقف، ويكفي أثرها الجانبي
    /// (الخطأ عند الإلغاء أو انتهاء المهلة) حيث لا يلزم.
    fn check(&self) -> io::Result<Duration> {
        if self.cancel.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        let now = Instant::now();
        if now >= self.deadline {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "deadline"));
        }
        Ok(self.deadline - now)
    }
}

impl Read for GuardedConnection {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            // السقف يملكه SlicedStream الآن، فلا تُضبط المهلة هنا مرة ثانية.
            self.check()?;
            match self.conn.read(buf) {
                Ok(0) if self.cancel.is_cancelled() => {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
                }
                Ok(n) => return Ok(n),
                Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => continue,
                Err(e) if self.cancel.is_cancelled() => {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, e.to_string()));
                }
                Err(e) => return Err(e),
            }
        }
    }
}

pub fn io_to_transport(error: &io::Error) -> TransportError {
    let kind = match error.kind() {
        io::ErrorKind::Interrupted => TransportErrorKind::Cancelled,
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => TransportErrorKind::Timeout,
        io::ErrorKind::ConnectionRefused => TransportErrorKind::ConnectionRefused,
        io::ErrorKind::InvalidData => TransportErrorKind::MalformedResponse,
        io::ErrorKind::OutOfMemory => TransportErrorKind::ResponseTooLarge,
        _ => TransportErrorKind::Io,
    };
    TransportError::new(kind, error.to_string())
}

pub struct HttpClient {
    tls: Option<TlsConnector>,
    user_agent: String,
}

impl Default for HttpClient {
    fn default() -> Self {
        Self::new()
    }
}

impl HttpClient {
    pub fn new() -> Self {
        // TLS 1.2 كحدّ أدنى، ومخزن شهادات النظام. الفشل في بناء الموصل يعني أن
        // الخروج البعيد غير متاح، لا أن التحقق يُتجاوز.
        let tls = TlsConnector::builder().min_protocol_version(Some(Protocol::Tlsv12)).build().ok();
        Self { tls, user_agent: format!("POLARIS/{}", env!("CARGO_PKG_VERSION")) }
    }

    fn connect(&self, endpoint: &ResolvedEndpoint, deadline: Instant, cancel: &CancelToken) -> Result<TcpStream, TransportError> {
        let addrs = endpoint.socket_addrs().map_err(|e| match e {
            EndpointError::NameResolutionFailed => TransportError::new(TransportErrorKind::NameResolution, "name resolution failed"),
            other => TransportError::new(TransportErrorKind::PolicyDenied, format!("{other:?}")),
        })?;
        let mut last = TransportError::new(TransportErrorKind::NetworkUnreachable, "no address");
        for addr in addrs {
            if cancel.is_cancelled() {
                return Err(TransportError::new(TransportErrorKind::Cancelled, "cancelled before connect"));
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(TransportError::new(TransportErrorKind::ConnectTimeout, "deadline before connect"));
            }
            let budget = (deadline - now).min(CONNECT_TIMEOUT);
            match TcpStream::connect_timeout(&addr, budget) {
                Ok(stream) => {
                    let _ = stream.set_nodelay(true);
                    cancel.register(&stream);
                    return Ok(stream);
                }
                Err(e) => {
                    // كل هذا فشلُ *إنشاء* اتصال. المهلة هنا مهلة اتصال (`ConnectTimeout`)
                    // لا مهلة قراءة: على ويندوز يصل منفذٌ محلي مغلق إلى هنا بـ TimedOut
                    // لا ConnectionRefused، وكلاهما تعذّرُ وصول لا خادمٌ قبِل ثم صمت.
                    last = match e.kind() {
                        io::ErrorKind::ConnectionRefused => TransportError::new(TransportErrorKind::ConnectionRefused, e.to_string()),
                        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => TransportError::new(TransportErrorKind::ConnectTimeout, e.to_string()),
                        _ => TransportError::new(TransportErrorKind::NetworkUnreachable, e.to_string()),
                    };
                }
            }
        }
        Err(last)
    }

    fn establish(&self, endpoint: &ResolvedEndpoint, deadline: Instant, idle: Option<Duration>, cancel: &CancelToken) -> Result<Connection, TransportError> {
        let tcp = self.connect(endpoint, deadline, cancel)?;
        let remaining = deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(1));
        // الكتابة تبقى بالمهلة الكاملة عمدًا: إرسال محجوب تنتهي مهلته يُبلّغ عددًا
        // غير محدَّد من البايتات المكتوبة، وإعادة المحاولة عليه تُفسد الطلب (ADR-020).
        tcp.set_write_timeout(Some(remaining)).map_err(|e| io_to_transport(&e))?;
        // القراءة تُشرَّح هنا، قبل المصافحة، لا بعدها: المصافحة كانت الموضع الوحيد
        // الذي بقي فيه الإلغاء معتمدًا على إيقاظ shutdown.
        let sliced = SlicedStream::new(tcp, deadline, cancel.clone(), READ_SLICE).map_err(|e| io_to_transport(&e))?.with_idle(idle);
        match endpoint.scheme {
            Scheme::Http => Ok(Connection::Plain(sliced)),
            Scheme::Https => {
                let connector = self
                    .tls
                    .as_ref()
                    .ok_or_else(|| TransportError::new(TransportErrorKind::Tls, "TLS is unavailable on this host"))?;
                let host = endpoint.host.trim_start_matches('[').trim_end_matches(']').to_string();
                connector
                    .connect(&host, sliced)
                    .map(|s| Connection::Tls(Box::new(s)))
                    .map_err(|e| {
                        if cancel.is_cancelled() {
                            TransportError::new(TransportErrorKind::Cancelled, "cancelled during TLS")
                        } else {
                            TransportError::new(TransportErrorKind::Tls, e.to_string())
                        }
                    })
            }
        }
    }

    fn head_bytes(&self, request: &HttpRequest<'_>, endpoint: &ResolvedEndpoint) -> Vec<u8> {
        // ترويسة Accept الافتراضية لمسار المزوّد. طلبٌ يحمل Accept صريحًا (صفحة ويب في
        // Phase-05) يستبدلها بدل أن تتكرّر الترويسة في الرأس الواحد.
        let accept = if request.headers.iter().any(|(name, _)| name.eq_ignore_ascii_case("accept")) {
            String::new()
        } else {
            "Accept: application/json, text/event-stream, application/x-ndjson\r\n".to_string()
        };
        let mut head = format!(
            "{} {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: {}\r\n{accept}Accept-Encoding: identity\r\nConnection: close\r\n",
            request.method,
            request.path,
            endpoint.host_header(),
            self.user_agent
        );
        for (name, value) in &request.headers {
            // لا فواصل أسطر داخل ترويسة: حقن ترويسة مرفوض بإسقاطها.
            if value.contains(['\r', '\n']) {
                continue;
            }
            head.push_str(name);
            head.push_str(": ");
            head.push_str(value);
            head.push_str("\r\n");
        }
        if let Some(body) = &request.body {
            head.push_str(&format!("Content-Length: {}\r\n", body.len()));
        }
        head.push_str("\r\n");
        head.into_bytes()
    }

    /// يرسل طلبًا واحدًا ويقرأ رأس الاستجابة. الجسم يُقرأ لاحقًا عبر `body`.
    pub fn send(
        &self,
        endpoint: &ResolvedEndpoint,
        request: HttpRequest<'_>,
        cancel: &CancelToken,
    ) -> Result<HttpResponse, TransportError> {
        if !request.path.starts_with('/') || request.path.contains(['\r', '\n', ' ']) {
            return Err(TransportError::new(TransportErrorKind::PolicyDenied, "invalid request path"));
        }
        let mut conn = self.establish(endpoint, request.deadline, request.idle, cancel)?;
        let mut bytes = self.head_bytes(&request, endpoint);
        if let Some(body) = &request.body {
            bytes.extend_from_slice(body);
        }
        conn.write_all(&bytes).map_err(|e| {
            if cancel.is_cancelled() {
                TransportError::new(TransportErrorKind::Cancelled, "cancelled while sending")
            } else {
                io_to_transport(&e)
            }
        })?;
        conn.flush().map_err(|e| io_to_transport(&e))?;
        let sent_at = Instant::now();

        let mut guarded = GuardedConnection { conn, deadline: request.deadline, cancel: cancel.clone() };
        let (status, headers, leftover, first_byte_ms) = read_head(&mut guarded, sent_at)?;
        let framing = framing_of(request.method, status, &headers)?;
        let body = BodyReader::new(leftover, Box::new(guarded), framing);
        Ok(HttpResponse { status, headers, body, first_byte_ms })
    }
}

type Head = (u16, Vec<(String, String)>, Vec<u8>, u64);

fn read_head(conn: &mut GuardedConnection, sent_at: Instant) -> Result<Head, TransportError> {
    let mut buffer: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let mut first_byte_ms: Option<u64> = None;
    loop {
        let n = conn.read(&mut chunk).map_err(|e| io_to_transport(&e))?;
        if n == 0 {
            return Err(TransportError::new(TransportErrorKind::MalformedResponse, "connection closed before the response head"));
        }
        if first_byte_ms.is_none() {
            first_byte_ms = Some(sent_at.elapsed().as_millis() as u64);
        }
        buffer.extend_from_slice(&chunk[..n]);
        let mut storage = [httparse::EMPTY_HEADER; 64];
        let mut parsed = httparse::Response::new(&mut storage);
        match parsed.parse(&buffer) {
            Ok(httparse::Status::Complete(length)) => {
                let status = parsed.code.unwrap_or(0);
                let headers = parsed
                    .headers
                    .iter()
                    .map(|h| (h.name.to_string(), String::from_utf8_lossy(h.value).into_owned()))
                    .collect();
                let leftover = buffer[length..].to_vec();
                // 1xx مؤقت: لا نطلبه (بلا Expect)، ووصوله يُعامل كاستجابة مشوّهة.
                if !(200..=599).contains(&status) {
                    return Err(TransportError::new(TransportErrorKind::MalformedResponse, format!("unexpected status {status}")));
                }
                return Ok((status, headers, leftover, first_byte_ms.unwrap_or(0)));
            }
            Ok(httparse::Status::Partial) => {
                if buffer.len() > MAX_HEAD_BYTES {
                    return Err(TransportError::new(TransportErrorKind::ResponseTooLarge, "response head too large"));
                }
            }
            Err(e) => return Err(TransportError::new(TransportErrorKind::MalformedResponse, e.to_string())),
        }
    }
}

fn framing_of(method: &str, status: u16, headers: &[(String, String)]) -> Result<Framing, TransportError> {
    if method == "HEAD" || status == 204 || status == 304 {
        return Ok(Framing::Length(0));
    }
    let find = |name: &str| headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.trim().to_ascii_lowercase());
    if let Some(encoding) = find("transfer-encoding") {
        if encoding.split(',').map(str::trim).next_back() == Some("chunked") {
            return Ok(Framing::Chunked);
        }
        return Err(TransportError::new(TransportErrorKind::MalformedResponse, "unsupported transfer encoding"));
    }
    if let Some(length) = find("content-length") {
        let value = length
            .parse::<u64>()
            .map_err(|_| TransportError::new(TransportErrorKind::MalformedResponse, "invalid content-length"))?;
        return Ok(Framing::Length(value));
    }
    Ok(Framing::UntilClose)
}
