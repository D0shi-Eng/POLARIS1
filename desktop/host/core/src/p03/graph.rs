// رسم المهام: DAG، ومُتحقِّقه، ومُجدوِله الحتمي.
//
// الثوابت (البند 17): معرّفات فريدة، لا دورات، لا تبعية ذاتية، لا تبعية معلّقة،
// الأب ليس تبعية تلقائيًا، والتحوّر مُرقَّم. المجموعة الجاهزة حتمية: نفس الحالة
// تعطي نفس المجموعة، والترتيب ثابت (أولوية، ثم زمن الإنشاء، ثم المعرّف — البند 38).
// الوكيل يقترح تحوّرًا؛ لا يُحوِّر الحالة الموثوقة مباشرة (البند 18).

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::mission::MissionPriority;
use super::task::{DependencyKind, TaskNode, TaskState};

/// سبب رفض رسم غير صالح. مغلق ومحدّد.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "code", content = "detail")]
pub enum GraphError {
    DuplicateTask(String),
    SelfDependency(String),
    DanglingDependency { task: String, missing: String },
    Cycle(Vec<String>),
    TaskNotFound(String),
    RevisionConflict { expected: u32, found: u32 },
    TaskBudgetExceeded { max: u32, found: u32 },
}

/// رسم المهام لمهمّة واحدة. التحوّر يمرّ عبر `apply_mutation` وحده.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskGraph {
    pub mission_id: String,
    pub revision: u32,
    nodes: BTreeMap<String, TaskNode>,
    /// ترتيب الإدراج، لكسر تعادل زمن الإنشاء عند التساوي التام.
    order: Vec<String>,
}

