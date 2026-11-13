// أوصاف الأدوار وأمثلة الوكلاء.
//
// الدور قالب سلوكي لا مصدر سلطة (البند 19): لا يمنح إذنًا ولا قدرة أداة. الهوية
// يصدرها وقت التشغيل الموثوق؛ النموذج لا يختار معرّف الوكيل، والعارض لا ينتحل
// وكيلًا، والوكيل لا يغيّر دوره (البند 111).

use serde::{Deserialize, Serialize};

use super::task::TaskType;

/// الأدوار المدمجة (البند 20). مجموعة مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentRole {
    Coordinator,
    Planner,
    Architect,
    Builder,
    Debugger,
    Reviewer,
    SecurityReviewer,
    TestEngineer,
    /// في Phase-03 لا يتصفّح الويب؛ يبحث في السياق المُقدَّم ومعرفة النموذج فقط (البند 29).
    Researcher,
}

impl AgentRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Coordinator => "COORDINATOR",
            Self::Planner => "PLANNER",
            Self::Architect => "ARCHITECT",
            Self::Builder => "BUILDER",
            Self::Debugger => "DEBUGGER",
            Self::Reviewer => "REVIEWER",
            Self::SecurityReviewer => "SECURITY_REVIEWER",
            Self::TestEngineer => "TEST_ENGINEER",
            Self::Researcher => "RESEARCHER",
        }
    }

    pub const ALL: [AgentRole; 9] = [
        Self::Coordinator,
        Self::Planner,
        Self::Architect,
        Self::Builder,
        Self::Debugger,
        Self::Reviewer,
        Self::SecurityReviewer,
        Self::TestEngineer,
        Self::Researcher,
    ];
}

/// صنف أمني للدور: توثيقي بحت. لا يُشتق منه إذن؛ الإذن يأتي من نقاط فرض السياسة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SecurityClass {
    Standard,
    /// أدوار المراجعة الأمنية تُصنَّف للتوثيق، لا لتمنحها سلطة تجاوز السياسة (البند 27).
    SecuritySensitive,
}

/// وصف الدور. قالب لا يحمل سلطة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentDescriptor {
    pub agent_type: AgentRole,
    pub display_name_key: String,
    pub purpose_key: String,
    pub allowed_task_types: Vec<TaskType>,
    pub required_capabilities: Vec<String>,
    pub max_delegation_depth: u32,
    pub review_eligible: bool,
    pub security_class: SecurityClass,
    pub enabled: bool,
}

impl AgentDescriptor {
    pub fn allows(&self, task_type: TaskType) -> bool {
        self.allowed_task_types.contains(&task_type)
    }
}

/// سجل الأدوار المدمجة. لا يُنشئ أي دور أذونات؛ يصف السلوك فقط.
pub struct AgentRegistry {
    descriptors: Vec<AgentDescriptor>,
}

impl AgentRegistry {
    /// السجل الافتراضي بالأدوار التسعة.
    pub fn builtin() -> Self {
        let d = |role: AgentRole, tasks: Vec<TaskType>, review: bool, sec: SecurityClass| AgentDescriptor {
            agent_type: role,
            display_name_key: format!("p03.agent.{}.name", role.as_str().to_lowercase()),
            purpose_key: format!("p03.agent.{}.purpose", role.as_str().to_lowercase()),
            allowed_task_types: tasks,
            required_capabilities: Vec::new(),
            max_delegation_depth: 3,
            review_eligible: review,
            security_class: sec,
            enabled: true,
        };
        Self {
            descriptors: vec![
                d(AgentRole::Coordinator, vec![], false, SecurityClass::Standard),
                d(AgentRole::Planner, vec![TaskType::Plan], false, SecurityClass::Standard),
                d(AgentRole::Architect, vec![TaskType::Design], true, SecurityClass::Standard),
                d(AgentRole::Builder, vec![TaskType::Build, TaskType::Debug], false, SecurityClass::Standard),
                d(AgentRole::Debugger, vec![TaskType::Debug], false, SecurityClass::Standard),
                d(AgentRole::Reviewer, vec![TaskType::Review], true, SecurityClass::Standard),
                d(AgentRole::SecurityReviewer, vec![TaskType::SecurityReview], true, SecurityClass::SecuritySensitive),
                d(AgentRole::TestEngineer, vec![TaskType::Test], true, SecurityClass::Standard),
                d(AgentRole::Researcher, vec![TaskType::Research, TaskType::Synthesize], false, SecurityClass::Standard),
            ],
        }
    }

