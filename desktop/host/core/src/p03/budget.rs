// دفتر الميزانية: الحجز قبل الإنفاق، لكل بُعد.
//
// المبدأ (البند 62): لا «سنتحقّق بعد التشغيل». نداء النموذج يحجز أولًا، والتفويض
// يحجز أولًا، وإنشاء المهمّة يتحقّق من الحدّ أولًا. الاستنفاد يحدث قبل أي عمل غير
// مأذون. الدفتر لا يعرف من أين تُصرف الموارد؛ يعرف الحدود والمستهلَك فقط.

use serde::Serialize;

use super::mission::MissionBudget;

/// بُعد الميزانية الذي استُنفد. مغلق ومطابق لأبعاد `MissionBudget`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BudgetDimension {
    WallClockMs,
    ModelCalls,
    InputTokens,
    OutputTokens,
    TotalTokens,
    Tasks,
    AgentInstances,
    ActiveAgents,
    ConcurrentModelCalls,
    Delegations,
    Retries,
    ReviewRounds,
    GraphRevisions,
}

impl BudgetDimension {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WallClockMs => "WALL_CLOCK_MS",
            Self::ModelCalls => "MODEL_CALLS",
            Self::InputTokens => "INPUT_TOKENS",
            Self::OutputTokens => "OUTPUT_TOKENS",
            Self::TotalTokens => "TOTAL_TOKENS",
            Self::Tasks => "TASKS",
            Self::AgentInstances => "AGENT_INSTANCES",
            Self::ActiveAgents => "ACTIVE_AGENTS",
            Self::ConcurrentModelCalls => "CONCURRENT_MODEL_CALLS",
            Self::Delegations => "DELEGATIONS",
            Self::Retries => "RETRIES",
            Self::ReviewRounds => "REVIEW_ROUNDS",
            Self::GraphRevisions => "GRAPH_REVISIONS",
        }
    }
}

/// رفض بسبب الميزانية: أي بُعد، وحدّه، وما طُلب.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct BudgetDenied {
    pub dimension: BudgetDimension,
    pub limit: u64,
    pub requested: u64,
}

/// الاستهلاك التراكمي لمهمّة: ما يُحفظ ويُستعاد عبر الاستئناف (R-07، 2026-10-12).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct BudgetUsage {
    pub model_calls: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub tasks: u64,
    pub agent_instances: u64,
    pub delegations: u64,
    pub retries: u64,
    pub review_rounds: u64,
    pub graph_revisions: u64,
}

/// دفتر ميزانية مهمّة واحدة. الأبعاد التراكمية تُستهلك ولا تُعاد؛ الأبعاد اللحظية
/// (الوكلاء النشطون، النداءات المتزامنة) تُحجز وتُحرَّر.
#[derive(Debug, Clone)]
pub struct BudgetLedger {
    budget: MissionBudget,
    started_at_ms: u64,
    // تراكمي.
    model_calls: u64,
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    tasks: u64,
    agent_instances: u64,
    delegations: u64,
    retries: u64,
    review_rounds: u64,
    graph_revisions: u64,
    // لحظي.
    active_agents: u64,
    concurrent_calls: u64,
}

impl BudgetLedger {
    pub fn new(budget: MissionBudget, started_at_ms: u64) -> Self {
        Self {
            budget,
            started_at_ms,
            model_calls: 0,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            tasks: 0,
            agent_instances: 0,
            delegations: 0,
            retries: 0,
            review_rounds: 0,
            graph_revisions: 0,
            active_agents: 0,
            concurrent_calls: 0,
        }
    }

    fn guard(dimension: BudgetDimension, current: u64, add: u64, limit: u64) -> Result<(), BudgetDenied> {
        if current.saturating_add(add) > limit {
            return Err(BudgetDenied { dimension, limit, requested: current.saturating_add(add) });
        }
        Ok(())
    }

