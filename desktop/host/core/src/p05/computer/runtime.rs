// زمن تشغيل التحكّم بسطح المكتب: منح، وجلسات، وملاحظات، وأفعال محروسة.
//
// الحدود (البنود 29–37):
//   ١ — لا فعل بلا جلسة، ولا جلسة بلا مهمّة، ولا نافذة بلا منحة من المستخدم لهذه
//       المهمّة بعينها. منحة مهمّة أخرى ليست منحة.
//   ٢ — الهويّة قوية: المقبض والعملية ووقت إنشائها والملف التنفيذي. معرّف عملية
//       أُعيد استعماله يُكشف بوقت الإنشاء، ونافذة استُبدلت تُكشف بالمقبض.
//   ٣ — كل اقتراح فعل مربوط ببصمة ملاحظة. قبل الفعل تُعاد الملاحظة؛ إن تغيّر
//       التخطيط فالاقتراح قديم ويُرفض، ولا يُنقر على إحداثيات لم تعد تصف الشاشة.
//   ٤ — لا إدخال إلى نافذة ليست في المقدّمة، ولا نقر على نقطة تغطّيها نافذة أخرى.
//   ٥ — واجهات الأمان وحقول كلمات المرور مرفوضة، والفعل الخطر أو المجهول الأثر
//       يُرفع إلى موافقة. الإلغاء يُفحص بين كل دفعة إدخال وأخرى.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use polaris_host_providers::net::CancelToken;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::p04::adapter::bounded;
use crate::p05::session::{reserve, ActionBudget, BudgetDimension, SessionState};

use super::observation::{ObservedElement, ScreenObservation};
use super::port::{DesktopError, DesktopPort, KeyChord, MouseButton, WindowInfo};
use super::risk::{activation_sensitivity, typing_sensitivity, window_sensitivity, Sensitivity};
use super::store::{ComputerActionRecord, ComputerSessionRecord, ComputerStore, ObservationRecord, TargetGrant};

/// أقصى طول لنصّ يُكتب في فعل واحد.
pub const MAX_TYPED_CHARS: usize = 200;
/// حجم دفعة الكتابة: الإلغاء يُفحص بين دفعة وأخرى.
const TYPE_CHUNK: usize = 16;

pub struct ComputerActionContext<'a> {
    pub mission_id: &'a str,
    pub task_id: &'a str,
    pub agent_id: &'a str,
    pub cancel: &'a CancelToken,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComputerFailure {
    /// النافذة ليست ممنوحة لهذه المهمّة (أو ممنوحة لمهمّة أخرى).
    NotGranted(String),
    NotPermitted(String),
    Stale(String),
    InvalidTarget(String),
    SessionClosed(&'static str),
    Budget(BudgetDimension),
    Cancelled,
    Desktop(DesktopError),
}

impl ComputerFailure {
    pub fn code(&self) -> String {
        match self {
            Self::NotGranted(_) => "TARGET_NOT_GRANTED".into(),
            Self::NotPermitted(_) => "NOT_PERMITTED".into(),
            Self::Stale(_) => "STALE_OBSERVATION".into(),
            Self::InvalidTarget(_) => "INVALID_TARGET".into(),
            Self::SessionClosed(_) => "SESSION_CLOSED".into(),
            Self::Budget(d) => format!("BUDGET_EXHAUSTED:{}", d.as_str()),
            Self::Cancelled => "CANCELLED".into(),
            Self::Desktop(DesktopError::WindowGone) => "TARGET_GONE".into(),
            Self::Desktop(DesktopError::NotForeground) => "TARGET_NOT_FOREGROUND".into(),
            Self::Desktop(DesktopError::Obscured) => "TARGET_OBSCURED".into(),
            Self::Desktop(DesktopError::Unavailable(_)) => "DESKTOP_UNAVAILABLE".into(),
            Self::Desktop(DesktopError::Failed(_)) => "DESKTOP_FAILED".into(),
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Self::NotGranted(d) | Self::NotPermitted(d) | Self::Stale(d) | Self::InvalidTarget(d) => d.clone(),
            Self::SessionClosed(state) => format!("the computer session for this mission is {state}"),
            Self::Budget(d) => format!("the mission's {} budget is exhausted", d.as_str()),
            Self::Cancelled => "the mission was cancelled; no further input is sent".into(),
            Self::Desktop(e) => e.describe(),
        }
    }
}

/// فعل إدخال مقترح، كما فكّكته محوّلات الأدوات من حجج مغلقة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputAction {
    PointerMove,
    Click(MouseButton),
    Key(KeyChord),
    Type(String),
    Scroll(i32),
}

impl InputAction {
    pub fn code(&self) -> &'static str {
        match self {
            Self::PointerMove => "POINTER_MOVE",
            Self::Click(_) => "CLICK",
            Self::Key(_) => "KEY",
            Self::Type(_) => "TYPE",
            Self::Scroll(_) => "SCROLL",
        }
    }
}

/// اقتراح فعل حاسوب مهيكل (ComputerActionProposalV1). النموذج يقترح، وزمن التشغيل
/// يملأ المهمّة والمهمّة الفرعية والجلسة والهدف، ويقرّر الخطر.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerActionProposalV1 {
    pub mission_id: String,
    pub task_id: String,
    pub session_id: String,
    pub target: String,
    pub action: InputAction,
    pub element: Option<String>,
    pub coordinates: Option<(i32, i32)>,
    pub observation_digest: String,
    pub reason: String,
    pub expected_effect: String,
    pub risk: &'static str,
}

