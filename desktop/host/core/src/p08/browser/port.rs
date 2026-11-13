// منفذ عملية المتصفّح: المنصّة تشغّل Chromium (Edge على ويندوز) في كائن مهمّة يقتل الشجرة
// كلها عند الإغلاق، وتعيد منفذ التصحيح الذي أعلنه. النواة تبني وسائط التشغيل هنا حتى تكون
// واحدة على كل منصّة، ولا تشغّل شيئًا بنفسها.
//
// لماذا هذه الوسائط: الشبكة كلها تمرّ بالمعترِض (Fetch) إلى المضيف، وما لا يعترضه شيء (مقبس
// ويب، عامل خدمة، WebRTC) يذهب إلى وكيل ميّت على الحلقة المحلية فيفشل مغلقًا — بما في ذلك
// عناوين الحلقة المحلية نفسها (`<-loopback>`). ولا مزامنة ولا ملحقات ولا تحديث مكوّنات.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// عملية متصفّح حيّة. إسقاطها يقتل الشجرة.
pub trait BrowserProcess: Send {
    /// منفذ التصحيح على 127.0.0.1 ومسار مقبس المتصفّح.
    fn devtools(&self) -> (u16, String);
    fn alive(&self) -> bool;
    /// يُنهي الشجرة كلها ويعيد عدد العمليات التي بقيت حيّة (يجب أن يكون صفرًا).
    fn kill(&mut self) -> u32;
}

pub trait BrowserProcessPort: Send + Sync {
    /// وصف المحرّك للعرض والدليل (مثل `EDGE_CHROMIUM+JOB`).
    fn engine(&self) -> &'static str;
    fn launch(&self, profile_dir: &Path) -> Result<Box<dyn BrowserProcess>, String>;
}

pub struct UnavailableBrowser(pub &'static str);

impl BrowserProcessPort for UnavailableBrowser {
    fn engine(&self) -> &'static str {
        "NONE"
    }
    fn launch(&self, _profile_dir: &Path) -> Result<Box<dyn BrowserProcess>, String> {
        Err(self.0.to_string())
    }
}

/// منفذ الوكيل الميّت: لا يستمع عليه شيء (المنفذ 9، discard). ما لا يعترضه المضيف يفشل هنا.
pub const DEAD_PROXY: &str = "http://127.0.0.1:9";

/// وسائط تشغيل Chromium بلا واجهة، موحّدة لكل منصّة.
pub fn chromium_arguments(profile_dir: &Path) -> Vec<String> {
    let profile = profile_dir.to_string_lossy().into_owned();
    [
        "--headless=new".to_string(),
        "--remote-debugging-port=0".into(),
        format!("--user-data-dir={profile}"),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--disable-sync".into(),
        "--disable-extensions".into(),
        "--disable-component-update".into(),
        "--disable-background-networking".into(),
        "--disable-default-apps".into(),
        "--disable-domain-reliability".into(),
        "--disable-client-side-phishing-detection".into(),
        "--dns-prefetch-disable".into(),
        "--no-pings".into(),
        "--metrics-recording-only".into(),
        "--disable-breakpad".into(),
        "--password-store=basic".into(),
        "--use-mock-keychain".into(),
        format!("--proxy-server={DEAD_PROXY}"),
        "--proxy-bypass-list=<-loopback>".into(),
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp".into(),
        "--webrtc-ip-handling-policy=disable_non_proxied_udp".into(),
        // الإطارات من أصول أخرى تبقى في عملية الصفحة، فيعترضها معترِض الصفحة نفسه.
        "--disable-site-isolation-trials".into(),
        "--disable-features=IsolateOrigins,site-per-process,Translate,MediaRouter,OptimizationHints,AutofillServerCommunication,InterestFeedContentSuggestions".into(),
        "--window-size=1280,900".into(),
        "--lang=en-US".into(),
        "about:blank".into(),
    ]
    .into_iter()
    .collect()
}

/// ينتظر ملف `DevToolsActivePort` الذي يكتبه المتصفّح في ملف تعريفه: السطر الأول المنفذ،
/// والثاني مسار مقبس المتصفّح.
pub fn read_devtools_active_port(profile_dir: &Path, timeout: Duration) -> Result<(u16, String), String> {
    let file = profile_dir.join("DevToolsActivePort");
    let deadline = Instant::now() + timeout;
    loop {
        if let Ok(text) = std::fs::read_to_string(&file) {
            let mut lines = text.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                if let Ok(port) = port.trim().parse::<u16>() {
                    if port > 0 && path.starts_with("/devtools/browser/") {
                        return Ok((port, path.trim().to_string()));
                    }
                }
            }
        }
        if Instant::now() > deadline {
            return Err("the browser did not announce its debugging port in time".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// مكان Edge المعتاد على ويندوز. لا يُشغَّل شيء هنا.
pub fn edge_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            out.push(PathBuf::from(base).join("Microsoft").join("Edge").join("Application").join("msedge.exe"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_uninterceptable_path_goes_to_a_dead_proxy_including_loopback() {
        let args = chromium_arguments(Path::new("/tmp/p"));
        assert!(args.contains(&format!("--proxy-server={DEAD_PROXY}")));
        assert!(args.iter().any(|a| a == "--proxy-bypass-list=<-loopback>"));
        assert!(args.iter().any(|a| a.starts_with("--headless")));
        assert!(!args.iter().any(|a| a.contains("remote-allow-origins")), "pages must not be allowed to reach the debugging socket");
    }

    #[test]
    fn the_announced_port_is_read_from_the_profile() {
        let dir = crate::test_scratch::root().join(format!("dtap-{}", crate::ids::new_uuid_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("DevToolsActivePort"), "53211\n/devtools/browser/abc\n").unwrap();
        assert_eq!(read_devtools_active_port(&dir, Duration::from_millis(200)).unwrap(), (53211, "/devtools/browser/abc".to_string()));
        std::fs::write(dir.join("DevToolsActivePort"), "0\n/other\n").unwrap();
        assert!(read_devtools_active_port(&dir, Duration::from_millis(100)).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
