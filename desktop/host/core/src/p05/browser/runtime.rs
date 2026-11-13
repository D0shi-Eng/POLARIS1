// زمن تشغيل المتصفّح: جلسات مربوطة بمهامّها، وأفعال تمرّ بالسياسة، ونتائج مقيسة.
//
// لا يصل أحد إلى هذا الملف إلا محوّلات الأدوات، ولا يصل إلى المحوّلات إلا بوابة
// الأدوات. لا عملية IPC تنفّذ فعلًا هنا (البند 50)، ولا وكيل يملك مرجعًا إليه.
//
// القفل لا يُمسك أثناء الشبكة: الجلسة تُقرأ، ثم يُفلت القفل، ثم يقع الجلب، ثم تُطبَّق
// النتيجة إن كانت الجلسة ما زالت قائمة. إمساكه أثناء الجلب يجعل الإلغاء ينتظر الجلب
// الذي جاء ليوقفه.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use url::Url;

use polaris_host_providers::net::CancelToken;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::p04::adapter::bounded;

use super::classify::{plan_click, ClickPlan};
use super::engine::{BrowserEngine, FetchFailure, FetchedPage, RequestBody};
use super::html::{parse, ElementHit, ParsedPage};
use super::observation::BrowserObservation;
use super::store::{BrowserActionRecord, BrowserSessionRecord, BrowserStore, DownloadRecord};
use crate::p05::session::{reserve, ActionBudget, BudgetDimension, SessionState};

/// أقصى حجم لملف يُرفع من الوسيط.
pub const MAX_UPLOAD_BYTES: u64 = 1024 * 1024;

/// سياق فعل: من يطلبه، ولأي مهمّة، ورمز إلغائها.
pub struct BrowserActionContext<'a> {
    pub mission_id: &'a str,
    pub task_id: &'a str,
    pub agent_id: &'a str,
    pub cancel: &'a CancelToken,
    pub timeout_ms: u64,
}

/// لماذا لم يقع الفعل. يُترجم إلى رفض بوابة بمفرداتها المغلقة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BrowserFailure {
    /// السياسة رفضت الوجهة. الرمز من مفردات سياسة التنقّل.
    Navigation(&'static str),
    /// الفعل لا يجوز على هذا الهدف (حقل كلمة مرور، حقل مخفي، مرجع ملف خارج الوسيط).
    NotPermitted(String),
    InvalidTarget(String),
    SessionClosed(&'static str),
    Budget(BudgetDimension),
    Cancelled,
    Timeout,
    TooLarge(u64),
    Malformed(String),
    Unavailable(String),
}

impl BrowserFailure {
    pub fn code(&self) -> String {
        match self {
            Self::Navigation(code) => (*code).to_string(),
            Self::NotPermitted(_) => "NOT_PERMITTED".into(),
            Self::InvalidTarget(_) => "INVALID_TARGET".into(),
            Self::SessionClosed(_) => "SESSION_CLOSED".into(),
            Self::Budget(d) => format!("BUDGET_EXHAUSTED:{}", d.as_str()),
            Self::Cancelled => "CANCELLED".into(),
            Self::Timeout => "TIMEOUT".into(),
            Self::TooLarge(_) => "RESULT_TOO_LARGE".into(),
            Self::Malformed(_) => "RESULT_MALFORMED".into(),
            Self::Unavailable(_) => "UNAVAILABLE".into(),
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::Navigation(code) => format!("the navigation policy refused this destination: {code}"),
            Self::NotPermitted(d) | Self::InvalidTarget(d) | Self::Malformed(d) | Self::Unavailable(d) => d.clone(),
            Self::SessionClosed(state) => format!("the browser session for this mission is {state}"),
            Self::Budget(d) => format!("the mission's {} budget is exhausted", d.as_str()),
            Self::Cancelled => "the mission was cancelled while the browser action was in flight".into(),
            Self::Timeout => "the page did not answer within the time the budget allowed".into(),
            Self::TooLarge(n) => format!("the response exceeded the size limit ({n} bytes)"),
        }
    }
}

/// نتيجة فعل وقع.
#[derive(Debug, Clone)]
pub struct BrowserActionResult {
    pub summary: String,
    pub measured_bytes: Vec<u8>,
    pub observation: Option<BrowserObservation>,
    /// `BROWSER_OBSERVATION` أو `BROWSER_ACTION_RESULT`.
    pub kind: &'static str,
    /// نصّ ما لوحظ بعد الفعل، إن وُجد. غيابه يعني دليلًا محايدًا: الفعل وقع فقط.
    pub observed_text: Option<String>,
    pub detail: String,
}

/// صفحة محمّلة في جلسة.
#[derive(Debug, Clone)]
struct LoadedPage {
    url: Url,
    status: u16,
    digest: String,
    parsed: ParsedPage,
    observation: BrowserObservation,
}

/// أزواج حقول النموذج، وملفاته المرفقة.
type FormPayload = (Vec<(String, String)>, Vec<(String, AttachedFile)>);

/// ملف أرفقه الوسيط بحقل.
#[derive(Debug, Clone)]
struct AttachedFile {
    file_name: String,
    content_type: String,
    bytes: Vec<u8>,
}

struct BrowserSession {
    record: BrowserSessionRecord,
    page: Option<LoadedPage>,
    back: Vec<Url>,
    forward: Vec<Url>,
    typed: BTreeMap<String, String>,
    attached: BTreeMap<String, AttachedFile>,
}

/// قياسات زمن التشغيل، تُقرأ في مسار القياس الأصلي.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BrowserTimings {
    pub sessions_started: u64,
    pub session_start_micros_total: u64,
    pub navigations: u64,
    pub navigation_overhead_micros_total: u64,
    pub observations: u64,
    pub observation_micros_total: u64,
}

pub struct BrowserRuntime {
    engine: BrowserEngine,
    store: BrowserStore,
    clock: RuntimeClock,
    audit: Arc<AuditLedger>,
    budget: ActionBudget,
    sessions: Mutex<BTreeMap<String, BrowserSession>>,
    downloads_root: Option<PathBuf>,
    timings: Mutex<BrowserTimings>,
}

