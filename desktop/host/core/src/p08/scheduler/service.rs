// المجدول: يحفظ المهامّ المجدولة، ويُطلقها في وقتها أو عند «شغّل الآن»، ويسجّل كل تشغيل.
//
// المهمّة المجدولة مهمّة عادية تمامًا: تُنشأ وتُبدأ عبر زمن تشغيل Phase-03 نفسه، وتمرّ كل
// أداة فيها ببوابة الأدوات نفسها. الجدولة لا تمنح إذنًا: أداة تحتاج موافقة تُوقف المهمّة في
// WAITING_FOR_APPROVAL (سياسة الانتظار)، أو تُلغى المهمّة ويُسجَّل السبب (سياسة الفشل). لا
// يوجد مسار يُنفَّذ فيه أثرٌ «سرًّا» لأن أحدًا لا يراقب.

use std::sync::{Arc, Mutex};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::{Database, StorageError};

use super::model::{parse_rfc3339_utc, MissionTemplate, ScheduleSpec};

/// ما يُطلق المهمّة. يربطه التركيب بزمن تشغيل Phase-03؛ الاختبار يربطه بتجهيزة.
pub trait MissionLauncher: Send + Sync {
    /// ينشئ المهمّة من القالب ويعيد معرّفها. لا يبدأها.
    fn create(&self, template: &MissionTemplate, schedule_id: &str) -> Result<String, String>;
    /// يبدأها ويعيد حالتها بعد التشغيل (COMPLETED، WAITING_FOR_APPROVAL…).
    fn start(&self, mission_id: &str) -> Result<String, String>;
    fn cancel(&self, mission_id: &str) -> Result<(), String>;
    /// «التشغيل في نفس المهمّة»: مهمّة جديدة تتابع محادثة مهمّة التشغيل السابق ولا تبدؤها. الافتراضي مهمّة منفصلة.
    fn continue_from(&self, _previous: &str, template: &MissionTemplate, schedule_id: &str) -> Result<String, String> {
        self.create(template, schedule_id)
    }
    /// PHASE-14: حالة مهمّة أطلقها جدول، ليُعرف أن تشغيله السابق ما زال يعمل. لا شيء = لا يُعرف (التجهيزات القديمة).
    fn state(&self, _mission_id: &str) -> Option<String> {
        None
    }
}

/// PHASE-14 (CP-14-1): حالات تعني أن مهمّة التشغيل السابق لم تنتهِ: تشغيل جديد يُتخطّى ولا يتراكب معها.
pub const ACTIVE_STATES: [&str; 6] = ["PLANNING", "READY", "RUNNING", "VERIFYING", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER"];
/// CP-14-2: موعد تأخّر أكثر من هذا (التطبيق كان مغلقًا أو نائمًا) يُطلق مرّة واحدة ويُسجَّل متأخّرًا بما فاته.
pub const CATCH_UP_GRACE_SECS: i64 = 300;
/// CP-14-3: محاولة إعادة واحدة بعد هذا الزمن حين فشل الإطلاق أو فشلت المهمّة.
pub const RETRY_DELAY_SECS: i64 = 300;
/// ما يُعاد محاولته: فشل قبل المهمّة، أو فشل المهمّة، أو حجبها (مزوّد انقطع فحُجبت المهمّة «غير متاح» — أهمّ حالات الإعادة).
/// الإلغاء لحاجة موافقة قرار سياسة، لا فشل عابر.
const RETRYABLE: [&str; 5] = ["LAUNCHER_UNAVAILABLE", "CREATE_FAILED", "START_FAILED", "FAILED", "BLOCKED"];
/// CP-14-4: ما لا يُعلن عنه إشعار انتهاء المهمّة (لا مهمّة، أو مهمّة أُلغيت عمدًا) فيُعلنه المجدول.
const NEEDS_ATTENTION: [&str; 4] = ["LAUNCHER_UNAVAILABLE", "CREATE_FAILED", "START_FAILED", "FAILED_APPROVAL_REQUIRED"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalPolicy {
    /// المهمّة تتوقّف منتظرة قرار المستخدم.
    WaitForApproval,
    /// المهمّة تُلغى حين تحتاج موافقة، ويُسجَّل ذلك.
    FailOnApproval,
}

impl ApprovalPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WaitForApproval => "WAIT_FOR_APPROVAL",
            Self::FailOnApproval => "FAIL_ON_APPROVAL",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "WAIT_FOR_APPROVAL" => Some(Self::WaitForApproval),
            "FAIL_ON_APPROVAL" => Some(Self::FailOnApproval),
            _ => None,
        }
    }
}

/// أين يعمل كل تشغيل (مانوس: «التشغيل في»): مهمّة منفصلة لكل تشغيل، أو الدور التالي في مهمّة التشغيل السابق.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RunTarget {
    SeparateTask,
    SameTask,
}

