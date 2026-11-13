// ربط Phase-08 بمهامّ Phase-03: اختيار النموذج لكل مهمّة، ومُطلِق المجدول، ومراقب يحرّر
// صندوق التنفيذ حين تنتهي المهمّة.
//
// لا شيء هنا ينشئ مسارًا جديدًا للمهمّة: الإنشاء والبدء والإلغاء هي عمليات Phase-03 نفسها،
// والاختيار اليدوي للنموذج يمرّ بتوجيه Phase-02 كما يمرّ أي استدعاء.

use std::sync::{Arc, Weak};

use rusqlite::{params, OptionalExtension};

use crate::p03::clock::RuntimeClock;
use crate::p03::mission::{ExecutionMode, MissionBudget, MissionPriority};
use crate::p03::port::{MissionModelPreference, MissionObserver, MissionOutcomeNote};
use crate::p03::service::{CreateMissionInput, Phase03};
use crate::storage::Database;

use super::execution::ExecutionService;
use super::scheduler::model::MissionTemplate;
use super::scheduler::service::MissionLauncher;

/// اختيار النموذج لكل مهمّة، محفوظ في `p08_mission_preferences`.
pub struct MissionPreferences {
    db: Arc<Database>,
    clock: RuntimeClock,
}

fn valid_model_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 200 && !id.chars().any(|c| c.is_control() || c.is_whitespace())
}

impl MissionPreferences {
    pub fn new(db: Arc<Database>, clock: RuntimeClock) -> Self {
        Self { db, clock }
    }

