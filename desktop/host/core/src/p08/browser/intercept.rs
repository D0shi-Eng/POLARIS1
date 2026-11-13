// المعترِض: كل طلب شبكة من الصفحة (مستند، نصّ برمجي، صورة، XHR، إطار) يتوقّف في المتصفّح
// حتى يقرّر المضيف فيه. القرار هو سياسة التنقّل نفسها لكل طلب ولكل إعادة توجيه، والجلب يجريه
// عميل HTTP المضيف (حلّ الاسم مرة لحظة الاتصال ورفض أي عنوان غير عام)، ثم يُسلَّم الردّ للمتصفّح.
//
// ما يترتّب على ذلك: المتصفّح لا يحلّ اسمًا ولا يفتح اتصالًا بنفسه لطلب معترَض؛ إعادة التوجيه
// تُعاد إليه كما هي فيطلب الوجهة الجديدة فتُعترض وتُفحص من جديد؛ والطلب الذي يكتب (POST وأخواته)
// لا يُرسل إلى أصل لم يُوافَق عليه. والتنزيل لا يُفتح: يُحفظ في `downloads/` معزولًا.

use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use polaris_host_providers::net::{web_destination, CancelToken, HttpClient, HttpRequest};
use serde::Serialize;
use serde_json::{json, Value};
use url::Url;

use crate::p05::browser::url_policy::{DestinationClass, NavigationPolicy};

use super::cdp::CdpConnection;

pub const MAX_RESPONSE_BYTES: usize = 20 * 1024 * 1024;
const MAX_IN_FLIGHT: usize = 24;
const LOG_LIMIT: usize = 600;

/// سطر في سجلّ طلبات الجلسة: ما طُلب، وما قُرّر، وما عاد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RequestLog {
    pub url: String,
    pub method: String,
    pub resource: String,
    pub decision: String,
    pub status: Option<u16>,
    pub bytes: usize,
}

/// تنزيل حفظه المعترِض ولم يفتحه.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedDownload {
    pub source_url: String,
    pub file_name: String,
    pub relative_path: String,
    pub bytes: Vec<u8>,
    pub content_type: String,
}

/// ما يتشاركه المعترِض وجلسة المتصفّح.
#[derive(Default)]
pub struct InterceptState {
    pub log: Mutex<Vec<RequestLog>>,
    /// الأصول التي وافق المستخدم على إرسال بيانات إليها (طلب كتابة).
    pub write_grants: Mutex<HashSet<String>>,
    pub in_flight: AtomicUsize,
    pub last_activity: Mutex<Option<Instant>>,
    pub downloads: Mutex<Vec<SavedDownload>>,
    pub denied: AtomicUsize,
}

impl InterceptState {
    fn record(&self, entry: RequestLog) {
        if let Ok(mut log) = self.log.lock() {
            if log.len() >= LOG_LIMIT {
                log.remove(0);
            }
            log.push(entry);
        }
        if let Ok(mut t) = self.last_activity.lock() {
            *t = Some(Instant::now());
        }
    }

    /// هل هدأت الشبكة: لا طلب جارٍ، ولا نشاط منذ `quiet`.
    pub fn quiet_for(&self, quiet: Duration) -> bool {
        self.in_flight.load(Ordering::SeqCst) == 0 && self.last_activity.lock().ok().and_then(|t| *t).is_none_or(|t| t.elapsed() >= quiet)
    }
}

/// ما يحتاجه المعترِض ليقرّر ويجلب.
#[derive(Clone)]
pub struct Interceptor {
    pub conn: Arc<CdpConnection>,
    pub http: Arc<HttpClient>,
    pub policy: NavigationPolicy,
    pub state: Arc<InterceptState>,
    pub cancel: CancelToken,
}

