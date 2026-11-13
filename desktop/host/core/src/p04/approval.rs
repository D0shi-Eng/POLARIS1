// الموافقة على استعمال أداة: مربوطة، ولمرّة واحدة، وذات أجل.
//
// القاعدة (البند 46/130): الموافقة ليست إذنًا عامًّا للأداة. هي مربوطة بستة أشياء
// معًا — المهمّة، والمهمّة الفرعية، والأداة، وبصمة الحجج، ومجموعة الأثر، والأجل —
// فلا تُعاد لأداة أخرى ولا لحجج أخرى ولا بعد انقضاء أجلها ولا مرّتين.
//
// ومن لا يستطيع منح الموافقة: النموذج، والوكيل، وخادم MCP، وناتج أداة. الجواب
// يأتي من المستخدم عبر عملية IPC مُسمّاة، ولا مسار آخر إليه.

use serde::{Deserialize, Serialize};

use super::effect::{self, ToolEffect};
use super::tool::RiskClass;

/// قرار المستخدم.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalDecision {
    Grant,
    Deny,
}

impl ApprovalDecision {
    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "GRANT" => Some(Self::Grant),
            "DENY" => Some(Self::Deny),
            _ => None,
        }
    }
}

/// حالة طلب الموافقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalStatus {
    Pending,
    Granted,
    Denied,
    Expired,
    /// مُنحت ثم استُهلكت في تنفيذ واحد. لا يُعاد استعمالها.
    Consumed,
}

impl ApprovalStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Granted => "GRANTED",
            Self::Denied => "DENIED",
            Self::Expired => "EXPIRED",
            Self::Consumed => "CONSUMED",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Some(match code {
            "PENDING" => Self::Pending,
            "GRANTED" => Self::Granted,
            "DENIED" => Self::Denied,
            "EXPIRED" => Self::Expired,
            "CONSUMED" => Self::Consumed,
            _ => return None,
        })
    }

    pub fn is_final(self) -> bool {
        matches!(self, Self::Denied | Self::Expired | Self::Consumed)
    }
}

/// الرباط الذي تُقاس به كل موافقة. تساوي الرباطين شرطٌ لازم قبل أي تنفيذ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalBinding {
    pub mission_id: String,
    pub task_id: String,
    pub tool_id: String,
    pub arguments_digest: String,
    pub effects: Vec<ToolEffect>,
}

impl ApprovalBinding {
    pub fn new(mission_id: &str, task_id: &str, tool_id: &str, arguments_digest: &str, effects: &[ToolEffect]) -> Self {
        Self {
            mission_id: mission_id.to_string(),
            task_id: task_id.to_string(),
            tool_id: tool_id.to_string(),
            arguments_digest: arguments_digest.to_string(),
            effects: effect::normalise(effects),
        }
    }

    /// بصمة الرباط. تُكتب في التدقيق فيثبت أن الممنوح هو المنفَّذ.
    pub fn digest(&self) -> String {
        let text = format!(
            "{}|{}|{}|{}|{}",
            self.mission_id,
            self.task_id,
            self.tool_id,
            self.arguments_digest,
            self.effects.iter().map(|e| e.as_str()).collect::<Vec<_>>().join(",")
        );
        crate::digest::sha256_hex(text.as_bytes())
    }
}

/// ملخّص موثوق لما يُطلب إقراره (Phase-05، البند 43).
///
/// يكتبه زمن التشغيل من حالته — الجلسة، والصفحة، والنافذة، والعنصر — لا من سبب
/// النموذج. سبب النموذج يبقى في `reason` معروضًا بوصفه قولًا، وهذا بجواره بوصفه
/// حقيقة عمّا سيحدث.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalContext {
    pub agent_id: String,
    /// الفعل برمز مغلق، مثل `WEB_CLICK` أو `DESKTOP_TYPE`.
    pub action: String,
    /// الهدف كما يراه زمن التشغيل: أصل وعنصر، أو نافذة وعملية.
    pub target: String,
    pub expected_effect: String,
    pub risk: RiskClass,
    pub arguments_summary: String,
}