impl RunTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SeparateTask => "SEPARATE_TASK",
            Self::SameTask => "SAME_TASK",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "SEPARATE_TASK" => Some(Self::SeparateTask),
            "SAME_TASK" => Some(Self::SameTask),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScheduleView {
    pub schedule_id: String,
    pub name: String,
    pub mission_template: Value,
    pub timezone: String,
    pub schedule: Value,
    pub enabled: bool,
    pub next_run: Option<String>,
    pub last_run: Option<String>,
    pub last_mission_id: Option<String>,
    pub last_status: Option<String>,
    pub budget: Value,
    pub approval_policy: String,
    pub created_at: String,
    pub updated_at: String,
    /// آخر لحظة يعمل فيها الجدول (مانوس: «تاريخ الانتهاء»)، أو لا شيء.
    pub end_at: Option<String>,
    pub run_target: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ScheduleRunView {
    pub run_id: String,
    pub schedule_id: String,
    pub mission_id: Option<String>,
    pub trigger_kind: String,
    pub status: String,
    pub detail: String,
    pub triggered_at: String,
}

/// مدخلات إنشاء أو تعديل.
pub struct ScheduleInput {
    pub name: String,
    pub template: MissionTemplate,
    pub timezone: String,
    pub spec: ScheduleSpec,
    pub enabled: bool,
    pub budget: Value,
    pub approval_policy: ApprovalPolicy,
    pub end_at: Option<String>,
    pub run_target: RunTarget,
}

pub struct SchedulerService {
    db: Arc<Database>,
    audit: Arc<AuditLedger>,
    clock: RuntimeClock,
    launcher: Mutex<Option<Arc<dyn MissionLauncher>>>,
    /// يمنع تداخل نبضتين: تشغيل مجدول واحد في كل لحظة.
    ticking: Mutex<()>,
    /// CP-14-1: إطلاق واحد في كل لحظة، من النبضة أو من «شغّل الآن»، فلا يرى اثنان «لا تشغيل سابق نشط» معًا.
    firing: Mutex<()>,
    /// CP-14-4: إشعار «يحتاج انتباهك» لما لا يعلنه إشعار المهمّة.
    attention: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

fn err(e: StorageError) -> String {
    e.to_string()
}

impl SchedulerService {
    pub fn new(db: Arc<Database>, audit: Arc<AuditLedger>, clock: RuntimeClock) -> Self {
        Self { db, audit, clock, launcher: Mutex::new(None), ticking: Mutex::new(()), firing: Mutex::new(()), attention: Mutex::new(None) }
    }

    /// يربط إشعار «يحتاج انتباهك» (التركيب يربطه بخدمة الإشعارات).
    pub fn bind_attention(&self, notify: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.attention.lock() {
            *slot = Some(notify);
        }
    }

    fn retry_pending(&self, schedule_id: &str) -> bool {
        self.db.with(|c| Ok(c.query_row("SELECT retry_pending FROM p08_schedules WHERE schedule_id = ?1", params![schedule_id], |r| r.get::<_, i64>(0)).optional()?)).ok().flatten() == Some(1)
    }

    pub fn bind_launcher(&self, launcher: Arc<dyn MissionLauncher>) {
        if let Ok(mut slot) = self.launcher.lock() {
            *slot = Some(launcher);
        }
    }

    fn launcher(&self) -> Option<Arc<dyn MissionLauncher>> {
        self.launcher.lock().ok().and_then(|s| s.clone())
    }

    fn now_secs(&self) -> i64 {
        (self.clock.now_millis() / 1000) as i64
    }

    fn validate(input: &ScheduleInput) -> Result<(), String> {
        if input.name.trim().is_empty() || input.name.chars().count() > 120 {
            return Err("the name must be 1..120 characters".into());
        }
        input.template.validate()?;
        input.spec.validate(&input.timezone)?;
        if !input.budget.is_object() {
            return Err("budget must be an object".into());
        }
        if input.end_at.as_deref().is_some_and(|e| parse_rfc3339_utc(e).is_none()) {
            return Err("end_at must be YYYY-MM-DDTHH:MM:SSZ".into());
        }
        Ok(())
    }

    /// مانوس: «حدد تاريخ انتهاء جديدًا قبل تفعيل هذه الأتمتة». جدول انقضى تاريخ انتهائه لا يُفعَّل.
    fn check_end(&self, enabled: bool, end_at: Option<&str>) -> Result<(), String> {
        match end_at.and_then(parse_rfc3339_utc) {
            Some(end) if enabled && end <= self.now_secs() => Err("the end date has passed; set a new end date before enabling this schedule".into()),
            _ => Ok(()),
        }
    }

    /// الموعد التالي، ولا شيء بعد تاريخ الانتهاء.
    fn capped(next: Option<i64>, end_at: Option<&str>) -> Option<i64> {
        match (next, end_at.and_then(parse_rfc3339_utc)) {
            (Some(n), Some(end)) if n > end => None,
            (n, _) => n,
        }
    }

    fn next_run_text(&self, input_spec: &ScheduleSpec, zone: &str, enabled: bool, end_at: Option<&str>) -> Option<String> {
        if !enabled {
            return None;
        }
        Self::capped(input_spec.next_after(zone, self.now_secs()), end_at).map(crate::time::format_rfc3339_utc)
    }

    pub fn create(&self, input: ScheduleInput) -> Result<ScheduleView, String> {
        Self::validate(&input)?;
        self.check_end(input.enabled, input.end_at.as_deref())?;
        let id = self.clock.id();
        let now = self.clock.now();
        let next = self.next_run_text(&input.spec, &input.timezone, input.enabled, input.end_at.as_deref());
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_schedules (schedule_id, name, template_json, timezone, schedule_json, enabled, next_run_at, budget_json, approval_policy, created_at, updated_at, end_at, run_target) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?12)",
                    params![
                        id,
                        input.name,
                        serde_json::to_string(&input.template).unwrap_or_default(),
                        input.timezone,
                        serde_json::to_string(&input.spec).unwrap_or_default(),
                        input.enabled as i64,
                        next,
                        input.budget.to_string(),
                        input.approval_policy.as_str(),
                        now,
                        input.end_at,
                        input.run_target.as_str()
                    ],
                )?;
                Ok(())
            })
            .map_err(err)?;
        self.audit_change(&id, "CREATED");
        self.get(&id)?.ok_or_else(|| "the schedule vanished".into())
    }

    pub fn update(&self, schedule_id: &str, input: ScheduleInput) -> Result<ScheduleView, String> {
        Self::validate(&input)?;
        self.check_end(input.enabled, input.end_at.as_deref())?;
        let next = self.next_run_text(&input.spec, &input.timezone, input.enabled, input.end_at.as_deref());
        let changed = self
            .db
            .with(|c| {
                Ok(c.execute(
                    "UPDATE p08_schedules SET name = ?2, template_json = ?3, timezone = ?4, schedule_json = ?5, enabled = ?6, next_run_at = ?7, budget_json = ?8, approval_policy = ?9, updated_at = ?10, end_at = ?11, run_target = ?12 WHERE schedule_id = ?1",
                    params![
                        schedule_id,
                        input.name,
                        serde_json::to_string(&input.template).unwrap_or_default(),
                        input.timezone,
                        serde_json::to_string(&input.spec).unwrap_or_default(),
                        input.enabled as i64,
                        next,
                        input.budget.to_string(),
                        input.approval_policy.as_str(),
                        self.clock.now(),
                        input.end_at,
                        input.run_target.as_str()
                    ],
                )?)
            })
            .map_err(err)?;
        if changed == 0 {
            return Err("no such schedule".into());
        }
        self.audit_change(schedule_id, "UPDATED");
        self.get(schedule_id)?.ok_or_else(|| "the schedule vanished".into())
    }

    pub fn set_enabled(&self, schedule_id: &str, enabled: bool) -> Result<ScheduleView, String> {
        let view = self.get(schedule_id)?.ok_or("no such schedule")?;
        let spec: ScheduleSpec = serde_json::from_value(view.schedule.clone()).map_err(|e| e.to_string())?;
        self.check_end(enabled, view.end_at.as_deref())?;
        let next = self.next_run_text(&spec, &view.timezone, enabled, view.end_at.as_deref());
        self.db
            .with(|c| Ok(c.execute("UPDATE p08_schedules SET enabled = ?2, next_run_at = ?3, updated_at = ?4 WHERE schedule_id = ?1", params![schedule_id, enabled as i64, next, self.clock.now()])?))
            .map_err(err)?;
        self.audit_change(schedule_id, if enabled { "ENABLED" } else { "DISABLED" });
        self.get(schedule_id)?.ok_or_else(|| "the schedule vanished".into())
    }

    pub fn delete(&self, schedule_id: &str) -> Result<bool, String> {
        let n = self.db.with(|c| Ok(c.execute("DELETE FROM p08_schedules WHERE schedule_id = ?1", params![schedule_id])?)).map_err(err)?;
        if n > 0 {
            self.audit_change(schedule_id, "DELETED");
        }
        Ok(n > 0)
    }

    fn audit_change(&self, id: &str, action: &str) {
        let _ = self.audit.append(&AuditRecord::new(AuditEventType::ScheduleChanged, "schedule", id, AuditOutcome::Success, serde_json::json!({ "action": action })));
    }

    fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<ScheduleView> {
        let parse = |s: String| serde_json::from_str::<Value>(&s).unwrap_or(Value::Null);
        Ok(ScheduleView {
            schedule_id: r.get(0)?,
            name: r.get(1)?,
            mission_template: parse(r.get(2)?),
            timezone: r.get(3)?,
            schedule: parse(r.get(4)?),
            enabled: r.get::<_, i64>(5)? == 1,
            next_run: r.get(6)?,
            last_run: r.get(7)?,
            last_mission_id: r.get(8)?,
            last_status: r.get(9)?,
            budget: parse(r.get(10)?),
            approval_policy: r.get(11)?,
            created_at: r.get(12)?,
            updated_at: r.get(13)?,
            end_at: r.get(14)?,
            run_target: r.get(15)?,
        })
    }

    const COLUMNS: &'static str = "schedule_id, name, template_json, timezone, schedule_json, enabled, next_run_at, last_run_at, last_mission_id, last_status, budget_json, approval_policy, created_at, updated_at, end_at, run_target";

    pub fn get(&self, schedule_id: &str) -> Result<Option<ScheduleView>, String> {
        self.db.with(|c| Ok(c.query_row(&format!("SELECT {} FROM p08_schedules WHERE schedule_id = ?1", Self::COLUMNS), params![schedule_id], Self::row).optional()?)).map_err(err)
    }

    pub fn list(&self) -> Result<Vec<ScheduleView>, String> {
        self.db
            .with(|c| {
                let mut stmt = c.prepare(&format!("SELECT {} FROM p08_schedules ORDER BY created_at", Self::COLUMNS))?;
                let rows = stmt.query_map([], Self::row)?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .map_err(err)
    }

    pub fn runs(&self, schedule_id: &str, limit: usize) -> Result<Vec<ScheduleRunView>, String> {
        self.db
            .with(|c| {
                let mut stmt = c.prepare("SELECT run_id, schedule_id, mission_id, trigger_kind, status, detail, triggered_at FROM p08_schedule_runs WHERE schedule_id = ?1 ORDER BY triggered_at DESC LIMIT ?2")?;
                let rows = stmt
                    .query_map(params![schedule_id, limit as i64], |r| {
                        Ok(ScheduleRunView { run_id: r.get(0)?, schedule_id: r.get(1)?, mission_id: r.get(2)?, trigger_kind: r.get(3)?, status: r.get(4)?, detail: r.get(5)?, triggered_at: r.get(6)? })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .map_err(err)
    }

    /// يُطلق تشغيلًا واحدًا بشكل متزامن ويعيد سجلّه. يُستعمل من النبضة ومن «شغّل الآن».
    pub fn trigger(&self, schedule_id: &str, kind: &'static str) -> Result<ScheduleRunView, String> {
        self.trigger_with(schedule_id, kind, None)
    }

    /// `note`: ما يُقدَّم به السجلّ (موعد متأخّر وما فاته).
    fn trigger_with(&self, schedule_id: &str, kind: &'static str, note: Option<String>) -> Result<ScheduleRunView, String> {
        let _firing = self.firing.lock().map_err(|_| "the scheduler lock is poisoned".to_string())?;
        let view = self.get(schedule_id)?.ok_or("no such schedule")?;
        let template: MissionTemplate = serde_json::from_value(view.mission_template.clone()).map_err(|e| e.to_string())?;
        let policy = ApprovalPolicy::parse(&view.approval_policy).unwrap_or(ApprovalPolicy::WaitForApproval);
        let run_id = self.clock.id();
        let triggered_at = self.clock.now();
        // CP-14-1: تشغيل سابق لم ينتهِ (يعمل أو ينتظر موافقة) ⇒ لا تشغيل ثانٍ فوقه. يُسجَّل التخطّي ولا تُعاد محاولته.
        let active = view.last_mission_id.as_deref().and_then(|m| self.launcher().and_then(|l| l.state(m)).map(|s| (m.to_string(), s))).filter(|(_, s)| ACTIVE_STATES.contains(&s.as_str()));
        // «التشغيل في نفس المهمّة»: الدور التالي في مهمّة التشغيل السابق؛ أول تشغيل (أو سابق لم يعد متاحًا) يبدأ مهمّة تتابعها التشغيلات بعده.
        let same_task = view.run_target == RunTarget::SameTask.as_str();
        let mut started_note = String::new();
        let (mission_id, status, detail) = match (self.launcher(), active) {
            (_, Some((previous, state))) => (None, "SKIPPED_PREVIOUS_ACTIVE".to_string(), format!("the previous run's mission {previous} is still {state}; this run did not start, so two runs never overlap")),
            (None, None) => (None, "LAUNCHER_UNAVAILABLE".to_string(), "no mission runtime is bound on this host".to_string()),
            (Some(launcher), None) => match match view.last_mission_id.as_deref().filter(|_| same_task) {
                Some(previous) => launcher.continue_from(previous, &template, schedule_id).or_else(|e| {
                    started_note = format!("The previous run's task could not be continued ({e}); this run started a new task, and later runs continue there.");
                    launcher.create(&template, schedule_id)
                }),
                None => launcher.create(&template, schedule_id),
            } {
                Err(e) => (None, "CREATE_FAILED".into(), e),
                Ok(mission_id) => match launcher.start(&mission_id) {
                    Err(e) => (Some(mission_id), "START_FAILED".into(), e),
                    Ok(state) if state == "WAITING_FOR_APPROVAL" && policy == ApprovalPolicy::FailOnApproval => {
                        let _ = launcher.cancel(&mission_id);
                        (Some(mission_id), "FAILED_APPROVAL_REQUIRED".into(), "the mission needed an approval and the schedule does not wait for one; it was cancelled".into())
                    }
                    Ok(state) => (Some(mission_id), state, String::new()),
                },
            },
        };
        let spec: Option<ScheduleSpec> = serde_json::from_value(view.schedule.clone()).ok();
        let regular = Self::capped(spec.and_then(|s| if view.enabled { s.next_after(&view.timezone, self.now_secs()) } else { None }), view.end_at.as_deref());
        // CP-14-3: فشل عابر يُعاد مرّة واحدة بعد خمس دقائق (أو في الموعد التالي إن كان أقرب). المحاولة نفسها لا تُعاد.
        let detail = format!("{started_note} {detail}").trim().to_string();
        let retry_at = Self::capped(Some(self.now_secs() + RETRY_DELAY_SECS), view.end_at.as_deref());
        let retry = view.enabled && kind != "RETRY" && RETRYABLE.contains(&status.as_str()) && retry_at.is_some();
        let (next, detail) = if retry {
            let at = self.now_secs() + RETRY_DELAY_SECS;
            let next = regular.map_or(at, |r| r.min(at));
            (Some(next), format!("{detail} One retry is scheduled for {}.", crate::time::format_rfc3339_utc(next)).trim().to_string())
        } else {
            (regular, detail)
        };
        let next = next.map(crate::time::format_rfc3339_utc);
        let detail = match note {
            Some(note) => format!("{note} {detail}").trim().to_string(),
            None => detail,
        };
        let detail: String = detail.chars().take(1_000).collect();
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_schedule_runs (run_id, schedule_id, mission_id, trigger_kind, status, detail, triggered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![run_id, schedule_id, mission_id, kind, status.chars().take(40).collect::<String>(), detail, triggered_at],
                )?;
                // تخطٍّ لا يمسّ مرجع التشغيل السابق: ما زال هو النشط.
                if status == "SKIPPED_PREVIOUS_ACTIVE" {
                    c.execute("UPDATE p08_schedules SET last_status = ?2, next_run_at = ?3 WHERE schedule_id = ?1", params![schedule_id, status, next])?;
                } else {
                    c.execute(
                        "UPDATE p08_schedules SET last_run_at = ?2, last_mission_id = ?3, last_status = ?4, next_run_at = ?5, retry_pending = ?6 WHERE schedule_id = ?1",
                        params![schedule_id, triggered_at, mission_id, status.chars().take(40).collect::<String>(), next, retry as i64],
                    )?;
                }
                Ok(())
            })
            .map_err(err)?;
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ScheduleTriggered,
            "schedule",
            schedule_id,
            if status == "COMPLETED" { AuditOutcome::Success } else { AuditOutcome::Started },
            serde_json::json!({ "run_id": run_id, "mission_id": mission_id, "trigger": kind, "status": status }),
        ));
        if NEEDS_ATTENTION.contains(&status.as_str()) {
            if let Some(notify) = self.attention.lock().ok().and_then(|n| n.clone()) {
                notify();
            }
        }
        Ok(ScheduleRunView { run_id, schedule_id: schedule_id.into(), mission_id, trigger_kind: kind.into(), status, detail, triggered_at })
    }

    /// نبضة المجدول: يُطلق كل جدول مفعَّل حان وقته. يعيد عدد ما أُطلق.
    pub fn tick(&self) -> usize {
        let Ok(_guard) = self.ticking.try_lock() else { return 0 };
        let now = self.now_secs();
        let due: Vec<(ScheduleView, i64)> = self
            .list()
            .unwrap_or_default()
            .into_iter()
            .filter(|s| s.enabled)
            .filter_map(|s| s.next_run.as_deref().and_then(parse_rfc3339_utc).filter(|t| *t <= now).map(|t| (s, t)))
            .collect();
        let mut fired = 0;
        for (view, due_at) in due {
            let (kind, note) = if self.retry_pending(&view.schedule_id) {
                ("RETRY", None)
            } else if now - due_at > CATCH_UP_GRACE_SECS {
                // CP-14-2: الموعد حلّ والتطبيق مغلق: يُطلق مرّة واحدة الآن، ويقول السجلّ ذلك وكم موعدًا بعده فات ولن يُعاد.
                let missed = serde_json::from_value::<ScheduleSpec>(view.schedule.clone())
                    .map(|spec| {
                        let mut n = 0u32;
                        let mut t = due_at;
                        while let Some(next) = spec.next_after(&view.timezone, t) {
                            if next > now || n >= 1_000 {
                                break;
                            }
                            n += 1;
                            t = next;
                        }
                        n
                    })
                    .unwrap_or(0);
                ("CATCH_UP", Some(format!("Due at {} while POLARIS was not running; it ran once on opening, and {missed} later occurrence(s) up to now were not run.", crate::time::format_rfc3339_utc(due_at))))
            } else {
                ("SCHEDULED", None)
            };
            if self.trigger_with(&view.schedule_id, kind, note).is_ok() {
                fired += 1;
            }
        }
        fired
    }

    /// للاختبار الأصلي وحده (بناء القياس): يجعل الجدول مستحقًّا الآن، ليُثبت أن النبضة تُطلقه.
    pub fn make_due_for_test(&self, schedule_id: &str) -> Result<(), String> {
        self.make_due_since_for_test(schedule_id, 1)
    }

    /// للاختبار وحده: موعد حلّ منذ `seconds_ago` ثانية (موعد فات والتطبيق مغلق حين تكون أكبر من مهلة اللحاق).
    pub fn make_due_since_for_test(&self, schedule_id: &str, seconds_ago: i64) -> Result<(), String> {
        let past = crate::time::format_rfc3339_utc(self.now_secs() - seconds_ago);
        self.db.with(|c| Ok(c.execute("UPDATE p08_schedules SET next_run_at = ?2 WHERE schedule_id = ?1", params![schedule_id, past])?)).map_err(err).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeLauncher {
        outcome: &'static str,
        cancelled: Mutex<Vec<String>>,
    }

    impl MissionLauncher for FakeLauncher {
        fn create(&self, _t: &MissionTemplate, _s: &str) -> Result<String, String> {
            Ok(crate::ids::new_uuid_v4())
        }
        fn start(&self, _m: &str) -> Result<String, String> {
            Ok(self.outcome.to_string())
        }
        fn cancel(&self, m: &str) -> Result<(), String> {
            self.cancelled.lock().unwrap().push(m.to_string());
            Ok(())
        }
    }

    fn service(outcome: &'static str) -> (SchedulerService, Arc<FakeLauncher>) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let s = SchedulerService::new(db, audit, RuntimeClock::system());
        let l = Arc::new(FakeLauncher { outcome, cancelled: Mutex::new(Vec::new()) });
        s.bind_launcher(l.clone());
        (s, l)
    }

    fn input(policy: ApprovalPolicy) -> ScheduleInput {
        ScheduleInput {
            name: "Morning report".into(),
            template: MissionTemplate { title: "Report".into(), objective: "Summarise the inputs".into(), project_id: None, model_id: None },
            timezone: "UTC+03:00".into(),
            spec: ScheduleSpec::Daily { time: "08:00".into() },
            enabled: true,
            budget: serde_json::json!({}),
            approval_policy: policy,
            end_at: None,
            run_target: RunTarget::SeparateTask,
        }
    }

    #[test]
    fn a_due_schedule_fires_on_the_tick_and_records_its_run() {
        let (s, _) = service("COMPLETED");
        let v = s.create(input(ApprovalPolicy::WaitForApproval)).unwrap();
        assert!(v.next_run.is_some());
        assert_eq!(s.tick(), 0, "a schedule fired before it was due");
        s.make_due_for_test(&v.schedule_id).unwrap();
        assert_eq!(s.tick(), 1);
        let runs = s.runs(&v.schedule_id, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "COMPLETED");
        let after = s.get(&v.schedule_id).unwrap().unwrap();
        assert!(after.next_run.as_deref().and_then(parse_rfc3339_utc).unwrap() > (RuntimeClock::system().now_millis() / 1000) as i64);
    }

    #[test]
    fn an_approval_is_never_bypassed_it_waits_or_the_mission_is_cancelled() {
        let (s, _) = service("WAITING_FOR_APPROVAL");
        let wait = s.create(input(ApprovalPolicy::WaitForApproval)).unwrap();
        assert_eq!(s.trigger(&wait.schedule_id, "RUN_NOW").unwrap().status, "WAITING_FOR_APPROVAL");
        let (s, launcher) = service("WAITING_FOR_APPROVAL");
        let fail = s.create(input(ApprovalPolicy::FailOnApproval)).unwrap();
        let run = s.trigger(&fail.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(run.status, "FAILED_APPROVAL_REQUIRED");
        assert_eq!(launcher.cancelled.lock().unwrap().len(), 1);
    }

    #[test]
    fn a_disabled_schedule_does_not_fire() {
        let (s, _) = service("COMPLETED");
        let v = s.create(input(ApprovalPolicy::WaitForApproval)).unwrap();
        s.make_due_for_test(&v.schedule_id).unwrap();
        s.set_enabled(&v.schedule_id, false).unwrap();
        assert_eq!(s.tick(), 0);
        assert!(s.get(&v.schedule_id).unwrap().unwrap().next_run.is_none());
    }

    /// PHASE-14 TEST FIXTURE: مُطلِق مُبرمَج بنتائج متتالية، وحالة لمهمّته الأخيرة، وعدّاد ما أنشأ.
    struct Scripted {
        outcomes: Mutex<std::collections::VecDeque<&'static str>>,
        state: Mutex<Option<String>>,
        created: std::sync::atomic::AtomicUsize,
    }

    impl MissionLauncher for Scripted {
        fn create(&self, _t: &MissionTemplate, _s: &str) -> Result<String, String> {
            self.created.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(crate::ids::new_uuid_v4())
        }
        fn start(&self, _m: &str) -> Result<String, String> {
            let outcome = self.outcomes.lock().unwrap().pop_front().unwrap_or("COMPLETED");
            *self.state.lock().unwrap() = Some(outcome.to_string());
            if outcome == "START_FAILED" {
                return Err("the provider could not be reached".into());
            }
            Ok(outcome.to_string())
        }
        fn cancel(&self, _m: &str) -> Result<(), String> {
            *self.state.lock().unwrap() = Some("CANCELLED".into());
            Ok(())
        }
        fn state(&self, _m: &str) -> Option<String> {
            self.state.lock().unwrap().clone()
        }
    }

    fn scripted(outcomes: &[&'static str]) -> (SchedulerService, Arc<Scripted>, Arc<std::sync::atomic::AtomicUsize>) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let s = SchedulerService::new(db, audit, RuntimeClock::system());
        let l = Arc::new(Scripted { outcomes: Mutex::new(outcomes.iter().copied().collect()), state: Mutex::new(None), created: std::sync::atomic::AtomicUsize::new(0) });
        s.bind_launcher(l.clone());
        let notified = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let n = notified.clone();
        s.bind_attention(Arc::new(move || {
            n.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }));
        (s, l, notified)
    }

    fn every_15_minutes() -> ScheduleInput {
        ScheduleInput { spec: ScheduleSpec::Interval { minutes: 15 }, ..input(ApprovalPolicy::WaitForApproval) }
    }

    #[test]
    fn cp14_a_run_does_not_start_while_the_previous_one_is_still_waiting() {
        let (s, l, _) = scripted(&["WAITING_FOR_APPROVAL", "COMPLETED"]);
        let v = s.create(input(ApprovalPolicy::WaitForApproval)).unwrap();
        let first = s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(first.status, "WAITING_FOR_APPROVAL");
        s.make_due_for_test(&v.schedule_id).unwrap();
        assert_eq!(s.tick(), 1);
        let runs = s.runs(&v.schedule_id, 10).unwrap();
        assert_eq!(runs[0].status, "SKIPPED_PREVIOUS_ACTIVE", "{runs:?}");
        assert_eq!(l.created.load(std::sync::atomic::Ordering::SeqCst), 1, "a second mission was created on top of the waiting one");
        assert_eq!(s.get(&v.schedule_id).unwrap().unwrap().last_mission_id, first.mission_id, "the skip replaced the reference to the run still waiting");
    }

    #[test]
    fn cp14_a_run_missed_while_the_app_was_closed_runs_once_and_says_so() {
        let (s, l, _) = scripted(&["COMPLETED"]);
        let v = s.create(every_15_minutes()).unwrap();
        s.make_due_since_for_test(&v.schedule_id, 3_600).unwrap();
        assert_eq!(s.tick(), 1);
        let runs = s.runs(&v.schedule_id, 10).unwrap();
        assert_eq!(runs.len(), 1, "missed occurrences were replayed: {runs:?}");
        assert_eq!(runs[0].trigger_kind, "CATCH_UP");
        assert!(runs[0].detail.contains("while POLARIS was not running") && runs[0].detail.contains("4 later occurrence(s)"), "{}", runs[0].detail);
        assert_eq!(l.created.load(std::sync::atomic::Ordering::SeqCst), 1);
        // الموعد التالي من الآن، لا من الموعد الفائت.
        let next = s.get(&v.schedule_id).unwrap().unwrap().next_run.as_deref().and_then(parse_rfc3339_utc).unwrap();
        assert!(next > (RuntimeClock::system().now_millis() / 1000) as i64);
    }

    #[test]
    fn cp14_a_failed_run_is_retried_once_after_five_minutes_and_the_retry_is_not_retried() {
        let (s, l, _) = scripted(&["FAILED", "FAILED"]);
        let v = s.create(input(ApprovalPolicy::WaitForApproval)).unwrap();
        let first = s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(first.status, "FAILED");
        assert!(first.detail.contains("One retry is scheduled"), "{}", first.detail);
        let now = (RuntimeClock::system().now_millis() / 1000) as i64;
        let next = s.get(&v.schedule_id).unwrap().unwrap().next_run.as_deref().and_then(parse_rfc3339_utc).unwrap();
        assert!((now + RETRY_DELAY_SECS - 5..=now + RETRY_DELAY_SECS + 5).contains(&next), "the retry is not five minutes away: {next} vs {now}");
        s.make_due_for_test(&v.schedule_id).unwrap();
        assert_eq!(s.tick(), 1);
        let runs = s.runs(&v.schedule_id, 10).unwrap();
        assert_eq!(runs[0].trigger_kind, "RETRY", "{runs:?}");
        assert!(!runs[0].detail.contains("One retry is scheduled"), "the retry scheduled another retry");
        assert!(!s.retry_pending(&v.schedule_id));
        assert_eq!(l.created.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    /// انقطاع المزوّد يحجب المهمّة (`p08_a_provider_that_stays_down_blocks_the_mission_as_unavailable_within_its_retry_bound`): يُعاد مرّة.
    #[test]
    fn cp14_a_mission_blocked_by_a_provider_that_went_down_is_retried_once() {
        let (s, l, _) = scripted(&["BLOCKED", "COMPLETED"]);
        let v = s.create(input(ApprovalPolicy::WaitForApproval)).unwrap();
        assert!(s.trigger(&v.schedule_id, "RUN_NOW").unwrap().detail.contains("One retry is scheduled"));
        s.make_due_for_test(&v.schedule_id).unwrap();
        assert_eq!(s.tick(), 1);
        let runs = s.runs(&v.schedule_id, 10).unwrap();
        assert_eq!((runs[0].trigger_kind.as_str(), runs[0].status.as_str()), ("RETRY", "COMPLETED"), "{runs:?}");
        assert_eq!(l.created.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn cp14_a_run_that_never_got_a_mission_or_was_cancelled_for_approval_asks_for_attention() {
        let (s, _, notified) = scripted(&["START_FAILED", "WAITING_FOR_APPROVAL", "COMPLETED"]);
        let v = s.create(input(ApprovalPolicy::FailOnApproval)).unwrap();
        assert_eq!(s.trigger(&v.schedule_id, "RUN_NOW").unwrap().status, "START_FAILED");
        assert_eq!(notified.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(s.trigger(&v.schedule_id, "RUN_NOW").unwrap().status, "FAILED_APPROVAL_REQUIRED");
        assert_eq!(notified.load(std::sync::atomic::Ordering::SeqCst), 2);
        // مهمّة اكتملت: إشعارها من مراقب المهمّة، لا من المجدول مرّة ثانية.
        assert_eq!(s.trigger(&v.schedule_id, "RUN_NOW").unwrap().status, "COMPLETED");
        assert_eq!(notified.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    /// TEST FIXTURE (مكافأة الأتمتة): مُطلِق يسجّل ما أنشأ وما تابع، ويُفشل المتابعة حين يُطلب.
    struct Threaded {
        created: Mutex<Vec<String>>,
        continued: Mutex<Vec<(String, String)>>,
        refuse_continue: bool,
    }

    impl MissionLauncher for Threaded {
        fn create(&self, _t: &MissionTemplate, _s: &str) -> Result<String, String> {
            let id = crate::ids::new_uuid_v4();
            self.created.lock().unwrap().push(id.clone());
            Ok(id)
        }
        fn continue_from(&self, previous: &str, _t: &MissionTemplate, _s: &str) -> Result<String, String> {
            if self.refuse_continue {
                return Err("the previous task was deleted".into());
            }
            let id = crate::ids::new_uuid_v4();
            self.continued.lock().unwrap().push((previous.to_string(), id.clone()));
            Ok(id)
        }
        fn start(&self, _m: &str) -> Result<String, String> {
            Ok("COMPLETED".into())
        }
        fn cancel(&self, _m: &str) -> Result<(), String> {
            Ok(())
        }
        fn state(&self, _m: &str) -> Option<String> {
            Some("COMPLETED".into())
        }
    }

    fn threaded(refuse_continue: bool) -> (SchedulerService, Arc<Threaded>) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let s = SchedulerService::new(db, audit, RuntimeClock::system());
        let l = Arc::new(Threaded { created: Mutex::new(Vec::new()), continued: Mutex::new(Vec::new()), refuse_continue });
        s.bind_launcher(l.clone());
        (s, l)
    }

    #[test]
    fn auto_same_task_runs_continue_in_the_previous_runs_task_and_the_first_run_starts_one() {
        let (s, l) = threaded(false);
        let v = s.create(ScheduleInput { run_target: RunTarget::SameTask, ..input(ApprovalPolicy::WaitForApproval) }).unwrap();
        assert_eq!(v.run_target, "SAME_TASK");
        let first = s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(l.created.lock().unwrap().len(), 1, "the first run did not start a task");
        let second = s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        let third = s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(l.created.lock().unwrap().len(), 1, "a same-task run started a separate task");
        let continued = l.continued.lock().unwrap().clone();
        assert_eq!(continued, vec![(first.mission_id.clone().unwrap(), second.mission_id.clone().unwrap()), (second.mission_id.clone().unwrap(), third.mission_id.clone().unwrap())]);
        // مهمّة منفصلة (الافتراضي): كل تشغيل ينشئ مهمّة.
        let (s, l) = threaded(false);
        let v = s.create(input(ApprovalPolicy::WaitForApproval)).unwrap();
        s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(l.created.lock().unwrap().len(), 2);
        assert!(l.continued.lock().unwrap().is_empty());
    }

    #[test]
    fn auto_a_run_whose_previous_task_is_gone_starts_a_new_task_and_says_so() {
        let (s, l) = threaded(true);
        let v = s.create(ScheduleInput { run_target: RunTarget::SameTask, ..input(ApprovalPolicy::WaitForApproval) }).unwrap();
        s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        let run = s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(run.status, "COMPLETED");
        assert_eq!(l.created.lock().unwrap().len(), 2);
        assert!(run.detail.contains("could not be continued") && run.detail.contains("the previous task was deleted"), "{}", run.detail);
    }

    #[test]
    fn auto_a_schedule_past_its_end_date_has_no_next_run_and_cannot_be_enabled_until_the_date_moves() {
        let (s, _) = service("FAILED");
        let now = (RuntimeClock::system().now_millis() / 1000) as i64;
        let past = crate::time::format_rfc3339_utc(now - 60);
        let refused = s.create(ScheduleInput { end_at: Some(past.clone()), ..input(ApprovalPolicy::WaitForApproval) });
        assert!(refused.unwrap_err().contains("set a new end date"));
        // تاريخ انتهاء بعد ساعة، والجدول يوميّ: لا موعد تالٍ قبله، فلا تشغيل مجدول ولا إعادة محاولة بعده.
        let soon = crate::time::format_rfc3339_utc(now + 3_600);
        let v = s.create(ScheduleInput { end_at: Some(soon.clone()), spec: ScheduleSpec::Daily { time: crate::time::format_rfc3339_utc(now + 7_200)[11..16].to_string() }, timezone: "UTC".into(), ..input(ApprovalPolicy::WaitForApproval) }).unwrap();
        assert_eq!(v.end_at.as_deref(), Some(soon.as_str()));
        assert!(v.next_run.is_none(), "a run after the end date was scheduled: {:?}", v.next_run);
        let v = s.create(ScheduleInput { end_at: Some(crate::time::format_rfc3339_utc(now + 120)), ..input(ApprovalPolicy::WaitForApproval) }).unwrap();
        let run = s.trigger(&v.schedule_id, "RUN_NOW").unwrap();
        assert_eq!(run.status, "FAILED");
        assert!(!run.detail.contains("One retry is scheduled"), "a retry after the end date was scheduled");
        s.set_enabled(&v.schedule_id, false).unwrap();
        let disabled = s.create(ScheduleInput { end_at: Some(past), enabled: false, ..input(ApprovalPolicy::WaitForApproval) }).unwrap();
        assert!(s.set_enabled(&disabled.schedule_id, true).unwrap_err().contains("set a new end date"));
    }
}