fn origin_of(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// ترويسات الطلب التي تُمرَّر إلى الخادم. قائمة مغلقة: لا ترويسة يختارها نصّ الصفحة بحرّية.
const FORWARDED: [(&str, &str); 10] = [
    ("accept", "Accept"),
    ("accept-language", "Accept-Language"),
    ("content-type", "Content-Type"),
    ("user-agent", "User-Agent"),
    ("referer", "Referer"),
    ("origin", "Origin"),
    ("x-requested-with", "X-Requested-With"),
    ("range", "Range"),
    ("if-none-match", "If-None-Match"),
    ("if-modified-since", "If-Modified-Since"),
];

/// ترويسات الردّ التي لا تُسلَّم للمتصفّح: خاصّة بالاتصال لا بالمورد.
const HOP_BY_HOP: [&str; 6] = ["connection", "keep-alive", "transfer-encoding", "content-length", "proxy-connection", "upgrade"];

fn is_renderable(content_type: &str) -> bool {
    let ct = content_type.to_ascii_lowercase();
    ct.is_empty()
        || ct.starts_with("text/")
        || ct.starts_with("image/")
        || ct.starts_with("font/")
        || ct.contains("javascript")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.starts_with("application/wasm")
}

fn safe_download_name(url: &Url, disposition: Option<&str>) -> String {
    let from_header = disposition.and_then(|d| d.split(';').find_map(|p| p.trim().strip_prefix("filename=").map(|v| v.trim_matches('"').to_string())));
    let raw = from_header.or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(str::to_string))).unwrap_or_default();
    let cleaned: String = raw.chars().filter(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ')).take(120).collect();
    let cleaned = cleaned.trim().trim_matches('.').to_string();
    if cleaned.is_empty() { "download.bin".into() } else { cleaned }
}

impl Interceptor {
    fn fail(&self, request_id: &str, session: Option<&str>, reason: &str) {
        self.conn.send("Fetch.failRequest", json!({ "requestId": request_id, "errorReason": reason }), session);
    }

    fn fulfill(&self, request_id: &str, session: Option<&str>, status: u16, headers: Vec<(String, String)>, body: &[u8]) {
        let headers: Vec<Value> = headers.into_iter().map(|(n, v)| json!({ "name": n, "value": v })).collect();
        let body = base64::engine::general_purpose::STANDARD.encode(body);
        self.conn.send("Fetch.fulfillRequest", json!({ "requestId": request_id, "responseCode": status, "responseHeaders": headers, "body": body }), session);
    }

    /// يعالج حدث `Fetch.requestPaused` في خيط مستقل، بسقف للطلبات المتزامنة.
    pub fn handle(&self, params: Value, session: Option<String>) {
        let Some(request_id) = params.get("requestId").and_then(Value::as_str).map(str::to_string) else { return };
        if self.state.in_flight.fetch_add(1, Ordering::SeqCst) >= MAX_IN_FLIGHT {
            self.state.in_flight.fetch_sub(1, Ordering::SeqCst);
            self.fail(&request_id, session.as_deref(), "BlockedByClient");
            return;
        }
        let me = self.clone();
        let spawned = std::thread::Builder::new().name("polaris-cdp-fetch".into()).spawn(move || {
            me.decide(&request_id, &params, session.as_deref());
            me.state.in_flight.fetch_sub(1, Ordering::SeqCst);
        });
        if spawned.is_err() {
            self.state.in_flight.fetch_sub(1, Ordering::SeqCst);
        }
    }

