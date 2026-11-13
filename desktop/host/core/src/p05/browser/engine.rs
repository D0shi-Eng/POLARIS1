// محرّك الجلب: طلب واحد لكل خطوة، وكل إعادة توجيه تُفحص من جديد.
//
// لماذا ليس WebView: المتصفّح هنا عميل HTTP/HTML يملكه زمن التشغيل، يمرّ بعميل
// Phase-02 نفسه — المهلة المطلقة، والإلغاء الذي يغلق المقبس، والحلّ مرّة واحدة لحظة
// الاتصال مع رفض أي عنوان غير عام، وTLS من النظام. وWebView يجلب موارده الفرعية
// ويحلّ أسماءه بنفسه، فلا يمكن فرض سياسة التنقّل على كل طلب يصدر منه. الثمن مُعلن:
// لا جافاسكربت ولا موارد فرعية ولا ملفات تعريف ارتباط.

use std::sync::Arc;
use std::time::{Duration, Instant};

use url::Url;

use polaris_host_providers::net::{web_destination, CancelToken, HttpClient, HttpRequest, TransportErrorKind};

use super::url_policy::{DestinationClass, NavigationDenial, NavigationPolicy};

/// حدود الجلب.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FetchLimits {
    pub max_body_bytes: usize,
    pub timeout_ms: u64,
}

impl Default for FetchLimits {
    fn default() -> Self {
        Self { max_body_bytes: 2 * 1024 * 1024, timeout_ms: 20_000 }
    }
}

/// جسم طلب يُرسل مع نموذج.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestBody {
    pub content_type: String,
    pub bytes: Vec<u8>,
}

/// ما جُلب فعلًا.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchedPage {
    pub requested: Url,
    pub final_url: Url,
    pub status: u16,
    pub content_type: String,
    pub content_disposition: Option<String>,
    pub body: Vec<u8>,
    pub redirects: Vec<Url>,
    pub class: DestinationClass,
    /// من إرسال الطلب إلى أول بايت، مجموعًا على الخطوات: زمن الخادم لا زمننا.
    pub server_ms: u64,
    pub total_ms: u64,
}

impl FetchedPage {
    pub fn is_html(&self) -> bool {
        let ct = self.content_type.to_ascii_lowercase();
        ct.is_empty() || ct.starts_with("text/html") || ct.starts_with("application/xhtml")
    }

    pub fn is_text(&self) -> bool {
        self.content_type.to_ascii_lowercase().starts_with("text/")
    }

    /// هل تعلن الاستجابة نفسها تنزيلًا لا صفحة؟
    pub fn is_attachment(&self) -> bool {
        self.content_disposition.as_deref().is_some_and(|d| d.to_ascii_lowercase().contains("attachment")) || (!self.is_text() && !self.is_html())
    }
}

/// لماذا لم يُجلب شيء. مغلق.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchFailure {
    Denied(NavigationDenial),
    /// الاسم حُلّ إلى عنوان غير عام عند الاتصال: رُفض الاتصال كله.
    ResolvedToPrivate,
    NameResolution,
    Timeout,
    Cancelled,
    TooLarge(u64),
    Malformed(String),
    Unreachable(String),
}

impl FetchFailure {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Denied(d) => d.as_str(),
            Self::ResolvedToPrivate => "RESOLVED_TO_PRIVATE_ADDRESS",
            Self::NameResolution => "NAME_RESOLUTION_FAILED",
            Self::Timeout => "TIMEOUT",
            Self::Cancelled => "CANCELLED",
            Self::TooLarge(_) => "RESULT_TOO_LARGE",
            Self::Malformed(_) => "RESULT_MALFORMED",
            Self::Unreachable(_) => "UNREACHABLE",
        }
    }
}

/// المحرّك. بلا حالة بين الطلبات: لا ملفات تعريف ارتباط ولا ذاكرة تخزين.
pub struct BrowserEngine {
    http: Arc<HttpClient>,
    policy: NavigationPolicy,
    limits: FetchLimits,
}

impl BrowserEngine {
    pub fn new(http: Arc<HttpClient>, policy: NavigationPolicy, limits: FetchLimits) -> Self {
        Self { http, policy, limits }
    }