/// سجل موافقة واحد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalRecord {
    pub approval_id: String,
    pub binding: ApprovalBinding,
    pub skill_id: String,
    /// معاينة محدودة للحجج، للعرض على المستخدم. ليست الحجج نفسها.
    pub arguments_preview: String,
    pub reason: String,
    pub status: ApprovalStatus,
    pub requested_at_ms: u64,
    pub requested_at: String,
    pub decided_at: Option<String>,
    pub expires_at_ms: u64,
    pub expires_at: String,
    /// الملخّص الموثوق، إن كتبه مُقيِّم السياسة. أدوات Phase-04 لا تكتبه.
    #[serde(default)]
    pub context: Option<ApprovalContext>,
}

/// لماذا رُفضت موافقة مقدَّمة. مغلق، ويطابق مفردات العقد.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ApprovalRefusal {
    Missing,
    Mismatch,
    Expired,
    AlreadyUsed,
    Denied,
    StillPending,
}

impl ApprovalRefusal {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Missing => "APPROVAL_MISSING",
            Self::Mismatch => "APPROVAL_MISMATCH",
            Self::Expired => "APPROVAL_EXPIRED",
            Self::AlreadyUsed => "APPROVAL_ALREADY_USED",
            Self::Denied => "APPROVAL_DENIED",
            Self::StillPending => "APPROVAL_REQUIRED",
        }
    }
}

/// أجل الموافقة الافتراضي: خمس دقائق. موافقة قديمة ليست موافقة على ما يجري الآن.
pub const DEFAULT_APPROVAL_TTL_MS: u64 = 5 * 60 * 1000;

/// مخزن الموافقات داخل العملية. الاستمرار على القرص يقع في المستودع.
#[derive(Debug, Default, Clone)]
pub struct ApprovalStore {
    records: Vec<ApprovalRecord>,
}

impl ApprovalStore {
    pub fn new() -> Self {
        Self { records: Vec::new() }
    }

    pub fn records(&self) -> &[ApprovalRecord] {
        &self.records
    }

    pub fn get(&self, approval_id: &str) -> Option<&ApprovalRecord> {
        self.records.iter().find(|r| r.approval_id == approval_id)
    }

    pub fn insert(&mut self, record: ApprovalRecord) {
        match self.records.iter_mut().find(|r| r.approval_id == record.approval_id) {
            Some(existing) => *existing = record,
            None => self.records.push(record),
        }
    }

    /// يُنهي أجل كل ما انقضى أجله. الانقضاء حقيقة زمنية لا قرار.
    pub fn expire_due(&mut self, now_ms: u64) -> usize {
        let mut expired = 0;
        for record in self.records.iter_mut() {
            if record.status == ApprovalStatus::Pending && now_ms > record.expires_at_ms {
                record.status = ApprovalStatus::Expired;
                expired += 1;
            }
        }
        expired
    }

    /// يُنهي كل موافقة معلّقة أو ممنوحة لمهمّة أُلغيت (Phase-06، البند 54). موافقة على
    /// أثر لمهمّة لم تعد قائمة لا تنتظر أحدًا، ولا تُستهلك بعد الإلغاء.
    pub fn expire_for_mission(&mut self, mission_id: &str, now: &str) -> Vec<ApprovalRecord> {
        let mut out = Vec::new();
        for record in self.records.iter_mut() {
            if record.binding.mission_id == mission_id && matches!(record.status, ApprovalStatus::Pending | ApprovalStatus::Granted) {
                record.status = ApprovalStatus::Expired;
                record.decided_at = Some(now.to_string());
                out.push(record.clone());
            }
        }
        out
    }