fn origin_of(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// امتدادات وتواقيع تجعل ملفًّا تنفيذيًّا أو أرشيفًا يحمل تنفيذيًّا.
fn looks_executable(name: &str, bytes: &[u8]) -> bool {
    let lower = name.to_ascii_lowercase();
    let by_name = [".exe", ".msi", ".bat", ".cmd", ".ps1", ".vbs", ".js", ".jar", ".scr", ".dll", ".com", ".lnk", ".hta"]
        .iter()
        .any(|e| lower.ends_with(e));
    let by_magic = bytes.starts_with(b"MZ") || bytes.starts_with(b"#!") || bytes.starts_with(b"\x7fELF");
    by_name || by_magic
}

fn sanitise_file_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("download");
    let cleaned: String = base.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).take(120).collect();
    if cleaned.trim_matches('.').is_empty() {
        "download.bin".into()
    } else {
        cleaned
    }
}

impl BrowserRuntime {
    pub fn new(
        engine: BrowserEngine,
        store: BrowserStore,
        clock: RuntimeClock,
        audit: Arc<AuditLedger>,
        budget: ActionBudget,
        downloads_root: Option<PathBuf>,
    ) -> Self {
        Self {
            engine,
            store,
            clock,
            audit,
            budget,
            sessions: Mutex::new(BTreeMap::new()),
            downloads_root,
            timings: Mutex::new(BrowserTimings::default()),
        }
    }

    pub fn store(&self) -> &BrowserStore {
        &self.store
    }

    pub fn engine(&self) -> &BrowserEngine {
        &self.engine
    }

    pub fn timings(&self) -> BrowserTimings {
        self.timings.lock().map(|t| *t).unwrap_or_default()
    }

    fn audit(&self, event: AuditEventType, subject: &str, outcome: AuditOutcome, detail: serde_json::Value) {
        let _ = self.audit.append(&AuditRecord::new(event, "browser_session", subject, outcome, detail));
    }

    fn persist(&self, session: &BrowserSession) {
        let _ = self.store.save_session(&session.record);
    }

    fn set_state(&self, session: &mut BrowserSession, next: SessionState, reason: Option<&str>) {
        let current = SessionState::parse(&session.record.state).unwrap_or(SessionState::Closed);
        if current == next || !current.can_transition_to(next) {
            return;
        }
        session.record.state = next.as_str().into();
        session.record.last_activity_at = self.clock.now();
        if next.is_terminal() {
            session.record.closed_reason = reason.map(str::to_string);
            self.audit(
                AuditEventType::BrowserSessionClosed,
                &session.record.session_id,
                if next == SessionState::Cancelled { AuditOutcome::Cancelled } else { AuditOutcome::Success },
                serde_json::json!({ "mission_id": session.record.mission_id, "state": next.as_str(), "reason": reason }),
            );
        }
        self.persist(session);
    }

    /// يسجّل فعلًا في تاريخ الجلسة. الرفض يُسجَّل كالتنفيذ، بسببه.
    #[allow(clippy::too_many_arguments)]
    fn record_action(
        &self,
        session_id: &str,
        ctx: &BrowserActionContext<'_>,
        action: &str,
        target: &str,
        status: &str,
        reason: Option<String>,
        url: Option<&str>,
        http_status: Option<u16>,
        digest: Option<&str>,
        duration_ms: u64,
    ) {
        let _ = self.store.record_action(&BrowserActionRecord {
            action_id: self.clock.id(),
            session_id: session_id.to_string(),
            mission_id: ctx.mission_id.to_string(),
            task_id: ctx.task_id.to_string(),
            action: action.to_string(),
            target: bounded(target, 600),
            status: status.to_string(),
            reason_code: reason,
            url: url.map(|u| bounded(u, 2048)),
            http_status,
            content_digest: digest.map(str::to_string),
            outcome: if status == "EXECUTED" { "ACTION_EXECUTED".into() } else { "NOT_EXECUTED".into() },
            occurred_at: self.clock.now(),
            duration_ms,
        });
    }