/// خطة فعل بعد التقييم: النافذة الحيّة، والعنصر، والنقطة، والحكم.
#[derive(Debug, Clone)]
pub struct InputPlan {
    pub grant: TargetGrant,
    pub window: WindowInfo,
    pub element: Option<ObservedElement>,
    pub point: Option<(i32, i32)>,
    pub sensitivity: Sensitivity,
    pub session_id: String,
}

#[derive(Debug, Clone)]
pub struct ComputerActionResult {
    pub summary: String,
    pub measured_bytes: Vec<u8>,
    pub observation: Option<ScreenObservation>,
    pub kind: &'static str,
    pub observed_text: Option<String>,
    pub detail: String,
}

/// نافذة كما تُعرض على المستخدم ليمنحها. لا تبلغ النموذج.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct InventoryWindow {
    pub hwnd: String,
    pub title: String,
    pub executable: String,
    pub pid: u32,
    pub grantable: bool,
    pub reason: Option<&'static str>,
}

struct ComputerSession {
    record: ComputerSessionRecord,
    latest: Option<ScreenObservation>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ComputerTimings {
    pub captures: u64,
    pub capture_micros_total: u64,
    pub dispatches: u64,
    pub dispatch_micros_total: u64,
}

pub struct ComputerRuntime {
    port: Arc<dyn DesktopPort>,
    store: ComputerStore,
    clock: RuntimeClock,
    audit: Arc<AuditLedger>,
    budget: ActionBudget,
    own_pid: u32,
    sessions: Mutex<BTreeMap<String, ComputerSession>>,
    timings: Mutex<ComputerTimings>,
    settle: Duration,
}

impl ComputerRuntime {
    pub fn new(port: Arc<dyn DesktopPort>, store: ComputerStore, clock: RuntimeClock, audit: Arc<AuditLedger>, budget: ActionBudget) -> Self {
        Self {
            port,
            store,
            clock,
            audit,
            budget,
            own_pid: std::process::id(),
            sessions: Mutex::new(BTreeMap::new()),
            timings: Mutex::new(ComputerTimings::default()),
            settle: Duration::from_millis(150),
        }
    }

    /// زمن الانتظار بعد الإدخال قبل الملاحظة اللاحقة. للاختبار: صفر.
    pub fn with_settle(mut self, settle: Duration) -> Self {
        self.settle = settle;
        self
    }

    pub fn store(&self) -> &ComputerStore {
        &self.store
    }

    pub fn available(&self) -> bool {
        self.port.available()
    }

    pub fn timings(&self) -> ComputerTimings {
        self.timings.lock().map(|t| *t).unwrap_or_default()
    }

    fn audit(&self, event: AuditEventType, subject: &str, outcome: AuditOutcome, detail: serde_json::Value) {
        let _ = self.audit.append(&AuditRecord::new(event, "computer_session", subject, outcome, detail));
    }

    // ——— المنح (من المستخدم عبر IPC، لا من الوكيل).

    fn grantability(&self, window: &WindowInfo) -> Option<&'static str> {
        if window.identity.pid == self.own_pid {
            // نافذة POLARIS نفسها لا تُمنح: وكيل ينقر واجهة الموافقة يوافق على نفسه.
            return Some("POLARIS_OWN_WINDOW");
        }
        if !window.identity.is_complete() {
            return Some("IDENTITY_INCOMPLETE");
        }
        if let Sensitivity::Refuse(reason) = window_sensitivity(window) {
            return Some(reason);
        }
        if !window.visible || window.minimized {
            return Some("NOT_VISIBLE");
        }
        None
    }

    /// جرد للمستخدم: النوافذ الظاهرة، وهل تُمنح ولماذا. لا يصل هذا الجرد إلى النموذج.
    pub fn user_inventory(&self) -> Result<Vec<InventoryWindow>, ComputerFailure> {
        let windows = self.port.list_windows().map_err(ComputerFailure::Desktop)?;
        Ok(windows
            .iter()
            .filter(|w| w.visible && !w.title.trim().is_empty())
            .take(100)
            .map(|w| {
                let reason = self.grantability(w);
                InventoryWindow {
                    hwnd: format!("{:#x}", w.identity.hwnd),
                    title: bounded(&w.title, 200),
                    executable: w.identity.executable_name(),
                    pid: w.identity.pid,
                    grantable: reason.is_none(),
                    reason,
                }
            })
            .collect())
    }

    /// يمنح نافذة لمهمّة. الهويّة تُقرأ الآن من النظام، لا من الطلب.
    pub fn grant(&self, mission_id: &str, hwnd: u64) -> Result<TargetGrant, ComputerFailure> {
        let window = self.port.window(hwnd).map_err(ComputerFailure::Desktop)?;
        if let Some(reason) = self.grantability(&window) {
            return Err(ComputerFailure::NotPermitted(format!("this window cannot be granted: {reason}")));
        }
        let grant = TargetGrant {
            grant_id: self.clock.id(),
            mission_id: mission_id.to_string(),
            identity: window.identity.clone(),
            title: bounded(&window.title, 200),
            granted_at: self.clock.now(),
            revoked_at: None,
        };
        self.store.save_grant(&grant).map_err(|e| ComputerFailure::Desktop(DesktopError::Failed(e.to_string())))?;
        self.audit(
            AuditEventType::ComputerTargetGranted,
            &grant.grant_id,
            AuditOutcome::Success,
            serde_json::json!({ "mission_id": mission_id, "pid": window.identity.pid, "executable": window.identity.executable_name() }),
        );
        Ok(grant)
    }

    pub fn revoke(&self, grant_id: &str) -> bool {
        let Ok(grants) = self.store.grants(None) else { return false };
        let Some(mut grant) = grants.into_iter().find(|g| g.grant_id == grant_id && g.revoked_at.is_none()) else {
            return false;
        };
        grant.revoked_at = Some(self.clock.now());
        let saved = self.store.save_grant(&grant).is_ok();
        if saved {
            self.audit(AuditEventType::ComputerTargetRevoked, grant_id, AuditOutcome::Success, serde_json::json!({ "mission_id": grant.mission_id }));
        }
        saved
    }