    /// يجيب على طلب موافقة. لا يقبل جوابًا على طلب محسوم سلفًا.
    pub fn decide(
        &mut self,
        approval_id: &str,
        decision: ApprovalDecision,
        now_ms: u64,
        now: &str,
    ) -> Result<ApprovalRecord, ApprovalRefusal> {
        self.expire_due(now_ms);
        let record = self.records.iter_mut().find(|r| r.approval_id == approval_id).ok_or(ApprovalRefusal::Missing)?;
        match record.status {
            ApprovalStatus::Pending => {}
            ApprovalStatus::Expired => return Err(ApprovalRefusal::Expired),
            ApprovalStatus::Consumed => return Err(ApprovalRefusal::AlreadyUsed),
            // إعادة الجواب على طلب محسوم ليست تصحيحًا: الطلب انتهى.
            ApprovalStatus::Granted | ApprovalStatus::Denied => return Err(ApprovalRefusal::AlreadyUsed),
        }
        record.status = match decision {
            ApprovalDecision::Grant => ApprovalStatus::Granted,
            ApprovalDecision::Deny => ApprovalStatus::Denied,
        };
        record.decided_at = Some(now.to_string());
        Ok(record.clone())
    }

    /// يستهلك موافقة ممنوحة لرباط بعينه. هذا هو الفحص الذي يسبق التنفيذ.
    ///
    /// كل شرط هنا وُضع بعد سؤال «كيف يُعاد استعمال هذه الموافقة؟»: أداة أخرى،
    /// حجج أخرى، مهمّة أخرى، أثر أوسع، بعد الأجل، أو مرّتين.
    pub fn consume(&mut self, approval_id: &str, binding: &ApprovalBinding, now_ms: u64) -> Result<ApprovalRecord, ApprovalRefusal> {
        self.expire_due(now_ms);
        let record = self.records.iter_mut().find(|r| r.approval_id == approval_id).ok_or(ApprovalRefusal::Missing)?;
        match record.status {
            ApprovalStatus::Granted => {}
            ApprovalStatus::Pending => return Err(ApprovalRefusal::StillPending),
            ApprovalStatus::Denied => return Err(ApprovalRefusal::Denied),
            ApprovalStatus::Expired => return Err(ApprovalRefusal::Expired),
            ApprovalStatus::Consumed => return Err(ApprovalRefusal::AlreadyUsed),
        }
        if record.binding != *binding {
            return Err(ApprovalRefusal::Mismatch);
        }
        if now_ms > record.expires_at_ms {
            record.status = ApprovalStatus::Expired;
            return Err(ApprovalRefusal::Expired);
        }
        record.status = ApprovalStatus::Consumed;
        Ok(record.clone())
    }

    /// موافقة ممنوحة وصالحة لهذا الرباط، إن وُجدت. يُستعمل لربط اقتراح بموافقته
    /// دون أن يسمّي النموذج معرّف موافقة.
    pub fn granted_for(&self, binding: &ApprovalBinding, now_ms: u64) -> Option<&ApprovalRecord> {
        self.records
            .iter()
            .find(|r| r.status == ApprovalStatus::Granted && r.binding == *binding && now_ms <= r.expires_at_ms)
    }

    /// R-24: رفضٌ صريح من المستخدم لهذا الرباط نفسه (المهمّة، والخطوة، والأداة، وبصمة الوسائط، والآثار). الفعل الذي رُفض لا يُسأل
    /// عنه ثانيةً: يعود رفضًا. قِيس 2026-10-13: بدونه كان الاستئناف بعد الرفض ينشئ طلبًا جديدًا، فيُسأل المستخدم إلى ما لا نهاية.
    pub fn denied_for(&self, binding: &ApprovalBinding) -> Option<&ApprovalRecord> {
        self.records.iter().find(|r| r.status == ApprovalStatus::Denied && r.binding == *binding)
    }

    /// طلب معلّق لهذا الرباط، إن وُجد. يمنع تكديس طلبات متطابقة.
    pub fn pending_for(&self, binding: &ApprovalBinding, now_ms: u64) -> Option<&ApprovalRecord> {
        self.records
            .iter()
            .find(|r| r.status == ApprovalStatus::Pending && r.binding == *binding && now_ms <= r.expires_at_ms)
    }

