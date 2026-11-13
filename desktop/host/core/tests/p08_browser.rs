// P08-BROWSER — المتصفّح الحقيقي: Chromium بلا واجهة، جافاسكربت يعمل، وكل طلب يمرّ بالمضيف.
//
// الموقع تجهيزة على الحلقة المحلية (TEST FIXTURE) تبني محتواها بجافاسكربت، وتحاول ما لا يجوز:
// نقطة بيانات وصفية سحابية، وخدمة محلية أخرى، ومقبس ويب، وإعادة توجيه إلى شبكة خاصة، وإرسال
// نموذج قبل الموافقة، وتنزيل، وحوار تنبيه. ما يُقاس: ما رآه الوكيل، وما قرّره المعترِض لكل طلب.

mod p08_support;

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use p08_support::{build_with_web, test_chromium, uuid};
use polaris_host_core::p08::browser::service::ActionContext;
use serde_json::Value;

const PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Fixture Shop</title></head><body>
<h1 id="h">Loading…</h1>
<ul id="list"></ul>
<label for="q">Search</label><input id="q" type="text" placeholder="Search products">
<button id="go" onclick="filter()">Filter</button>
<select id="sort" onchange="document.getElementById('sorted').textContent='sorted by '+this.value"><option value="name">Name</option><option value="price">Price</option></select>
<p id="sorted"></p>
<input id="pw" type="password" placeholder="Password">
<form id="f" method="post" action="/submit"><input name="note" id="note" type="text" placeholder="Note"><button id="send" type="submit">Send note</button></form>
<a id="next" href="/next">Next page</a>
<a id="dl" href="/file.bin">Download file</a>
<iframe src="/frame" width="200" height="60"></iframe>
<p id="probe"></p>
<script>
  const items = ['Alpha lamp', 'Beta chair', 'Gamma desk'];
  function render(list) { document.getElementById('list').innerHTML = list.map(i => '<li>' + i + '</li>').join(''); }
  function filter() { const q = document.getElementById('q').value.toLowerCase(); render(items.filter(i => i.toLowerCase().includes(q))); document.getElementById('h').textContent = 'Filtered: ' + q; }
  fetch('/data.json').then(r => r.json()).then(d => { document.getElementById('h').textContent = 'Catalogue ' + d.version; render(items); });
  fetch('http://169.254.169.254/latest/meta-data/').then(() => { document.getElementById('probe').textContent += ' metadata-reached'; }).catch(() => { document.getElementById('probe').textContent += ' metadata-blocked'; });
  fetch('/redirect').then(() => { document.getElementById('probe').textContent += ' redirect-followed'; }).catch(() => { document.getElementById('probe').textContent += ' redirect-blocked'; });
  try { const ws = new WebSocket('ws://127.0.0.1:9/x'); ws.onopen = () => { document.getElementById('probe').textContent += ' ws-open'; }; ws.onerror = () => { document.getElementById('probe').textContent += ' ws-blocked'; }; } catch (e) {}
  alert('fixture alert');
</script></body></html>"#;

struct Fixture {
    port: u16,
    posts: Arc<AtomicUsize>,
    frame_hits: Arc<AtomicUsize>,
}

fn serve() -> Fixture {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let posts = Arc::new(AtomicUsize::new(0));
    let frame_hits = Arc::new(AtomicUsize::new(0));
    let (p, f) = (posts.clone(), frame_hits.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let (p, f) = (p.clone(), f.clone());
            std::thread::spawn(move || {
                let mut buf = vec![0u8; 16384];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let line = req.lines().next().unwrap_or("").to_string();
                let path = line.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (status, ctype, extra, body): (&str, &str, String, Vec<u8>) = match (line.split_whitespace().next().unwrap_or(""), path.as_str()) {
                    ("GET", "/") => ("200 OK", "text/html; charset=utf-8", String::new(), PAGE.as_bytes().to_vec()),
                    ("GET", "/data.json") => ("200 OK", "application/json", String::new(), br#"{"version":"v7"}"#.to_vec()),
                    ("GET", "/next") => ("200 OK", "text/html; charset=utf-8", String::new(), b"<!doctype html><title>Next</title><p>Second page reached</p>".to_vec()),
                    ("GET", "/frame") => {
                        f.fetch_add(1, Ordering::SeqCst);
                        ("200 OK", "text/html", String::new(), b"<p>framed content</p>".to_vec())
                    }
                    ("GET", "/redirect") => ("302 Found", "text/plain", "Location: http://10.0.0.1/admin\r\n".into(), Vec::new()),
                    ("GET", "/file.bin") => ("200 OK", "application/octet-stream", "Content-Disposition: attachment; filename=\"report.bin\"\r\n".into(), b"BINARYDATA".to_vec()),
                    ("POST", "/submit") => {
                        p.fetch_add(1, Ordering::SeqCst);
                        ("200 OK", "text/html", String::new(), b"<p>note received</p>".to_vec())
                    }
                    _ => ("404 Not Found", "text/plain", String::new(), b"no".to_vec()),
                };
                let head = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(&body);
            });
        }
    });
    Fixture { port, posts, frame_hits }
}

fn text_of(observation: &Value) -> String {
    observation.to_string()
}