    pub fn grants_for(&self, mission_id: &str) -> Vec<TargetGrant> {
        self.store.grants(Some(mission_id)).unwrap_or_default().into_iter().filter(|g| g.revoked_at.is_none()).collect()
    }

    /// يحلّ مرجع نافذة إلى منحة هذه المهمّة. منحة مهمّة أخرى رفضٌ، لا بحث أوسع.
    fn resolve_grant(&self, mission_id: &str, window_ref: Option<&str>) -> Result<TargetGrant, ComputerFailure> {
        let mine = self.grants_for(mission_id);
        match window_ref.filter(|r| !r.is_empty()) {
            Some(reference) => {
                if let Some(found) = mine.into_iter().find(|g| g.grant_id == reference) {
                    return Ok(found);
                }
                let elsewhere = self.store.grants(None).unwrap_or_default().into_iter().any(|g| g.grant_id == reference);
                Err(ComputerFailure::NotGranted(if elsewhere {
                    "that window is granted to another mission, not this one".into()
                } else {
                    "no window with that reference is granted to this mission".into()
                }))
            }
            None => {
                let bound = self
                    .sessions
                    .lock()
                    .ok()
                    .and_then(|s| s.get(mission_id).and_then(|s| s.record.target.clone()))
                    .filter(|g| mine.iter().any(|m| m.grant_id == g.grant_id));
                if let Some(target) = bound {
                    return Ok(target);
                }
                match mine.len() {
                    0 => Err(ComputerFailure::NotGranted("no window has been granted to this mission".into())),
                    1 => Ok(mine.into_iter().next().expect("one grant")),
                    _ => Err(ComputerFailure::InvalidTarget("several windows are granted; name one by its grant reference".into())),
                }
            }
        }
    }

    /// النافذة الحيّة لمنحة، بعد التحقق من أنها ما زالت الهويّة الممنوحة نفسها.
    fn live_window(&self, grant: &TargetGrant) -> Result<WindowInfo, ComputerFailure> {
        let window = self.port.window(grant.identity.hwnd).map_err(ComputerFailure::Desktop)?;
        if !window.identity.same_as(&grant.identity) {
            return Err(ComputerFailure::NotPermitted(
                "the window's identity changed since it was granted (a different process now owns this handle or process id)".into(),
            ));
        }
        if let Sensitivity::Refuse(reason) = window_sensitivity(&window) {
            return Err(ComputerFailure::NotPermitted(format!("input to this window is refused: {reason}")));
        }
        Ok(window)
    }

    // ——— الجلسات.

    fn persist(&self, session: &ComputerSession) {
        let _ = self.store.save_session(&session.record);
    }

    fn set_state(&self, session: &mut ComputerSession, next: SessionState, reason: Option<&str>) {
        let current = SessionState::parse(&session.record.state).unwrap_or(SessionState::Closed);
        if current == next || !current.can_transition_to(next) {
            return;
        }
        session.record.state = next.as_str().into();
        if next.is_terminal() {
            session.record.closed_reason = reason.map(str::to_string);
            self.audit(
                AuditEventType::ComputerSessionClosed,
                &session.record.session_id,
                if next == SessionState::Cancelled { AuditOutcome::Cancelled } else { AuditOutcome::Success },
                serde_json::json!({ "mission_id": session.record.mission_id, "state": next.as_str(), "reason": reason }),
            );
        }
        self.persist(session);
    }

    fn ensure_session(&self, ctx: &ComputerActionContext<'_>) -> Result<String, ComputerFailure> {
        let mut sessions = self.sessions.lock().map_err(|_| ComputerFailure::Desktop(DesktopError::Failed("session table".into())))?;
        if let Some(existing) = sessions.get_mut(ctx.mission_id) {
            let state = SessionState::parse(&existing.record.state).unwrap_or(SessionState::Closed);
            if state.is_terminal() {
                return Err(ComputerFailure::SessionClosed(state.as_str()));
            }
            if state == SessionState::Waiting {
                self.set_state(existing, SessionState::Active, None);
            }
            return Ok(existing.record.session_id.clone());
        }
        let record = ComputerSessionRecord {
            session_id: self.clock.id(),
            mission_id: ctx.mission_id.to_string(),
            agent_id: ctx.agent_id.to_string(),
            state: SessionState::Created.as_str().into(),
            target: None,
            created_at: self.clock.now(),
            last_action_at: None,
            action_count: 0,
            click_count: 0,
            keyboard_count: 0,
            capture_count: 0,
            closed_reason: None,
        };
        let id = record.session_id.clone();
        self.audit(AuditEventType::ComputerSessionOpened, &id, AuditOutcome::Success, serde_json::json!({ "mission_id": ctx.mission_id, "agent_id": ctx.agent_id }));
        let session = ComputerSession { record, latest: None };
        self.persist(&session);
        sessions.insert(ctx.mission_id.to_string(), session);
        Ok(id)
    }

    fn with_session<T>(&self, mission_id: &str, work: impl FnOnce(&mut ComputerSession) -> T) -> Option<T> {
        let mut sessions = self.sessions.lock().ok()?;
        sessions.get_mut(mission_id).map(work)
    }

    pub fn live_state(&self, mission_id: &str) -> Option<String> {
        self.with_session(mission_id, |s| s.record.state.clone())
    }

    pub fn latest_observation(&self, mission_id: &str) -> Option<ScreenObservation> {
        self.with_session(mission_id, |s| s.latest.clone()).flatten()
    }

