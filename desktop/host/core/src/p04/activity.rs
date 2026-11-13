// سجل نشاط الأدوات: كل محاولة، ناجحة كانت أو مرفوضة.
//
// القاعدة (البند 50): الرفض يُسجَّل تمامًا كما يُسجَّل النجاح. سجلٌّ لا يحمل إلا
// النجاحات يجعل «لم يحدث شيء» و«مُنع شيء» متطابقين على الشاشة، وهما ليسا كذلك.

use serde::{Deserialize, Serialize};

use super::effect::ToolEffect;

/// حالة محاولة واحدة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InvocationStatus {
    Succeeded,
    Failed,
    Denied,
    TimedOut,
    Cancelled,
    AwaitingApproval,
}

impl InvocationStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Succeeded => "SUCCEEDED",
            Self::Failed => "FAILED",
            Self::Denied => "DENIED",
            Self::TimedOut => "TIMED_OUT",
            Self::Cancelled => "CANCELLED",
            Self::AwaitingApproval => "AWAITING_APPROVAL",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Some(match code {
            "SUCCEEDED" => Self::Succeeded,
            "FAILED" => Self::Failed,
            "DENIED" => Self::Denied,
            "TIMED_OUT" => Self::TimedOut,
            "CANCELLED" => Self::Cancelled,
            "AWAITING_APPROVAL" => Self::AwaitingApproval,
            _ => return None,
        })
    }

    /// هل وقع أثر فعليّ؟ هذا هو الفارق الذي يقرّر تسجيل الدليل.
    pub fn executed(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::TimedOut)
    }
}

/// سجل محاولة واحدة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolInvocationRecord {
    pub invocation_id: String,
    pub mission_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub skill_id: String,
    pub tool_id: String,
    pub status: InvocationStatus,
    pub denial_reason: Option<String>,
    pub effects: Vec<ToolEffect>,
    pub arguments_digest: String,
    pub result_digest: Option<String>,
    pub evidence_id: Option<String>,
    pub approval_id: Option<String>,
    /// ملخّص محدود. ليس الجسم الخام، ولا يحمل سرًّا.
    pub summary: String,
    pub started_at: String,
    pub duration_ms: u64,
}

impl ToolInvocationRecord {
    pub fn is_denied(&self) -> bool {
        matches!(self.status, InvocationStatus::Denied)
    }
}

/// سجل النشاط داخل العملية. أحدث أولًا عند القراءة.
#[derive(Debug, Default, Clone)]
pub struct ActivityLog {
    records: Vec<ToolInvocationRecord>,
    /// أقصى ما يُحتفظ به في الذاكرة. المستودع يحفظ ما يجب أن يبقى.
    capacity: usize,
}

/// السعة الافتراضية للسجل داخل العملية.
pub const DEFAULT_CAPACITY: usize = 500;

impl ActivityLog {
    pub fn new() -> Self {
        Self { records: Vec::new(), capacity: DEFAULT_CAPACITY }
    }

    pub fn with_capacity(capacity: usize) -> Self {
        Self { records: Vec::new(), capacity: capacity.max(1) }
    }

