// عميل MCP: JSON-RPC 2.0 فوق HTTP بنقل «Streamable HTTP» (مواصفة 2025-03-26).
//
// النقلان: الحلقة المحلية (`LOOPBACK_HTTP`)، وHTTPS إلى عنوان عامّ سجّله المستخدم (`REMOTE_HTTPS`، PHASE-06 2026-10-21). العنوان العامّ
// يُحلّ ويُفحص عند كل اتصال (`web_destination`: لا عنوان خاص ولا حلقة ولا اعتماد في الرابط). نقل STDIO يشغّل عملية، وتشغيل عملية على
// المضيف أثرٌ لا قدرة له في هذا البناء (`effect::RUNTIME_CAPABILITY_GRANT`)؛ تشغيلها داخل الصندوق المعزول يحتاج منفذًا لعملية طويلة
// العمر بأنابيب، وليس موجودًا. يبقى خارج المرحلة معلنًا.
//
// ما تطلبه المواصفة من العميل ويطبّقه هذا الملف (قِيس غيابه في PHASE-06، CP-06-1..3): `Accept` بالنوعين، وقراءة الردّ من تيّار SSE،
// وحمل `Mcp-Session-Id` الذي أعطاه الخادم في كل طلب بعده، وإشعار `notifications/initialized` بعد التهيئة، وإعادة التهيئة مرة حين
// يُنهي الخادم الجلسة (404).
//
// كل ما يعود من هنا بيانات: الحجم محدود، والوقت محدود، والإلغاء مُحترَم، والجسم يُفكَّك بعقد صريح — لا يُقرأ حقل لم يُطلب، ولا يُصدَّق
// ادعاء عن سلطة.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use polaris_host_providers::net::endpoint;
use polaris_host_providers::net::http::{HttpRequest, TransportErrorKind};
use polaris_host_providers::net::{web_destination, CancelToken, HttpClient, ResolvedEndpoint};

use super::model::McpTransport;
use super::sanitize;

/// إصدار بروتوكول MCP الذي يُعلنه هذا العميل عند التهيئة.
pub const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

/// تفصيل خطأ الجلسة المنتهية: يقرؤه `call_tool` ليعيد التهيئة مرة.
const SESSION_ENDED: &str = "the server ended the MCP session";

/// خطأ نداء خادم. مغلق، ويُترجَم عند البوابة إلى سبب رفض من مفردات العقد.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpError {
    /// النقطة ليست على الحلقة المحلية ولا عنوانًا عامًّا مقبولًا، أو ليست صالحة أصلًا.
    EndpointRefused(String),
    Unreachable(String),
    TimedOut,
    Cancelled,
    TooLarge(u64),
    Malformed(String),
    /// الخادم أعاد خطأ JSON-RPC.
    Remote { code: i64, message: String },
}

impl McpError {
    pub fn as_code(&self) -> &'static str {
        match self {
            Self::EndpointRefused(_) => "NETWORK_POLICY_DENIED",
            Self::Unreachable(_) => "SERVER_UNREACHABLE",
            Self::TimedOut => "SERVER_UNREACHABLE",
            Self::Cancelled => "CANCELLED",
            Self::TooLarge(_) => "RESULT_TOO_LARGE",
            Self::Malformed(_) => "RESULT_MALFORMED",
            Self::Remote { .. } => "RESULT_MALFORMED",
        }
    }
}

/// يحلّ نقطة نهاية على الحلقة المحلية وحدها، وبلا سرّ في العنوان.
pub fn resolve(raw: &str) -> Result<ResolvedEndpoint, McpError> {
    endpoint::loopback(raw).map_err(|e| McpError::EndpointRefused(format!("{e:?}")))
}