impl TaskGraph {
    pub fn new(mission_id: impl Into<String>) -> Self {
        Self { mission_id: mission_id.into(), revision: 0, nodes: BTreeMap::new(), order: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.nodes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.nodes.is_empty()
    }

    pub fn get(&self, task_id: &str) -> Option<&TaskNode> {
        self.nodes.get(task_id)
    }

    pub fn nodes(&self) -> impl Iterator<Item = &TaskNode> {
        self.order.iter().filter_map(move |id| self.nodes.get(id))
    }

    /// يبني رسمًا من مجموعة عُقد ويتحقّق منه. البناء يفشل مغلقًا على أي انتهاك.
    pub fn build(mission_id: impl Into<String>, tasks: Vec<TaskNode>, max_tasks: u32) -> Result<Self, GraphError> {
        let mut graph = TaskGraph::new(mission_id);
        if tasks.len() as u32 > max_tasks {
            return Err(GraphError::TaskBudgetExceeded { max: max_tasks, found: tasks.len() as u32 });
        }
        for task in tasks {
            if graph.nodes.contains_key(&task.task_id) {
                return Err(GraphError::DuplicateTask(task.task_id));
            }
            graph.order.push(task.task_id.clone());
            graph.nodes.insert(task.task_id.clone(), task);
        }
        graph.validate()?;
        graph.revision = 1;
        Ok(graph)
    }

    /// يعيد بناء رسم محفوظ بتحوّره المخزَّن. يتحقّق كما يتحقّق البناء الأول:
    /// رسم مخزَّن غير صالح خطأ بيانات يُعلَن، لا حالة تُحمَّل بصمت.
    pub fn restore(mission_id: impl Into<String>, tasks: Vec<TaskNode>, revision: u32) -> Result<Self, GraphError> {
        let mut graph = TaskGraph::build(mission_id, tasks, u32::MAX)?;
        graph.revision = revision;
        Ok(graph)
    }

    /// يتحقّق من ثوابت الرسم كلها. لا يعدّل شيئًا.
    pub fn validate(&self) -> Result<(), GraphError> {
        // تبعية ذاتية ومعلّقة.
        for node in self.nodes.values() {
            for dep in &node.dependencies {
                if dep.task_id == node.task_id {
                    return Err(GraphError::SelfDependency(node.task_id.clone()));
                }
                if !self.nodes.contains_key(&dep.task_id) {
                    return Err(GraphError::DanglingDependency { task: node.task_id.clone(), missing: dep.task_id.clone() });
                }
            }
        }
        // دورة: كشف بترتيب طوبولوجي (كان). البحث بترتيب ثابت حتى تكون الرسالة حتمية.
        self.detect_cycle()?;
        Ok(())
    }

    /// كشف الدورات بخوارزمية كان. يعيد أسماء العُقد المتورّطة عند وجود دورة.
    fn detect_cycle(&self) -> Result<(), GraphError> {
        // الدرجة الداخلية لكل عقدة = عدد تبعياتها (حافة: تبعية -> مُعتمِد).
        let mut indegree: BTreeMap<&str, usize> =
            self.nodes.values().map(|n| (n.task_id.as_str(), n.dependencies.len())).collect();
        let mut queue: Vec<&str> = indegree.iter().filter(|(_, d)| **d == 0).map(|(k, _)| *k).collect();
        queue.sort_unstable();
        let mut visited = 0usize;
        let mut i = 0;
        while i < queue.len() {
            let current = queue[i];
            i += 1;
            visited += 1;
            // العُقد التي تعتمد على current تنقص درجتها الداخلية.
            let mut newly: Vec<&str> = Vec::new();
            for node in self.nodes.values() {
                if node.dependencies.iter().any(|d| d.task_id == current) {
                    let entry = indegree.get_mut(node.task_id.as_str()).unwrap();
                    *entry -= 1;
                    if *entry == 0 {
                        newly.push(node.task_id.as_str());
                    }
                }
            }
            newly.sort_unstable();
            queue.extend(newly);
        }
        if visited != self.nodes.len() {
            // العُقد الباقية بدرجة داخلية موجبة هي حلقة الدورة.
            let mut in_cycle: Vec<String> = indegree
                .iter()
                .filter(|(_, d)| **d > 0)
                .map(|(k, _)| k.to_string())
                .collect();
            in_cycle.sort_unstable();
            return Err(GraphError::Cycle(in_cycle));
        }
        Ok(())
    }

    /// المجموعة الجاهزة: العُقد التي استُوفيت كل تبعياتها وهي بعدُ PENDING/READY.
    /// حتمية: ترتيب ثابت بالأولوية ثم زمن الإنشاء ثم المعرّف.
    pub fn ready_set(&self, priority: &BTreeMap<String, MissionPriority>) -> Vec<String> {
        let mut ready: Vec<&TaskNode> = self
            .nodes
            .values()
            .filter(|n| matches!(n.state, TaskState::Pending | TaskState::Ready))
            .filter(|n| self.dependencies_satisfied(n))
            .collect();
        ready.sort_by(|a, b| {
            let pa = priority.get(&a.task_id).copied().unwrap_or(MissionPriority::Normal);
            let pb = priority.get(&b.task_id).copied().unwrap_or(MissionPriority::Normal);
            // أولوية أعلى أولًا (High > Normal > Low)، ثم ترتيب الإدراج، ثم المعرّف.
            pb.cmp(&pa)
                .then_with(|| self.insertion_index(&a.task_id).cmp(&self.insertion_index(&b.task_id)))
                .then_with(|| a.task_id.cmp(&b.task_id))
        });
        ready.into_iter().map(|n| n.task_id.clone()).collect()
    }

    fn insertion_index(&self, task_id: &str) -> usize {
        self.order.iter().position(|id| id == task_id).unwrap_or(usize::MAX)
    }

    fn dependencies_satisfied(&self, node: &TaskNode) -> bool {
        node.dependencies.iter().all(|dep| match self.nodes.get(&dep.task_id) {
            None => false,
            Some(target) => match dep.kind {
                DependencyKind::RequiresSuccess => target.state.is_satisfied(),
                DependencyKind::RequiresCompletion => target.state.is_terminal(),
            },
        })
    }

    /// أي تبعية مطلوبة فشلت؟ يُستعمل لحجب العقدة (البند 16).
    pub fn has_failed_success_dependency(&self, node: &TaskNode) -> bool {
        node.dependencies.iter().any(|dep| {
            dep.kind == DependencyKind::RequiresSuccess
                && self.nodes.get(&dep.task_id).is_some_and(|t| t.state == TaskState::Failed)
        })
    }

    /// تحديث حالة عقدة موجودة. لا يمسّ التبعيات، فلا يكسر الرسم.
    pub fn set_state(&mut self, task_id: &str, state: TaskState) -> Result<(), GraphError> {
        let node = self.nodes.get_mut(task_id).ok_or_else(|| GraphError::TaskNotFound(task_id.to_string()))?;
        node.state = state;
        node.version += 1;
        Ok(())
    }

    /// يغيّر عنوان عقدة (خطوة خطة كتبها الوكيل ثم أعاد صياغتها، ADR-039). لا يغيّر حالتها ولا تبعياتها.
    pub fn set_title(&mut self, task_id: &str, title: &str) {
        if let Some(node) = self.nodes.get_mut(task_id) {
            if node.title != title {
                node.title = title.to_string();
                node.version += 1;
            }
        }
    }

    /// يسجّل سبب فشل عقدة (محدودًا) ليُحفظ معها ويُقرأ لاحقًا؛ لا يغيّر حالتها.
    pub fn note_failure(&mut self, task_id: &str, reason: &str) {
        if let Some(node) = self.nodes.get_mut(task_id) {
            node.failure_reason = Some(reason.chars().take(400).collect());
        }
    }

    /// يزيد عدّاد المحاولات لعقدة. يُستعمل في دورة المراجعة/التعديل المحدودة.
    pub fn bump_attempt(&mut self, task_id: &str) -> Result<u32, GraphError> {
        let node = self.nodes.get_mut(task_id).ok_or_else(|| GraphError::TaskNotFound(task_id.to_string()))?;
        node.attempt += 1;
        node.version += 1;
        Ok(node.attempt)
    }

    pub fn assign(&mut self, task_id: &str, agent_id: impl Into<String>) -> Result<(), GraphError> {
        let node = self.nodes.get_mut(task_id).ok_or_else(|| GraphError::TaskNotFound(task_id.to_string()))?;
        node.assigned_agent_id = Some(agent_id.into());
        node.state = TaskState::Assigned;
        node.version += 1;
        Ok(())
    }

    /// يطبّق تحوّرًا مُقترحًا بعد فحص تفاؤلي للتحوّر. عقدة مكتملة لا تُغيَّر مدخلاتها.
    pub fn apply_mutation(&mut self, mutation: &GraphMutation, max_tasks: u32) -> Result<(), GraphError> {
        if mutation.base_revision != self.revision {
            return Err(GraphError::RevisionConflict { expected: self.revision, found: mutation.base_revision });
        }
        let projected = self.len() + mutation.added_tasks.len();
        if projected as u32 > max_tasks {
            return Err(GraphError::TaskBudgetExceeded { max: max_tasks, found: projected as u32 });
        }
        // نُطبّق على نسخة ثم نتحقّق: إمّا يُقبل التحوّر كاملًا أو يُرفض كاملًا.
        let mut trial = self.clone();
        for task in &mutation.added_tasks {
            if trial.nodes.contains_key(&task.task_id) {
                return Err(GraphError::DuplicateTask(task.task_id.clone()));
            }
            trial.order.push(task.task_id.clone());
            trial.nodes.insert(task.task_id.clone(), task.clone());
        }
        for edge in &mutation.added_dependencies {
            let node = trial
                .nodes
                .get_mut(&edge.dependent)
                .ok_or_else(|| GraphError::TaskNotFound(edge.dependent.clone()))?;
            node.dependencies.push(super::task::Dependency { task_id: edge.dependency.clone(), kind: edge.kind });
        }
        trial.validate()?;
        trial.revision = self.revision + 1;
        *self = trial;
        Ok(())
    }
}

/// حافة تبعية مُقترَحة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProposedEdge {
    pub dependent: String,
    pub dependency: String,
    pub kind: DependencyKind,
}

