// ميزانية الأدوات: الحجز قبل التنفيذ، لكل بُعد.
//
// المبدأ نفسه الذي تقوم عليه ميزانية Phase-03 (البند 62): لا «سنتحقّق بعد التنفيذ».
// أداة ذات أثر خارجي لا يمكن التراجع عنها بعد أن تقع، فالفحص بعدها ليس فحصًا.
// كل بُعد يُحجز قبل النداء، ويُسوّى بعده بالزمن المقيس فعلًا.

use serde::{Deserialize, Serialize};

/// حدود استعمال الأدوات داخل مهمّة واحدة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolBudget {
    pub max_tool_calls: u32,
    pub max_tool_calls_per_task: u32,
    pub max_external_side_effects: u32,
    pub max_network_tool_calls: u32,
    pub max_tool_runtime_ms: u64,
}

impl ToolBudget {
    /// الحدّ المحافظ: هو الافتراضي، ولا يُختار «شيء معقول» صامتًا.
    pub const fn conservative() -> Self {
        Self {
            max_tool_calls: 16,
            max_tool_calls_per_task: 4,
            max_external_side_effects: 2,
            max_network_tool_calls: 8,
            max_tool_runtime_ms: 60_000,
        }
    }

    pub const fn balanced() -> Self {
        Self {
            max_tool_calls: 48,
            max_tool_calls_per_task: 8,
            max_external_side_effects: 6,
            max_network_tool_calls: 24,
            max_tool_runtime_ms: 180_000,
        }
    }

    /// ميزانية تمنع كل أداة. تُستعمل حين تُغلق الأدوات على مهمّة بعينها.
    pub const fn none() -> Self {
        Self {
            max_tool_calls: 0,
            max_tool_calls_per_task: 0,
            max_external_side_effects: 0,
            max_network_tool_calls: 0,
            max_tool_runtime_ms: 0,
        }
    }
}

impl Default for ToolBudget {
    fn default() -> Self {
        Self::conservative()
    }
}

/// بُعد الميزانية الذي استُنفد.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ToolBudgetDimension {
    ToolCalls,
    ToolCallsPerTask,
    ExternalSideEffects,
    NetworkToolCalls,
    ToolRuntimeMs,
}

impl ToolBudgetDimension {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ToolCalls => "TOOL_CALLS",
            Self::ToolCallsPerTask => "TOOL_CALLS_PER_TASK",
            Self::ExternalSideEffects => "EXTERNAL_SIDE_EFFECTS",
            Self::NetworkToolCalls => "NETWORK_TOOL_CALLS",
            Self::ToolRuntimeMs => "TOOL_RUNTIME_MS",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ToolBudgetDenied {
    pub dimension: ToolBudgetDimension,
    pub limit: u64,
    pub requested: u64,
}

/// ما استُهلك فعلًا.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolBudgetUsage {
    pub tool_calls: u32,
    pub external_side_effects: u32,
    pub network_tool_calls: u32,
    pub tool_runtime_ms: u64,
}

/// ما يصفه نداء واحد قبل تنفيذه: هل يلمس الشبكة، وهل يترك أثرًا خارجيًّا.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CallShape {
    pub network: bool,
    pub external: bool,
}

/// دفتر ميزانية أدوات مهمّة واحدة.
#[derive(Debug, Clone)]
pub struct ToolBudgetLedger {
    budget: ToolBudget,
    usage: ToolBudgetUsage,
    per_task: Vec<(String, u32)>,
}

impl ToolBudgetLedger {
    pub fn new(budget: ToolBudget) -> Self {
        Self { budget, usage: ToolBudgetUsage::default(), per_task: Vec::new() }
    }

    pub fn budget(&self) -> ToolBudget {
        self.budget
    }

    pub fn usage(&self) -> ToolBudgetUsage {
        self.usage
    }

    fn guard(dimension: ToolBudgetDimension, current: u64, add: u64, limit: u64) -> Result<(), ToolBudgetDenied> {
        if current.saturating_add(add) > limit {
            return Err(ToolBudgetDenied { dimension, limit, requested: current.saturating_add(add) });
        }
        Ok(())
    }

    fn task_count(&self, task_id: &str) -> u32 {
        self.per_task.iter().find(|(id, _)| id == task_id).map(|(_, n)| *n).unwrap_or(0)
    }