    pub fn for_mission(&self, mission_id: &str) -> Vec<&ApprovalRecord> {
        self.records.iter().filter(|r| r.binding.mission_id == mission_id).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(tool: &str, digest: &str) -> ApprovalBinding {
        ApprovalBinding::new("m1", "t1", tool, digest, &[ToolEffect::WriteLocal])
    }

    fn record(id: &str, binding: ApprovalBinding, now_ms: u64) -> ApprovalRecord {
        ApprovalRecord {
            approval_id: id.into(),
            binding,
            skill_id: "polaris.skill.project-note".into(),
            arguments_preview: "{\"note\":\"...\"}".into(),
            reason: "the agent asked to append a note".into(),
            status: ApprovalStatus::Pending,
            requested_at_ms: now_ms,
            requested_at: "2026-09-22T00:00:00Z".into(),
            decided_at: None,
            expires_at_ms: now_ms + DEFAULT_APPROVAL_TTL_MS,
            expires_at: "2026-09-22T00:05:00Z".into(),
            context: None,
        }
    }

    #[test]
    fn a_granted_approval_is_consumed_once_and_never_again() {
        let mut store = ApprovalStore::new();
        store.insert(record("a1", binding("polaris.tool.note", "d1"), 0));
        store.decide("a1", ApprovalDecision::Grant, 10, "t").unwrap();
        assert!(store.consume("a1", &binding("polaris.tool.note", "d1"), 20).is_ok());
        assert_eq!(
            store.consume("a1", &binding("polaris.tool.note", "d1"), 30),
            Err(ApprovalRefusal::AlreadyUsed),
            "an approval was replayed"
        );
    }

    /// R-24: الرفض يُذكر للرباط نفسه وحده؛ وسائط أخرى طلبٌ جديد.
    #[test]
    fn a_denied_approval_is_remembered_for_the_same_binding_only() {
        let mut store = ApprovalStore::new();
        store.insert(record("a1", binding("polaris.tool.note", "d1"), 0));
        assert!(store.denied_for(&binding("polaris.tool.note", "d1")).is_none());
        store.decide("a1", ApprovalDecision::Deny, 10, "t").unwrap();
        assert!(store.denied_for(&binding("polaris.tool.note", "d1")).is_some(), "the user's refusal was forgotten");
        assert!(store.denied_for(&binding("polaris.tool.note", "d2")).is_none(), "a refusal leaked to other arguments");
        assert!(store.granted_for(&binding("polaris.tool.note", "d1"), 20).is_none());
    }

    #[test]
    fn an_approval_cannot_be_moved_to_another_tool_or_other_arguments() {
        let mut store = ApprovalStore::new();
        store.insert(record("a1", binding("polaris.tool.note", "d1"), 0));
        store.decide("a1", ApprovalDecision::Grant, 10, "t").unwrap();
        assert_eq!(
            store.consume("a1", &binding("polaris.tool.other", "d1"), 20),
            Err(ApprovalRefusal::Mismatch),
            "an approval moved to another tool"
        );
        assert_eq!(
            store.consume("a1", &binding("polaris.tool.note", "d2"), 20),
            Err(ApprovalRefusal::Mismatch),
            "an approval moved to other arguments"
        );
    }

    #[test]
    fn an_approval_cannot_be_moved_to_another_mission_or_a_wider_effect() {
        let mut store = ApprovalStore::new();
        store.insert(record("a1", binding("polaris.tool.note", "d1"), 0));
        store.decide("a1", ApprovalDecision::Grant, 10, "t").unwrap();
        let other_mission = ApprovalBinding::new("m2", "t1", "polaris.tool.note", "d1", &[ToolEffect::WriteLocal]);
        assert_eq!(store.consume("a1", &other_mission, 20), Err(ApprovalRefusal::Mismatch));
        let wider = ApprovalBinding::new("m1", "t1", "polaris.tool.note", "d1", &[ToolEffect::WriteLocal, ToolEffect::ExternalSideEffect]);
        assert_eq!(store.consume("a1", &wider, 20), Err(ApprovalRefusal::Mismatch), "an approval widened its effect set");
    }

    #[test]
    fn an_expired_approval_is_not_a_valid_one() {
        let mut store = ApprovalStore::new();
        store.insert(record("a1", binding("polaris.tool.note", "d1"), 0));
        store.decide("a1", ApprovalDecision::Grant, 10, "t").unwrap();
        let late = DEFAULT_APPROVAL_TTL_MS + 1;
        assert_eq!(store.consume("a1", &binding("polaris.tool.note", "d1"), late), Err(ApprovalRefusal::Expired));
    }

    #[test]
    fn a_pending_approval_cannot_be_consumed_and_a_denied_one_stays_denied() {
        let mut store = ApprovalStore::new();
        store.insert(record("a1", binding("polaris.tool.note", "d1"), 0));
        assert_eq!(store.consume("a1", &binding("polaris.tool.note", "d1"), 5), Err(ApprovalRefusal::StillPending));
        store.decide("a1", ApprovalDecision::Deny, 10, "t").unwrap();
        assert_eq!(store.consume("a1", &binding("polaris.tool.note", "d1"), 20), Err(ApprovalRefusal::Denied));
        // ولا يُعاد فتح طلب محسوم بجواب ثانٍ.
        assert_eq!(store.decide("a1", ApprovalDecision::Grant, 20, "t"), Err(ApprovalRefusal::AlreadyUsed));
    }

    #[test]
    fn an_unknown_approval_identifier_is_refused() {
        let mut store = ApprovalStore::new();
        assert_eq!(store.consume("nope", &binding("polaris.tool.note", "d1"), 5), Err(ApprovalRefusal::Missing));
        assert_eq!(store.decide("nope", ApprovalDecision::Grant, 5, "t"), Err(ApprovalRefusal::Missing));
    }

    #[test]
    fn a_pending_request_expires_by_time_alone() {
        let mut store = ApprovalStore::new();
        store.insert(record("a1", binding("polaris.tool.note", "d1"), 0));
        assert_eq!(store.expire_due(DEFAULT_APPROVAL_TTL_MS + 1), 1);
        assert_eq!(store.get("a1").unwrap().status, ApprovalStatus::Expired);
        assert_eq!(store.decide("a1", ApprovalDecision::Grant, DEFAULT_APPROVAL_TTL_MS + 2, "t"), Err(ApprovalRefusal::Expired));
    }

    #[test]
    fn the_binding_digest_changes_when_any_bound_field_changes() {
        let base = binding("polaris.tool.note", "d1").digest();
        assert_ne!(base, binding("polaris.tool.other", "d1").digest());
        assert_ne!(base, binding("polaris.tool.note", "d2").digest());
        assert_ne!(base, ApprovalBinding::new("m2", "t1", "polaris.tool.note", "d1", &[ToolEffect::WriteLocal]).digest());
        assert_ne!(base, ApprovalBinding::new("m1", "t2", "polaris.tool.note", "d1", &[ToolEffect::WriteLocal]).digest());
        assert_ne!(base, ApprovalBinding::new("m1", "t1", "polaris.tool.note", "d1", &[ToolEffect::ExternalSideEffect]).digest());
        // والترتيب لا يغيّرها: الرباط مجموعة لا قائمة.
        assert_eq!(
            ApprovalBinding::new("m1", "t1", "x", "d", &[ToolEffect::ReadLocal, ToolEffect::WriteLocal]).digest(),
            ApprovalBinding::new("m1", "t1", "x", "d", &[ToolEffect::WriteLocal, ToolEffect::ReadLocal]).digest()
        );
    }
}