    fn charge(&self, mission_id: &str, clicks: u32, keys: u32, captures: u32) -> Result<(), ComputerFailure> {
        let budget = self.budget;
        self.with_session(mission_id, |s| {
            let r = &mut s.record;
            let (mut a, mut c, mut k, mut p) = (r.action_count, r.click_count, r.keyboard_count, r.capture_count);
            reserve(&mut a, 1, budget.max_computer_actions, BudgetDimension::ComputerActions)?;
            reserve(&mut c, clicks, budget.max_clicks, BudgetDimension::Clicks)?;
            reserve(&mut k, keys, budget.max_keyboard_events, BudgetDimension::KeyboardEvents)?;
            reserve(&mut p, captures, budget.max_screen_captures, BudgetDimension::ScreenCaptures)?;
            r.action_count = a;
            r.click_count = c;
            r.keyboard_count = k;
            r.capture_count = p;
            Ok(())
        })
        .unwrap_or(Err(BudgetDimension::ComputerActions))
        .map_err(ComputerFailure::Budget)
    }

    #[allow(clippy::too_many_arguments)]
    fn record_action(&self, session_id: &str, ctx: &ComputerActionContext<'_>, action: &str, target: &str, status: &str, reason: Option<String>, digest: Option<&str>, duration_ms: u64) {
        let _ = self.store.record_action(&ComputerActionRecord {
            action_id: self.clock.id(),
            session_id: session_id.to_string(),
            mission_id: ctx.mission_id.to_string(),
            task_id: ctx.task_id.to_string(),
            action: action.to_string(),
            target: bounded(target, 600),
            status: status.to_string(),
            reason_code: reason,
            observation_digest: digest.map(str::to_string),
            occurred_at: self.clock.now(),
            duration_ms,
        });
        self.with_session(ctx.mission_id, |s| {
            s.record.last_action_at = Some(self.clock.now());
            self.persist(s);
        });
    }

    /// يلتقط ملاحظة جديدة لنافذة منحة حيّة. لا يغيّر الجلسة.
    fn capture(&self, grant: &TargetGrant, window: &WindowInfo) -> Result<ScreenObservation, ComputerFailure> {
        let began = Instant::now();
        let elements = self.port.elements(window.identity.hwnd).map_err(ComputerFailure::Desktop)?;
        let frame = self.port.capture(window.identity.hwnd).map_err(ComputerFailure::Desktop)?;
        let observation = ScreenObservation::of(self.clock.id(), &grant.grant_id, window, &elements, &frame, self.clock.now());
        if let Ok(mut t) = self.timings.lock() {
            t.captures += 1;
            t.capture_micros_total += began.elapsed().as_micros() as u64;
        }
        Ok(observation)
    }

    fn remember(&self, session_id: &str, mission_id: &str, grant: &TargetGrant, observation: &ScreenObservation) {
        let _ = self.store.record_observation(&ObservationRecord {
            observation_id: observation.observation_id.clone(),
            session_id: session_id.to_string(),
            mission_id: mission_id.to_string(),
            window_json: observation.window_json(),
            width: observation.width,
            height: observation.height,
            frame_digest: observation.frame_digest.clone(),
            layout_digest: observation.observation_digest.clone(),
            element_count: observation.elements.len() as u32,
            observed_at: observation.timestamp.clone(),
        });
        self.with_session(mission_id, |s| {
            s.latest = Some(observation.clone());
            s.record.target = Some(grant.clone());
            if s.record.state == SessionState::Created.as_str() {
                s.record.state = SessionState::Active.as_str().into();
            }
            self.persist(s);
        });
    }

    fn observation_result(&self, observation: ScreenObservation, kind: &'static str, summary: String) -> ComputerActionResult {
        ComputerActionResult {
            measured_bytes: serde_json::to_vec(&observation).unwrap_or_default(),
            observed_text: Some(observation.observed_text()),
            detail: format!("observation_digest={} frame_digest={}", observation.observation_digest, observation.frame_digest),
            observation: Some(observation),
            kind,
            summary,
        }
    }

    // ——— أفعال القراءة.

    /// نوافذ هذه المهمّة الممنوحة، وعدد ما سواها بلا وصف.
    pub fn list_windows(&self, ctx: &ComputerActionContext<'_>) -> Result<ComputerActionResult, ComputerFailure> {
        let session_id = self.ensure_session(ctx)?;
        self.charge(ctx.mission_id, 0, 0, 0)?;
        let grants = self.grants_for(ctx.mission_id);
        let all = self.port.list_windows().map_err(ComputerFailure::Desktop)?;
        let mut lines = Vec::new();
        for grant in &grants {
            let state = match self.live_window(grant) {
                Ok(w) => format!("live \"{}\"", bounded(&w.title, 120)),
                Err(e) => format!("unavailable ({})", e.code()),
            };
            lines.push(format!("window {} ({} pid {}) {state}", grant.grant_id, grant.identity.executable_name(), grant.identity.pid));
        }
        let others = all.iter().filter(|w| !grants.iter().any(|g| g.identity.hwnd == w.identity.hwnd)).count();
        lines.push(format!("{others} other window(s) exist and are not granted to this mission; they are not described"));
        self.record_action(&session_id, ctx, "WINDOW_LIST", "-", "EXECUTED", None, None, 0);
        let text = lines.join("\n");
        Ok(ComputerActionResult {
            summary: format!("{} granted window(s); {others} other window(s) not described", grants.len()),
            measured_bytes: text.clone().into_bytes(),
            observation: None,
            kind: "COMPUTER_OBSERVATION",
            observed_text: None,
            detail: text,
        })
    }