    fn decide(&self, request_id: &str, params: &Value, session: Option<&str>) {
        let request = params.get("request").cloned().unwrap_or(Value::Null);
        let raw_url = request.get("url").and_then(Value::as_str).unwrap_or("").to_string();
        let method = request.get("method").and_then(Value::as_str).unwrap_or("GET").to_ascii_uppercase();
        let resource = params.get("resourceType").and_then(Value::as_str).unwrap_or("Other").to_string();
        let short: String = raw_url.chars().take(300).collect();
        let deny = |reason: &str| {
            self.state.denied.fetch_add(1, Ordering::SeqCst);
            self.state.record(RequestLog { url: short.clone(), method: method.clone(), resource: resource.clone(), decision: reason.into(), status: None, bytes: 0 });
            self.fail(request_id, session, "BlockedByClient");
        };
        if self.cancel.is_cancelled() {
            return deny("CANCELLED");
        }
        let Ok(url) = Url::parse(&raw_url) else { return deny("INVALID_URL") };
        let class = match self.policy.check(&url) {
            Ok(c) => c,
            Err(d) => return deny(d.as_str()),
        };
        let writes = !matches!(method.as_str(), "GET" | "HEAD" | "OPTIONS");
        if writes && !self.state.write_grants.lock().map(|g| g.contains(&origin_of(&url))).unwrap_or(false) {
            return deny("WRITE_NEEDS_APPROVAL");
        }
        let endpoint = match web_destination(&url, class == DestinationClass::TestFixture) {
            Ok(e) => e,
            Err(_) => return deny("PRIVATE_ADDRESS_DENIED"),
        };
        let mut headers: Vec<(&'static str, String)> = Vec::new();
        if let Some(map) = request.get("headers").and_then(Value::as_object) {
            for (name, value) in map {
                let lower = name.to_ascii_lowercase();
                if let Some((_, canonical)) = FORWARDED.iter().find(|(l, _)| *l == lower) {
                    if let Some(v) = value.as_str().filter(|v| !v.contains(['\r', '\n']) && v.len() <= 4096) {
                        headers.push((canonical, v.to_string()));
                    }
                }
            }
        }
        // ملفات تعريف الارتباط يملكها المتصفّح؛ تُقرأ منه لهذا العنوان وحده.
        if let Ok(cookies) = self.conn.call("Network.getCookies", json!({ "urls": [raw_url] }), session, Duration::from_secs(5)) {
            let pairs: Vec<String> = cookies.get("cookies").and_then(Value::as_array).into_iter().flatten().filter_map(|c| Some(format!("{}={}", c.get("name")?.as_str()?, c.get("value")?.as_str()?))).collect();
            if !pairs.is_empty() {
                headers.push(("Cookie", pairs.join("; ")));
            }
        }
        let body = request.get("postData").and_then(Value::as_str).map(|s| s.as_bytes().to_vec());
        let mut path = url.path().to_string();
        if path.is_empty() {
            path.push('/');
        }
        if let Some(q) = url.query() {
            path.push('?');
            path.push_str(q);
        }
        let http_request = HttpRequest { method: &method, path, headers, body, deadline: Instant::now() + Duration::from_secs(30), idle: None };
        let mut response = match self.http.send(&endpoint, http_request, &self.cancel) {
            Ok(r) => r,
            Err(e) => return deny(&format!("FETCH_{:?}", e.kind).to_ascii_uppercase()),
        };
        let bytes = match response.body.read_all(MAX_RESPONSE_BYTES + 1) {
            Ok(b) if b.len() <= MAX_RESPONSE_BYTES => b,
            _ => return deny("RESULT_TOO_LARGE"),
        };
        let status = response.status;
        let content_type = response.header("content-type").unwrap_or("").to_string();
        let disposition = response.header("content-disposition").map(str::to_string);
        let is_download = resource == "Document" && (200..300).contains(&status) && (disposition.as_deref().is_some_and(|d| d.to_ascii_lowercase().contains("attachment")) || !is_renderable(&content_type));
        if is_download {
            let name = safe_download_name(&url, disposition.as_deref());
            if let Ok(mut d) = self.state.downloads.lock() {
                d.push(SavedDownload { source_url: short.clone(), file_name: name.clone(), relative_path: String::new(), bytes: bytes.clone(), content_type: content_type.clone() });
            }
            self.state.record(RequestLog { url: short, method, resource, decision: "DOWNLOAD_QUARANTINED".into(), status: Some(status), bytes: bytes.len() });
            let page = format!("<!doctype html><meta charset=utf-8><title>Download saved</title><p>POLARIS saved this download to the mission's downloads folder as <b>{}</b>. It was not opened.</p>", super::page::html_escape(&name));
            return self.fulfill(request_id, session, 200, vec![("Content-Type".into(), "text/html; charset=utf-8".into())], page.as_bytes());
        }
        let headers: Vec<(String, String)> = response.headers.iter().filter(|(n, _)| !HOP_BY_HOP.contains(&n.to_ascii_lowercase().as_str())).cloned().collect();
        self.state.record(RequestLog { url: short, method, resource, decision: if class == DestinationClass::TestFixture { "ALLOWED_FIXTURE".into() } else { "ALLOWED".into() }, status: Some(status), bytes: bytes.len() });
        self.fulfill(request_id, session, status, headers, &bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_names_are_reduced_to_a_safe_file_name() {
        let url = Url::parse("https://example.com/files/report.pdf").unwrap();
        assert_eq!(safe_download_name(&url, None), "report.pdf");
        assert_eq!(safe_download_name(&url, Some("attachment; filename=\"..\\\\..\\\\evil.exe\"")), "....evil.exe".trim_matches('.'));
        assert_eq!(safe_download_name(&Url::parse("https://example.com/").unwrap(), None), "download.bin");
    }

    #[test]
    fn documents_that_are_not_renderable_are_downloads() {
        assert!(is_renderable("text/html; charset=utf-8"));
        assert!(is_renderable("application/javascript"));
        assert!(!is_renderable("application/pdf"));
        assert!(!is_renderable("application/octet-stream"));
    }
}