    /// المهلة الزمنية: يتجاوزها إن مرّ أكثر من الحدّ منذ البدء.
    pub fn check_deadline(&self, now_ms: u64) -> Result<(), BudgetDenied> {
        let elapsed = now_ms.saturating_sub(self.started_at_ms);
        if elapsed > self.budget.max_wall_clock_ms {
            return Err(BudgetDenied {
                dimension: BudgetDimension::WallClockMs,
                limit: self.budget.max_wall_clock_ms,
                requested: elapsed,
            });
        }
        Ok(())
    }

    /// يحجز نداء نموذج: يفحص الحدّ الكلّي والتزامن معًا قبل الإنفاق.
    pub fn reserve_model_call(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::ModelCalls, self.model_calls, 1, self.budget.max_model_calls as u64)?;
        Self::guard(
            BudgetDimension::ConcurrentModelCalls,
            self.concurrent_calls,
            1,
            self.budget.max_concurrent_model_calls as u64,
        )?;
        self.model_calls += 1;
        self.concurrent_calls += 1;
        Ok(())
    }

    /// يُحرّر تزامن نداء لم يُنتج ردًّا (إخفاق عابر، مخرجات مشوّهة، إلغاء). النداء يبقى محسوبًا من
    /// الحدّ الكلّي؛ التزامن وحده يُعاد، وإلا تراكمت المحاولات الفاشلة «نداءات متزامنة» وهمية
    /// حتى يرفض الدفتر نداءً شرعيًّا (قِيس في MISSION-D بالتشغيل القانوني).
    pub fn abandon_model_call(&mut self) {
        self.concurrent_calls = self.concurrent_calls.saturating_sub(1);
    }

    /// يُحرّر تزامن نداء انتهى، ويحاسب رموزه فعليًّا. الرموز تُسجَّل أولًا ثم يُفحص الحدّ (D-7): النداء أُنفق عند
    /// المزوّد سواء تجاوز الحدّ أم لا، والرفض يوقف ما بعده ولا يمحو ما حدث.
    pub fn settle_model_call(&mut self, input_tokens: u64, output_tokens: u64) -> Result<(), BudgetDenied> {
        self.concurrent_calls = self.concurrent_calls.saturating_sub(1);
        let (input_before, output_before, total_before) = (self.input_tokens, self.output_tokens, self.total_tokens);
        self.input_tokens = input_before.saturating_add(input_tokens);
        self.output_tokens = output_before.saturating_add(output_tokens);
        self.total_tokens = total_before.saturating_add(input_tokens.saturating_add(output_tokens));
        Self::guard(BudgetDimension::InputTokens, input_before, input_tokens, self.budget.max_input_tokens)?;
        Self::guard(BudgetDimension::OutputTokens, output_before, output_tokens, self.budget.max_output_tokens)?;
        Self::guard(BudgetDimension::TotalTokens, total_before, input_tokens.saturating_add(output_tokens), self.budget.max_total_tokens)
    }

    pub fn reserve_task(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::Tasks, self.tasks, 1, self.budget.max_tasks as u64)?;
        self.tasks += 1;
        Ok(())
    }

    pub fn reserve_agent(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::AgentInstances, self.agent_instances, 1, self.budget.max_agent_instances as u64)?;
        self.agent_instances += 1;
        Ok(())
    }

    pub fn acquire_active_agent(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::ActiveAgents, self.active_agents, 1, self.budget.max_active_agents as u64)?;
        self.active_agents += 1;
        Ok(())
    }

    pub fn release_active_agent(&mut self) {
        self.active_agents = self.active_agents.saturating_sub(1);
    }

    pub fn reserve_delegation(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::Delegations, self.delegations, 1, self.budget.max_delegations as u64)?;
        self.delegations += 1;
        Ok(())
    }

    pub fn reserve_retry(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::Retries, self.retries, 1, self.budget.max_retries as u64)?;
        self.retries += 1;
        Ok(())
    }

    pub fn reserve_review_round(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::ReviewRounds, self.review_rounds, 1, self.budget.max_review_rounds as u64)?;
        self.review_rounds += 1;
        Ok(())
    }

    pub fn reserve_graph_revision(&mut self) -> Result<(), BudgetDenied> {
        Self::guard(BudgetDimension::GraphRevisions, self.graph_revisions, 1, self.budget.max_graph_revisions as u64)?;
        self.graph_revisions += 1;
        Ok(())
    }

    pub fn model_calls_used(&self) -> u64 {
        self.model_calls
    }

    /// الاستهلاك التراكمي كما هو الآن، ليُحفظ مع اللقطة (R-07). الأبعاد اللحظية (وكلاء نشطون، نداءات متزامنة) لا تُحفظ:
    /// هي حجوزات تخصّ عملية حيّة، وتُحرَّر حكمًا حين تنتهي العملية أو تنقطع.
    pub fn usage(&self) -> BudgetUsage {
        BudgetUsage {
            model_calls: self.model_calls,
            input_tokens: self.input_tokens,
            output_tokens: self.output_tokens,
            total_tokens: self.total_tokens,
            tasks: self.tasks,
            agent_instances: self.agent_instances,
            delegations: self.delegations,
            retries: self.retries,
            review_rounds: self.review_rounds,
            graph_revisions: self.graph_revisions,
        }
    }

    /// يستعيد الاستهلاك التراكمي من تشغيل سابق: الاستئناف لا يمنح المهمّة ميزانية جديدة (R-07). الحجوزات اللحظية تبدأ صفرًا.
    pub fn restore_usage(&mut self, used: &BudgetUsage) {
        self.model_calls = used.model_calls;
        self.input_tokens = used.input_tokens;
        self.output_tokens = used.output_tokens;
        self.total_tokens = used.total_tokens;
        self.tasks = used.tasks;
        self.agent_instances = used.agent_instances;
        self.delegations = used.delegations;
        self.retries = used.retries;
        self.review_rounds = used.review_rounds;
        self.graph_revisions = used.graph_revisions;
        self.active_agents = 0;
        self.concurrent_calls = 0;
    }

    /// الزمن المستهلك من حدّ الوقت حتى `now_ms`.
    pub fn elapsed_ms(&self, now_ms: u64) -> u64 {
        now_ms.saturating_sub(self.started_at_ms)
    }

    pub fn total_tokens_used(&self) -> u64 {
        self.total_tokens
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_budget() -> MissionBudget {
        MissionBudget {
            max_wall_clock_ms: 1_000,
            max_model_calls: 2,
            max_input_tokens: 100,
            max_output_tokens: 100,
            max_total_tokens: 150,
            max_tasks: 2,
            max_agent_instances: 2,
            max_active_agents: 1,
            max_concurrent_model_calls: 1,
            max_delegations: 1,
            max_delegation_depth: 3,
            max_retries: 1,
            max_review_rounds: 2,
            max_graph_revisions: 2,
            max_tool_calls: 2,
            max_tool_calls_per_task: 1,
            max_external_side_effects: 1,
            max_network_tool_calls: 1,
            max_tool_runtime_ms: 1_000,
        }
    }

    #[test]
    fn a_model_call_is_reserved_before_spending_and_exhausts() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        ledger.reserve_model_call().unwrap();
        ledger.settle_model_call(10, 10).unwrap();
        ledger.reserve_model_call().unwrap();
        ledger.settle_model_call(10, 10).unwrap();
        // النداء الثالث يتجاوز الحدّ قبل أي عمل.
        let err = ledger.reserve_model_call().unwrap_err();
        assert_eq!(err.dimension, BudgetDimension::ModelCalls);
    }

    #[test]
    fn concurrency_is_bounded_and_released() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        ledger.reserve_model_call().unwrap();
        // نداء متزامن ثانٍ مرفوض قبل تسوية الأول.
        assert_eq!(ledger.reserve_model_call().unwrap_err().dimension, BudgetDimension::ConcurrentModelCalls);
        ledger.settle_model_call(1, 1).unwrap();
        // بعد التسوية يُسمح بنداء آخر.
        ledger.reserve_model_call().unwrap();
    }

    #[test]
    fn the_token_budget_is_enforced() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        ledger.reserve_model_call().unwrap();
        let err = ledger.settle_model_call(200, 0).unwrap_err();
        assert_eq!(err.dimension, BudgetDimension::InputTokens);
    }

    #[test]
    fn the_total_token_budget_catches_the_sum() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        ledger.reserve_model_call().unwrap();
        // 90+90 يمرّان فرديًّا لكن مجموعهما 180 > 150.
        let err = ledger.settle_model_call(90, 90).unwrap_err();
        assert_eq!(err.dimension, BudgetDimension::TotalTokens);
    }

    /// QA 2026-10-15 (D-7): النداء الذي يتجاوز الحدّ أُنفق فعلًا عند المزوّد. الرفض يوقف ما بعده، لكن رموزه تُسجَّل،
    /// وإلا صار الدفتر أقلّ من الحقيقة في كل مسار يتجاهل الرفض (الردّ الختامي، والتلخيص، والتفويض).
    #[test]
    fn an_over_budget_call_is_still_recorded_in_the_ledger() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        ledger.reserve_model_call().unwrap();
        assert_eq!(ledger.settle_model_call(200, 5).unwrap_err().dimension, BudgetDimension::InputTokens);
        let used = ledger.usage();
        assert_eq!((used.input_tokens, used.output_tokens, used.total_tokens), (200, 5, 205), "the spent tokens were dropped");
        assert_eq!(ledger.concurrent_calls, 0);
    }

    #[test]
    fn the_deadline_is_enforced() {
        let ledger = BudgetLedger::new(small_budget(), 0);
        assert!(ledger.check_deadline(1_000).is_ok());
        assert_eq!(ledger.check_deadline(1_001).unwrap_err().dimension, BudgetDimension::WallClockMs);
    }

    #[test]
    fn a_failed_attempt_releases_its_concurrency_but_still_counts() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        for _ in 0..2 {
            ledger.reserve_model_call().unwrap();
            ledger.abandon_model_call();
        }
        assert_eq!(ledger.model_calls, 2, "a failed attempt must still count as a model call");
        assert_eq!(ledger.concurrent_calls, 0, "a failed attempt kept its concurrency slot");
    }

    #[test]
    fn active_agents_are_bounded_and_released() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        ledger.acquire_active_agent().unwrap();
        assert_eq!(ledger.acquire_active_agent().unwrap_err().dimension, BudgetDimension::ActiveAgents);
        ledger.release_active_agent();
        ledger.acquire_active_agent().unwrap();
    }

    #[test]
    fn delegations_retries_and_reviews_exhaust() {
        let mut ledger = BudgetLedger::new(small_budget(), 0);
        ledger.reserve_delegation().unwrap();
        assert_eq!(ledger.reserve_delegation().unwrap_err().dimension, BudgetDimension::Delegations);
        ledger.reserve_retry().unwrap();
        assert_eq!(ledger.reserve_retry().unwrap_err().dimension, BudgetDimension::Retries);
        ledger.reserve_review_round().unwrap();
        ledger.reserve_review_round().unwrap();
        assert_eq!(ledger.reserve_review_round().unwrap_err().dimension, BudgetDimension::ReviewRounds);
    }

    #[test]
    fn restored_usage_is_cumulative_and_instant_reservations_start_free() {
        let mut first = BudgetLedger::new(small_budget(), 0);
        first.reserve_model_call().unwrap();
        first.settle_model_call(10, 10).unwrap();
        first.acquire_active_agent().unwrap();
        let mut resumed = BudgetLedger::new(small_budget(), 0);
        resumed.restore_usage(&first.usage());
        resumed.reserve_model_call().unwrap();
        resumed.settle_model_call(1, 1).unwrap();
        assert_eq!(resumed.reserve_model_call().unwrap_err().dimension, BudgetDimension::ModelCalls, "a resume granted a fresh call budget");
        // الوكيل النشط في العملية السابقة لا يحجز مقعدًا في العملية الجديدة.
        resumed.acquire_active_agent().unwrap();
    }
}