    /// يلاحظ النافذة الممنوحة ويربطها بالجلسة.
    pub fn observe(&self, ctx: &ComputerActionContext<'_>, window_ref: Option<&str>) -> Result<ComputerActionResult, ComputerFailure> {
        let session_id = self.ensure_session(ctx)?;
        let grant = match self.resolve_grant(ctx.mission_id, window_ref) {
            Ok(g) => g,
            Err(e) => {
                self.record_action(&session_id, ctx, "OBSERVE", window_ref.unwrap_or("-"), "DENIED", Some(e.code()), None, 0);
                return Err(e);
            }
        };
        let window = match self.live_window(&grant) {
            Ok(w) => w,
            Err(e) => {
                self.record_action(&session_id, ctx, "OBSERVE", &grant.grant_id, "DENIED", Some(e.code()), None, 0);
                return Err(e);
            }
        };
        self.charge(ctx.mission_id, 0, 0, 1)?;
        let observation = self.capture(&grant, &window)?;
        self.remember(&session_id, ctx.mission_id, &grant, &observation);
        self.record_action(&session_id, ctx, "OBSERVE", &grant.grant_id, "EXECUTED", None, Some(&observation.observation_digest), 0);
        let summary = format!(
            "observed window \"{}\" ({} pid {}) {}x{}: {} element(s); observation_digest {} [UNTRUSTED_CONTENT]",
            bounded(&observation.window_title, 120),
            observation.executable,
            observation.pid,
            observation.width,
            observation.height,
            observation.elements.len(),
            &observation.observation_digest[..16]
        );
        Ok(self.observation_result(observation, "COMPUTER_OBSERVATION", summary))
    }

    // ——— أفعال الإدخال.

    /// تقييم فعل إدخال دون أي أثر. يُستدعى من نقطة قرار السياسة ثم مرّة ثانية عند التنفيذ.
    pub fn plan_input(
        &self,
        mission_id: &str,
        action: &InputAction,
        element: Option<&str>,
        coordinates: Option<(i32, i32)>,
        observation_digest: &str,
    ) -> Result<InputPlan, ComputerFailure> {
        let (state, session_id, target, latest) = self
            .with_session(mission_id, |s| (s.record.state.clone(), s.record.session_id.clone(), s.record.target.clone(), s.latest.clone()))
            .ok_or_else(|| ComputerFailure::InvalidTarget("this mission has no computer session yet; observe a granted window first".into()))?;
        let state = SessionState::parse(&state).unwrap_or(SessionState::Closed);
        if state.is_terminal() {
            return Err(ComputerFailure::SessionClosed(state.as_str()));
        }
        let grant = target.ok_or_else(|| ComputerFailure::InvalidTarget("no window is bound to this session; observe a granted window first".into()))?;
        if !self.grants_for(mission_id).iter().any(|g| g.grant_id == grant.grant_id) {
            return Err(ComputerFailure::NotGranted("the bound window is no longer granted to this mission".into()));
        }
        let latest = latest.ok_or_else(|| ComputerFailure::InvalidTarget("no observation exists to act on".into()))?;
        if observation_digest != latest.observation_digest {
            return Err(ComputerFailure::Stale(
                "the proposal names an observation that is not the latest one; observe again and replan".into(),
            ));
        }
        let window = self.live_window(&grant)?;
        let element = match (element, coordinates) {
            (Some(reference), _) => Some(
                latest
                    .element(reference)
                    .cloned()
                    .ok_or_else(|| ComputerFailure::InvalidTarget(format!("no element {} in the latest observation", bounded(reference, 20))))?,
            ),
            (None, Some((x, y))) => latest.elements.iter().find(|e| x >= e.x && x < e.x + e.width && y >= e.y && y < e.y + e.height).cloned(),
            (None, None) => None,
        };
        let point = match (&element, coordinates) {
            (Some(e), _) => Some((window.rect.left + e.x + e.width / 2, window.rect.top + e.y + e.height / 2)),
            (None, Some((x, y))) => {
                if x < 0 || y < 0 || x >= window.rect.width() || y >= window.rect.height() {
                    return Err(ComputerFailure::InvalidTarget("the coordinates fall outside the granted window".into()));
                }
                Some((window.rect.left + x, window.rect.top + y))
            }
            (None, None) => None,
        };
        let sensitivity = match action {
            InputAction::Click(_) => {
                if point.is_none() {
                    return Err(ComputerFailure::InvalidTarget("a click needs an element or coordinates".into()));
                }
                activation_sensitivity(&window, element.as_ref())
            }
            InputAction::Key(chord) if chord.activates() => activation_sensitivity(&window, element.as_ref()),
            InputAction::Type(text) => {
                if text.chars().count() > MAX_TYPED_CHARS {
                    return Err(ComputerFailure::InvalidTarget(format!("at most {MAX_TYPED_CHARS} characters are typed in one action")));
                }
                typing_sensitivity(&window, element.as_ref(), text)
            }
            InputAction::Key(_) | InputAction::PointerMove | InputAction::Scroll(_) => match window_sensitivity(&window) {
                Sensitivity::Refuse(r) => Sensitivity::Refuse(r),
                _ => Sensitivity::Safe,
            },
        };
        if let Sensitivity::Refuse(reason) = sensitivity {
            return Err(ComputerFailure::NotPermitted(format!("this input is refused: {reason}")));
        }
        Ok(InputPlan { grant, window, element, point, sensitivity, session_id })
    }

