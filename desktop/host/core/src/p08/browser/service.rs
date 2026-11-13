// خدمة المتصفّح الحقيقي: جلسة Chromium واحدة لكل مهمّة، تُفتح عند أول فعل وتُغلق مع المهمّة
// أو بإيقاف المستخدم. الجلسات تُسجَّل في مخزن جلسات Phase-05 نفسه، فتظهر في واجهة الجلسات
// نفسها بزرّ الإيقاف نفسه، ولا يُنشأ مخزن ثانٍ.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use polaris_host_providers::net::HttpClient;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::p05::browser::store::{BrowserActionRecord, BrowserSessionRecord, BrowserStore, DownloadRecord};
use crate::p05::browser::url_policy::NavigationPolicy;
use crate::storage::Database;

use super::super::workspace::WorkspaceRoot;
use super::port::BrowserProcessPort;
use super::session::BrowserSession;

const EXECUTABLE_EXTENSIONS: [&str; 14] = ["exe", "dll", "msi", "bat", "cmd", "ps1", "vbs", "js", "jar", "scr", "com", "lnk", "hta", "msix"];

struct Live {
    session: Arc<BrowserSession>,
    record: BrowserSessionRecord,
}

pub struct BrowserService {
    port: Arc<dyn BrowserProcessPort>,
    http: Arc<HttpClient>,
    policy: NavigationPolicy,
    workspaces: WorkspaceRoot,
    profiles_root: PathBuf,
    store: BrowserStore,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    live: Mutex<HashMap<String, Live>>,
    enabled: Mutex<bool>,
}

/// ما يحتاجه الفعل: المهمّة والمهمّة الفرعية والوكيل.
pub struct ActionContext<'a> {
    pub mission_id: &'a str,
    pub task_id: &'a str,
    pub agent_id: &'a str,
}

impl BrowserService {
    #[allow(clippy::too_many_arguments)]
    pub fn new(port: Arc<dyn BrowserProcessPort>, http: Arc<HttpClient>, policy: NavigationPolicy, workspaces: WorkspaceRoot, profiles_root: PathBuf, db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { port, http, policy, workspaces, profiles_root, store: BrowserStore::new(db), audit, clock, live: Mutex::new(HashMap::new()), enabled: Mutex::new(true) }
    }

