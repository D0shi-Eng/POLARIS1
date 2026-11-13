// نطاق المهمّة: النموذج وآلة الحالة والميزانية وإثبات الإنجاز.
//
// حالة المهمّة تجيب: «أين نحن في دورة حياة التنفيذ؟». إثبات الإنجاز يجيب سؤالًا
// آخر تمامًا: «هل ثبت الإنجاز الناجح فعلًا؟». الاثنان منفصلان عمدًا (البند 14):
// مهمّة قد تكون COMPLETED بينما إثباتها NOT_PROVEN، ولا يُدمجان.

use serde::{Deserialize, Serialize};

use super::trust::AuthorityClass;

/// حالة دورة حياة المهمّة. مجموعة مغلقة، والانتقالات صريحة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MissionState {
    Created,
    Planning,
    Ready,
    Running,
    WaitingForApproval,
    WaitingForUser,
    Blocked,
    Verifying,
    Completed,
    Failed,
    Cancelled,
    Stopped,
}

impl MissionState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "CREATED",
            Self::Planning => "PLANNING",
            Self::Ready => "READY",
            Self::Running => "RUNNING",
            Self::WaitingForApproval => "WAITING_FOR_APPROVAL",
            Self::WaitingForUser => "WAITING_FOR_USER",
            Self::Blocked => "BLOCKED",
            Self::Verifying => "VERIFYING",
            Self::Completed => "COMPLETED",
            Self::Failed => "FAILED",
            Self::Cancelled => "CANCELLED",
            Self::Stopped => "STOPPED",
        }
    }

    /// الحالة نهائية: لا تنفيذ بعدها إلا بمراجعة/مهمّة جديدة صريحة.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }

    /// هل الانتقال إلى `next` مشروع؟ المنع مغلق: كل ما ليس مُعلنًا هنا مرفوض.
    /// لا قفزة صامتة، ولا انتقال من حالة نهائية إلى تشغيل.
    pub fn can_transition_to(self, next: MissionState) -> bool {
        use MissionState::*;
        match self {
            Created => matches!(next, Planning | Cancelled | Stopped),
            Planning => matches!(next, Ready | WaitingForUser | Blocked | Failed | Cancelled | Stopped),
            Ready => matches!(next, Running | WaitingForUser | Blocked | Cancelled | Stopped),
            Running => matches!(
                next,
                WaitingForApproval | WaitingForUser | Blocked | Verifying | Completed | Failed | Cancelled | Stopped
            ),
            WaitingForApproval => matches!(next, Running | Blocked | Failed | Cancelled | Stopped),
            WaitingForUser => matches!(next, Running | Ready | Blocked | Failed | Cancelled | Stopped),
            Blocked => matches!(next, Ready | Running | WaitingForUser | Failed | Cancelled | Stopped),
            Verifying => matches!(next, Running | Completed | Failed | Blocked | Cancelled | Stopped),
            // الحالات النهائية لا تنتقل إلى تشغيل. الاستئناف يفتح مهمّة/مراجعة جديدة.
            Completed | Failed | Cancelled => false,
            // STOPPED يُستأنف فقط بفعل صريح من المالك: يُعامَل خارج آلة الحالة.
            Stopped => false,
        }
    }
}

/// حالة إثبات الإنجاز، منفصلة عن حالة المهمّة (البند 14).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CompletionProofStatus {
    /// لم يُقيَّم بعد.
    NotEvaluated,
    /// قُيِّم فلم يثبت الإنجاز.
    NotProven,
    /// ثبت الإنجاز وفق قواعد التحقق.
    Proven,
}

impl CompletionProofStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotEvaluated => "NOT_EVALUATED",
            Self::NotProven => "NOT_PROVEN",
            Self::Proven => "PROVEN",
        }
    }
}

/// أولوية المهمّة، تُستعمل في ترتيب الجدولة الحتمي.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MissionPriority {
    Low,
    Normal,
    High,
}

/// مصدر المهمّة: من أنشأها. لا يمنح سلطة؛ توثيقي وتدقيقي.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MissionOrigin {
    User,
    System,
}

/// نمط التنفيذ (البند 148): وكيل واحد، أو تنسيق متعدّد الوكلاء.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionMode {
    SingleAgent,
    CoordinatedMultiAgent,
}