/// يحلّ نقطة خادم مسجَّل بنقله: الحلقة المحلية، وإلا HTTPS إلى اسم أو عنوان عامّ. لا http عامّ، ولا عنوان خاص، ولا اعتماد ولا استعلام
/// في الرابط. الفحص يتكرّر عند الاتصال (الاسم يُحلّ ويُفحص كل مرة).
pub fn resolve_registered(raw: &str) -> Result<(ResolvedEndpoint, McpTransport), McpError> {
    if let Ok(local) = resolve(raw) {
        return Ok((local, McpTransport::LoopbackHttp));
    }
    let url = url::Url::parse(raw).map_err(|_| McpError::EndpointRefused("the endpoint is not a URL".into()))?;
    if url.scheme() != "https" {
        return Err(McpError::EndpointRefused("a server outside this computer must use https".into()));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(McpError::EndpointRefused("the endpoint carries a query or a fragment".into()));
    }
    let mut resolved = web_destination(&url, false).map_err(|e| McpError::EndpointRefused(format!("{e:?}")))?;
    resolved.base_path = url.path().trim_end_matches('/').to_string();
    Ok((resolved, McpTransport::RemoteHttps))
}

/// معرّف جلسة يقبله العميل: ASCII مرئي، وطول محدود (المواصفة: 0x21–0x7E).
fn valid_session_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && value.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

/// يقرأ ردّ JSON-RPC ذا المعرّف المطلوب من تيّار SSE. رسائل أخرى (طلبات الخادم وإشعاراته) تُتجاهل: العميل لا يجيب الخادم بشيء.
fn sse_response(bytes: &[u8], id: &str) -> Result<Value, McpError> {
    let text = String::from_utf8_lossy(bytes).replace("\r\n", "\n");
    for event in text.split("\n\n") {
        let data: Vec<&str> = event.lines().filter_map(|l| l.strip_prefix("data:")).map(|l| l.strip_prefix(' ').unwrap_or(l)).collect();
        if data.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&data.join("\n")) else { continue };
        if message.get("id").and_then(Value::as_str) == Some(id) && (message.get("result").is_some() || message.get("error").is_some()) {
            return Ok(message);
        }
    }
    Err(McpError::Malformed("the event stream carried no response to this request".into()))
}

/// عميل JSON-RPC صغير. يملك عميل HTTP المشترك ولا يفتح شبكته الخاصة. يتذكّر جلسة كل خادم داخل هذه العملية وحدها.
pub struct McpClient {
    http: Arc<HttpClient>,
    sessions: Mutex<HashMap<String, String>>,
    initialized: Mutex<HashSet<String>>,
}

/// ما قِيس عن نداء واحد.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CallTiming {
    pub elapsed_ms: u64,
    pub response_bytes: u64,
}

impl McpClient {
    pub fn new(http: Arc<HttpClient>) -> Self {
        Self { http, sessions: Mutex::new(HashMap::new()), initialized: Mutex::new(HashSet::new()) }
    }

    fn session_of(&self, key: &str) -> Option<String> {
        self.sessions.lock().ok().and_then(|s| s.get(key).cloned())
    }

    fn forget(&self, key: &str) {
        if let Ok(mut s) = self.sessions.lock() {
            s.remove(key);
        }
        if let Ok(mut i) = self.initialized.lock() {
            i.remove(key);
        }
    }