    /// يحجز نداء أداة واحدًا. كل بُعد يُفحص قبل أي تنفيذ، بما فيه الزمن المتبقّي:
    /// نداء يبدأ وقد نفد زمن الأدوات هو إنفاق غير مأذون حتى لو انتهى سريعًا.
    pub fn reserve(&mut self, task_id: &str, shape: CallShape) -> Result<(), ToolBudgetDenied> {
        Self::guard(ToolBudgetDimension::ToolCalls, self.usage.tool_calls as u64, 1, self.budget.max_tool_calls as u64)?;
        Self::guard(
            ToolBudgetDimension::ToolCallsPerTask,
            self.task_count(task_id) as u64,
            1,
            self.budget.max_tool_calls_per_task as u64,
        )?;
        if shape.network {
            Self::guard(
                ToolBudgetDimension::NetworkToolCalls,
                self.usage.network_tool_calls as u64,
                1,
                self.budget.max_network_tool_calls as u64,
            )?;
        }
        if shape.external {
            Self::guard(
                ToolBudgetDimension::ExternalSideEffects,
                self.usage.external_side_effects as u64,
                1,
                self.budget.max_external_side_effects as u64,
            )?;
        }
        Self::guard(ToolBudgetDimension::ToolRuntimeMs, self.usage.tool_runtime_ms, 0, self.budget.max_tool_runtime_ms)?;
        if self.usage.tool_runtime_ms >= self.budget.max_tool_runtime_ms {
            return Err(ToolBudgetDenied {
                dimension: ToolBudgetDimension::ToolRuntimeMs,
                limit: self.budget.max_tool_runtime_ms,
                requested: self.usage.tool_runtime_ms,
            });
        }
        self.usage.tool_calls += 1;
        if shape.network {
            self.usage.network_tool_calls += 1;
        }
        if shape.external {
            self.usage.external_side_effects += 1;
        }
        match self.per_task.iter_mut().find(|(id, _)| id == task_id) {
            Some((_, n)) => *n += 1,
            None => self.per_task.push((task_id.to_string(), 1)),
        }
        Ok(())
    }

    /// الزمن المتبقّي لنداء واحد. يصير مهلة النداء، فلا يتجاوز نداءٌ ميزانية المهمّة.
    pub fn remaining_runtime_ms(&self) -> u64 {
        self.budget.max_tool_runtime_ms.saturating_sub(self.usage.tool_runtime_ms)
    }

    /// يسجّل الزمن المقيس بعد النداء.
    pub fn settle(&mut self, elapsed_ms: u64) {
        self.usage.tool_runtime_ms = self.usage.tool_runtime_ms.saturating_add(elapsed_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small() -> ToolBudget {
        ToolBudget { max_tool_calls: 3, max_tool_calls_per_task: 2, max_external_side_effects: 1, max_network_tool_calls: 1, max_tool_runtime_ms: 100 }
    }

    const PLAIN: CallShape = CallShape { network: false, external: false };
    const NETWORK: CallShape = CallShape { network: true, external: false };
    const EXTERNAL: CallShape = CallShape { network: false, external: true };

    #[test]
    fn the_total_call_budget_is_reserved_before_the_call_and_exhausts() {
        let mut ledger = ToolBudgetLedger::new(small());
        ledger.reserve("t1", PLAIN).unwrap();
        ledger.reserve("t1", PLAIN).unwrap();
        ledger.reserve("t2", PLAIN).unwrap();
        assert_eq!(ledger.reserve("t3", PLAIN).unwrap_err().dimension, ToolBudgetDimension::ToolCalls);
    }

    #[test]
    fn the_per_task_budget_binds_one_task_without_binding_the_others() {
        let mut ledger = ToolBudgetLedger::new(small());
        ledger.reserve("t1", PLAIN).unwrap();
        ledger.reserve("t1", PLAIN).unwrap();
        assert_eq!(ledger.reserve("t1", PLAIN).unwrap_err().dimension, ToolBudgetDimension::ToolCallsPerTask);
        // ومهمّة فرعية أخرى ما تزال ضمن حدّها.
        ledger.reserve("t2", PLAIN).unwrap();
    }

    #[test]
    fn network_and_external_calls_are_counted_in_their_own_dimensions() {
        let mut ledger = ToolBudgetLedger::new(small());
        ledger.reserve("t1", NETWORK).unwrap();
        assert_eq!(ledger.reserve("t2", NETWORK).unwrap_err().dimension, ToolBudgetDimension::NetworkToolCalls);
        let mut other = ToolBudgetLedger::new(small());
        other.reserve("t1", EXTERNAL).unwrap();
        assert_eq!(other.reserve("t2", EXTERNAL).unwrap_err().dimension, ToolBudgetDimension::ExternalSideEffects);
    }

    #[test]
    fn a_refused_reservation_spends_nothing() {
        let mut ledger = ToolBudgetLedger::new(small());
        ledger.reserve("t1", NETWORK).unwrap();
        assert!(ledger.reserve("t2", NETWORK).is_err());
        // النداء المرفوض لم يُحسب في العدّ الكلّي.
        assert_eq!(ledger.usage().tool_calls, 1);
        assert_eq!(ledger.usage().network_tool_calls, 1);
    }

    #[test]
    fn the_runtime_budget_stops_a_call_that_would_start_with_nothing_left() {
        let mut ledger = ToolBudgetLedger::new(small());
        ledger.reserve("t1", PLAIN).unwrap();
        ledger.settle(100);
        assert_eq!(ledger.remaining_runtime_ms(), 0);
        assert_eq!(ledger.reserve("t2", PLAIN).unwrap_err().dimension, ToolBudgetDimension::ToolRuntimeMs);
    }

    #[test]
    fn the_remaining_runtime_becomes_the_timeout_of_the_next_call() {
        let mut ledger = ToolBudgetLedger::new(small());
        ledger.reserve("t1", PLAIN).unwrap();
        ledger.settle(40);
        assert_eq!(ledger.remaining_runtime_ms(), 60);
    }

    #[test]
    fn a_zero_budget_refuses_every_tool() {
        let mut ledger = ToolBudgetLedger::new(ToolBudget::none());
        assert_eq!(ledger.reserve("t1", PLAIN).unwrap_err().dimension, ToolBudgetDimension::ToolCalls);
    }
}