/// ميزانية المهمّة. كل بُعد يُفرَض، والحجز قبل الإنفاق (البند 61/62).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissionBudget {
    pub max_wall_clock_ms: u64,
    pub max_model_calls: u32,
    pub max_input_tokens: u64,
    pub max_output_tokens: u64,
    pub max_total_tokens: u64,
    pub max_tasks: u32,
    pub max_agent_instances: u32,
    pub max_active_agents: u32,
    pub max_concurrent_model_calls: u32,
    pub max_delegations: u32,
    pub max_delegation_depth: u32,
    pub max_retries: u32,
    pub max_review_rounds: u32,
    pub max_graph_revisions: u32,
    // ——— أبعاد أدوات Phase-04. أُضيفت بقيم افتراضية معلنة، فمهمّة حُفظت قبلها
    // تُقرأ بالحدّ المحافظ لا بحدّ مفتوح: الغياب يعني أضيق، لا أوسع.
    #[serde(default = "default_max_tool_calls")]
    pub max_tool_calls: u32,
    #[serde(default = "default_max_tool_calls_per_task")]
    pub max_tool_calls_per_task: u32,
    #[serde(default = "default_max_external_side_effects")]
    pub max_external_side_effects: u32,
    #[serde(default = "default_max_network_tool_calls")]
    pub max_network_tool_calls: u32,
    #[serde(default = "default_max_tool_runtime_ms")]
    pub max_tool_runtime_ms: u64,
}

fn default_max_tool_calls() -> u32 {
    16
}

fn default_max_tool_calls_per_task() -> u32 {
    4
}

fn default_max_external_side_effects() -> u32 {
    2
}

fn default_max_network_tool_calls() -> u32 {
    8
}

fn default_max_tool_runtime_ms() -> u64 {
    60_000
}

impl MissionBudget {
    /// إعداد افتراضي محافظ (البند 9/36/60). قِيَم منتَج، لا مُثلى مُقاسة على عتاد.
    pub fn conservative() -> Self {
        Self {
            max_wall_clock_ms: 15 * 60 * 1_000,
            max_model_calls: 24,
            max_input_tokens: 200_000,
            max_output_tokens: 60_000,
            max_total_tokens: 240_000,
            max_tasks: 32,
            max_agent_instances: 8,
            max_active_agents: 4,
            max_concurrent_model_calls: 2,
            max_delegations: 8,
            max_delegation_depth: 3,
            max_retries: 2,
            max_review_rounds: 2,
            max_graph_revisions: 8,
            max_tool_calls: 16,
            max_tool_calls_per_task: 4,
            max_external_side_effects: 2,
            max_network_tool_calls: 8,
            max_tool_runtime_ms: 60_000,
        }
    }

    /// إعداد متوازن. أوسع من المحافظ، وما يزال محدودًا في كل بُعد.
    pub fn balanced() -> Self {
        Self {
            max_wall_clock_ms: 30 * 60 * 1_000,
            max_model_calls: 60,
            max_input_tokens: 600_000,
            max_output_tokens: 180_000,
            max_total_tokens: 780_000,
            max_tasks: 64,
            max_agent_instances: 16,
            max_active_agents: 4,
            max_concurrent_model_calls: 2,
            max_delegations: 16,
            max_delegation_depth: 3,
            max_retries: 2,
            max_review_rounds: 2,
            max_graph_revisions: 16,
            max_tool_calls: 48,
            max_tool_calls_per_task: 8,
            max_external_side_effects: 6,
            max_network_tool_calls: 24,
            max_tool_runtime_ms: 180_000,
        }
    }

    /// إعداد موسَّع. الحدّ الأعلى الذي يعرضه المنتَج، وليس «الأفضل»: لا قياس يقول ذلك.
    pub fn extended() -> Self {
        Self {
            max_wall_clock_ms: 60 * 60 * 1_000,
            max_model_calls: 150,
            max_input_tokens: 1_500_000,
            max_output_tokens: 450_000,
            max_total_tokens: 1_950_000,
            max_tasks: 128,
            max_agent_instances: 32,
            max_active_agents: 6,
            max_concurrent_model_calls: 3,
            max_delegations: 32,
            max_delegation_depth: 3,
            max_retries: 3,
            max_review_rounds: 3,
            max_graph_revisions: 32,
            max_tool_calls: 96,
            max_tool_calls_per_task: 12,
            max_external_side_effects: 12,
            max_network_tool_calls: 48,
            max_tool_runtime_ms: 300_000,
        }
    }
}

/// حالة متطلَّب المهمّة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RequirementStatus {
    Pending,
    Satisfied,
    Unsatisfied,
    Unverified,
    Blocked,
}

/// متطلَّب واحد للمهمّة، يُربط بقاعدة تحقق وادّعاء وأدلّة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissionRequirement {
    pub requirement_id: String,
    pub text: String,
    pub verification_rule_id: String,
    pub mandatory: bool,
    pub status: RequirementStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim_ref: Option<String>,
    pub evidence_refs: Vec<String>,
}