#[test]
fn p08_browser_real_chromium_runs_javascript_and_every_request_passes_the_policy() {
    if test_chromium().is_none() {
        println!("P08-NOT-TESTED: no Chromium on this machine; the real browser is measured natively with Edge");
        return;
    }
    let web = serve();
    let h = build_with_web(None, Some(web.port));
    let p08 = h.host().phase08().unwrap().clone();
    let mission = uuid();
    let (task, agent) = (uuid(), uuid());
    let ctx = ActionContext { mission_id: &mission, task_id: &task, agent_id: &agent };
    let session = p08.browser.session(&ctx).expect("the browser did not start");
    let base = format!("http://127.0.0.1:{}", web.port);
    session.navigate(&format!("{base}/")).unwrap();
    session.wait(Some("Catalogue v7"), 10_000).unwrap();
    let snap = session.snapshot().unwrap();
    // جافاسكربت عمل: العنوان والقائمة بُنيا في الصفحة، والبيانات جاءت من طلب XHR مُعترَض.
    assert!(snap.text.contains("Catalogue v7"), "{}", snap.text);
    assert!(snap.text.contains("Beta chair"));
    let find = |label: &str| snap.items.iter().find(|i| text_of(i).contains(label)).and_then(|i| i["ref"].as_u64()).unwrap() as u32;
    // كتابة ونقر بأحداث إدخال حقيقية.
    session.type_text(find("Search products"), "beta", false, true).unwrap();
    session.click(find("Filter")).unwrap();
    let after = session.snapshot().unwrap();
    assert!(after.text.contains("Filtered: beta") && !after.text.contains("Alpha lamp"), "{}", after.text);
    session.select(find("Name"), "price").unwrap();
    assert!(session.snapshot().unwrap().text.contains("sorted by price"));
    // حقل كلمة المرور لا يُكتب فيه.
    let pw = session.type_text(find("Password"), "secret", false, true).unwrap_err();
    assert_eq!(pw, "PASSWORD_FIELD");
    // ما حاولته الصفحة ولا يجوز: رُفض كله.
    session.wait(Some("ws-blocked"), 5_000).unwrap();
    let probe = session.snapshot().unwrap().text;
    assert!(probe.contains("metadata-blocked") && !probe.contains("metadata-reached"), "{probe}");
    assert!(probe.contains("redirect-blocked") && !probe.contains("redirect-followed"), "{probe}");
    assert!(!probe.contains("ws-open"), "a websocket opened past the dead proxy: {probe}");
    assert!(session.dialogs_dismissed() >= 1, "the alert was not dismissed");
    let log = p08.browser.request_log(&mission);
    let decision = |needle: &str| log.iter().filter(|l| l.url.contains(needle)).map(|l| l.decision.clone()).collect::<Vec<_>>();
    assert!(decision("169.254.169.254").iter().all(|d| d != "ALLOWED" && d != "ALLOWED_FIXTURE"), "{log:?}");
    assert!(decision("10.0.0.1").iter().all(|d| d.contains("DENIED")), "the private redirect target was not denied: {log:?}");
    assert!(decision("/data.json").contains(&"ALLOWED_FIXTURE".to_string()));
    assert!(web.frame_hits.load(Ordering::SeqCst) >= 1 && decision("/frame").contains(&"ALLOWED_FIXTURE".to_string()), "the iframe bypassed the interceptor: {log:?}");
    // إرسال النموذج قبل الموافقة لا يصل الخادم؛ وبعدها يصل مرة.
    session.type_text(find("Note"), "hello", false, true).unwrap();
    session.click(find("Send note")).unwrap();
    assert_eq!(web.posts.load(Ordering::SeqCst), 0, "a form was posted without approval");
    assert!(p08.browser.request_log(&mission).iter().any(|l| l.decision == "WRITE_NEEDS_APPROVAL"));
    session.navigate(&format!("{base}/")).unwrap();
    assert!(p08.browser.grant_write(&mission, &base));
    let snap = session.snapshot().unwrap();
    let note = snap.items.iter().find(|i| text_of(i).contains("Note")).and_then(|i| i["ref"].as_u64()).unwrap() as u32;
    let send = snap.items.iter().find(|i| text_of(i).contains("Send note")).and_then(|i| i["ref"].as_u64()).unwrap() as u32;
    session.type_text(note, "hello", false, true).unwrap();
    session.click(send).unwrap();
    assert_eq!(web.posts.load(Ordering::SeqCst), 1, "the approved post did not arrive exactly once");
    // التنزيل يُحفظ معزولًا ولا يُفتح.
    session.navigate(&format!("{base}/")).unwrap();
    let snap = session.snapshot().unwrap();
    let dl = snap.items.iter().find(|i| text_of(i).contains("Download file")).and_then(|i| i["ref"].as_u64()).unwrap() as u32;
    session.click(dl).unwrap();
    assert!(session.snapshot().unwrap().text.contains("POLARIS saved this download"));
    p08.browser.record(&ctx, "DOWNLOAD", "report.bin", true, None, None, None, 1);
    let ws = h.ok("workspace.list", serde_json::json!({ "mission_id": mission }));
    assert!(ws["entries"].as_array().unwrap().iter().any(|e| e["path"] == "downloads/report.bin"), "{ws}");
    // لقطة شاشة PNG حقيقية.
    let png = session.screenshot().unwrap();
    assert!(png.starts_with(b"\x89PNG"));
    // الجلسة ظاهرة في واجهة الجلسات، والإيقاف يغلقها ويقتل العملية.
    let sessions = h.ok("browser.session.list", serde_json::json!({ "mission_id": mission }));
    let sid = sessions["sessions"][0]["session_id"].as_str().unwrap().to_string();
    h.ok("browser.session.cancel", serde_json::json!({ "session_id": sid }));
    assert_eq!(p08.browser.live_count(), 0);
    let closed = h.ok("browser.session.get", serde_json::json!({ "session_id": sid }));
    assert_eq!(closed["session"]["state"], "CANCELLED");
}