    pub fn policy(&self) -> &NavigationPolicy {
        &self.policy
    }

    pub fn limits(&self) -> FetchLimits {
        self.limits
    }

    /// يجلب عنوانًا، متتبّعًا إعادات التوجيه بعد فحص كلٍّ منها. `POST` يصير `GET`
    /// بعد إعادة التوجيه (303/301/302) كما يفعل المتصفّح، ولا يُعاد إرسال جسمه أبدًا.
    pub fn fetch(
        &self,
        method: &str,
        url: &Url,
        body: Option<RequestBody>,
        cancel: &CancelToken,
        timeout_ms: Option<u64>,
    ) -> Result<FetchedPage, FetchFailure> {
        let started = Instant::now();
        let budget = timeout_ms.unwrap_or(self.limits.timeout_ms).min(self.limits.timeout_ms).max(1);
        let deadline = started + Duration::from_millis(budget);
        let mut class = self.policy.check(url).map_err(FetchFailure::Denied)?;
        let mut current = url.clone();
        let mut method = method.to_string();
        let mut body = body;
        let mut redirects = Vec::new();
        let mut server_ms = 0u64;
        loop {
            if cancel.is_cancelled() {
                return Err(FetchFailure::Cancelled);
            }
            let endpoint = web_destination(&current, class == DestinationClass::TestFixture).map_err(|e| match e {
                polaris_host_providers::net::EndpointError::PrivateAddress => FetchFailure::ResolvedToPrivate,
                polaris_host_providers::net::EndpointError::SchemeNotAllowed => FetchFailure::Denied(NavigationDenial::SchemeNotAllowed),
                polaris_host_providers::net::EndpointError::CredentialsInUrl => FetchFailure::Denied(NavigationDenial::CredentialsInUrl),
                _ => FetchFailure::Denied(NavigationDenial::InvalidUrl),
            })?;
            let mut path = current.path().to_string();
            if path.is_empty() {
                path.push('/');
            }
            if let Some(query) = current.query() {
                path.push('?');
                path.push_str(query);
            }
            let mut headers: Vec<(&'static str, String)> =
                vec![("Accept", "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5".to_string())];
            if let Some(b) = &body {
                headers.push(("Content-Type", b.content_type.clone()));
            }
            let request = HttpRequest {
                method: &method,
                path,
                headers,
                body: body.as_ref().map(|b| b.bytes.clone()),
                deadline,
                idle: None,
            };
            let mut response = self.http.send(&endpoint, request, cancel).map_err(|e| match e.kind {
                TransportErrorKind::Cancelled => FetchFailure::Cancelled,
                TransportErrorKind::Timeout | TransportErrorKind::ConnectTimeout => FetchFailure::Timeout,
                TransportErrorKind::PolicyDenied if e.detail.contains("PrivateAddress") => FetchFailure::ResolvedToPrivate,
                TransportErrorKind::NameResolution => FetchFailure::NameResolution,
                TransportErrorKind::ResponseTooLarge => FetchFailure::TooLarge(self.limits.max_body_bytes as u64),
                TransportErrorKind::MalformedResponse => FetchFailure::Malformed(e.detail),
                _ => FetchFailure::Unreachable(e.detail),
            })?;
            server_ms += response.first_byte_ms;
            if (300..400).contains(&response.status) && response.status != 304 {
                let Some(location) = response.header("location").map(str::to_string) else {
                    return Err(FetchFailure::Malformed("a redirect without a location".into()));
                };
                let (next, next_class) =
                    self.policy.check_redirect(&current, &location, redirects.len()).map_err(FetchFailure::Denied)?;
                redirects.push(next.clone());
                current = next;
                class = next_class;
                if response.status != 307 && response.status != 308 {
                    method = "GET".into();
                    body = None;
                }
                continue;
            }
            // الحجم المُعلن يُفحص قبل القراءة؛ والمقروء يُقصّ عند السقف ثم يُرفض.
            if let Some(length) = response.header("content-length").and_then(|v| v.trim().parse::<u64>().ok()) {
                if length > self.limits.max_body_bytes as u64 {
                    return Err(FetchFailure::TooLarge(length));
                }
            }
            let content_type = response.header("content-type").unwrap_or("").to_string();
            let content_disposition = response.header("content-disposition").map(str::to_string);
            let status = response.status;
            let bytes = response.body.read_all(self.limits.max_body_bytes + 1).map_err(|e| match e.kind {
                TransportErrorKind::Cancelled => FetchFailure::Cancelled,
                TransportErrorKind::Timeout => FetchFailure::Timeout,
                TransportErrorKind::ResponseTooLarge => FetchFailure::TooLarge(self.limits.max_body_bytes as u64 + 1),
                _ => FetchFailure::Malformed(e.detail),
            })?;
            if bytes.len() > self.limits.max_body_bytes {
                return Err(FetchFailure::TooLarge(bytes.len() as u64));
            }
            return Ok(FetchedPage {
                requested: url.clone(),
                final_url: current,
                status,
                content_type,
                content_disposition,
                body: bytes,
                redirects,
                class,
                server_ms,
                total_ms: started.elapsed().as_millis() as u64,
            });
        }
    }
}

#[cfg(test)]
pub(crate) mod fixture {
    //! خادم HTTP صغير على الحلقة المحلية لاختبارات المحرّك. TEST FIXTURE.
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::thread;

