// فحوص المتصفّح الحقيقي على الجهاز: Edge (Chromium) بلا واجهة داخل كائن مهمّة، عبر أدوات
// الوكيل نفسها في البوابة. الموقع تجهيزة محلية تبني محتواها بجافاسكربت وتحاول ما لا يجوز.

use serde_json::{json, Value};

use crate::fixture::Web;
use crate::platform::Harness;
use crate::probe::Probe;
use crate::report::{Section, Status};

/// رقم العنصر من سطر مثل `[7] input(text) "Search products"`.
pub fn find_ref(observation: &str, label: &str) -> Option<u64> {
    observation.lines().filter(|l| l.starts_with('[') && l.contains(label)).find_map(|l| l[1..].split(']').next().and_then(|n| n.parse().ok()))
}

pub fn run(h: &Harness, web: &Web) -> Section {
    let mut s = Section::default();
    s.record("P08-BRW-ENGINE", Status::of(h.engine.contains("EDGE") || h.engine.contains("CHROM")), format!("browser engine: {}", h.engine), json!({ "engine": h.engine }));
    let mut p = Probe::new(h, "browser probes");
    let base = web.base();
    let open = p.invoke("polaris.browser.open", json!({ "url": format!("{base}/") }));
    if !open.ok() {
        s.record("P08-BRW-OPEN", Status::Fail, format!("the browser did not open the fixture: {}", open.summary), open.view());
        p.finish();
        return s;
    }
    let wait = p.invoke("polaris.browser.wait", json!({ "text": "Catalogue v7", "timeout_ms": 15000 }));
    let read = p.invoke("polaris.browser.read", json!({}));
    let js = read.observation.contains("Catalogue v7") && read.observation.contains("Beta chair") && read.observation.contains("240.00");
    s.record("P08-BRW-JS", Status::of(js), "content built by JavaScript from an intercepted fetch is visible", json!({ "wait": wait.view(), "read": read.view() }));
    s.record("P08-BRW-UNTRUSTED-LABEL", Status::of(read.observation.starts_with("[WEB_UNTRUSTED]")), "the page reaches the agent labelled WEB_UNTRUSTED", Value::Null);
    let search = find_ref(&read.observation, "Search products");
    let filter = find_ref(&read.observation, "\"Filter\"");
    let typed = search.map(|r| p.invoke("polaris.browser.type", json!({ "ref": r, "text": "beta" })));
    let clicked = filter.map(|r| p.invoke("polaris.browser.click", json!({ "ref": r })));
    let after = clicked.as_ref().map(|c| c.observation.clone()).unwrap_or_default();
    s.record("P08-BRW-TYPE-CLICK", Status::of(after.contains("Filtered: beta") && !after.contains("Alpha lamp")), "typing and clicking with trusted input events changes the page", json!({ "type": typed.map(|c| c.view()), "click": clicked.map(|c| c.view()) }));
    let read = p.invoke("polaris.browser.read", json!({}));
    let sel = find_ref(&read.observation, "select").map(|r| p.invoke("polaris.browser.select", json!({ "ref": r, "value": "price" })));
    s.record("P08-BRW-SELECT", Status::of(sel.as_ref().is_some_and(|c| c.observation.contains("sorted by price"))), "choosing an option fires the page's handler", json!({ "select": sel.map(|c| c.view()) }));
    let pw = find_ref(&read.observation, "Password").map(|r| p.invoke("polaris.browser.type", json!({ "ref": r, "text": "secret" })));
    s.record("P08-BRW-PASSWORD-REFUSED", Status::of(pw.as_ref().is_some_and(|c| !c.ok())), "a password field is never typed into", json!({ "call": pw.map(|c| c.view()) }));
    let probe = p.invoke("polaris.browser.wait", json!({ "text": "redirect-", "timeout_ms": 8000 }));
    let read = p.invoke("polaris.browser.read", json!({}));
    let blocked = read.observation.contains("metadata-blocked") && !read.observation.contains("metadata-reached") && !read.observation.contains("redirect-followed");
    s.record("P08-BRW-PRIVATE-DENIED", Status::of(blocked), "the cloud metadata address and a redirect to a private network are refused", json!({ "wait": probe.view(), "probe_text": read.observation.lines().find(|l| l.contains("blocked") || l.contains("reached")).unwrap_or("") }));
    let log = h.host().phase08().map(|p8| p8.browser.request_log(&p.mission_id)).unwrap_or_default();
    let meta_allowed = log.iter().any(|l| l.url.contains("169.254.169.254") && l.decision.starts_with("ALLOWED"));
    s.record("P08-BRW-POLICY-EVERY-REQUEST", Status::of(!log.is_empty() && !meta_allowed), format!("{} requests passed the host's policy", log.len()), json!({ "decisions": log.iter().map(|l| json!([l.url.chars().take(80).collect::<String>(), l.decision])).take(40).collect::<Vec<_>>() }));
    let posts_before = web.posts();
    let read = p.invoke("polaris.browser.read", json!({}));
    let note = find_ref(&read.observation, "\"Note\"");
    let send = find_ref(&read.observation, "Send note");
    if let (Some(n), Some(b)) = (note, send) {
        p.invoke("polaris.browser.type", json!({ "ref": n, "text": "hello" }));
        p.invoke("polaris.browser.click", json!({ "ref": b }));
    }
    let blocked_post = web.posts() == posts_before;
    let (first, second) = p.invoke_with_decision("polaris.browser.permit_write", json!({ "origin": base }), true);
    let granted = second.as_ref().is_some_and(|c| c.ok());
    p.invoke("polaris.browser.open", json!({ "url": format!("{base}/") }));
    let read = p.invoke("polaris.browser.read", json!({}));
    if let (Some(n), Some(b)) = (find_ref(&read.observation, "\"Note\""), find_ref(&read.observation, "Send note")) {
        p.invoke("polaris.browser.type", json!({ "ref": n, "text": "hello" }));
        p.invoke("polaris.browser.click", json!({ "ref": b }));
    }
    let delivered_once = web.posts() == posts_before + 1;
    s.record("P08-BRW-WRITE-APPROVAL", Status::of(blocked_post && p.awaiting(&first) && granted && delivered_once), "a form post is blocked until a human allows the origin, then arrives exactly once", json!({ "blocked_before": blocked_post, "approval": first.view(), "after_grant": second.map(|c| c.view()), "posts": web.posts() - posts_before }));
    p.invoke("polaris.browser.open", json!({ "url": format!("{base}/") }));
    let read = p.invoke("polaris.browser.read", json!({}));
    let dl = find_ref(&read.observation, "Download file").map(|r| p.invoke("polaris.browser.click", json!({ "ref": r })));
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let _ = p.invoke("polaris.browser.read", json!({}));
    let ws = h.call("workspace.list", json!({ "mission_id": p.mission_id })).unwrap_or(Value::Null).to_string();
    s.record("P08-BRW-DOWNLOAD-QUARANTINE", Status::of(ws.contains("downloads/report.bin")), "a download lands in the workspace's quarantine folder and is not opened", json!({ "click": dl.map(|c| c.view()) }));
    let shot = p.invoke("polaris.browser.screenshot", json!({}));
    let png_ok = shot.ok() && ws_png(h, &p.mission_id);
    s.record("P08-BRW-SCREENSHOT", Status::of(png_ok), &shot.summary, shot.view());
    p.invoke("polaris.browser.open", json!({ "url": format!("{base}/") }));
    let read = p.invoke("polaris.browser.read", json!({}));
    let next = find_ref(&read.observation, "Next page").map(|r| p.invoke("polaris.browser.click", json!({ "ref": r })));
    let back = p.invoke("polaris.browser.history", json!({ "direction": "back" }));
    let nav_ok = next.as_ref().is_some_and(|c| c.observation.contains("Second page reached")) && back.observation.contains("Fixture Shop");
    s.record("P08-BRW-NAVIGATE-HISTORY", Status::of(nav_ok), "a link navigates and history goes back", json!({ "next": next.map(|c| c.view()), "back": back.view() }));
    let tabs = p.invoke("polaris.browser.tabs", json!({ "action": "list" }));
    s.record("P08-BRW-TABS", Status::of(tabs.ok()), &tabs.summary, tabs.view());
    let sessions = h.call("browser.session.list", json!({ "mission_id": p.mission_id })).unwrap_or_else(|e| json!({ "error": e }));
    let live_state = |st: &Value| !matches!(st.as_str(), Some("CLOSED" | "CANCELLED" | "FAILED" | "COMPLETED"));
    let sid = sessions["sessions"].as_array().and_then(|a| a.iter().find(|x| live_state(&x["state"])).and_then(|x| x["session_id"].as_str().map(String::from))).unwrap_or_default();
    let stopped = h.call("browser.session.cancel", json!({ "session_id": sid }));
    let live = h.host().phase08().map(|p8| p8.browser.live_count()).unwrap_or(99);
    let closed = h.call("browser.session.get", json!({ "session_id": sid })).unwrap_or_else(|e| json!({ "error": e }));
    s.record("P08-BRW-STOP", Status::of(stopped.is_ok() && live == 0 && closed["session"]["state"] == "CANCELLED"), "Stop from the sessions UI closes the browser and kills its process", json!({ "live_after": live, "state": closed["session"]["state"], "get_error": closed["error"], "list_error": sessions["error"], "sessions": sessions["sessions"].as_array().map(|a| a.iter().map(|x| x["state"].clone()).collect::<Vec<_>>()), "stop": stopped.as_ref().err() }));
    p.finish();
    s
}

fn ws_png(h: &Harness, mission: &str) -> bool {
    let list = h.call("workspace.list", json!({ "mission_id": mission, "depth": 4 })).unwrap_or(Value::Null);
    let shot = list["entries"].as_array().and_then(|a| a.iter().find_map(|e| e["path"].as_str().filter(|p| p.ends_with(".png")).map(String::from)));
    match shot {
        Some(path) => h.call("workspace.preview", json!({ "mission_id": mission, "path": path })).map(|v| v["kind"] == "IMAGE").unwrap_or(false),
        None => false,
    }
}
