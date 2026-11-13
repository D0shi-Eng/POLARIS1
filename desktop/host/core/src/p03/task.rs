// عقدة المهمّة الفرعية وآلة حالتها.
//
// الجاهزية تقرّرها التبعيات لا ترتيب المصفوفة (البند 16): عقدة لا تصير READY حتى
// تُستوفى قاعدة كل تبعية مطلوبة. المدخلات والمخرجات مراجع مخزّنة لا كتلًا غير محدودة.

use serde::{Deserialize, Serialize};

/// نوع المهمّة الفرعية. مجموعة مغلقة تُطابق أنواع الأدوار المسموح بها.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskType {
    Plan,
    Design,
    Build,
    Debug,
    Review,
    SecurityReview,
    Test,
    Research,
    Synthesize,
}

impl TaskType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "PLAN",
            Self::Design => "DESIGN",
            Self::Build => "BUILD",
            Self::Debug => "DEBUG",
            Self::Review => "REVIEW",
            Self::SecurityReview => "SECURITY_REVIEW",
            Self::Test => "TEST",
            Self::Research => "RESEARCH",
            Self::Synthesize => "SYNTHESIZE",
        }
    }
}

/// حالة العقدة. مجموعة مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskState {
    Pending,
    Ready,
    Assigned,
    Running,
    Waiting,
    Review,
    Succeeded,
    Failed,
    Cancelled,
    Blocked,
    /// أُعيدت الحالة بعد تعطّل التطبيق (البند 73)؛ لا تبقى RUNNING بأعجوبة.
    Interrupted,
    /// قال الوكيل إن الخطوة تمّت، ولا قياس يخصّها (خطة 2026-10-07، ADR-041): نهائية، ولا تُقرأ نجاحًا ولا تفي بتبعية نجاح.
    UnverifiedDone,
}

impl TaskState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "PENDING",
            Self::Ready => "READY",
            Self::Assigned => "ASSIGNED",
            Self::Running => "RUNNING",
            Self::Waiting => "WAITING",
            Self::Review => "REVIEW",
            Self::Succeeded => "SUCCEEDED",
            Self::Failed => "FAILED",
            Self::Cancelled => "CANCELLED",
            Self::Blocked => "BLOCKED",
            Self::Interrupted => "INTERRUPTED",
            Self::UnverifiedDone => "UNVERIFIED_DONE",
        }
    }

    /// حالة انتهت إلى نتيجة، فلا تُحسب ضمن العمل المتبقّي.
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled | Self::UnverifiedDone)
    }

    /// خطوة لم تنتهِ ولا تنتظر شيئًا من خارجها: ما يغلقه مدقّق الثوابت حين تنتهي مهمّتها.
    pub fn is_open(self) -> bool {
        matches!(self, Self::Pending | Self::Ready | Self::Assigned | Self::Running | Self::Waiting | Self::Review)
    }

    /// أنجزت العقدة تبعيتها بنجاح.
    pub fn is_satisfied(self) -> bool {
        self == Self::Succeeded
    }
}

/// دلالة التبعية: هل يكفي أن تنتهي، أم يجب أن تنجح؟ صريحة لا سحرية (البند 16/17).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DependencyKind {
    /// يجب أن تنجح التبعية.
    RequiresSuccess,
    /// يكفي أن تنتهي التبعية (نجاحًا أو فشلًا)، لتشغيل تشخيص مثلًا.
    RequiresCompletion,
}

/// تبعية واحدة: على أي عقدة، وبأي دلالة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dependency {
    pub task_id: String,
    pub kind: DependencyKind,
}

/// عقدة المهمّة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskNode {
    pub task_id: String,
    pub mission_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_task_id: Option<String>,
    pub title: String,
    pub objective: String,
    pub task_type: TaskType,
    pub state: TaskState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assigned_agent_id: Option<String>,
    pub dependencies: Vec<Dependency>,
    pub required_capabilities: Vec<String>,
    pub input_refs: Vec<String>,
    pub output_refs: Vec<String>,
    pub claim_ids: Vec<String>,
    pub attempt: u32,
    pub max_attempts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    pub version: u32,
}

impl TaskNode {
    pub fn new(
        task_id: impl Into<String>,
        mission_id: impl Into<String>,
        title: impl Into<String>,
        objective: impl Into<String>,
        task_type: TaskType,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            mission_id: mission_id.into(),
            parent_task_id: None,
            title: title.into(),
            objective: objective.into(),
            task_type,
            state: TaskState::Pending,
            assigned_agent_id: None,
            dependencies: Vec::new(),
            required_capabilities: Vec::new(),
            input_refs: Vec::new(),
            output_refs: Vec::new(),
            claim_ids: Vec::new(),
            attempt: 0,
            max_attempts: 1,
            failure_reason: None,
            version: 1,
        }
    }

    pub fn with_dependency(mut self, task_id: impl Into<String>, kind: DependencyKind) -> Self {
        self.dependencies.push(Dependency { task_id: task_id.into(), kind });
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_succeeded_satisfies_a_success_dependency() {
        assert!(TaskState::Succeeded.is_satisfied());
        assert!(!TaskState::Failed.is_satisfied());
        assert!(!TaskState::Running.is_satisfied());
    }

    #[test]
    fn terminal_states_are_classified() {
        assert!(TaskState::Succeeded.is_terminal());
        assert!(TaskState::Failed.is_terminal());
        assert!(TaskState::Cancelled.is_terminal());
        assert!(!TaskState::Blocked.is_terminal());
        assert!(!TaskState::Interrupted.is_terminal());
    }
}
