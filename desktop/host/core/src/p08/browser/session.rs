// جلسة Chromium واحدة لمهمّة واحدة: عملية في كائن مهمّة، واتصال CDP، ومعترِض لكل طلب، وخيط
// أحداث يغلق الحوارات ويضبط كل هدف جديد (نافذة منبثقة، إطار، عامل) قبل أن يعمل.
//
// الأفعال (فتح، قراءة، نقر، كتابة، اختيار، مفتاح، تمرير، انتظار، لقطة، رفع) تُنفَّذ على الهدف
// الأساسي. القراءة والتحديد من عالم معزول؛ النقر والكتابة أحداث إدخال موثوقة يرسلها المضيف.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use polaris_host_providers::net::{CancelToken, HttpClient};
use serde::Serialize;
use serde_json::{json, Value};

use crate::p05::browser::url_policy::NavigationPolicy;

use super::cdp::{CdpConnection, CdpEvent};
use super::intercept::{InterceptState, Interceptor};
use super::page::{js_string, with_ref, CONTAINS, FOCUS, LOCATE, SELECT, SNAPSHOT};

/// المفاتيح التي يقبلها `key()`، بالترتيب نفسه. يقرؤها مخطط أداة «press» (CP-03-1)؛ مفتاح يُضاف هنا يُضاف هناك.
pub const KEYS: [&str; 13] = ["Enter", "Tab", "Escape", "Backspace", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End", "Space"];
use super::port::BrowserProcess;

const CALL: Duration = Duration::from_secs(15);
pub const MAX_WAIT_MS: u64 = 30_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TabInfo {
    pub target_id: String,
    pub url: String,
    pub title: String,
    pub primary: bool,
}

/// هدف مُلحَق: جلسته المسطّحة ونوعه.
#[derive(Debug, Clone)]
struct Attached {
    session: String,
    target_id: String,
    kind: String,
}

#[derive(Default)]
struct Shared {
    attached: Mutex<Vec<Attached>>,
    tabs: Mutex<Vec<TabInfo>>,
    dialogs_dismissed: Mutex<u32>,
    loads: Mutex<u64>,
    contexts_cleared: AtomicBool,
}

pub struct BrowserSession {
    pub session_id: String,
    pub mission_id: String,
    process: Mutex<Box<dyn BrowserProcess>>,
    conn: Arc<CdpConnection>,
    primary: Mutex<Attached>,
    world: Mutex<Option<i64>>,
    shared: Arc<Shared>,
    pub state: Arc<InterceptState>,
    pub cancel: CancelToken,
}

fn setup_target(conn: &CdpConnection, session: &str, kind: &str) {
    // المعترِض أولًا، ثم ما يلزم الصفحة، ثم يُسمح للهدف أن يعمل. طلب قبل هذا لا يوجد.
    conn.send("Fetch.enable", json!({ "patterns": [{ "urlPattern": "*", "requestStage": "Request" }] }), Some(session));
    conn.send("Network.setBypassServiceWorker", json!({ "bypass": true }), Some(session));
    if kind == "page" || kind == "iframe" {
        conn.send("Page.enable", json!({}), Some(session));
    }
    conn.send("Target.setAutoAttach", json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }), Some(session));
    conn.send("Runtime.runIfWaitingForDebugger", json!({}), Some(session));
}