    /// ينفّذ فعل إدخال بعد إعادة الملاحظة والتحقّق من الهويّة والمقدّمة والنقطة.
    pub fn perform(
        &self,
        ctx: &ComputerActionContext<'_>,
        action: &InputAction,
        element: Option<&str>,
        coordinates: Option<(i32, i32)>,
        observation_digest: &str,
    ) -> Result<ComputerActionResult, ComputerFailure> {
        let session_id = self.ensure_session(ctx)?;
        let target_label = element.map(str::to_string).or_else(|| coordinates.map(|(x, y)| format!("{x},{y}"))).unwrap_or_else(|| "-".into());
        let fail = |e: ComputerFailure| {
            let status = if e == ComputerFailure::Cancelled { "CANCELLED" } else { "DENIED" };
            self.record_action(&session_id, ctx, action.code(), &target_label, status, Some(e.code()), Some(observation_digest), 0);
            e
        };
        if ctx.cancel.is_cancelled() {
            return Err(fail(ComputerFailure::Cancelled));
        }
        let plan = self.plan_input(ctx.mission_id, action, element, coordinates, observation_digest).map_err(fail)?;

        // قبل الفعل: ملاحظة جديدة. إن تغيّر التخطيط منذ الملاحظة التي بُني عليها
        // الاقتراح فالاقتراح قديم، والإحداثيات قد تقع الآن على شيء آخر.
        let fresh = self.capture(&plan.grant, &plan.window).map_err(fail)?;
        if fresh.observation_digest != observation_digest {
            self.remember(&session_id, ctx.mission_id, &plan.grant, &fresh);
            return Err(fail(ComputerFailure::Stale(
                "the window changed between the observation and the action; the proposal is stale and nothing was sent".into(),
            )));
        }
        let (clicks, keys) = match action {
            InputAction::Click(_) => (1, 0),
            InputAction::Key(_) => (0, 1),
            InputAction::Type(text) => (0, text.chars().count() as u32),
            InputAction::PointerMove | InputAction::Scroll(_) => (0, 0),
        };
        self.charge(ctx.mission_id, clicks, keys, 1).map_err(fail)?;

        let began = Instant::now();
        let hwnd = plan.window.identity.hwnd;
        self.port.focus(hwnd).map_err(|e| fail(ComputerFailure::Desktop(e)))?;
        if self.port.foreground().map_err(|e| fail(ComputerFailure::Desktop(e)))? != Some(hwnd) {
            return Err(fail(ComputerFailure::Desktop(DesktopError::NotForeground)));
        }
        if let Some((x, y)) = plan.point {
            if self.port.root_window_at(x, y).map_err(|e| fail(ComputerFailure::Desktop(e)))? != Some(hwnd) {
                return Err(fail(ComputerFailure::Desktop(DesktopError::Obscured)));
            }
        }
        if ctx.cancel.is_cancelled() {
            return Err(fail(ComputerFailure::Cancelled));
        }
        let dispatched = match action {
            InputAction::PointerMove => {
                let (x, y) = plan.point.ok_or_else(|| fail(ComputerFailure::InvalidTarget("a pointer move needs a point".into())))?;
                self.port.pointer_move(x, y)
            }
            InputAction::Click(button) => {
                let (x, y) = plan.point.expect("checked in plan_input");
                self.port.click(x, y, *button)
            }
            InputAction::Key(chord) => self.port.key(*chord),
            InputAction::Scroll(notches) => {
                let (x, y) = plan.point.unwrap_or_else(|| plan.window.rect.center());
                self.port.scroll(x, y, *notches)
            }
            InputAction::Type(text) => {
                if let Some((x, y)) = plan.point {
                    // الحقل المسمّى يُنقر أولًا ليصير هو المستقبِل، لا ما صادف تركيزه.
                    if let Err(e) = self.port.click(x, y, MouseButton::Left) {
                        return Err(fail(ComputerFailure::Desktop(e)));
                    }
                }
                let chars: Vec<char> = text.chars().collect();
                let mut result = Ok(());
                for chunk in chars.chunks(TYPE_CHUNK) {
                    if ctx.cancel.is_cancelled() {
                        return Err(fail(ComputerFailure::Cancelled));
                    }
                    result = self.port.type_text(&chunk.iter().collect::<String>());
                    if result.is_err() {
                        break;
                    }
                }
                result
            }
        };
        dispatched.map_err(|e| fail(ComputerFailure::Desktop(e)))?;
        let dispatch_micros = began.elapsed().as_micros() as u64;
        if let Ok(mut t) = self.timings.lock() {
            t.dispatches += 1;
            t.dispatch_micros_total += dispatch_micros;
        }
        if !self.settle.is_zero() {
            std::thread::sleep(self.settle);
        }
        // بعد الفعل: ما لوحظ هو ما يُقارَن بادّعاء النتيجة. الفعل وحده لا يؤيّد شيئًا.
        let after = self.live_window(&plan.grant).and_then(|w| self.capture(&plan.grant, &w)).ok();
        if let Some(after) = &after {
            self.remember(&session_id, ctx.mission_id, &plan.grant, after);
        }
        self.record_action(&session_id, ctx, action.code(), &target_label, "EXECUTED", None, Some(observation_digest), dispatch_micros / 1000);
        let target_text = plan.element.as_ref().map(|e| format!("{} \"{}\"", e.element_ref, bounded(&e.text, 60))).unwrap_or(target_label.clone());
        let summary = format!(
            "ACTION_EXECUTED: {} on {} in window {} (pid {}); outcome UNVERIFIED by this action{}",
            action.code(),
            target_text,
            plan.grant.grant_id,
            plan.window.identity.pid,
            after.as_ref().map(|o| format!("; new observation_digest {}", &o.observation_digest[..16])).unwrap_or_default()
        );
        Ok(ComputerActionResult {
            measured_bytes: format!("{} {} {}", action.code(), target_label, observation_digest).into_bytes(),
            observed_text: after.as_ref().map(ScreenObservation::observed_text),
            detail: format!("dispatch_micros={dispatch_micros}"),
            observation: after,
            kind: "COMPUTER_ACTION_RESULT",
            summary,
        })
    }