    pub fn engine(&self) -> &'static str {
        self.port.engine()
    }

    pub fn policy(&self) -> &NavigationPolicy {
        &self.policy
    }

    pub fn set_enabled(&self, enabled: bool) {
        if let Ok(mut e) = self.enabled.lock() {
            *e = enabled;
        }
    }

    pub fn workspaces(&self) -> &WorkspaceRoot {
        &self.workspaces
    }

    /// جلسة المهمّة، تُفتح عند الحاجة.
    pub fn session(&self, ctx: &ActionContext<'_>) -> Result<Arc<BrowserSession>, String> {
        if !self.enabled.lock().map(|e| *e).unwrap_or(false) {
            return Err("BROWSER_DISABLED: the browser engine is turned off in settings".into());
        }
        let mut live = self.live.lock().map_err(|_| "poisoned")?;
        if let Some(l) = live.get(ctx.mission_id) {
            if l.session.alive() {
                return Ok(l.session.clone());
            }
            let old = live.remove(ctx.mission_id);
            if let Some(old) = old {
                self.finish(old, "FAILED", "BROWSER_EXITED");
            }
        }
        let profile = self.profiles_root.join(ctx.mission_id);
        let _ = std::fs::remove_dir_all(&profile);
        std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
        let process = self.port.launch(&profile)?;
        let session_id = self.clock.id();
        let session = Arc::new(BrowserSession::start(session_id.clone(), ctx.mission_id.to_string(), process, self.http.clone(), self.policy.clone())?);
        let now = self.clock.now();
        let record = BrowserSessionRecord {
            session_id,
            mission_id: ctx.mission_id.into(),
            owner_agent_id: ctx.agent_id.into(),
            state: "ACTIVE".into(),
            current_origin: None,
            current_url: None,
            current_title: None,
            navigation_count: 0,
            action_count: 0,
            download_count: 0,
            upload_count: 0,
            created_at: now.clone(),
            last_activity_at: now,
            closed_reason: None,
        };
        let _ = self.store.save_session(&record);
        let _ = self.audit.append(&AuditRecord::new(AuditEventType::BrowserSessionOpened, "browser_session", &record.session_id, AuditOutcome::Started, serde_json::json!({ "mission_id": ctx.mission_id, "engine": self.port.engine() })));
        live.insert(ctx.mission_id.to_string(), Live { session: session.clone(), record });
        Ok(session)
    }

    /// يسجّل فعلًا في سجلّ الجلسة ويحفظ ما نزّله المعترِض إلى مجلد التنزيلات المعزول.
    #[allow(clippy::too_many_arguments)]
    pub fn record(&self, ctx: &ActionContext<'_>, action: &str, target: &str, ok: bool, reason: Option<&str>, url: Option<&str>, title: Option<&str>, duration_ms: u64) {
        let Ok(mut live) = self.live.lock() else { return };
        let Some(l) = live.get_mut(ctx.mission_id) else { return };
        let now = self.clock.now();
        l.record.action_count += 1;
        if action == "NAVIGATE" && ok {
            l.record.navigation_count += 1;
        }
        if action == "UPLOAD" && ok {
            l.record.upload_count += 1;
        }
        if let Some(u) = url {
            l.record.current_url = Some(u.chars().take(600).collect());
            l.record.current_origin = url::Url::parse(u).ok().map(|x| x.origin().ascii_serialization());
        }
        if let Some(t) = title {
            l.record.current_title = Some(t.chars().take(300).collect());
        }
        l.record.last_activity_at = now.clone();
        let saved = self.flush_downloads(ctx, &l.session);
        l.record.download_count += saved;
        let _ = self.store.save_session(&l.record);
        let _ = self.store.record_action(&BrowserActionRecord {
            action_id: self.clock.id(),
            session_id: l.record.session_id.clone(),
            mission_id: ctx.mission_id.into(),
            task_id: ctx.task_id.into(),
            action: action.into(),
            target: target.chars().take(300).collect(),
            status: if ok { "EXECUTED".into() } else { "FAILED".into() },
            // رمز السبب مفردات مغلقة غير فارغة؛ ما يتبقّى فارغًا بعد التنقية لا يُسجَّل سببًا.
            reason_code: reason.map(|r| r.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':' | '.' | '-')).take(80).collect::<String>()).filter(|r| !r.is_empty()),
            url: url.map(|u| u.chars().take(600).collect()),
            http_status: None,
            content_digest: None,
            outcome: if ok { "ACTION_EXECUTED".into() } else { "NOT_EXECUTED".into() },
            occurred_at: now,
            duration_ms,
        });
    }

    fn flush_downloads(&self, ctx: &ActionContext<'_>, session: &BrowserSession) -> u32 {
        let pending: Vec<_> = session.state.downloads.lock().map(|mut d| std::mem::take(&mut *d)).unwrap_or_default();
        let Ok(ws) = self.workspaces.for_mission(ctx.mission_id) else { return 0 };
        let mut saved = 0;
        for d in pending {
            let mut name = d.file_name.clone();
            let mut n = 2;
            while ws.resolve(&format!("downloads/{name}"), super::super::workspace::Access::Read).map(|p| p.exists()).unwrap_or(false) && n < 100 {
                name = format!("{n}-{}", d.file_name);
                n += 1;
            }
            let rel = format!("downloads/{name}");
            if ws.write(&rel, &d.bytes).is_err() {
                continue;
            }
            let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            let _ = self.store.record_download(&DownloadRecord {
                download_id: self.clock.id(),
                session_id: session.session_id.clone(),
                mission_id: ctx.mission_id.into(),
                source_url: d.source_url,
                file_name: name,
                byte_count: d.bytes.len() as u64,
                sha256: crate::digest::sha256_hex(&d.bytes),
                content_type: d.content_type.chars().take(200).collect(),
                executable: EXECUTABLE_EXTENSIONS.contains(&ext.as_str()) || d.bytes.starts_with(b"MZ"),
                trust: "UNTRUSTED_CONTENT".into(),
                downloaded_at: self.clock.now(),
            });
            saved += 1;
        }
        saved
    }

    fn finish(&self, live: Live, state: &str, reason: &str) {
        let survivors = live.session.close();
        let mut record = live.record;
        record.state = state.into();
        record.closed_reason = Some(reason.into());
        record.last_activity_at = self.clock.now();
        let _ = self.store.save_session(&record);
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::BrowserSessionClosed,
            "browser_session",
            &record.session_id,
            if survivors == 0 { AuditOutcome::Success } else { AuditOutcome::Failure },
            serde_json::json!({ "reason": reason, "survivors": survivors, "requests_denied": live.session.state.denied.load(std::sync::atomic::Ordering::SeqCst), "dialogs_dismissed": live.session.dialogs_dismissed() }),
        ));
        let _ = std::fs::remove_dir_all(self.profiles_root.join(&record.mission_id));
    }

    /// يغلق جلسة مهمّة (نهاية المهمّة أو إلغاؤها).
    pub fn close_mission(&self, mission_id: &str, state: &str, reason: &str) {
        let taken = self.live.lock().ok().and_then(|mut l| l.remove(mission_id));
        if let Some(l) = taken {
            self.finish(l, state, reason);
        }
    }

    /// إيقاف المستخدم من واجهة الجلسات بمعرّف الجلسة.
    pub fn close_session(&self, session_id: &str) {
        let mission = self.live.lock().ok().and_then(|l| l.iter().find(|(_, v)| v.record.session_id == session_id).map(|(k, _)| k.clone()));
        if let Some(m) = mission {
            self.close_mission(&m, "CANCELLED", "USER_STOPPED");
        }
    }

    pub fn live_count(&self) -> usize {
        self.live.lock().map(|l| l.len()).unwrap_or(0)
    }

    /// سجلّ طلبات الجلسة الحيّة لمهمّة، للدليل والاختبار.
    pub fn request_log(&self, mission_id: &str) -> Vec<super::intercept::RequestLog> {
        self.live.lock().ok().and_then(|l| l.get(mission_id).and_then(|x| x.session.state.log.lock().ok().map(|g| g.clone()))).unwrap_or_default()
    }

    pub fn grant_write(&self, mission_id: &str, origin: &str) -> bool {
        self.live.lock().ok().and_then(|l| l.get(mission_id).map(|x| x.session.state.write_grants.lock().map(|mut g| g.insert(origin.to_string())).is_ok())).unwrap_or(false)
    }
}