    pub fn push(&mut self, record: ToolInvocationRecord) {
        self.records.push(record);
        if self.records.len() > self.capacity {
            let excess = self.records.len() - self.capacity;
            self.records.drain(0..excess);
        }
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn all(&self) -> &[ToolInvocationRecord] {
        &self.records
    }

    /// سجلات مهمّة واحدة، أحدث أولًا.
    pub fn for_mission(&self, mission_id: &str) -> Vec<&ToolInvocationRecord> {
        let mut found: Vec<&ToolInvocationRecord> = self.records.iter().filter(|r| r.mission_id == mission_id).collect();
        found.reverse();
        found
    }

    /// أحدث السجلات عبر كل المهامّ.
    pub fn recent(&self, limit: usize) -> Vec<&ToolInvocationRecord> {
        self.records.iter().rev().take(limit).collect()
    }

    pub fn skills_used(&self, mission_id: &str) -> Vec<String> {
        let mut out: Vec<String> = self
            .records
            .iter()
            .filter(|r| r.mission_id == mission_id && r.status.executed())
            .map(|r| r.skill_id.clone())
            .collect();
        out.sort();
        out.dedup();
        out
    }

    pub fn tools_used(&self, mission_id: &str) -> Vec<String> {
        let mut out: Vec<String> = self
            .records
            .iter()
            .filter(|r| r.mission_id == mission_id && r.status.executed())
            .map(|r| r.tool_id.clone())
            .collect();
        out.sort();
        out.dedup();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(id: &str, mission: &str, status: InvocationStatus) -> ToolInvocationRecord {
        ToolInvocationRecord {
            invocation_id: id.into(),
            mission_id: mission.into(),
            task_id: "t1".into(),
            agent_id: "a1".into(),
            skill_id: "polaris.skill.evidence-gathering".into(),
            tool_id: "polaris.tool.audit.chain.verify".into(),
            status,
            denial_reason: if matches!(status, InvocationStatus::Denied) { Some("UNKNOWN_TOOL".into()) } else { None },
            effects: vec![ToolEffect::DatabaseRead],
            arguments_digest: "d".into(),
            result_digest: None,
            evidence_id: None,
            approval_id: None,
            summary: "s".into(),
            started_at: "2026-09-22T00:00:00Z".into(),
            duration_ms: 1,
        }
    }

    #[test]
    fn a_denied_attempt_is_recorded_exactly_like_a_successful_one() {
        let mut log = ActivityLog::new();
        log.push(record("i1", "m1", InvocationStatus::Succeeded));
        log.push(record("i2", "m1", InvocationStatus::Denied));
        assert_eq!(log.len(), 2);
        assert_eq!(log.for_mission("m1").len(), 2);
        assert!(log.all().iter().any(|r| r.is_denied()));
    }

    #[test]
    fn only_an_executed_attempt_counts_as_a_tool_the_mission_used() {
        let mut log = ActivityLog::new();
        log.push(record("i1", "m1", InvocationStatus::Denied));
        log.push(record("i2", "m1", InvocationStatus::AwaitingApproval));
        assert!(log.tools_used("m1").is_empty(), "a denied call was reported as a tool the mission used");
        log.push(record("i3", "m1", InvocationStatus::Succeeded));
        assert_eq!(log.tools_used("m1").len(), 1);
        assert_eq!(log.skills_used("m1").len(), 1);
    }

    #[test]
    fn one_mission_never_sees_another_missions_activity() {
        let mut log = ActivityLog::new();
        log.push(record("i1", "m1", InvocationStatus::Succeeded));
        log.push(record("i2", "m2", InvocationStatus::Succeeded));
        assert_eq!(log.for_mission("m1").len(), 1);
        assert_eq!(log.for_mission("m1")[0].invocation_id, "i1");
    }

    #[test]
    fn the_newest_record_is_read_first() {
        let mut log = ActivityLog::new();
        log.push(record("i1", "m1", InvocationStatus::Succeeded));
        log.push(record("i2", "m1", InvocationStatus::Succeeded));
        assert_eq!(log.for_mission("m1")[0].invocation_id, "i2");
        assert_eq!(log.recent(1)[0].invocation_id, "i2");
    }

    #[test]
    fn the_log_is_bounded_and_drops_the_oldest_rather_than_growing_without_limit() {
        let mut log = ActivityLog::with_capacity(2);
        for index in 0..5 {
            log.push(record(&format!("i{index}"), "m1", InvocationStatus::Succeeded));
        }
        assert_eq!(log.len(), 2);
        assert_eq!(log.all()[0].invocation_id, "i3");
    }

    #[test]
    fn an_awaiting_approval_attempt_did_not_execute() {
        assert!(!InvocationStatus::AwaitingApproval.executed());
        assert!(!InvocationStatus::Denied.executed());
        assert!(!InvocationStatus::Cancelled.executed());
        assert!(InvocationStatus::Succeeded.executed());
        assert!(InvocationStatus::TimedOut.executed(), "a timed-out call may still have had an effect");
    }
}