    fn request(&self, endpoint: &ResolvedEndpoint, body: Vec<u8>, timeout_ms: u64) -> HttpRequest<'_> {
        let path = if endpoint.base_path.is_empty() { "/".to_string() } else { endpoint.base_path.clone() };
        // المهلة محدودة من الجانبين: لا نداء بلا سقف، ولا سقف يبتلع ميزانية المهمّة.
        let timeout = Duration::from_millis(timeout_ms.clamp(200, 30_000));
        let mut headers = vec![
            ("content-type", "application/json".to_string()),
            // CP-06-1: المواصفة تطلب النوعين؛ خوادم كثيرة ترفض (406) طلبًا يقبل JSON وحده.
            ("accept", "application/json, text/event-stream".to_string()),
            ("mcp-protocol-version", MCP_PROTOCOL_VERSION.to_string()),
        ];
        if let Some(session) = self.session_of(&endpoint.display()) {
            headers.push(("mcp-session-id", session));
        }
        HttpRequest { idle: None, method: "POST", path, headers, body: Some(body), deadline: Instant::now() + timeout }
    }

    /// ينفّذ نداء JSON-RPC واحدًا ويعيد حقل `result` كما وصل.
    pub fn call(&self, endpoint: &ResolvedEndpoint, method: &str, params: Value, timeout_ms: u64, cancel: &CancelToken) -> Result<(Value, CallTiming), McpError> {
        if cancel.is_cancelled() {
            return Err(McpError::Cancelled);
        }
        let id = crate::ids::new_uuid_v4();
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string().into_bytes();
        let key = endpoint.display();
        let had_session = self.session_of(&key).is_some();
        let started = Instant::now();
        let mut response = self.http.send(endpoint, self.request(endpoint, body, timeout_ms), cancel).map_err(|error| match error.kind {
            TransportErrorKind::Cancelled => McpError::Cancelled,
            TransportErrorKind::Timeout | TransportErrorKind::ConnectTimeout => McpError::TimedOut,
            TransportErrorKind::ResponseTooLarge => McpError::TooLarge(sanitize::MAX_RESPONSE_BYTES as u64),
            TransportErrorKind::PolicyDenied => McpError::EndpointRefused(error.detail),
            _ => McpError::Unreachable(error.detail),
        })?;
        let content_type = response.header("content-type").unwrap_or("").to_ascii_lowercase();
        // CP-06-2: الجلسة التي يعطيها الخادم عند التهيئة تُحمل في كل طلب بعدها. قيمة غير صالحة لا تُحفظ.
        if method == "initialize" {
            match response.header("mcp-session-id").filter(|v| valid_session_id(v)) {
                Some(session) => {
                    if let Ok(mut s) = self.sessions.lock() {
                        s.insert(key.clone(), session.to_string());
                    }
                }
                None => {
                    if let Ok(mut s) = self.sessions.lock() {
                        s.remove(&key);
                    }
                }
            }
        }
        let bytes = response.body.read_all(sanitize::MAX_RESPONSE_BYTES).map_err(|error| match error.kind {
            TransportErrorKind::ResponseTooLarge => McpError::TooLarge(sanitize::MAX_RESPONSE_BYTES as u64),
            TransportErrorKind::Cancelled => McpError::Cancelled,
            TransportErrorKind::Timeout => McpError::TimedOut,
            _ => McpError::Unreachable(error.detail),
        })?;
        let timing = CallTiming { elapsed_ms: started.elapsed().as_millis() as u64, response_bytes: bytes.len() as u64 };
        if cancel.is_cancelled() {
            return Err(McpError::Cancelled);
        }
        if response.status == 404 && had_session {
            self.forget(&key);
            return Err(McpError::Unreachable(SESSION_ENDED.into()));
        }
        if response.status < 200 || response.status >= 300 {
            return Err(McpError::Unreachable(format!("the server answered with status {}", response.status)));
        }
        if bytes.len() > sanitize::MAX_RESPONSE_BYTES {
            return Err(McpError::TooLarge(bytes.len() as u64));
        }
        // CP-06-1: ردّ Streamable HTTP قد يكون تيّار أحداث يحمل رسالة الردّ.
        let document: Value = if content_type.starts_with("text/event-stream") {
            sse_response(&bytes, &id)?
        } else {
            serde_json::from_slice(&bytes).map_err(|e| McpError::Malformed(format!("the response is not JSON: {e}")))?
        };
        if let Some(error) = document.get("error") {
            let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
            let message = sanitize::clean_text(error.get("message").and_then(Value::as_str).unwrap_or(""), 300);
            return Err(McpError::Remote { code, message });
        }
        let result = document.get("result").cloned().ok_or_else(|| McpError::Malformed("the response carries neither a result nor an error".into()))?;
        Ok((result, timing))
    }

    /// إشعار JSON-RPC بلا معرّف: يُقبل أي ردّ 2xx (عادة 202 بلا جسم)، ولا يُقرأ جسم.
    fn notify(&self, endpoint: &ResolvedEndpoint, method: &str, timeout_ms: u64, cancel: &CancelToken) -> Result<(), McpError> {
        let body = json!({ "jsonrpc": "2.0", "method": method }).to_string().into_bytes();
        let response = self.http.send(endpoint, self.request(endpoint, body, timeout_ms), cancel).map_err(|error| match error.kind {
            TransportErrorKind::Cancelled => McpError::Cancelled,
            TransportErrorKind::Timeout | TransportErrorKind::ConnectTimeout => McpError::TimedOut,
            _ => McpError::Unreachable(error.detail),
        })?;
        if (200..300).contains(&response.status) {
            Ok(())
        } else {
            Err(McpError::Unreachable(format!("the server refused {method} with status {}", response.status)))
        }
    }

    /// تهيئة. تثبت أن الطرف الآخر يتكلّم البروتوكول قبل أن يُسأل عن أدواته، ثم تُعلمه بانتهائها (CP-06-3).
    pub fn initialize(&self, endpoint: &ResolvedEndpoint, timeout_ms: u64, cancel: &CancelToken) -> Result<Value, McpError> {
        let params = json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            // لا قدرة تُطلب من الخادم: نحن من نستدعيه، ولا نمنحه شيئًا.
            "capabilities": {},
            "clientInfo": { "name": "POLARIS", "version": env!("CARGO_PKG_VERSION") },
        });
        let (value, _) = self.call(endpoint, "initialize", params, timeout_ms, cancel)?;
        self.notify(endpoint, "notifications/initialized", timeout_ms, cancel)?;
        if let Ok(mut i) = self.initialized.lock() {
            i.insert(endpoint.display());
        }
        Ok(value)
    }

    /// يهيّئ الخادم مرة في هذه العملية قبل أول نداء يحتاجها.
    fn ensure_initialized(&self, endpoint: &ResolvedEndpoint, timeout_ms: u64, cancel: &CancelToken) -> Result<(), McpError> {
        let done = self.initialized.lock().map(|i| i.contains(&endpoint.display())).unwrap_or(false);
        if !done {
            self.initialize(endpoint, timeout_ms, cancel)?;
        }
        Ok(())
    }

    /// قائمة الأدوات كما أعلنها الخادم. بيانات خام، تُطهَّر ثم تُتحقَّق بعد ذلك.
    pub fn list_tools(&self, endpoint: &ResolvedEndpoint, timeout_ms: u64, cancel: &CancelToken) -> Result<Vec<Value>, McpError> {
        self.ensure_initialized(endpoint, timeout_ms, cancel)?;
        let (result, _) = self.call(endpoint, "tools/list", json!({}), timeout_ms, cancel)?;
        let tools = result.get("tools").and_then(Value::as_array).ok_or_else(|| McpError::Malformed("tools/list returned no tools array".into()))?;
        if tools.len() > sanitize::MAX_TOOLS_PER_SERVER {
            return Err(McpError::TooLarge(tools.len() as u64));
        }
        Ok(tools.clone())
    }

    /// ينفّذ أداة. اسم الأداة هو الاسم الذي أعلنه الخادم، لا معرّفنا المركّب. جلسة أنهاها الخادم تُعاد مرة واحدة.
    pub fn call_tool(&self, endpoint: &ResolvedEndpoint, declared_name: &str, arguments: &Value, timeout_ms: u64, cancel: &CancelToken) -> Result<(Value, CallTiming), McpError> {
        self.ensure_initialized(endpoint, timeout_ms, cancel)?;
        let params = json!({ "name": declared_name, "arguments": arguments });
        match self.call(endpoint, "tools/call", params.clone(), timeout_ms, cancel) {
            Err(McpError::Unreachable(detail)) if detail == SESSION_ENDED => {
                self.initialize(endpoint, timeout_ms, cancel)?;
                self.call(endpoint, "tools/call", params, timeout_ms, cancel)
            }
            other => other,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_destination_outside_the_loopback_interface_is_refused_before_any_connection() {
        for raw in ["https://example.invalid/mcp", "http://10.0.0.5:4200", "http://example.com", "file:///C:/tools/server", "http://127.0.0.1:4200?token=abc"] {
            assert!(resolve(raw).is_err(), "{raw} resolved");
        }
    }

    #[test]
    fn a_registered_remote_server_must_be_public_https_without_query_or_credential() {
        let (remote, transport) = resolve_registered("https://learn.microsoft.com/api/mcp").expect("public https resolves");
        assert_eq!(transport, McpTransport::RemoteHttps);
        assert_eq!(remote.base_path, "/api/mcp");
        assert_eq!(resolve_registered("http://127.0.0.1:4200/mcp").unwrap().1, McpTransport::LoopbackHttp);
        for raw in [
            "http://example.com/mcp",
            "https://10.0.0.5/mcp",
            "https://192.168.1.2/mcp",
            "https://169.254.169.254/latest",
            "https://user:secret@example.com/mcp",
            "https://example.com/mcp?token=abc",
            "file:///C:/tools/server",
        ] {
            assert!(resolve_registered(raw).is_err(), "{raw} was accepted");
        }
    }

    #[test]
    fn a_loopback_destination_resolves_and_keeps_its_base_path() {
        let resolved = resolve("http://127.0.0.1:4200/mcp").expect("loopback resolves");
        assert_eq!(resolved.base_path, "/mcp");
        assert_eq!(resolved.port, 4200);
        assert_eq!(resolve("http://localhost:4200").unwrap().base_path, "");
    }

    #[test]
    fn a_url_carrying_a_credential_is_refused() {
        assert!(resolve("http://user:secret@127.0.0.1:4200").is_err());
    }

    #[test]
    fn the_response_is_read_from_an_event_stream_by_its_id_and_other_messages_are_ignored() {
        let id = "8f1c2b3a-0000-4000-8000-000000000001";
        let stream = format!(
            "event: message\ndata: {{\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{{}}}}\n\n\
             data: {{\"jsonrpc\":\"2.0\",\"id\":\"other\",\"result\":{{\"x\":1}}}}\n\n\
             data: {{\"jsonrpc\":\"2.0\",\"id\":\"{id}\",\"result\":{{\"tools\":[]}}}}\n\n"
        );
        assert_eq!(sse_response(stream.as_bytes(), id).unwrap()["result"], json!({ "tools": [] }));
        assert!(matches!(sse_response(b"data: not json\n\n", id), Err(McpError::Malformed(_))));
    }

    #[test]
    fn only_a_visible_ascii_session_id_is_kept() {
        assert!(valid_session_id("1868a90c-9f1b-4b3a-8f3e-6c1f0b0a2d11"));
        for bad in ["", "has space", "line\nbreak", &"x".repeat(300)] {
            assert!(!valid_session_id(bad), "{bad:?} was accepted");
        }
    }

    #[test]
    fn a_cancelled_call_does_not_open_a_connection() {
        let client = McpClient::new(Arc::new(HttpClient::new()));
        let endpoint = resolve("http://127.0.0.1:1/mcp").unwrap();
        let cancel = CancelToken::new();
        cancel.cancel();
        assert_eq!(client.call(&endpoint, "tools/list", json!({}), 1000, &cancel), Err(McpError::Cancelled));
    }

    #[test]
    fn an_unreachable_server_is_reported_as_unreachable_not_as_a_malformed_result() {
        let client = McpClient::new(Arc::new(HttpClient::new()));
        // المنفذ 1 محجوز ولا يستمع عليه شيء في بيئة الاختبار.
        let endpoint = resolve("http://127.0.0.1:1/mcp").unwrap();
        let cancel = CancelToken::new();
        let outcome = client.call(&endpoint, "tools/list", json!({}), 400, &cancel);
        assert!(matches!(outcome, Err(McpError::Unreachable(_)) | Err(McpError::TimedOut)), "an unreachable server produced {outcome:?}");
    }

    #[test]
    fn every_error_maps_to_a_code_from_the_closed_vocabulary() {
        let codes = [
            McpError::EndpointRefused("x".into()).as_code(),
            McpError::Unreachable("x".into()).as_code(),
            McpError::TimedOut.as_code(),
            McpError::Cancelled.as_code(),
            McpError::TooLarge(1).as_code(),
            McpError::Malformed("x".into()).as_code(),
            McpError::Remote { code: -32000, message: "x".into() }.as_code(),
        ];
        for code in codes {
            assert!(crate::p04::gateway::DenialReason::parse(code).is_some(), "{code} is not a denial reason in the contract vocabulary");
        }
    }
}