fn event_loop(events: Receiver<CdpEvent>, conn: Arc<CdpConnection>, shared: Arc<Shared>, interceptor: Interceptor) {
    for event in events {
        let session = event.session_id.clone();
        match event.method.as_str() {
            "Fetch.requestPaused" => interceptor.handle(event.params, session),
            "Target.attachedToTarget" => {
                let child = event.params.get("sessionId").and_then(Value::as_str).unwrap_or("").to_string();
                let info = event.params.get("targetInfo").cloned().unwrap_or(Value::Null);
                let kind = info.get("type").and_then(Value::as_str).unwrap_or("other").to_string();
                let target_id = info.get("targetId").and_then(Value::as_str).unwrap_or("").to_string();
                if child.is_empty() {
                    continue;
                }
                setup_target(&conn, &child, &kind);
                if let Ok(mut a) = shared.attached.lock() {
                    a.push(Attached { session: child, target_id: target_id.clone(), kind: kind.clone() });
                }
                if kind == "page" {
                    if let Ok(mut tabs) = shared.tabs.lock() {
                        if !tabs.iter().any(|t| t.target_id == target_id) {
                            tabs.push(TabInfo { target_id, url: info.get("url").and_then(Value::as_str).unwrap_or("").chars().take(600).collect(), title: String::new(), primary: false });
                        }
                    }
                }
            }
            "Target.targetInfoChanged" => {
                let info = event.params.get("targetInfo").cloned().unwrap_or(Value::Null);
                let id = info.get("targetId").and_then(Value::as_str).unwrap_or("");
                if let Ok(mut tabs) = shared.tabs.lock() {
                    if let Some(t) = tabs.iter_mut().find(|t| t.target_id == id) {
                        t.url = info.get("url").and_then(Value::as_str).unwrap_or("").chars().take(600).collect();
                        t.title = info.get("title").and_then(Value::as_str).unwrap_or("").chars().take(300).collect();
                    }
                }
            }
            "Target.targetDestroyed" | "Target.detachedFromTarget" => {
                let id = event.params.get("targetId").and_then(Value::as_str).unwrap_or("").to_string();
                let sid = event.params.get("sessionId").and_then(Value::as_str).unwrap_or("").to_string();
                if let Ok(mut tabs) = shared.tabs.lock() {
                    tabs.retain(|t| t.target_id != id || t.primary);
                }
                if let Ok(mut a) = shared.attached.lock() {
                    a.retain(|x| x.session != sid && (id.is_empty() || x.target_id != id));
                }
            }
            // لا حوار يُقبل نيابةً عن المستخدم: تنبيه أو تأكيد أو إدخال يُرفض ويُعدّ.
            "Page.javascriptDialogOpening" => {
                conn.send("Page.handleJavaScriptDialog", json!({ "accept": false }), session.as_deref());
                if let Ok(mut n) = shared.dialogs_dismissed.lock() {
                    *n += 1;
                }
            }
            "Page.loadEventFired" => {
                if let Ok(mut n) = shared.loads.lock() {
                    *n += 1;
                }
            }
            "Runtime.executionContextsCleared" | "Page.frameNavigated" => shared.contexts_cleared.store(true, Ordering::SeqCst),
            _ => {}
        }
    }
}

/// نتيجة نصّية مقروءة من الصفحة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Snapshot {
    pub url: String,
    pub title: String,
    pub text: String,
    pub truncated: bool,
    pub items: Vec<Value>,
    /// جداول الصفحة صفوفًا من خلايا (Phase-08): بنية DOM نفسها، لا نثرًا يُستنتج منه الجدول.
    /// محتواها WEB_UNTRUSTED كبقية الصفحة.
    #[serde(default)]
    pub tables: Vec<Value>,
}