    /// يبني سجلًّا من أوصاف مُعطاة (تُستعمله الإعدادات لتعطيل أدوار).
    pub fn from_descriptors(descriptors: Vec<AgentDescriptor>) -> Self {
        Self { descriptors }
    }

    pub fn descriptor(&self, role: AgentRole) -> Option<&AgentDescriptor> {
        self.descriptors.iter().find(|d| d.agent_type == role)
    }

    pub fn descriptors(&self) -> &[AgentDescriptor] {
        &self.descriptors
    }

    /// هل الدور مُفعَّل ومعروف؟ دور مجهول أو معطّل ليس مدعومًا.
    pub fn is_available(&self, role: AgentRole) -> bool {
        self.descriptor(role).is_some_and(|d| d.enabled)
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::builtin()
    }
}

/// حالة أمثولة الوكيل. مجموعة مغلقة (البند 31).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentState {
    Created,
    Idle,
    Working,
    Waiting,
    Reviewing,
    Blocked,
    Completed,
    Failed,
    Cancelled,
    Stopped,
}

impl AgentState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Created => "CREATED",
            Self::Idle => "IDLE",
            Self::Working => "WORKING",
            Self::Waiting => "WAITING",
            Self::Reviewing => "REVIEWING",
            Self::Blocked => "BLOCKED",
            Self::Completed => "COMPLETED",
            Self::Failed => "FAILED",
            Self::Cancelled => "CANCELLED",
            Self::Stopped => "STOPPED",
        }
    }

    /// بعد التوقّف لا تنفيذ خلفي ضمني (البند 31).
    pub fn is_stopped(self) -> bool {
        matches!(self, Self::Stopped | Self::Cancelled)
    }
}

/// أمثولة وكيل في وقت التشغيل. لا تخزّن سرّ نموذج (البند 30).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentInstance {
    pub agent_id: String,
    pub mission_id: String,
    pub role: AgentRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    pub state: AgentState,
    pub delegation_depth: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task_id: Option<String>,
    pub output_refs: Vec<String>,
    pub created_at: String,
    pub last_active_at: String,
    /// تعريف الوكيل وإصداره حين يعمل المثيل بتعريف من الدليل (القسم 6). الهوية التنفيذية: معرّف المثيل + التعريف + الإصدار.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<(String, String)>,
}

impl AgentInstance {
    pub fn new(agent_id: impl Into<String>, mission_id: impl Into<String>, role: AgentRole, now: impl Into<String>) -> Self {
        let now = now.into();
        Self {
            agent_id: agent_id.into(),
            mission_id: mission_id.into(),
            role,
            model_id: None,
            state: AgentState::Created,
            delegation_depth: 0,
            parent_agent_id: None,
            current_task_id: None,
            output_refs: Vec::new(),
            created_at: now.clone(),
            last_active_at: now,
            definition: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_builtin_registry_has_nine_enabled_roles() {
        let reg = AgentRegistry::builtin();
        assert_eq!(reg.descriptors().len(), 9);
        for role in AgentRole::ALL {
            assert!(reg.is_available(role), "{role:?} missing");
        }
    }

    #[test]
    fn a_disabled_role_is_not_available() {
        let mut reg = AgentRegistry::builtin();
        // نعطّل دورًا بتعديل الوصف مباشرةً (كما ستفعل الإعدادات).
        let idx = reg.descriptors.iter().position(|d| d.agent_type == AgentRole::Builder).unwrap();
        reg.descriptors[idx].enabled = false;
        assert!(!reg.is_available(AgentRole::Builder));
    }

    #[test]
    fn roles_only_allow_their_declared_task_types() {
        let reg = AgentRegistry::builtin();
        let planner = reg.descriptor(AgentRole::Planner).unwrap();
        assert!(planner.allows(TaskType::Plan));
        assert!(!planner.allows(TaskType::Build));
        // المنسّق لا يملك أنواع مهام: ينسّق ولا ينفّذ.
        assert!(reg.descriptor(AgentRole::Coordinator).unwrap().allowed_task_types.is_empty());
    }

    #[test]
    fn a_descriptor_carries_no_authority_field() {
        // برهان إنشائي: الوصف لا يملك حقلًا للأذونات؛ التحقق بأن التسلسل لا يحوي كلمة سلطة.
        let reg = AgentRegistry::builtin();
        let json = serde_json::to_string(reg.descriptor(AgentRole::SecurityReviewer).unwrap()).unwrap();
        assert!(!json.contains("permission"));
        assert!(!json.contains("authority"));
        assert!(!json.contains("grant"));
    }
}