    /// يجلب النافذة الممنوحة إلى المقدّمة. أثر إدخال: تغيير التركيز.
    pub fn focus(&self, ctx: &ComputerActionContext<'_>, window_ref: Option<&str>) -> Result<ComputerActionResult, ComputerFailure> {
        let session_id = self.ensure_session(ctx)?;
        let grant = self.resolve_grant(ctx.mission_id, window_ref)?;
        let window = self.live_window(&grant)?;
        self.charge(ctx.mission_id, 0, 0, 0)?;
        self.port.focus(window.identity.hwnd).map_err(ComputerFailure::Desktop)?;
        let foreground = self.port.foreground().map_err(ComputerFailure::Desktop)? == Some(window.identity.hwnd);
        self.with_session(ctx.mission_id, |s| {
            s.record.target = Some(grant.clone());
            if s.record.state == SessionState::Created.as_str() {
                s.record.state = SessionState::Active.as_str().into();
            }
            self.persist(s);
        });
        self.record_action(&session_id, ctx, "FOCUS", &grant.grant_id, if foreground { "EXECUTED" } else { "FAILED" }, (!foreground).then(|| "TARGET_NOT_FOREGROUND".into()), None, 0);
        if !foreground {
            return Err(ComputerFailure::Desktop(DesktopError::NotForeground));
        }
        Ok(ComputerActionResult {
            summary: format!("ACTION_EXECUTED: window {} is in the foreground", grant.grant_id),
            measured_bytes: format!("FOCUS {}", grant.grant_id).into_bytes(),
            observation: None,
            kind: "COMPUTER_ACTION_RESULT",
            observed_text: None,
            detail: format!("pid={}", window.identity.pid),
        })
    }

    /// يسجّل رفضًا قرّرته نقطة قرار السياسة قبل أي أثر، في تاريخ جلسة المهمّة إن وُجدت.
    pub fn record_assessed_refusal(&self, mission_id: &str, task_id: &str, action: &str, target: &str, failure: &ComputerFailure, digest: Option<&str>) {
        let Some(session_id) = self.with_session(mission_id, |s| s.record.session_id.clone()) else { return };
        let cancel = CancelToken::new();
        let ctx = ComputerActionContext { mission_id, task_id, agent_id: "", cancel: &cancel };
        self.record_action(&session_id, &ctx, action, target, "DENIED", Some(failure.code()), digest, 0);
    }

    // ——— دورة الحياة.

    /// منح مهمّة انتهت لا تبقى: المنحة مربوطة بالمهمّة، ونهايتها نهايتها.
    fn revoke_all(&self, mission_id: &str) {
        for grant in self.grants_for(mission_id) {
            self.revoke(&grant.grant_id);
        }
    }

    pub fn mission_finished(&self, mission_id: &str, terminal: bool, failed: bool) {
        if terminal {
            self.revoke_all(mission_id);
        }
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
        self.revoke_all(mission_id);
        self.with_session(mission_id, |s| self.set_state(s, SessionState::Cancelled, Some("MISSION_CANCELLED")));
    }

    pub fn close_by_user(&self, session_id: &str) -> Option<String> {
        let mut sessions = self.sessions.lock().ok()?;
        let session = sessions.values_mut().find(|s| s.record.session_id == session_id)?;
        self.set_state(session, SessionState::Cancelled, Some("USER_STOPPED"));
        Some(session.record.mission_id.clone())
    }

    pub fn recover_after_restart(&self) -> u32 {
        self.store.close_after_restart(&self.clock.now()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::super::fixture::FixtureDesktop;
    use super::*;
    use crate::storage::Database;

    fn runtime(port: Arc<FixtureDesktop>) -> ComputerRuntime {
        let db = Arc::new(Database::in_memory().unwrap());
        ComputerRuntime::new(port, ComputerStore::new(db.clone()), RuntimeClock::deterministic(), Arc::new(AuditLedger::new(db)), ActionBudget::default())
            .with_settle(Duration::ZERO)
    }

    fn ctx<'a>(mission: &'a str, cancel: &'a CancelToken) -> ComputerActionContext<'a> {
        ComputerActionContext { mission_id: mission, task_id: "t1", agent_id: "a1", cancel }
    }

    fn element_ref(obs: &ScreenObservation, text: &str) -> String {
        obs.elements.iter().find(|e| e.text == text).unwrap().element_ref.clone()
    }

    #[test]
    fn no_grant_means_no_observation_and_no_action() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        let cancel = CancelToken::new();
        assert!(matches!(rt.observe(&ctx("m1", &cancel), None), Err(ComputerFailure::NotGranted(_))));
        assert!(port.log().is_empty(), "input reached the desktop without a grant");
    }

    #[test]
    fn a_safe_click_executes_and_the_new_observation_shows_its_effect() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        rt.grant("m1", port.identity().hwnd).unwrap();
        let cancel = CancelToken::new();
        let c = ctx("m1", &cancel);
        let observed = rt.observe(&c, None).unwrap().observation.unwrap();
        let increment = element_ref(&observed, "Increment");
        let plan = rt.plan_input("m1", &InputAction::Click(MouseButton::Left), Some(&increment), None, &observed.observation_digest).unwrap();
        assert_eq!(plan.sensitivity, Sensitivity::Safe);
        let result = rt.perform(&c, &InputAction::Click(MouseButton::Left), Some(&increment), None, &observed.observation_digest).unwrap();
        assert!(result.summary.starts_with("ACTION_EXECUTED"));
        assert_eq!(port.counter(), 1);
        assert!(result.observed_text.unwrap().contains("count: 1"));
    }