    /// الاستجابة: الحالة، والترويسات، والجسم، والتأخير بالميلي ثانية.
    pub type FixtureReply = (u16, Vec<(String, String)>, Vec<u8>, u64);

    /// يشغّل خادمًا يجيب كل مسار بدالّة. يعيد العنوان.
    pub fn serve(handler: fn(&str, &str, &str) -> FixtureReply) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                thread::spawn(move || {
                    let mut stream = stream;
                    let mut buffer = vec![0u8; 65536];
                    let mut read = 0;
                    loop {
                        let Ok(n) = stream.read(&mut buffer[read..]) else { return };
                        if n == 0 {
                            break;
                        }
                        read += n;
                        let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                        if let Some(head_end) = text.find("\r\n\r\n") {
                            let length = text[..head_end]
                                .lines()
                                .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                                .unwrap_or(0);
                            if read >= head_end + 4 + length {
                                break;
                            }
                        }
                    }
                    let text = String::from_utf8_lossy(&buffer[..read]).to_string();
                    let first = text.lines().next().unwrap_or("");
                    let mut parts = first.split_whitespace();
                    let method = parts.next().unwrap_or("").to_string();
                    let path = parts.next().unwrap_or("").to_string();
                    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
                    let (status, headers, bytes, delay) = handler(&method, &path, &body);
                    if delay > 0 {
                        thread::sleep(std::time::Duration::from_millis(delay));
                    }
                    let mut head = format!("HTTP/1.1 {status} X\r\nConnection: close\r\nContent-Length: {}\r\n", bytes.len());
                    for (k, v) in headers {
                        head.push_str(&format!("{k}: {v}\r\n"));
                    }
                    head.push_str("\r\n");
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.write_all(&bytes);
                });
            }
        });
        addr
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::serve;
    use super::*;

    fn html(status: u16, body: &str) -> (u16, Vec<(String, String)>, Vec<u8>, u64) {
        (status, vec![("Content-Type".into(), "text/html; charset=utf-8".into())], body.as_bytes().to_vec(), 0)
    }

    fn handler(method: &str, path: &str, body: &str) -> (u16, Vec<(String, String)>, Vec<u8>, u64) {
        match path {
            "/normal" => html(200, "<title>Normal</title><p>hello</p>"),
            "/redirect" => (302, vec![("Location".into(), "/normal".into())], Vec::new(), 0),
            "/to-private" => (302, vec![("Location".into(), "http://10.1.2.3/".into())], Vec::new(), 0),
            "/to-other-port" => (302, vec![("Location".into(), "http://127.0.0.1:9/x".into())], Vec::new(), 0),
            "/loop" => (302, vec![("Location".into(), "/loop".into())], Vec::new(), 0),
            "/big" => html(200, &"x".repeat(5000)),
            "/slow" => (200, vec![], b"late".to_vec(), 3000),
            "/echo" => html(200, &format!("<p>{method} {body}</p>")),
            _ => html(404, "<p>missing</p>"),
        }
    }

    fn engine(addr: std::net::SocketAddr, max: usize) -> BrowserEngine {
        BrowserEngine::new(
            Arc::new(HttpClient::new()),
            NavigationPolicy::with_fixture_origins(&[(addr.ip(), addr.port())]),
            FetchLimits { max_body_bytes: max, timeout_ms: 10_000 },
        )
    }

    fn url(addr: std::net::SocketAddr, path: &str) -> Url {
        Url::parse(&format!("http://{addr}{path}")).unwrap()
    }

    #[test]
    fn a_fixture_page_is_fetched_and_a_redirect_is_followed_after_a_recheck() {
        let addr = serve(handler);
        let e = engine(addr, 1 << 20);
        let page = e.fetch("GET", &url(addr, "/redirect"), None, &CancelToken::new(), None).unwrap();
        assert_eq!(page.status, 200);
        assert_eq!(page.final_url.path(), "/normal");
        assert_eq!(page.redirects.len(), 1);
        assert!(page.is_html());
    }

    #[test]
    fn a_redirect_to_a_private_or_unlisted_address_is_refused_before_connecting() {
        let addr = serve(handler);
        let e = engine(addr, 1 << 20);
        assert_eq!(
            e.fetch("GET", &url(addr, "/to-private"), None, &CancelToken::new(), None).unwrap_err(),
            FetchFailure::Denied(NavigationDenial::PrivateAddressDenied)
        );
        assert_eq!(
            e.fetch("GET", &url(addr, "/to-other-port"), None, &CancelToken::new(), None).unwrap_err(),
            FetchFailure::Denied(NavigationDenial::LoopbackDenied)
        );
        assert_eq!(
            e.fetch("GET", &url(addr, "/loop"), None, &CancelToken::new(), None).unwrap_err(),
            FetchFailure::Denied(NavigationDenial::TooManyRedirects)
        );
    }

    #[test]
    fn an_oversized_body_is_refused_not_truncated_silently() {
        let addr = serve(handler);
        let e = engine(addr, 1000);
        assert!(matches!(e.fetch("GET", &url(addr, "/big"), None, &CancelToken::new(), None), Err(FetchFailure::TooLarge(_))));
    }

    #[test]
    fn a_slow_page_times_out_and_a_cancel_stops_it_in_flight() {
        let addr = serve(handler);
        let e = engine(addr, 1 << 20);
        let began = Instant::now();
        assert_eq!(e.fetch("GET", &url(addr, "/slow"), None, &CancelToken::new(), Some(600)).unwrap_err(), FetchFailure::Timeout);
        assert!(began.elapsed() < Duration::from_millis(2500));
        let cancel = CancelToken::new();
        let trigger = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            trigger.cancel();
        });
        let began = Instant::now();
        assert_eq!(e.fetch("GET", &url(addr, "/slow"), None, &cancel, None).unwrap_err(), FetchFailure::Cancelled);
        assert!(began.elapsed() < Duration::from_millis(2000), "the cancel did not stop the fetch in flight");
    }

    #[test]
    fn a_post_body_is_sent_once_and_becomes_get_after_a_redirect() {
        let addr = serve(handler);
        let e = engine(addr, 1 << 20);
        let page = e
            .fetch(
                "POST",
                &url(addr, "/echo"),
                Some(RequestBody { content_type: "application/x-www-form-urlencoded".into(), bytes: b"a=1".to_vec() }),
                &CancelToken::new(),
                None,
            )
            .unwrap();
        assert!(String::from_utf8_lossy(&page.body).contains("POST a=1"));
    }

    #[test]
    fn the_product_policy_refuses_the_same_loopback_page() {
        let addr = serve(handler);
        let e = BrowserEngine::new(Arc::new(HttpClient::new()), NavigationPolicy::product(), FetchLimits::default());
        assert_eq!(
            e.fetch("GET", &url(addr, "/normal"), None, &CancelToken::new(), None).unwrap_err(),
            FetchFailure::Denied(NavigationDenial::LoopbackDenied)
        );
    }
}