    /// جلسة المهمّة، تُنشأ عند أول فعل. جلسة منتهية لا تُعاد.
    fn ensure_session(&self, ctx: &BrowserActionContext<'_>) -> Result<String, BrowserFailure> {
        let began = std::time::Instant::now();
        let mut sessions = self.sessions.lock().map_err(|_| BrowserFailure::Unavailable("the session table is unavailable".into()))?;
        if let Some(existing) = sessions.get_mut(ctx.mission_id) {
            let state = SessionState::parse(&existing.record.state).unwrap_or(SessionState::Closed);
            if state.is_terminal() {
                return Err(BrowserFailure::SessionClosed(state.as_str()));
            }
            if state == SessionState::Waiting {
                self.set_state(existing, SessionState::Active, None);
            }
            return Ok(existing.record.session_id.clone());
        }
        let now = self.clock.now();
        let record = BrowserSessionRecord {
            session_id: self.clock.id(),
            mission_id: ctx.mission_id.to_string(),
            owner_agent_id: ctx.agent_id.to_string(),
            state: SessionState::Created.as_str().into(),
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
        let session_id = record.session_id.clone();
        self.audit(
            AuditEventType::BrowserSessionOpened,
            &session_id,
            AuditOutcome::Success,
            serde_json::json!({ "mission_id": ctx.mission_id, "agent_id": ctx.agent_id }),
        );
        let session =
            BrowserSession { record, page: None, back: Vec::new(), forward: Vec::new(), typed: BTreeMap::new(), attached: BTreeMap::new() };
        self.persist(&session);
        sessions.insert(ctx.mission_id.to_string(), session);
        if let Ok(mut t) = self.timings.lock() {
            t.sessions_started += 1;
            t.session_start_micros_total += began.elapsed().as_micros() as u64;
        }
        Ok(session_id)
    }

    fn with_session<T>(&self, mission_id: &str, work: impl FnOnce(&mut BrowserSession) -> T) -> Option<T> {
        let mut sessions = self.sessions.lock().ok()?;
        sessions.get_mut(mission_id).map(work)
    }

    /// يحجز من ميزانية الجلسة قبل الأثر.
    fn reserve(&self, mission_id: &str, navigation: bool, download: bool, upload: bool) -> Result<(), BrowserFailure> {
        let budget = self.budget;
        self.with_session(mission_id, |s| {
            let r = &mut s.record;
            let (mut nav, mut act, mut dl, mut up) = (r.navigation_count, r.action_count, r.download_count, r.upload_count);
            reserve(&mut act, 1, budget.max_browser_actions, BudgetDimension::BrowserActions)?;
            if navigation {
                reserve(&mut nav, 1, budget.max_browser_navigations, BudgetDimension::BrowserNavigations)?;
            }
            if download {
                reserve(&mut dl, 1, budget.max_browser_downloads, BudgetDimension::BrowserDownloads)?;
            }
            if upload {
                reserve(&mut up, 1, budget.max_browser_uploads, BudgetDimension::BrowserUploads)?;
            }
            r.navigation_count = nav;
            r.action_count = act;
            r.download_count = dl;
            r.upload_count = up;
            Ok(())
        })
        .unwrap_or(Err(BudgetDimension::BrowserActions))
        .map_err(BrowserFailure::Budget)
    }

    fn page_snapshot(&self, mission_id: &str) -> Option<LoadedPage> {
        self.with_session(mission_id, |s| s.page.clone()).flatten()
    }

    /// آخر ملاحظة للمهمّة، لسياق الوكيل التالي.
    pub fn latest_observation(&self, mission_id: &str) -> Option<BrowserObservation> {
        self.page_snapshot(mission_id).map(|p| p.observation)
    }

    fn map_fetch(failure: FetchFailure) -> BrowserFailure {
        match failure {
            FetchFailure::Denied(d) => BrowserFailure::Navigation(d.as_str()),
            FetchFailure::ResolvedToPrivate => BrowserFailure::Navigation("RESOLVED_TO_PRIVATE_ADDRESS"),
            FetchFailure::NameResolution => BrowserFailure::Unavailable("the host name did not resolve".into()),
            FetchFailure::Timeout => BrowserFailure::Timeout,
            FetchFailure::Cancelled => BrowserFailure::Cancelled,
            FetchFailure::TooLarge(n) => BrowserFailure::TooLarge(n),
            FetchFailure::Malformed(d) => BrowserFailure::Malformed(d),
            FetchFailure::Unreachable(d) => BrowserFailure::Unavailable(d),
        }
    }

    /// يفحص وجهة تنقّل دون أي اتصال. يُستدعى من نقطة قرار السياسة.
    pub fn check_destination(&self, raw: &str) -> Result<Url, BrowserFailure> {
        self.engine.policy().check_text(raw).map(|(url, _)| url).map_err(|d| BrowserFailure::Navigation(d.as_str()))
    }

    /// يحمّل صفحة في الجلسة بعد جلب وقع. يعيد الملاحظة ونتيجة الفعل.
    fn load(&self, mission_id: &str, fetched: FetchedPage, push_history: bool) -> BrowserActionResult {
        let began = std::time::Instant::now();
        let digest = crate::digest::sha256_hex(&fetched.body);
        let body_text = String::from_utf8_lossy(&fetched.body).to_string();
        let parsed = if fetched.is_html() {
            parse(&body_text)
        } else if fetched.is_text() {
            ParsedPage { text: bounded(&body_text, super::html::MAX_TEXT_CHARS), ..ParsedPage::default() }
        } else {
            ParsedPage { text: format!("[a {} response of {} bytes; not a page]", fetched.content_type, fetched.body.len()), ..ParsedPage::default() }
        };
        let observation =
            BrowserObservation::of(fetched.final_url.as_str(), fetched.status, &fetched.content_type, &digest, &self.clock.now(), &parsed);
        let page = LoadedPage {
            url: fetched.final_url.clone(),
            status: fetched.status,
            digest: digest.clone(),
            parsed,
            observation: observation.clone(),
        };
        self.with_session(mission_id, |s| {
            if push_history {
                if let Some(previous) = &s.page {
                    s.back.push(previous.url.clone());
                    if s.back.len() > 50 {
                        s.back.remove(0);
                    }
                }
                s.forward.clear();
            }
            s.typed.clear();
            s.attached.clear();
            s.record.current_origin = Some(bounded(&origin_of(&page.url), 300));
            s.record.current_url = Some(bounded(page.url.as_str(), 2048));
            s.record.current_title = Some(bounded(&page.parsed.title, 300));
            s.record.last_activity_at = self.clock.now();
            s.page = Some(page);
            if s.record.state == SessionState::Created.as_str() {
                s.record.state = SessionState::Active.as_str().into();
            }
            self.persist(s);
        });
        if let Ok(mut t) = self.timings.lock() {
            t.observations += 1;
            t.observation_micros_total += began.elapsed().as_micros() as u64;
        }
        let measured = serde_json::to_vec(&observation).unwrap_or_default();
        BrowserActionResult {
            summary: format!(
                "loaded {} (HTTP {}) \"{}\" after {} redirect(s); {} link(s), {} form(s); content digest {}",
                bounded(fetched.final_url.as_str(), 200),
                fetched.status,
                bounded(&observation.title, 120),
                fetched.redirects.len(),
                observation.links.len(),
                observation.forms.len(),
                &digest[..16]
            ),
            measured_bytes: measured,
            observed_text: Some(observation.observed_text()),
            observation: Some(observation),
            kind: "BROWSER_OBSERVATION",
            detail: format!("status={} redirects={} server_ms={}", fetched.status, fetched.redirects.len(), fetched.server_ms),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn fetch_and_load(
        &self,
        ctx: &BrowserActionContext<'_>,
        session_id: &str,
        action: &str,
        target: &str,
        method: &str,
        url: &Url,
        body: Option<RequestBody>,
        push_history: bool,
    ) -> Result<BrowserActionResult, BrowserFailure> {
        let began = std::time::Instant::now();
        let fetched = self.engine.fetch(method, url, body, ctx.cancel, Some(ctx.timeout_ms)).map_err(Self::map_fetch);
        let elapsed = began.elapsed().as_millis() as u64;
        match fetched {
            Ok(page) => {
                let server_ms = page.server_ms;
                let (final_url, status) = (page.final_url.to_string(), page.status);
                let mut result = self.load(ctx.mission_id, page, push_history);
                let digest = result.observation.as_ref().map(|o| o.content_digest.clone());
                self.record_action(session_id, ctx, action, target, "EXECUTED", None, Some(&final_url), Some(status), digest.as_deref(), elapsed);
                if let Ok(mut t) = self.timings.lock() {
                    t.navigations += 1;
                    t.navigation_overhead_micros_total += (began.elapsed().as_micros() as u64).saturating_sub(server_ms * 1000);
                }
                result.kind = if action == "NAVIGATE" || action == "RELOAD" || action == "BACK" || action == "FORWARD" {
                    "BROWSER_OBSERVATION"
                } else {
                    "BROWSER_ACTION_RESULT"
                };
                Ok(result)
            }
            Err(failure) => {
                let status = if failure == BrowserFailure::Cancelled { "CANCELLED" } else { "FAILED" };
                self.record_action(session_id, ctx, action, target, status, Some(failure.code()), Some(url.as_str()), None, None, elapsed);
                if failure == BrowserFailure::Cancelled {
                    self.with_session(ctx.mission_id, |s| self.set_state(s, SessionState::Cancelled, Some("MISSION_CANCELLED")));
                }
                Err(failure)
            }
        }
    }

    // ——— الأفعال.

    pub fn navigate(&self, ctx: &BrowserActionContext<'_>, raw_url: &str) -> Result<BrowserActionResult, BrowserFailure> {
        let session_id = self.ensure_session(ctx)?;
        let url = match self.check_destination(raw_url) {
            Ok(url) => url,
            Err(failure) => {
                self.record_action(&session_id, ctx, "NAVIGATE", raw_url, "DENIED", Some(failure.code()), None, None, None, 0);
                return Err(failure);
            }
        };
        self.reserve(ctx.mission_id, true, false, false)?;
        self.fetch_and_load(ctx, &session_id, "NAVIGATE", raw_url, "GET", &url, None, true)
    }

    pub fn read(&self, ctx: &BrowserActionContext<'_>, offset: usize) -> Result<BrowserActionResult, BrowserFailure> {
        let session_id = self.ensure_session(ctx)?;
        let Some(page) = self.page_snapshot(ctx.mission_id) else {
            return Err(BrowserFailure::InvalidTarget("no page is loaded in this mission's browser session".into()));
        };
        self.reserve(ctx.mission_id, false, false, false)?;
        let text: String = page.parsed.text.chars().skip(offset).take(4000).collect();
        let observation = page.observation.clone();
        self.record_action(&session_id, ctx, "READ", page.url.as_str(), "EXECUTED", None, Some(page.url.as_str()), Some(page.status), Some(&page.digest), 0);
        Ok(BrowserActionResult {
            summary: format!(
                "read {} characters of \"{}\" from offset {offset} [{}]",
                text.chars().count(),
                bounded(&observation.title, 120),
                super::observation::WEB_UNTRUSTED
            ),
            measured_bytes: text.as_bytes().to_vec(),
            observed_text: Some(bounded(&format!("{}\n{}", page.parsed.title, text), 4000)),
            observation: Some(observation),
            kind: "BROWSER_OBSERVATION",
            detail: format!("offset={offset} total_chars={}", page.parsed.text.chars().count()),
        })
    }

    /// خطة النقر كما تقرّرها الصفحة المحمّلة. تُستدعى من نقطة قرار السياسة.
    pub fn plan_click(&self, mission_id: &str, target: &str) -> Result<ClickPlan, BrowserFailure> {
        let page = self
            .page_snapshot(mission_id)
            .ok_or_else(|| BrowserFailure::InvalidTarget("no page is loaded in this mission's browser session".into()))?;
        match plan_click(&page.url, &page.parsed, target) {
            None => Err(BrowserFailure::InvalidTarget(format!("no element {} on the loaded page", bounded(target, 40)))),
            Some(ClickPlan::NoAction(reason)) => Err(BrowserFailure::InvalidTarget(format!("the element has no action this engine performs: {reason}"))),
            Some(plan) => {
                // الوجهة نفسها تمرّ بالسياسة قبل أي قرار آخر.
                let url = match &plan {
                    ClickPlan::Follow { url, .. } | ClickPlan::Submit { url, .. } => url.clone(),
                    ClickPlan::NoAction(_) => unreachable!(),
                };
                self.engine.policy().check(&url).map_err(|d| BrowserFailure::Navigation(d.as_str()))?;
                Ok(plan)
            }
        }
    }

    /// يبني جسم إرسال نموذج من حقوله وما كُتب فيها وما أُرفق بها.
    fn form_payload(&self, mission_id: &str, form_ref: &str, button_ref: &str) -> Option<FormPayload> {
        self.with_session(mission_id, |s| {
            let page = s.page.as_ref()?;
            let form = page.parsed.forms.iter().find(|f| f.form_ref == form_ref)?;
            let mut pairs = Vec::new();
            let mut files = Vec::new();
            for field in &form.fields {
                let Some(name) = field.name.clone().filter(|n| !n.is_empty()) else { continue };
                if field.is_submit() {
                    if field.element_ref == button_ref {
                        pairs.push((name, field.value.clone()));
                    }
                    continue;
                }
                // حقل كلمة المرور لا يُرسل أبدًا، ولا فارغًا: لا يملأه الوكيل، ولا تخرج
                // قيمة افتراضية وضعتها الصفحة فيه.
                if field.is_password() {
                    continue;
                }
                if field.is_file() {
                    if let Some(file) = s.attached.get(&field.element_ref) {
                        files.push((name, file.clone()));
                    }
                    continue;
                }
                if matches!(field.input_type.as_str(), "checkbox" | "radio" | "button" | "reset" | "image") {
                    continue;
                }
                let value = s.typed.get(&field.element_ref).cloned().unwrap_or_else(|| field.value.clone());
                pairs.push((name, value));
            }
            Some((pairs, files))
        })
        .flatten()
    }

    pub fn click(&self, ctx: &BrowserActionContext<'_>, target: &str) -> Result<BrowserActionResult, BrowserFailure> {
        let session_id = self.ensure_session(ctx)?;
        let plan = match self.plan_click(ctx.mission_id, target) {
            Ok(plan) => plan,
            Err(failure) => {
                self.record_action(&session_id, ctx, "CLICK", target, "DENIED", Some(failure.code()), None, None, None, 0);
                return Err(failure);
            }
        };
        self.reserve(ctx.mission_id, true, false, false)?;
        match plan {
            ClickPlan::Follow { url, .. } => self.fetch_and_load(ctx, &session_id, "CLICK", target, "GET", &url, None, true),
            ClickPlan::Submit { form_ref, method, url, .. } => {
                let button = self
                    .page_snapshot(ctx.mission_id)
                    .and_then(|p| match p.parsed.find(target) {
                        Some(ElementHit::Field(_, f)) => Some(f.element_ref.clone()),
                        _ => None,
                    })
                    .unwrap_or_default();
                let (pairs, files) = self.form_payload(ctx.mission_id, &form_ref, &button).unwrap_or_default();
                let (method, url, body) = if method == "POST" {
                    if files.is_empty() {
                        let encoded = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs.iter()).finish();
                        ("POST", url, Some(RequestBody { content_type: "application/x-www-form-urlencoded".into(), bytes: encoded.into_bytes() }))
                    } else {
                        let boundary = format!("polaris-{}", &crate::digest::sha256_hex(self.clock.id().as_bytes())[..24]);
                        let mut bytes = Vec::new();
                        for (name, value) in &pairs {
                            bytes.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
                        }
                        for (name, file) in &files {
                            bytes.extend_from_slice(
                                format!(
                                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
                                    file.file_name, file.content_type
                                )
                                .as_bytes(),
                            );
                            bytes.extend_from_slice(&file.bytes);
                            bytes.extend_from_slice(b"\r\n");
                        }
                        bytes.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
                        ("POST", url, Some(RequestBody { content_type: format!("multipart/form-data; boundary={boundary}"), bytes }))
                    }
                } else {
                    let mut with_query = url.clone();
                    with_query.set_query(None);
                    with_query.query_pairs_mut().extend_pairs(pairs.iter());
                    ("GET", with_query, None)
                };
                let mut result = self.fetch_and_load(ctx, &session_id, "CLICK", target, method, &url, body, true)?;
                // الفعل وقع. قبول الخادم لا يُستنتج من ذلك: ما لوحظ بعده هو ما يُقارَن
                // بادّعاء النتيجة في طبقة الحقيقة، والفعل نفسه لا يؤيّد شيئًا.
                result.summary = format!("ACTION_EXECUTED: form {form_ref} sent by {method}; outcome UNVERIFIED by this action. {}", result.summary);
                Ok(result)
            }
            ClickPlan::NoAction(reason) => Err(BrowserFailure::InvalidTarget(reason.into())),
        }
    }

    /// فحص الكتابة قبل أي أثر: الهدف حقل نصّي ظاهر، ليس كلمة مرور، والنصّ ليس سرًّا.
    pub fn check_type(&self, mission_id: &str, target: &str, text: &str) -> Result<String, BrowserFailure> {
        let page = self
            .page_snapshot(mission_id)
            .ok_or_else(|| BrowserFailure::InvalidTarget("no page is loaded in this mission's browser session".into()))?;
        let Some(ElementHit::Field(_, field)) = page.parsed.find(target) else {
            return Err(BrowserFailure::InvalidTarget(format!("no field {} on the loaded page", bounded(target, 40))));
        };
        if field.is_password() {
            return Err(BrowserFailure::NotPermitted("typing into a password field is not permitted".into()));
        }
        if field.is_hidden() || field.is_file() || !field.is_typeable() {
            return Err(BrowserFailure::NotPermitted(format!("the field {} does not accept typed text", field.element_ref)));
        }
        if crate::p05::secret::find(text).is_some() {
            return Err(BrowserFailure::NotPermitted("the text looks like a credential and will not be typed".into()));
        }
        Ok(field.element_ref.clone())
    }

    pub fn type_text(&self, ctx: &BrowserActionContext<'_>, target: &str, text: &str) -> Result<BrowserActionResult, BrowserFailure> {
        let session_id = self.ensure_session(ctx)?;
        let element = match self.check_type(ctx.mission_id, target, text) {
            Ok(e) => e,
            Err(failure) => {
                self.record_action(&session_id, ctx, "TYPE", target, "DENIED", Some(failure.code()), None, None, None, 0);
                return Err(failure);
            }
        };
        self.reserve(ctx.mission_id, false, false, false)?;
        self.with_session(ctx.mission_id, |s| {
            s.typed.insert(element.clone(), text.to_string());
        });
        self.record_action(&session_id, ctx, "TYPE", &element, "EXECUTED", None, None, None, None, 0);
        Ok(BrowserActionResult {
            summary: format!("ACTION_EXECUTED: typed {} character(s) into {element}; nothing was sent", text.chars().count()),
            measured_bytes: format!("TYPE {element} chars={}", text.chars().count()).into_bytes(),
            observation: None,
            kind: "BROWSER_ACTION_RESULT",
            observed_text: None,
            detail: format!("element={element}"),
        })
    }

    pub fn history_move(&self, ctx: &BrowserActionContext<'_>, action: &str) -> Result<BrowserActionResult, BrowserFailure> {
        let session_id = self.ensure_session(ctx)?;
        let target = self
            .with_session(ctx.mission_id, |s| {
                let current = s.page.as_ref().map(|p| p.url.clone());
                match action {
                    "BACK" => s.back.last().cloned(),
                    "FORWARD" => s.forward.last().cloned(),
                    _ => current,
                }
            })
            .flatten();
        let Some(url) = target else {
            let failure = BrowserFailure::InvalidTarget(format!("there is nothing to {} to", action.to_ascii_lowercase()));
            self.record_action(&session_id, ctx, action, "-", "DENIED", Some(failure.code()), None, None, None, 0);
            return Err(failure);
        };
        if let Err(d) = self.engine.policy().check(&url) {
            let failure = BrowserFailure::Navigation(d.as_str());
            self.record_action(&session_id, ctx, action, url.as_str(), "DENIED", Some(failure.code()), None, None, None, 0);
            return Err(failure);
        }
        self.reserve(ctx.mission_id, true, false, false)?;
        let result = self.fetch_and_load(ctx, &session_id, action, url.as_str(), "GET", &url, None, false)?;
        // التاريخ يتحرّك بعد جلب نجح، لا قبله.
        self.with_session(ctx.mission_id, |s| match action {
            "BACK" => {
                s.back.pop();
                s.forward.push(url.clone());
            }
            "FORWARD" => {
                s.forward.pop();
                s.back.push(url.clone());
            }
            _ => {}
        });
        Ok(result)
    }

    /// هدف تنزيل: رابط في الصفحة المحمّلة. يُفحص بالسياسة قبل أي قرار آخر.
    pub fn plan_download(&self, mission_id: &str, target: &str) -> Result<Url, BrowserFailure> {
        let page = self
            .page_snapshot(mission_id)
            .ok_or_else(|| BrowserFailure::InvalidTarget("no page is loaded in this mission's browser session".into()))?;
        let Some(ElementHit::Link(link)) = page.parsed.find(target) else {
            return Err(BrowserFailure::InvalidTarget(format!("no link {} on the loaded page", bounded(target, 40))));
        };
        let url = super::html::resolve(&page.url, &link.href).ok_or_else(|| BrowserFailure::InvalidTarget("the link is not a valid address".into()))?;
        self.engine.policy().check(&url).map_err(|d| BrowserFailure::Navigation(d.as_str()))?;
        Ok(url)
    }

    pub fn download(&self, ctx: &BrowserActionContext<'_>, target: &str) -> Result<BrowserActionResult, BrowserFailure> {
        let session_id = self.ensure_session(ctx)?;
        let url = match self.plan_download(ctx.mission_id, target) {
            Ok(url) => url,
            Err(failure) => {
                self.record_action(&session_id, ctx, "DOWNLOAD", target, "DENIED", Some(failure.code()), None, None, None, 0);
                return Err(failure);
            }
        };
        let Some(root) = self.downloads_root.clone() else {
            return Err(BrowserFailure::Unavailable("this host has no download folder, so nothing can be saved".into()));
        };
        self.reserve(ctx.mission_id, true, true, false)?;
        let began = std::time::Instant::now();
        let fetched = match self.engine.fetch("GET", &url, None, ctx.cancel, Some(ctx.timeout_ms)) {
            Ok(page) => page,
            Err(failure) => {
                let failure = Self::map_fetch(failure);
                self.record_action(&session_id, ctx, "DOWNLOAD", url.as_str(), "FAILED", Some(failure.code()), Some(url.as_str()), None, None, began.elapsed().as_millis() as u64);
                return Err(failure);
            }
        };
        let file_name = sanitise_file_name(fetched.final_url.path());
        let digest = crate::digest::sha256_hex(&fetched.body);
        let executable = looks_executable(&file_name, &fetched.body);
        let download_id = self.clock.id();
        let directory = root.join(sanitise_file_name(ctx.mission_id));
        std::fs::create_dir_all(&directory).map_err(|e| BrowserFailure::Unavailable(format!("the download folder could not be created: {e}")))?;
        // الملف يُحفظ باسم محايد لا يُنفَّذ بالنقر، ولا يُفتح ولا يُنفَّذ هنا أبدًا.
        let path = directory.join(format!("{download_id}.quarantine"));
        std::fs::write(&path, &fetched.body).map_err(|e| BrowserFailure::Unavailable(format!("the download could not be written: {e}")))?;
        // علامة الويب على Windows: الملف جاء من الإنترنت، فيعامله النظام كذلك.
        #[cfg(windows)]
        {
            let mut stream = path.clone().into_os_string();
            stream.push(":Zone.Identifier");
            let _ = std::fs::write(PathBuf::from(stream), "[ZoneTransfer]\r\nZoneId=3\r\n");
        }
        let record = DownloadRecord {
            download_id: download_id.clone(),
            session_id: session_id.clone(),
            mission_id: ctx.mission_id.to_string(),
            source_url: bounded(fetched.final_url.as_str(), 2048),
            file_name: file_name.clone(),
            byte_count: fetched.body.len() as u64,
            sha256: digest.clone(),
            content_type: bounded(&fetched.content_type, 200),
            executable,
            trust: "UNTRUSTED_CONTENT".into(),
            downloaded_at: self.clock.now(),
        };
        let _ = self.store.record_download(&record);
        self.record_action(&session_id, ctx, "DOWNLOAD", url.as_str(), "EXECUTED", None, Some(fetched.final_url.as_str()), Some(fetched.status), Some(&digest), began.elapsed().as_millis() as u64);
        Ok(BrowserActionResult {
            summary: format!(
                "ACTION_EXECUTED: downloaded {} ({} bytes, sha256 {}) into the mission's quarantine folder as download:{download_id}; \
                 executable={executable}; it was not opened or run [UNTRUSTED_CONTENT]",
                file_name,
                fetched.body.len(),
                &digest[..16]
            ),
            measured_bytes: fetched.body,
            observation: None,
            kind: "BROWSER_ACTION_RESULT",
            observed_text: None,
            detail: format!("download_id={download_id} executable={executable}"),
        })
    }

    /// وسيط الملفات: مرجع ملف مسمّى، لا مسار حرّ. في هذا البناء: تنزيلات المهمّة نفسها.
    pub fn resolve_file_ref(&self, mission_id: &str, file_ref: &str) -> Result<DownloadRecord, BrowserFailure> {
        let Some(id) = file_ref.strip_prefix("download:") else {
            return Err(BrowserFailure::NotPermitted("only a file reference issued by this mission's broker can be uploaded".into()));
        };
        let downloads = self.store.downloads(mission_id).map_err(|e| BrowserFailure::Unavailable(e.to_string()))?;
        downloads
            .into_iter()
            .find(|d| d.download_id == id)
            .ok_or_else(|| BrowserFailure::NotPermitted("the file reference is not one this mission holds".into()))
    }

    pub fn check_upload(&self, mission_id: &str, target: &str, file_ref: &str) -> Result<(String, DownloadRecord), BrowserFailure> {
        let page = self
            .page_snapshot(mission_id)
            .ok_or_else(|| BrowserFailure::InvalidTarget("no page is loaded in this mission's browser session".into()))?;
        let Some(ElementHit::Field(_, field)) = page.parsed.find(target) else {
            return Err(BrowserFailure::InvalidTarget(format!("no field {} on the loaded page", bounded(target, 40))));
        };
        if !field.is_file() {
            return Err(BrowserFailure::NotPermitted("the target is not a file field".into()));
        }
        let record = self.resolve_file_ref(mission_id, file_ref)?;
        if record.byte_count > MAX_UPLOAD_BYTES {
            return Err(BrowserFailure::TooLarge(record.byte_count));
        }
        Ok((field.element_ref.clone(), record))
    }

    pub fn upload(&self, ctx: &BrowserActionContext<'_>, target: &str, file_ref: &str) -> Result<BrowserActionResult, BrowserFailure> {
        let session_id = self.ensure_session(ctx)?;
        let (element, record) = match self.check_upload(ctx.mission_id, target, file_ref) {
            Ok(found) => found,
            Err(failure) => {
                self.record_action(&session_id, ctx, "UPLOAD", target, "DENIED", Some(failure.code()), None, None, None, 0);
                return Err(failure);
            }
        };
        let Some(root) = self.downloads_root.clone() else {
            return Err(BrowserFailure::Unavailable("this host has no file broker folder".into()));
        };
        let path = root.join(sanitise_file_name(ctx.mission_id)).join(format!("{}.quarantine", record.download_id));
        let bytes = std::fs::read(&path).map_err(|e| BrowserFailure::Unavailable(format!("the brokered file could not be read: {e}")))?;
        if crate::digest::sha256_hex(&bytes) != record.sha256 {
            return Err(BrowserFailure::NotPermitted("the brokered file changed since it was recorded".into()));
        }
        self.reserve(ctx.mission_id, false, false, true)?;
        self.with_session(ctx.mission_id, |s| {
            s.attached.insert(
                element.clone(),
                AttachedFile { file_name: record.file_name.clone(), content_type: record.content_type.clone(), bytes: bytes.clone() },
            );
        });
        self.record_action(&session_id, ctx, "UPLOAD", &element, "EXECUTED", None, None, None, Some(&record.sha256), 0);
        Ok(BrowserActionResult {
            summary: format!(
                "ACTION_EXECUTED: attached download:{} ({} bytes) to {element}; it is sent only when the form is submitted",
                record.download_id, record.byte_count
            ),
            measured_bytes: format!("UPLOAD {element} sha256={}", record.sha256).into_bytes(),
            observation: None,
            kind: "BROWSER_ACTION_RESULT",
            observed_text: None,
            detail: format!("element={element}"),
        })
    }

    /// يسجّل رفضًا قرّرته نقطة قرار السياسة قبل أي أثر، في تاريخ جلسة المهمّة إن وُجدت.
    /// الرفض حقيقة عن الجلسة كالتنفيذ، ولا يُفتح له جلسة جديدة.
    pub fn record_assessed_refusal(&self, mission_id: &str, task_id: &str, action: &str, target: &str, failure: &BrowserFailure) {
        let Some(session_id) = self.with_session(mission_id, |s| s.record.session_id.clone()) else { return };
        let cancel = CancelToken::new();
        let ctx = BrowserActionContext { mission_id, task_id, agent_id: "", cancel: &cancel, timeout_ms: 0 };
        self.record_action(&session_id, &ctx, action, target, "DENIED", Some(failure.code()), None, None, None, 0);
    }

    // ——— دورة الحياة.

    /// نهاية تشغيل. المهمّة المنتظرة تُبقي جلستها منتظرة؛ المنتهية تُغلقها.
    pub fn mission_finished(&self, mission_id: &str, terminal: bool, failed: bool) {
        self.with_session(mission_id, |s| {
            if !terminal {
                self.set_state(s, SessionState::Waiting, None);
            } else if failed {
                self.set_state(s, SessionState::Failed, Some("MISSION_FAILED"));
            } else {
                self.set_state(s, SessionState::Closed, Some("MISSION_ENDED"));
            }
        });
    }

    pub fn mission_cancelled(&self, mission_id: &str) {
        self.with_session(mission_id, |s| self.set_state(s, SessionState::Cancelled, Some("MISSION_CANCELLED")));
    }

    /// إيقاف من المستخدم عبر عملية الجلسة. يغلق الجلسة، والإلغاء نفسه يمرّ بالمهمّة.
    pub fn close_by_user(&self, session_id: &str) -> Option<String> {
        let mut sessions = self.sessions.lock().ok()?;
        let session = sessions.values_mut().find(|s| s.record.session_id == session_id)?;
        self.set_state(session, SessionState::Cancelled, Some("USER_STOPPED"));
        Some(session.record.mission_id.clone())
    }

    pub fn recover_after_restart(&self) -> u32 {
        self.store.close_after_restart(&self.clock.now()).unwrap_or(0)
    }

    pub fn live_state(&self, mission_id: &str) -> Option<String> {
        self.with_session(mission_id, |s| s.record.state.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::super::engine::fixture::serve;
    use super::super::engine::FetchLimits;
    use super::super::url_policy::NavigationPolicy;
    use super::*;
    use crate::storage::Database;
    use polaris_host_providers::net::HttpClient;

    fn page(body: &str) -> (u16, Vec<(String, String)>, Vec<u8>, u64) {
        (200, vec![("Content-Type".into(), "text/html".into())], body.as_bytes().to_vec(), 0)
    }

    fn handler(method: &str, path: &str, body: &str) -> (u16, Vec<(String, String)>, Vec<u8>, u64) {
        match path {
            "/form" => page(
                r#"<title>Order form</title><form action="/submit" method="post"><input name="item" id="item">
                <input type="password" name="pw" id="pw"><button id="send">Place order</button></form>
                <a href="/files/tool.exe" id="exe">tool</a><a href="/next" id="next">next</a>"#,
            ),
            "/submit" => page(&format!("<title>Accepted</title><p>ORDER ACCEPTED {method} {body}</p>")),
            "/next" => page("<title>Next</title><p>second page</p>"),
            "/files/tool.exe" => (200, vec![("Content-Type".into(), "application/octet-stream".into())], b"MZ\x90\x00fake".to_vec(), 0),
            _ => page("<p>missing</p>"),
        }
    }

    fn runtime(addr: std::net::SocketAddr, downloads: Option<PathBuf>) -> BrowserRuntime {
        let db = Arc::new(Database::in_memory().unwrap());
        BrowserRuntime::new(
            BrowserEngine::new(Arc::new(HttpClient::new()), NavigationPolicy::with_fixture_origins(&[(addr.ip(), addr.port())]), FetchLimits::default()),
            BrowserStore::new(db.clone()),
            RuntimeClock::deterministic(),
            Arc::new(AuditLedger::new(db)),
            ActionBudget::default(),
            downloads,
        )
    }

    fn ctx<'a>(mission: &'a str, cancel: &'a CancelToken) -> BrowserActionContext<'a> {
        BrowserActionContext { mission_id: mission, task_id: "t1", agent_id: "a1", cancel, timeout_ms: 5000 }
    }

    #[test]
    fn navigate_type_and_submit_record_an_executed_action_and_an_observation() {
        let addr = serve(handler);
        let rt = runtime(addr, None);
        let cancel = CancelToken::new();
        let c = ctx("m1", &cancel);
        let loaded = rt.navigate(&c, &format!("http://{addr}/form")).unwrap();
        assert_eq!(loaded.kind, "BROWSER_OBSERVATION");
        assert_eq!(rt.live_state("m1").as_deref(), Some("ACTIVE"));
        assert!(matches!(rt.type_text(&c, "#pw", "x"), Err(BrowserFailure::NotPermitted(_))), "a password field accepted text");
        rt.type_text(&c, "#item", "blue widget").unwrap();
        let plan = rt.plan_click("m1", "#send").unwrap();
        assert!(plan.is_external(), "a POST order form was not classified external");
        let sent = rt.click(&c, "#send").unwrap();
        assert!(sent.summary.starts_with("ACTION_EXECUTED"));
        assert!(sent.summary.contains("outcome UNVERIFIED"));
        assert!(sent.observed_text.unwrap().contains("ORDER ACCEPTED POST item=blue+widget"));
        let session = rt.store().sessions(Some("m1")).unwrap().remove(0);
        let actions = rt.store().actions(&session.session_id).unwrap();
        assert!(actions.iter().any(|a| a.action == "TYPE" && a.status == "DENIED"));
        assert!(actions.iter().any(|a| a.action == "CLICK" && a.outcome == "ACTION_EXECUTED"));
    }

    #[test]
    fn sessions_are_mission_bound_and_a_closed_session_is_not_reused() {
        let addr = serve(handler);
        let rt = runtime(addr, None);
        let cancel = CancelToken::new();
        rt.navigate(&ctx("m1", &cancel), &format!("http://{addr}/next")).unwrap();
        // مهمّة أخرى لا ترى صفحة الأولى.
        assert!(rt.read(&ctx("m2", &cancel), 0).is_err());
        rt.mission_finished("m1", true, false);
        assert_eq!(rt.navigate(&ctx("m1", &cancel), &format!("http://{addr}/next")).unwrap_err(), BrowserFailure::SessionClosed("CLOSED"));
    }

    #[test]
    fn a_javascript_or_private_destination_is_refused_and_recorded() {
        let addr = serve(handler);
        let rt = runtime(addr, None);
        let cancel = CancelToken::new();
        assert_eq!(rt.navigate(&ctx("m1", &cancel), "javascript:alert(1)").unwrap_err(), BrowserFailure::Navigation("SCHEME_NOT_ALLOWED"));
        assert_eq!(rt.navigate(&ctx("m1", &cancel), "http://10.0.0.1/").unwrap_err(), BrowserFailure::Navigation("PRIVATE_ADDRESS_DENIED"));
        let session = rt.store().sessions(Some("m1")).unwrap().remove(0);
        assert_eq!(rt.store().actions(&session.session_id).unwrap().iter().filter(|a| a.status == "DENIED").count(), 2);
    }

    #[test]
    fn an_executable_download_is_quarantined_flagged_and_never_run() {
        let addr = serve(handler);
        let dir = crate::test_scratch::root().join(format!("p05-dl-{}", std::process::id()));
        let rt = runtime(addr, Some(dir.clone()));
        let cancel = CancelToken::new();
        let c = ctx("m1", &cancel);
        rt.navigate(&c, &format!("http://{addr}/form")).unwrap();
        let result = rt.download(&c, "#exe").unwrap();
        assert!(result.summary.contains("executable=true"));
        let downloads = rt.store().downloads("m1").unwrap();
        assert_eq!(downloads.len(), 1);
        assert!(downloads[0].executable);
        let stored = std::fs::read_dir(dir.join("m1")).unwrap().filter_map(Result::ok).map(|e| e.file_name().to_string_lossy().to_string()).collect::<Vec<_>>();
        assert!(stored.iter().all(|n| n.ends_with(".quarantine")), "a download kept a runnable name: {stored:?}");
        // الوسيط يقبل مرجعه، ويرفض مسارًا حرًّا.
        assert!(rt.resolve_file_ref("m1", &format!("download:{}", downloads[0].download_id)).is_ok());
        assert!(matches!(rt.resolve_file_ref("m1", "C:\\Windows\\win.ini"), Err(BrowserFailure::NotPermitted(_))));
        assert!(matches!(rt.resolve_file_ref("m2", &format!("download:{}", downloads[0].download_id)), Err(BrowserFailure::NotPermitted(_))));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn the_navigation_budget_is_enforced_before_the_fetch() {
        let addr = serve(handler);
        let db = Arc::new(Database::in_memory().unwrap());
        let rt = BrowserRuntime::new(
            BrowserEngine::new(Arc::new(HttpClient::new()), NavigationPolicy::with_fixture_origins(&[(addr.ip(), addr.port())]), FetchLimits::default()),
            BrowserStore::new(db.clone()),
            RuntimeClock::deterministic(),
            Arc::new(AuditLedger::new(db)),
            ActionBudget { max_browser_navigations: 1, ..ActionBudget::default() },
            None,
        );
        let cancel = CancelToken::new();
        rt.navigate(&ctx("m1", &cancel), &format!("http://{addr}/next")).unwrap();
        assert_eq!(
            rt.navigate(&ctx("m1", &cancel), &format!("http://{addr}/next")).unwrap_err(),
            BrowserFailure::Budget(BudgetDimension::BrowserNavigations)
        );
    }

    #[test]
    fn a_restart_closes_open_sessions_honestly() {
        let addr = serve(handler);
        let rt = runtime(addr, None);
        let cancel = CancelToken::new();
        rt.navigate(&ctx("m1", &cancel), &format!("http://{addr}/next")).unwrap();
        assert_eq!(rt.recover_after_restart(), 1);
        let session = rt.store().sessions(Some("m1")).unwrap().remove(0);
        assert_eq!(session.state, "CLOSED");
        assert_eq!(session.closed_reason.as_deref(), Some("HOST_RESTARTED"));
    }
}
