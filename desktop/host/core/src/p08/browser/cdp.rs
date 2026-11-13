// اتصال بروتوكول أدوات المطوّر (CDP) على مقبس ويب في الحلقة المحلية وحدها.
//
// خيط قارئ واحد يوزّع الردود على من ينتظرها بمعرّف الطلب، ويضع الأحداث في طابور. لا شيء هنا
// يفسّر محتوى الصفحة: هذا نقل فقط. المنفذ الذي يتصل به منفذ حلقة محلية أعلنه المتصفّح
// نفسه في ملف DevToolsActivePort داخل ملف تعريف يملكه POLARIS.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use polaris_host_providers::net::loopback::LoopbackWebSocket;
use serde_json::{json, Value};

/// حدث CDP: الطريقة والمعاملات وجلسة الهدف إن وُجدت.
#[derive(Debug, Clone)]
pub struct CdpEvent {
    pub method: String,
    pub params: Value,
    pub session_id: Option<String>,
}

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;

pub struct CdpConnection {
    writer: Mutex<LoopbackWebSocket>,
    pending: Pending,
    next_id: AtomicU64,
    closed: Arc<AtomicBool>,
}

impl CdpConnection {
    /// يتصل ويعيد الاتصال وطابور الأحداث. الأحداث تُسلَّم بالترتيب الذي وصلت به.
    pub fn connect(port: u16, path: &str) -> Result<(Arc<Self>, Receiver<CdpEvent>), String> {
        let ws = LoopbackWebSocket::connect(port, path, Duration::from_secs(10)).map_err(|e| format!("the browser's debugging socket could not be reached: {e}"))?;
        let mut reader = ws.try_clone().map_err(|e| e.to_string())?;
        reader.set_read_timeout(None).map_err(|e| e.to_string())?;
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let closed = Arc::new(AtomicBool::new(false));
        let (events_tx, events_rx) = channel();
        let (p, c) = (pending.clone(), closed.clone());
        std::thread::Builder::new()
            .name("polaris-cdp-reader".into())
            .spawn(move || {
                while let Ok(Some(message)) = reader.read_message() {
                    let Ok(value) = serde_json::from_str::<Value>(&message) else { continue };
                    if let Some(id) = value.get("id").and_then(Value::as_u64) {
                        let waiter = p.lock().ok().and_then(|mut m| m.remove(&id));
                        if let Some(tx) = waiter {
                            let result = match value.get("error") {
                                Some(e) => Err(e.get("message").and_then(Value::as_str).unwrap_or("CDP error").chars().take(300).collect()),
                                None => Ok(value.get("result").cloned().unwrap_or(Value::Null)),
                            };
                            let _ = tx.send(result);
                        }
                    } else if let Some(method) = value.get("method").and_then(Value::as_str) {
                        let event = CdpEvent {
                            method: method.to_string(),
                            params: value.get("params").cloned().unwrap_or(Value::Null),
                            session_id: value.get("sessionId").and_then(Value::as_str).map(str::to_string),
                        };
                        if events_tx.send(event).is_err() {
                            break;
                        }
                    }
                }
                c.store(true, Ordering::SeqCst);
                // من ينتظر ردًّا لن يصله: يُبلَّغ بإغلاق الاتصال بدل أن ينتظر مهلته كاملة.
                if let Ok(mut m) = p.lock() {
                    for (_, tx) in m.drain() {
                        let _ = tx.send(Err("the browser connection closed".into()));
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok((Arc::new(Self { writer: Mutex::new(ws), pending, next_id: AtomicU64::new(1), closed }), events_rx))
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// يرسل أمرًا وينتظر ردّه بمهلة. `session` جلسة هدف مسطّحة (flatten) أو لا شيء للمتصفّح.
    pub fn call(&self, method: &str, params: Value, session: Option<&str>, timeout: Duration) -> Result<Value, String> {
        if self.is_closed() {
            return Err("the browser connection is closed".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = channel();
        self.pending.lock().map_err(|_| "poisoned")?.insert(id, tx);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            message["sessionId"] = json!(s);
        }
        let sent = self.writer.lock().map_err(|_| "poisoned".to_string()).and_then(|mut w| w.send_text(&message.to_string()).map_err(|e| e.to_string()));
        if let Err(e) = sent {
            let _ = self.pending.lock().map(|mut m| m.remove(&id));
            return Err(format!("the browser command could not be sent: {e}"));
        }
        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => {
                let _ = self.pending.lock().map(|mut m| m.remove(&id));
                Err(format!("{method} timed out"))
            }
        }
    }

    /// يرسل أمرًا بلا انتظار (للردّ على طلب معترَض من خيط المعترِض).
    pub fn send(&self, method: &str, params: Value, session: Option<&str>) {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let mut message = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            message["sessionId"] = json!(s);
        }
        if let Ok(mut w) = self.writer.lock() {
            let _ = w.send_text(&message.to_string());
        }
    }

    pub fn close(&self) {
        if let Ok(mut w) = self.writer.lock() {
            w.close();
        }
    }
}