impl BrowserSession {
    /// يشغّل المتصفّح ويتصل به ويلحق الصفحة الأولى بمعترِضها قبل أي تنقّل.
    pub fn start(session_id: String, mission_id: String, mut process: Box<dyn BrowserProcess>, http: Arc<HttpClient>, policy: NavigationPolicy) -> Result<Self, String> {
        let (port, path) = process.devtools();
        let (conn, events) = match CdpConnection::connect(port, &path) {
            Ok(c) => c,
            Err(e) => {
                process.kill();
                return Err(e);
            }
        };
        let state = Arc::new(InterceptState::default());
        let cancel = CancelToken::new();
        let shared = Arc::new(Shared::default());
        let interceptor = Interceptor { conn: conn.clone(), http, policy, state: state.clone(), cancel: cancel.clone() };
        let (c2, s2) = (conn.clone(), shared.clone());
        std::thread::Builder::new().name("polaris-cdp-events".into()).spawn(move || event_loop(events, c2, s2, interceptor)).map_err(|e| e.to_string())?;
        let setup = || -> Result<Attached, String> {
            conn.call("Browser.setDownloadBehavior", json!({ "behavior": "deny" }), None, CALL)?;
            conn.call("Target.setDiscoverTargets", json!({ "discover": true }), None, CALL)?;
            conn.call("Target.setAutoAttach", json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }), None, CALL)?;
            let targets = conn.call("Target.getTargets", json!({}), None, CALL)?;
            let page = targets.get("targetInfos").and_then(Value::as_array).into_iter().flatten().find(|t| t.get("type").and_then(Value::as_str) == Some("page")).cloned();
            let target_id = match page.and_then(|p| p.get("targetId").and_then(Value::as_str).map(str::to_string)) {
                Some(id) => id,
                None => conn.call("Target.createTarget", json!({ "url": "about:blank" }), None, CALL)?.get("targetId").and_then(Value::as_str).ok_or("no page target")?.to_string(),
            };
            // قد يكون الإلحاق التلقائي قد ألحقه؛ وإلا يُلحق صراحةً.
            let deadline = Instant::now() + Duration::from_secs(3);
            loop {
                if let Some(a) = shared.attached.lock().ok().and_then(|a| a.iter().find(|x| x.target_id == target_id).cloned()) {
                    return Ok(a);
                }
                if Instant::now() > deadline {
                    let attached = conn.call("Target.attachToTarget", json!({ "targetId": target_id, "flatten": true }), None, CALL)?;
                    let session = attached.get("sessionId").and_then(Value::as_str).ok_or("no session")?.to_string();
                    setup_target(&conn, &session, "page");
                    return Ok(Attached { session, target_id: target_id.clone(), kind: "page".into() });
                }
                std::thread::sleep(Duration::from_millis(30));
            }
        };
        let primary = match setup() {
            Ok(p) => p,
            Err(e) => {
                conn.close();
                process.kill();
                return Err(e);
            }
        };
        if let Ok(mut tabs) = shared.tabs.lock() {
            tabs.retain(|t| t.target_id != primary.target_id);
            tabs.insert(0, TabInfo { target_id: primary.target_id.clone(), url: "about:blank".into(), title: String::new(), primary: true });
        }
        Ok(Self { session_id, mission_id, process: Mutex::new(process), conn, primary: Mutex::new(primary), world: Mutex::new(None), shared, state, cancel })
    }

    fn page(&self) -> Attached {
        self.primary.lock().map(|p| p.clone()).unwrap_or_else(|p| p.into_inner().clone())
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        if self.cancel.is_cancelled() {
            return Err("CANCELLED".into());
        }
        self.conn.call(method, params, Some(&self.page().session), CALL)
    }

    /// عالم معزول على الإطار الرئيسي، يُعاد إنشاؤه بعد كل تنقّل.
    fn world(&self, fresh: bool) -> Result<i64, String> {
        let cleared = self.shared.contexts_cleared.swap(false, Ordering::SeqCst);
        if !fresh && !cleared {
            if let Some(id) = self.world.lock().ok().and_then(|w| *w) {
                return Ok(id);
            }
        }
        let tree = self.call("Page.getFrameTree", json!({}))?;
        let frame = tree.pointer("/frameTree/frame/id").and_then(Value::as_str).ok_or("no main frame")?.to_string();
        let created = self.call("Page.createIsolatedWorld", json!({ "frameId": frame, "worldName": "polaris-reader", "grantUniveralAccess": false }))?;
        let id = created.get("executionContextId").and_then(Value::as_i64).ok_or("no isolated world")?;
        if let Ok(mut w) = self.world.lock() {
            *w = Some(id);
        }
        Ok(id)
    }

    fn evaluate(&self, expression: &str, fresh_world: bool) -> Result<Value, String> {
        let context = self.world(fresh_world)?;
        let result = self.call("Runtime.evaluate", json!({ "expression": expression, "contextId": context, "returnByValue": true, "timeout": 5000 }))?;
        if let Some(ex) = result.get("exceptionDetails") {
            return Err(format!("SCRIPT_ERROR: {}", ex.pointer("/exception/description").and_then(Value::as_str).unwrap_or("error").chars().take(200).collect::<String>()));
        }
        Ok(result.pointer("/result/value").cloned().unwrap_or(Value::Null))
    }

    /// ينتظر اكتمال المستند وهدوء الشبكة، بسقف.
    pub fn settle(&self, max: Duration) {
        let deadline = Instant::now() + max;
        std::thread::sleep(Duration::from_millis(150));
        while Instant::now() < deadline && !self.cancel.is_cancelled() {
            let ready = self.evaluate("document.readyState", true).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
            if ready == "complete" && self.state.quiet_for(Duration::from_millis(400)) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    pub fn navigate(&self, url: &str) -> Result<(), String> {
        let result = self.call("Page.navigate", json!({ "url": url }))?;
        if let Some(err) = result.get("errorText").and_then(Value::as_str) {
            return Err(format!("NAVIGATION_FAILED: {err}"));
        }
        self.settle(Duration::from_secs(30));
        Ok(())
    }

    pub fn history(&self, delta: i64) -> Result<(), String> {
        let h = self.call("Page.getNavigationHistory", json!({}))?;
        let current = h.get("currentIndex").and_then(Value::as_i64).unwrap_or(0);
        let entries = h.get("entries").and_then(Value::as_array).cloned().unwrap_or_default();
        let target = current + delta;
        let entry = usize::try_from(target).ok().and_then(|i| entries.get(i)).ok_or("NO_HISTORY_ENTRY")?;
        let id = entry.get("id").and_then(Value::as_i64).ok_or("NO_HISTORY_ENTRY")?;
        self.call("Page.navigateToHistoryEntry", json!({ "entryId": id }))?;
        self.settle(Duration::from_secs(20));
        Ok(())
    }

    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let raw = self.evaluate(SNAPSHOT, true)?;
        let v: Value = serde_json::from_str(raw.as_str().unwrap_or("{}")).map_err(|_| "the page could not be read")?;
        Ok(Snapshot {
            url: v.get("url").and_then(Value::as_str).unwrap_or("").into(),
            title: v.get("title").and_then(Value::as_str).unwrap_or("").into(),
            text: v.get("text").and_then(Value::as_str).unwrap_or("").into(),
            truncated: v.get("truncated").and_then(Value::as_bool).unwrap_or(false),
            items: v.get("items").and_then(Value::as_array).cloned().unwrap_or_default(),
            tables: v.get("tables").and_then(Value::as_array).cloned().unwrap_or_default(),
        })
    }

    fn locate(&self, reference: u32) -> Result<Value, String> {
        let raw = self.evaluate(&with_ref(LOCATE, reference), false)?;
        let v: Value = serde_json::from_str(raw.as_str().unwrap_or("{}")).map_err(|_| "STALE_REF")?;
        if let Some(e) = v.get("error").and_then(Value::as_str) {
            return Err(e.into());
        }
        Ok(v)
    }

    fn mouse(&self, kind: &str, x: f64, y: f64, button: &str, clicks: u32, delta_y: f64) -> Result<(), String> {
        let mut p = json!({ "type": kind, "x": x, "y": y, "button": button, "clickCount": clicks });
        if kind == "mouseWheel" {
            p["deltaX"] = json!(0);
            p["deltaY"] = json!(delta_y);
        }
        self.call("Input.dispatchMouseEvent", p).map(|_| ())
    }

    pub fn click(&self, reference: u32) -> Result<String, String> {
        let at = self.locate(reference)?;
        if at.get("disabled").and_then(Value::as_bool) == Some(true) {
            return Err("ELEMENT_DISABLED".into());
        }
        let (x, y) = (at.get("x").and_then(Value::as_f64).unwrap_or(0.0), at.get("y").and_then(Value::as_f64).unwrap_or(0.0));
        self.mouse("mouseMoved", x, y, "none", 0, 0.0)?;
        self.mouse("mousePressed", x, y, "left", 1, 0.0)?;
        self.mouse("mouseReleased", x, y, "left", 1, 0.0)?;
        self.settle(Duration::from_secs(10));
        Ok(format!("{} {}", at.get("tag").and_then(Value::as_str).unwrap_or(""), at.get("type").and_then(Value::as_str).unwrap_or("")).trim().to_string())
    }

    fn key(&self, key: &str) -> Result<(), String> {
        let (code, vk, text) = match key {
            "Enter" => ("Enter", 13, Some("\r")),
            "Tab" => ("Tab", 9, None),
            "Escape" => ("Escape", 27, None),
            "Backspace" => ("Backspace", 8, None),
            "ArrowDown" => ("ArrowDown", 40, None),
            "ArrowUp" => ("ArrowUp", 38, None),
            "ArrowLeft" => ("ArrowLeft", 37, None),
            "ArrowRight" => ("ArrowRight", 39, None),
            "PageDown" => ("PageDown", 34, None),
            "PageUp" => ("PageUp", 33, None),
            "Home" => ("Home", 36, None),
            "End" => ("End", 35, None),
            "Space" => ("Space", 32, Some(" ")),
            _ => return Err("KEY_NOT_ALLOWED".into()),
        };
        let mut down = json!({ "type": if text.is_some() { "keyDown" } else { "rawKeyDown" }, "key": if key == "Space" { " " } else { key }, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk });
        if let Some(t) = text {
            down["text"] = json!(t);
        }
        self.call("Input.dispatchKeyEvent", down)?;
        self.call("Input.dispatchKeyEvent", json!({ "type": "keyUp", "key": if key == "Space" { " " } else { key }, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk }))?;
        Ok(())
    }

    pub fn press(&self, key: &str) -> Result<(), String> {
        self.key(key)?;
        self.settle(Duration::from_secs(10));
        Ok(())
    }

    pub fn type_text(&self, reference: u32, text: &str, submit: bool, clear: bool) -> Result<(), String> {
        let focus = self.evaluate(&with_ref(FOCUS, reference).replace("CLEAR", if clear { "true" } else { "false" }), false)?;
        match focus.as_str() {
            Some("OK") => {}
            Some(other) => return Err(other.to_string()),
            None => return Err("NOT_FOCUSABLE".into()),
        }
        if !text.is_empty() {
            self.call("Input.insertText", json!({ "text": text }))?;
        }
        if submit {
            self.key("Enter")?;
        }
        self.settle(Duration::from_secs(10));
        Ok(())
    }

    pub fn select(&self, reference: u32, value: &str) -> Result<(), String> {
        let r = self.evaluate(&with_ref(SELECT, reference).replace("VALUE", &js_string(value)), false)?;
        match r.as_str() {
            Some("OK") => {
                self.settle(Duration::from_secs(5));
                Ok(())
            }
            Some(other) => Err(other.into()),
            None => Err("SELECT_FAILED".into()),
        }
    }

    pub fn scroll(&self, down: bool) -> Result<(), String> {
        self.mouse("mouseWheel", 640.0, 450.0, "none", 0, if down { 700.0 } else { -700.0 })?;
        std::thread::sleep(Duration::from_millis(250));
        Ok(())
    }

    /// ينتظر ظهور نصّ، أو مدّة ثابتة إن لم يُسمَّ نصّ. يعيد هل ظهر.
    pub fn wait(&self, text: Option<&str>, max_ms: u64) -> Result<bool, String> {
        let deadline = Instant::now() + Duration::from_millis(max_ms.min(MAX_WAIT_MS));
        loop {
            if let Some(t) = text {
                if self.evaluate(&CONTAINS.replace("NEEDLE", &js_string(t)), true)?.as_bool() == Some(true) {
                    return Ok(true);
                }
            }
            if Instant::now() >= deadline || self.cancel.is_cancelled() {
                return Ok(text.is_none());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    }

    pub fn screenshot(&self) -> Result<Vec<u8>, String> {
        let shot = self.call("Page.captureScreenshot", json!({ "format": "png", "captureBeyondViewport": false }))?;
        let data = shot.get("data").and_then(Value::as_str).ok_or("no screenshot")?;
        base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())
    }

    /// يرفع ملفًّا إلى حقل ملف. المسار مطلق حلّه المضيف من داخل مساحة المهمّة.
    pub fn upload(&self, reference: u32, absolute: &str) -> Result<(), String> {
        let at = self.locate(reference)?;
        if at.get("tag").and_then(Value::as_str) != Some("input") || at.get("type").and_then(Value::as_str) != Some("file") {
            return Err("NOT_A_FILE_INPUT".into());
        }
        let context = self.world(false)?;
        let obj = self.call("Runtime.evaluate", json!({ "expression": format!("(globalThis.__polarisRefs || [])[{} - 1]", reference), "contextId": context, "returnByValue": false }))?;
        let object_id = obj.pointer("/result/objectId").and_then(Value::as_str).ok_or("STALE_REF")?.to_string();
        self.call("DOM.setFileInputFiles", json!({ "files": [absolute], "objectId": object_id }))?;
        self.settle(Duration::from_secs(5));
        Ok(())
    }

    pub fn tabs(&self) -> Vec<TabInfo> {
        let primary = self.page().target_id;
        self.shared.tabs.lock().map(|t| t.iter().cloned().map(|mut x| {
            x.primary = x.target_id == primary;
            x
        }).collect()).unwrap_or_default()
    }

    /// يجعل تبويبًا آخر هو الأساسي (نافذة فتحتها الصفحة).
    pub fn switch_tab(&self, target_id: &str) -> Result<(), String> {
        let attached = self.shared.attached.lock().map_err(|_| "poisoned")?.iter().find(|a| a.target_id == target_id && a.kind == "page").cloned().ok_or("NO_SUCH_TAB")?;
        *self.primary.lock().map_err(|_| "poisoned")? = attached;
        self.shared.contexts_cleared.store(true, Ordering::SeqCst);
        Ok(())
    }

    pub fn close_tab(&self, target_id: &str) -> Result<(), String> {
        if target_id == self.page().target_id {
            return Err("THE_PRIMARY_TAB_CANNOT_BE_CLOSED".into());
        }
        self.conn.call("Target.closeTarget", json!({ "targetId": target_id }), None, CALL).map(|_| ())
    }

    pub fn dialogs_dismissed(&self) -> u32 {
        self.shared.dialogs_dismissed.lock().map(|n| *n).unwrap_or(0)
    }

    pub fn alive(&self) -> bool {
        !self.conn.is_closed() && self.process.lock().map(|p| p.alive()).unwrap_or(false)
    }

    /// يغلق المتصفّح ويقتل الشجرة. يعيد عدد العمليات الباقية (يجب أن يكون صفرًا).
    pub fn close(&self) -> u32 {
        self.cancel.cancel();
        let _ = self.conn.call("Browser.close", json!({}), None, Duration::from_secs(3));
        self.conn.close();
        self.process.lock().map(|mut p| p.kill()).unwrap_or(0)
    }
}