impl MissionRequirement {
    pub fn new(requirement_id: impl Into<String>, text: impl Into<String>, verification_rule_id: impl Into<String>, mandatory: bool) -> Self {
        Self {
            requirement_id: requirement_id.into(),
            text: text.into(),
            verification_rule_id: verification_rule_id.into(),
            mandatory,
            status: RequirementStatus::Pending,
            claim_ref: None,
            evidence_refs: Vec::new(),
        }
    }
}

/// المهمّة نفسها.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mission {
    pub mission_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub title: String,
    /// عنوان المهمّة قد يُولَّد بنموذج؛ عندئذٍ لا يحمل سلطة تعليمة (البند 154).
    pub title_authority: AuthorityClass,
    pub objective: String,
    pub origin: MissionOrigin,
    pub execution_mode: ExecutionMode,
    pub priority: MissionPriority,
    pub state: MissionState,
    pub completion_proof_status: CompletionProofStatus,
    pub current_revision: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_task_id: Option<String>,
    pub budget: MissionBudget,
    pub requirements: Vec<MissionRequirement>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub version: u32,
}

/// سبب رفض انتقال حالة، للتشخيص.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IllegalTransition {
    pub from: MissionState,
    pub to: MissionState,
}

impl Mission {
    /// ينتقل بالحالة إن كان الانتقال مشروعًا، وإلا يرفض دون تغيير.
    pub fn transition_to(&mut self, next: MissionState, now: &str) -> Result<(), IllegalTransition> {
        if !self.state.can_transition_to(next) {
            return Err(IllegalTransition { from: self.state, to: next });
        }
        // آثار جانبية للحالة: أوّل دخول تشغيل يختم started_at، والحالة النهائية completed_at.
        if next == MissionState::Running && self.started_at.is_none() {
            self.started_at = Some(now.to_string());
        }
        if next.is_terminal() {
            self.completed_at = Some(now.to_string());
        }
        self.state = next;
        self.version += 1;
        Ok(())
    }

    pub fn mandatory_requirements(&self) -> impl Iterator<Item = &MissionRequirement> {
        self.requirements.iter().filter(|r| r.mandatory)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mission() -> Mission {
        Mission {
            mission_id: "m1".into(),
            project_id: None,
            title: "t".into(),
            title_authority: AuthorityClass::DirectUserInstruction,
            objective: "o".into(),
            origin: MissionOrigin::User,
            execution_mode: ExecutionMode::SingleAgent,
            priority: MissionPriority::Normal,
            state: MissionState::Created,
            completion_proof_status: CompletionProofStatus::NotEvaluated,
            current_revision: 1,
            root_task_id: None,
            budget: MissionBudget::conservative(),
            requirements: Vec::new(),
            created_at: "t0".into(),
            started_at: None,
            completed_at: None,
            result_summary: None,
            failure_reason: None,
            version: 1,
        }
    }

    #[test]
    fn a_created_mission_may_plan_but_not_run_directly() {
        assert!(MissionState::Created.can_transition_to(MissionState::Planning));
        assert!(!MissionState::Created.can_transition_to(MissionState::Running));
    }

    #[test]
    fn terminal_states_never_transition_to_running() {
        for terminal in [MissionState::Completed, MissionState::Failed, MissionState::Cancelled] {
            assert!(!terminal.can_transition_to(MissionState::Running), "{terminal:?} reopened silently");
        }
    }

    #[test]
    fn an_illegal_transition_is_rejected_without_changing_state() {
        let mut m = mission();
        let err = m.transition_to(MissionState::Completed, "t1").unwrap_err();
        assert_eq!(err.from, MissionState::Created);
        assert_eq!(m.state, MissionState::Created, "state changed on a rejected transition");
        assert_eq!(m.version, 1, "version bumped on a rejected transition");
    }

    #[test]
    fn entering_running_stamps_started_and_terminal_stamps_completed() {
        let mut m = mission();
        m.transition_to(MissionState::Planning, "t1").unwrap();
        m.transition_to(MissionState::Ready, "t2").unwrap();
        m.transition_to(MissionState::Running, "t3").unwrap();
        assert_eq!(m.started_at.as_deref(), Some("t3"));
        m.transition_to(MissionState::Completed, "t4").unwrap();
        assert_eq!(m.completed_at.as_deref(), Some("t4"));
        assert_eq!(m.state, MissionState::Completed);
    }

    #[test]
    fn completion_state_and_proof_are_independent() {
        let mut m = mission();
        m.transition_to(MissionState::Planning, "t1").unwrap();
        m.transition_to(MissionState::Ready, "t2").unwrap();
        m.transition_to(MissionState::Running, "t3").unwrap();
        m.transition_to(MissionState::Completed, "t4").unwrap();
        // COMPLETED لا يعني PROVEN.
        assert_eq!(m.state, MissionState::Completed);
        assert_eq!(m.completion_proof_status, CompletionProofStatus::NotEvaluated);
    }
}