    /// يحفظ الاختيار. `None` يعني النموذج الافتراضي. مصدر الاختيار (مستخدم/جدول) يُسجَّل.
    pub fn set(&self, mission_id: &str, model_id: Option<&str>, schedule_id: Option<&str>) -> Result<(), String> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err("mission_id is not valid".into());
        }
        if model_id.is_some_and(|m| !valid_model_id(m)) {
            return Err("model_id is not valid".into());
        }
        let origin = if schedule_id.is_some() { "SCHEDULE" } else { "USER" };
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_mission_preferences (mission_id, model_id, origin, schedule_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(mission_id) DO UPDATE SET model_id = excluded.model_id",
                    params![mission_id, model_id, origin, schedule_id, self.clock.now()],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())
    }

    /// يسمّ المهمّة بالجدول الذي أطلقها، ولو كان لها صفّ تفضيلات من قبل (دور محادثة ورث نموذجه): «من الأتمتة» يعرفها.
    pub fn link_schedule(&self, mission_id: &str, schedule_id: &str) -> Result<(), String> {
        if !crate::ids::is_uuid_v4(mission_id) || !crate::ids::is_uuid_v4(schedule_id) {
            return Err("mission_id or schedule_id is not valid".into());
        }
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_mission_preferences (mission_id, model_id, origin, schedule_id, created_at) VALUES (?1, NULL, 'SCHEDULE', ?2, ?3)
                     ON CONFLICT(mission_id) DO UPDATE SET origin = 'SCHEDULE', schedule_id = excluded.schedule_id",
                    params![mission_id, schedule_id, self.clock.now()],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())
    }

    /// يثبّت متخصّصًا للمهمّة أو يزيله (`None`). المعرّف يُتحقَّق منه في الكتالوج قبل الحفظ.
    pub fn set_specialist(&self, mission_id: &str, specialist_id: Option<&str>) -> Result<(), String> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err("mission_id is not valid".into());
        }
        if let Some(id) = specialist_id {
            if crate::p03::specialist::SpecialistCatalog::builtin().get(id).is_none() {
                return Err("specialist_id is not a known specialist".into());
            }
        }
        self.db
            .with(|c| {
                c.execute(
                    "INSERT INTO p08_mission_preferences (mission_id, model_id, origin, schedule_id, created_at, specialist_id) VALUES (?1, NULL, 'USER', NULL, ?2, ?3)
                     ON CONFLICT(mission_id) DO UPDATE SET specialist_id = excluded.specialist_id",
                    params![mission_id, self.clock.now(), specialist_id],
                )?;
                Ok(())
            })
            .map_err(|e| e.to_string())
    }

    pub fn specialist(&self, mission_id: &str) -> Option<String> {
        self.db
            .with(|c| Ok(c.query_row("SELECT specialist_id FROM p08_mission_preferences WHERE mission_id = ?1", params![mission_id], |r| r.get::<_, Option<String>>(0)).optional()?))
            .ok()
            .flatten()
            .flatten()
    }

    pub fn get(&self, mission_id: &str) -> Option<(Option<String>, String, Option<String>)> {
        self.db
            .with(|c| Ok(c.query_row("SELECT model_id, origin, schedule_id FROM p08_mission_preferences WHERE mission_id = ?1", params![mission_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?))
            .ok()
            .flatten()
    }
}

impl MissionModelPreference for MissionPreferences {
    fn model_for(&self, mission_id: &str) -> Option<String> {
        self.get(mission_id).and_then(|(m, _, _)| m)
    }

    fn specialist_for(&self, mission_id: &str) -> Option<String> {
        self.specialist(mission_id)
    }

    fn user_profile(&self) -> Option<String> {
        super::integrations::settings::profile_text(&super::integrations::settings::Phase08Settings::new(self.db.clone()))
    }

    fn executor_is_remote(&self, mission_id: &str) -> Option<bool> {
        let chosen = self.get(mission_id).and_then(|(m, _, _)| m);
        let model = chosen.or_else(|| {
            self.db
                .with(|c| Ok(c.query_row("SELECT value FROM preferences WHERE key = 'default_model_id'", [], |r| r.get::<_, String>(0)).optional()?))
                .ok()
                .flatten()
        })?;
        let provider = model.split(':').next()?.to_string();
        if let Some(descriptor) = polaris_host_providers::catalog::descriptor(&provider) {
            return Some(descriptor.locality == polaris_host_providers::domain::Locality::Remote);
        }
        // مزوّد مخصّص: بعيد ما لم يكن عنوانه على الحلقة المحلية.
        let base = self
            .db
            .with(|c| Ok(c.query_row("SELECT base_url FROM provider_custom WHERE provider_id = ?1", params![provider], |r| r.get::<_, String>(0)).optional()?))
            .ok()
            .flatten()?;
        Some(polaris_host_providers::net::endpoint::loopback(&base).is_err())
    }

    fn monitor_model(&self) -> Option<String> {
        // الجدول نفسه الذي يكتبه `model.preferences.set` في Phase-02 (ADR-041).
        self.db
            .with(|c| Ok(c.query_row("SELECT value FROM preferences WHERE key = 'monitor_model_id'", [], |r| r.get::<_, String>(0)).optional()?))
            .ok()
            .flatten()
    }

    fn review_model(&self) -> Option<String> {
        // الجدول نفسه الذي يكتبه `model.preferences.set` في Phase-02.
        self.db
            .with(|c| Ok(c.query_row("SELECT value FROM preferences WHERE key = 'review_model_id'", [], |r| r.get::<_, String>(0)).optional()?))
            .ok()
            .flatten()
    }
}

/// مُطلِق المجدول فوق Phase-03. مرجع ضعيف: المجدول لا يُبقي زمن التشغيل حيًّا.
pub struct Phase03Launcher {
    pub phase03: Weak<Phase03>,
    pub preferences: Arc<MissionPreferences>,
    /// «التشغيل في نفس المهمّة»: الدور التالي في محادثة التشغيل السابق. لا شيء ⇒ كل تشغيل مهمّة منفصلة.
    pub conversations: Option<Arc<super::conversation::ConversationService>>,
}

/// جلسة المُطلِق: موافقاتها تظهر للمستخدم كأي موافقة، ولا تُمنح تلقائيًّا.
pub const SCHEDULER_SESSION: &str = "polaris-scheduler";

impl MissionLauncher for Phase03Launcher {
    fn create(&self, template: &MissionTemplate, schedule_id: &str) -> Result<String, String> {
        let p03 = self.phase03.upgrade().ok_or("the mission runtime is gone")?;
        let created = p03
            .create(CreateMissionInput {
                title: template.title.clone(),
                objective: template.objective.clone(),
                project_id: template.project_id.clone(),
                execution_mode: ExecutionMode::SingleAgent,
                priority: MissionPriority::Normal,
                budget: MissionBudget::balanced(),
                requirements: Vec::new(),
            })
            .map_err(|e| e.diagnostic_line())?;
        self.preferences.set(&created.mission_id, template.model_id.as_deref(), Some(schedule_id))?;
        Ok(created.mission_id)
    }

    fn start(&self, mission_id: &str) -> Result<String, String> {
        let p03 = self.phase03.upgrade().ok_or("the mission runtime is gone")?;
        p03.start(mission_id, SCHEDULER_SESSION).map(|r| r.state.to_string()).map_err(|e| e.diagnostic_line())
    }

    fn cancel(&self, mission_id: &str) -> Result<(), String> {
        let p03 = self.phase03.upgrade().ok_or("the mission runtime is gone")?;
        p03.cancel(mission_id).map(|_| ()).map_err(|e| e.diagnostic_line())
    }

    /// الدور التالي في محادثة مهمّة التشغيل السابق، برسالة القالب، بالمشروع والمساحة نفسيهما؛ ويُسمّ بالجدول.
    fn continue_from(&self, previous: &str, template: &MissionTemplate, schedule_id: &str) -> Result<String, String> {
        let Some(conversations) = &self.conversations else { return self.create(template, schedule_id) };
        let next = conversations.continue_thread(previous, &template.objective).map_err(|e| e.to_string())?;
        if let Some(model) = template.model_id.as_deref() {
            self.preferences.set(&next.mission_id, Some(model), Some(schedule_id))?;
        }
        self.preferences.link_schedule(&next.mission_id, schedule_id)?;
        Ok(next.mission_id)
    }

    /// PHASE-14: حالة مهمّة التشغيل السابق كما يحفظها زمن التشغيل.
    fn state(&self, mission_id: &str) -> Option<String> {
        let p03 = self.phase03.upgrade()?;
        p03.get(mission_id).ok().map(|m| m.mission.state.to_string())
    }
}

/// يحرّر صندوق المهمّة (ملف تعريف الحاوية وإذن المساحة) ويغلق متصفّحها حين تنتهي نهائيًّا أو تُلغى.
/// المهمّة المنتظرة موافقةً ليست نهائية: صندوقها يبقى لتستأنف.
pub struct ReleaseSandboxObserver {
    pub execution: Arc<ExecutionService>,
    pub browser: Arc<super::browser::BrowserService>,
    /// تسجيل مخرجات `outputs/` عند الاكتمال. اختياري لأن بعض التجهيزات تبني المراقب بلا مخرجات.
    pub artifacts: Option<Arc<super::artifacts::service::ArtifactService>>,
}

impl MissionObserver for ReleaseSandboxObserver {
    fn mission_finished(&self, note: &MissionOutcomeNote) {
        // المهمّة المكتملة: ما في outputs/ يصير مخرجات في المكتبة قبل إغلاق الصندوق.
        if note.terminal && note.state == "COMPLETED" {
            if let Some(artifacts) = &self.artifacts {
                artifacts.register_outputs(&note.mission_id, None);
            }
        }
        if note.terminal {
            self.execution.release(&note.mission_id);
            self.browser.close_mission(&note.mission_id, "CLOSED", "MISSION_ENDED");
        }
    }
    fn mission_cancelled(&self, mission_id: &str) {
        self.execution.release(mission_id);
        self.browser.close_mission(mission_id, "CANCELLED", "MISSION_CANCELLED");
    }
}

/// يوزّع أحداث المهمّة على عدّة مراقبين بالترتيب.
pub struct ObserverChain(pub Vec<Arc<dyn MissionObserver>>);

impl MissionObserver for ObserverChain {
    fn task_finished(&self, note: &crate::p03::port::TaskOutcomeNote) {
        for o in &self.0 {
            o.task_finished(note);
        }
    }
    fn mission_finished(&self, note: &MissionOutcomeNote) {
        for o in &self.0 {
            o.mission_finished(note);
        }
    }
    fn mission_cancelled(&self, mission_id: &str) {
        for o in &self.0 {
            o.mission_cancelled(mission_id);
        }
    }
    fn narrate(&self, note: &crate::p03::port::NarrationNote) {
        for o in &self.0 {
            o.narrate(note);
        }
    }
    fn thinking(&self, mission_id: &str, active: bool) {
        for o in &self.0 {
            o.thinking(mission_id, active);
        }
    }
    fn retitle(&self, mission_id: &str, title: &str) {
        for o in &self.0 {
            o.retitle(mission_id, title);
        }
    }

    fn security_event(&self, mission_id: &str, event: &crate::p03::security::SecurityEvent) {
        for o in &self.0 {
            o.security_event(mission_id, event);
        }
    }

    fn suggest(&self, mission_id: &str, suggestions: &[String]) {
        for o in &self.0 {
            o.suggest(mission_id, suggestions);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_preference_is_stored_per_mission_and_invalid_ids_are_refused() {
        let db = Arc::new(Database::in_memory().unwrap());
        let p = MissionPreferences::new(db, RuntimeClock::system());
        let m = crate::ids::new_uuid_v4();
        assert_eq!(p.model_for(&m), None);
        p.set(&m, Some("local-openai-compatible:fixture-chat"), None).unwrap();
        assert_eq!(p.model_for(&m).as_deref(), Some("local-openai-compatible:fixture-chat"));
        assert_eq!(p.get(&m).unwrap().1, "USER");
        assert!(p.set("x", None, None).is_err());
        assert!(p.set(&m, Some("bad id"), None).is_err());
    }
}