    #[test]
    fn a_stale_observation_is_rejected_and_nothing_is_clicked() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        rt.grant("m1", port.identity().hwnd).unwrap();
        let cancel = CancelToken::new();
        let c = ctx("m1", &cancel);
        let observed = rt.observe(&c, None).unwrap().observation.unwrap();
        let increment = element_ref(&observed, "Increment");
        // الشاشة تتغيّر بين الملاحظة والفعل.
        port.change_status("status: changed by someone else");
        let out = rt.perform(&c, &InputAction::Click(MouseButton::Left), Some(&increment), None, &observed.observation_digest);
        assert!(matches!(out, Err(ComputerFailure::Stale(_))), "{out:?}");
        assert_eq!(port.counter(), 0);
        assert!(!port.log().iter().any(|l| l.starts_with("CLICK")), "a stale proposal reached the desktop");
        // والاقتراح القديم نفسه يبقى قديمًا بعد أن صارت هناك ملاحظة أحدث.
        let again = rt.plan_input("m1", &InputAction::Click(MouseButton::Left), Some(&increment), None, &observed.observation_digest);
        assert!(matches!(again, Err(ComputerFailure::Stale(_))));
    }

    #[test]
    fn a_reused_process_id_breaks_the_grant() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        rt.grant("m1", port.identity().hwnd).unwrap();
        let cancel = CancelToken::new();
        let c = ctx("m1", &cancel);
        rt.observe(&c, None).unwrap();
        port.simulate_pid_reuse();
        assert!(matches!(rt.observe(&c, None), Err(ComputerFailure::NotPermitted(_))), "a reused process id passed as the granted window");
    }

    #[test]
    fn a_window_granted_to_another_mission_cannot_be_targeted() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        let grant = rt.grant("m-other", port.identity().hwnd).unwrap();
        let cancel = CancelToken::new();
        let out = rt.observe(&ctx("m1", &cancel), Some(&grant.grant_id));
        assert!(matches!(out, Err(ComputerFailure::NotGranted(ref d)) if d.contains("another mission")), "{out:?}");
    }

    #[test]
    fn a_password_field_is_refused_and_a_destructive_button_needs_approval() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        rt.grant("m1", port.identity().hwnd).unwrap();
        let cancel = CancelToken::new();
        let observed = rt.observe(&ctx("m1", &cancel), None).unwrap().observation.unwrap();
        let password = observed.elements.iter().find(|e| e.password).unwrap().element_ref.clone();
        let typed = rt.plan_input("m1", &InputAction::Type("hello".into()), Some(&password), None, &observed.observation_digest);
        assert!(matches!(typed, Err(ComputerFailure::NotPermitted(_))));
        let delete = element_ref(&observed, "Delete all files");
        let plan = rt.plan_input("m1", &InputAction::Click(MouseButton::Left), Some(&delete), None, &observed.observation_digest).unwrap();
        assert_eq!(plan.sensitivity, Sensitivity::Approve("HIGH_RISK_WORDING"));
        let unknown = rt.plan_input("m1", &InputAction::Click(MouseButton::Left), None, Some((590, 390)), &observed.observation_digest).unwrap();
        assert_eq!(unknown.sensitivity, Sensitivity::Approve("UNKNOWN_TARGET"));
    }

    #[test]
    fn after_a_cancel_no_input_is_sent() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        rt.grant("m1", port.identity().hwnd).unwrap();
        let cancel = CancelToken::new();
        let c = ctx("m1", &cancel);
        let observed = rt.observe(&c, None).unwrap().observation.unwrap();
        let increment = element_ref(&observed, "Increment");
        cancel.cancel();
        rt.mission_cancelled("m1");
        let out = rt.perform(&c, &InputAction::Click(MouseButton::Left), Some(&increment), None, &observed.observation_digest);
        assert!(out.is_err());
        assert_eq!(port.counter(), 0);
        assert_eq!(rt.live_state("m1").as_deref(), Some("CANCELLED"));
        assert!(rt.grants_for("m1").is_empty(), "a cancelled mission kept its window grant");
    }

    #[test]
    fn a_finished_mission_releases_its_window_but_a_waiting_one_keeps_it() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        rt.grant("m1", port.identity().hwnd).unwrap();
        rt.mission_finished("m1", false, false);
        assert_eq!(rt.grants_for("m1").len(), 1, "a mission waiting for approval lost its grant");
        rt.mission_finished("m1", true, false);
        assert!(rt.grants_for("m1").is_empty(), "a finished mission kept its window grant");
    }

    #[test]
    fn an_obscured_point_receives_no_click() {
        let port = Arc::new(FixtureDesktop::new());
        let rt = runtime(port.clone());
        rt.grant("m1", port.identity().hwnd).unwrap();
        let cancel = CancelToken::new();
        let c = ctx("m1", &cancel);
        let observed = rt.observe(&c, None).unwrap().observation.unwrap();
        port.set_obscured(true);
        let increment = element_ref(&observed, "Increment");
        let out = rt.perform(&c, &InputAction::Click(MouseButton::Left), Some(&increment), None, &observed.observation_digest);
        assert_eq!(out.unwrap_err(), ComputerFailure::Desktop(DesktopError::Obscured));
        assert_eq!(port.counter(), 0);
    }

    #[test]
    fn polaris_own_window_is_never_grantable() {
        let port = Arc::new(FixtureDesktop::new());
        let mut rt = runtime(port.clone());
        rt.own_pid = port.identity().pid;
        assert!(matches!(rt.grant("m1", port.identity().hwnd), Err(ComputerFailure::NotPermitted(ref d)) if d.contains("POLARIS_OWN_WINDOW")));
    }
}