/// اقتراح تحوّر من وكيل. يحمل مصدره والتحوّر المطلوب فوق تحوّر أساس معلوم.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphMutation {
    pub proposal_id: String,
    pub agent_id: String,
    pub mission_id: String,
    pub base_revision: u32,
    pub added_tasks: Vec<TaskNode>,
    pub added_dependencies: Vec<ProposedEdge>,
    pub reason: String,
}

/// يجمع أولويات العُقد من قيمة واحدة (مبسّط: كلها بأولوية المهمّة).
pub fn uniform_priority(graph: &TaskGraph, priority: MissionPriority) -> BTreeMap<String, MissionPriority> {
    graph.nodes.keys().map(|k| (k.clone(), priority)).collect::<BTreeMap<_, _>>()
}

/// أسماء العُقد بترتيب طوبولوجي صالح، أو خطأ إن كانت هناك دورة. للعرض والاختبار.
pub fn topological_order(graph: &TaskGraph) -> Result<Vec<String>, GraphError> {
    graph.validate()?;
    let mut result: Vec<String> = Vec::new();
    let mut done: BTreeSet<String> = BTreeSet::new();
    while result.len() < graph.len() {
        let mut progressed = false;
        let mut candidates: Vec<&TaskNode> = graph
            .nodes
            .values()
            .filter(|n| !done.contains(&n.task_id))
            .filter(|n| n.dependencies.iter().all(|d| done.contains(&d.task_id)))
            .collect();
        candidates.sort_by(|a, b| a.task_id.cmp(&b.task_id));
        for node in candidates {
            done.insert(node.task_id.clone());
            result.push(node.task_id.clone());
            progressed = true;
        }
        if !progressed {
            return Err(GraphError::Cycle(vec![]));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::task::TaskType;

    fn task(id: &str, deps: &[(&str, DependencyKind)]) -> TaskNode {
        let mut t = TaskNode::new(id, "m1", id, "o", TaskType::Build);
        for (d, k) in deps {
            t = t.with_dependency(*d, *k);
        }
        t
    }

    #[test]
    fn a_single_task_graph_is_ready() {
        let graph = TaskGraph::build("m1", vec![task("a", &[])], 32).unwrap();
        let pr = uniform_priority(&graph, MissionPriority::Normal);
        assert_eq!(graph.ready_set(&pr), vec!["a"]);
    }

    #[test]
    fn a_linear_chain_releases_one_at_a_time() {
        let graph = TaskGraph::build(
            "m1",
            vec![
                task("a", &[]),
                task("b", &[("a", DependencyKind::RequiresSuccess)]),
                task("c", &[("b", DependencyKind::RequiresSuccess)]),
            ],
            32,
        )
        .unwrap();
        let pr = uniform_priority(&graph, MissionPriority::Normal);
        assert_eq!(graph.ready_set(&pr), vec!["a"]);
    }

    #[test]
    fn a_diamond_releases_two_after_the_root() {
        let mut graph = TaskGraph::build(
            "m1",
            vec![
                task("a", &[]),
                task("b", &[("a", DependencyKind::RequiresSuccess)]),
                task("c", &[("a", DependencyKind::RequiresSuccess)]),
                task("d", &[("b", DependencyKind::RequiresSuccess), ("c", DependencyKind::RequiresSuccess)]),
            ],
            32,
        )
        .unwrap();
        graph.set_state("a", TaskState::Succeeded).unwrap();
        let pr = uniform_priority(&graph, MissionPriority::Normal);
        assert_eq!(graph.ready_set(&pr), vec!["b", "c"]);
    }

    #[test]
    fn a_cycle_is_rejected() {
        let err = TaskGraph::build(
            "m1",
            vec![
                task("a", &[("b", DependencyKind::RequiresSuccess)]),
                task("b", &[("a", DependencyKind::RequiresSuccess)]),
            ],
            32,
        )
        .unwrap_err();
        assert!(matches!(err, GraphError::Cycle(_)), "{err:?}");
    }

    #[test]
    fn a_self_dependency_is_rejected() {
        let err = TaskGraph::build("m1", vec![task("a", &[("a", DependencyKind::RequiresSuccess)])], 32).unwrap_err();
        assert_eq!(err, GraphError::SelfDependency("a".into()));
    }

    #[test]
    fn a_dangling_dependency_is_rejected() {
        let err = TaskGraph::build("m1", vec![task("a", &[("ghost", DependencyKind::RequiresSuccess)])], 32).unwrap_err();
        assert_eq!(err, GraphError::DanglingDependency { task: "a".into(), missing: "ghost".into() });
    }

    #[test]
    fn a_duplicate_task_id_is_rejected() {
        let err = TaskGraph::build("m1", vec![task("a", &[]), task("a", &[])], 32).unwrap_err();
        assert_eq!(err, GraphError::DuplicateTask("a".into()));
    }

    #[test]
    fn the_task_budget_is_enforced_at_build() {
        let err = TaskGraph::build("m1", vec![task("a", &[]), task("b", &[])], 1).unwrap_err();
        assert_eq!(err, GraphError::TaskBudgetExceeded { max: 1, found: 2 });
    }

    #[test]
    fn a_failed_success_dependency_blocks_the_dependent() {
        let mut graph = TaskGraph::build(
            "m1",
            vec![task("a", &[]), task("b", &[("a", DependencyKind::RequiresSuccess)])],
            32,
        )
        .unwrap();
        graph.set_state("a", TaskState::Failed).unwrap();
        let b = graph.get("b").unwrap().clone();
        assert!(graph.has_failed_success_dependency(&b));
        let pr = uniform_priority(&graph, MissionPriority::Normal);
        assert!(!graph.ready_set(&pr).contains(&"b".to_string()), "b became ready despite a failed dependency");
    }

    #[test]
    fn a_completion_dependency_releases_on_failure() {
        let mut graph = TaskGraph::build(
            "m1",
            vec![task("a", &[]), task("b", &[("a", DependencyKind::RequiresCompletion)])],
            32,
        )
        .unwrap();
        graph.set_state("a", TaskState::Failed).unwrap();
        let pr = uniform_priority(&graph, MissionPriority::Normal);
        assert!(graph.ready_set(&pr).contains(&"b".to_string()), "a completion dependency did not release on failure");
    }

    #[test]
    fn the_ready_set_is_deterministic() {
        let graph = TaskGraph::build("m1", vec![task("c", &[]), task("a", &[]), task("b", &[])], 32).unwrap();
        let pr = uniform_priority(&graph, MissionPriority::Normal);
        let first = graph.ready_set(&pr);
        for _ in 0..20 {
            assert_eq!(graph.ready_set(&pr), first);
        }
        // ترتيب الإدراج يُحترم عند تساوي الأولوية.
        assert_eq!(first, vec!["c", "a", "b"]);
    }

    #[test]
    fn a_mutation_on_a_stale_revision_conflicts() {
        let mut graph = TaskGraph::build("m1", vec![task("a", &[])], 32).unwrap();
        let mutation = GraphMutation {
            proposal_id: "p1".into(),
            agent_id: "ag1".into(),
            mission_id: "m1".into(),
            base_revision: 0, // الرسم الآن عند 1.
            added_tasks: vec![task("b", &[])],
            added_dependencies: vec![],
            reason: "r".into(),
        };
        let err = graph.apply_mutation(&mutation, 32).unwrap_err();
        assert_eq!(err, GraphError::RevisionConflict { expected: 1, found: 0 });
    }

    #[test]
    fn a_valid_mutation_bumps_the_revision() {
        let mut graph = TaskGraph::build("m1", vec![task("a", &[])], 32).unwrap();
        let mutation = GraphMutation {
            proposal_id: "p1".into(),
            agent_id: "ag1".into(),
            mission_id: "m1".into(),
            base_revision: 1,
            added_tasks: vec![task("b", &[])],
            added_dependencies: vec![ProposedEdge { dependent: "b".into(), dependency: "a".into(), kind: DependencyKind::RequiresSuccess }],
            reason: "r".into(),
        };
        graph.apply_mutation(&mutation, 32).unwrap();
        assert_eq!(graph.revision, 2);
        assert_eq!(graph.len(), 2);
        assert_eq!(graph.get("b").unwrap().dependencies.len(), 1);
    }

    #[test]
    fn a_mutation_that_would_cycle_is_rejected_whole() {
        let mut graph = TaskGraph::build(
            "m1",
            vec![task("a", &[]), task("b", &[("a", DependencyKind::RequiresSuccess)])],
            32,
        )
        .unwrap();
        let revision_before = graph.revision;
        let len_before = graph.len();
        let mutation = GraphMutation {
            proposal_id: "p1".into(),
            agent_id: "ag1".into(),
            mission_id: "m1".into(),
            base_revision: revision_before,
            added_tasks: vec![],
            // a -> b موجودة؛ إضافة b -> a تُنشئ دورة.
            added_dependencies: vec![ProposedEdge { dependent: "a".into(), dependency: "b".into(), kind: DependencyKind::RequiresSuccess }],
            reason: "r".into(),
        };
        assert!(matches!(graph.apply_mutation(&mutation, 32), Err(GraphError::Cycle(_))));
        assert_eq!(graph.revision, revision_before, "revision changed on a rejected mutation");
        assert_eq!(graph.len(), len_before);
    }

    #[test]
    fn topological_order_is_valid_for_a_dag() {
        let graph = TaskGraph::build(
            "m1",
            vec![
                task("a", &[]),
                task("b", &[("a", DependencyKind::RequiresSuccess)]),
                task("c", &[("b", DependencyKind::RequiresSuccess)]),
            ],
            32,
        )
        .unwrap();
        assert_eq!(topological_order(&graph).unwrap(), vec!["a", "b", "c"]);
    }
}
