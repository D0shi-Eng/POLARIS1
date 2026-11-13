// حالة التشغيل التراكمية لمهمّة (R-07، تكليف الإصلاح 2026-10-12).
//
// العيب الذي تغلقه: كل استئناف كان يبني زمن تشغيل جديدًا بعدّادات صفرية وموعد جديد وعدّاد رفض فارغ وأعلام قاعدة الاثنين
// مطفأة، فيمنح المهمّة ميزانية جديدة، ويعيد فتح مسار أوقفه رفض متكرّر، وينسى أن سياقًا غير موثوق دخل المحادثة.
//
// ما يُحفظ هنا تراكمي: يُستهلك ولا يُعاد إلا بقرار مستخدم صريح (لا يوجد مسار كهذا في هذا البناء). وما لا يُحفظ عمدًا: الحجوزات
// اللحظية (وكيل نشط، نداء متزامن)، لأنها تخصّ عملية حيّة وتنتهي معها.
//
// الإثبات المحسوم يُحفظ معها: القراءة تعيد الحكم الذي حُسم عند الإنهاء بحواجزه، لا اشتقاقًا ثانيًا بلا حواجز (R-03).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::budget::BudgetUsage;
use super::completion::CompletionProof;

/// إصدار صيغة الحالة المحفوظة. صيغة أحدث من هذا البناء تُرفض عند القراءة بدل أن تُفهم خطأً.
pub const RUNTIME_STATE_FORMAT: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeState {
    pub format: u32,
    /// الاستهلاك التراكمي للميزانية.
    pub usage: BudgetUsage,
    /// الزمن الفعلي المستهلك من حدّ الوقت في التشغيلات السابقة (لا يُحسب زمن الانتظار بين تشغيلين).
    pub elapsed_ms: u64,
    /// رفضات كل نمط (الأداة وسبب الرفض).
    pub denial_counts: BTreeMap<String, u32>,
    /// قاعدة الاثنين: دخل سياقَ المهمّة محتوى غير موثوق، أو صارت بيانات حسّاسة في المتناول.
    pub untrusted_input: bool,
    pub sensitive_data: bool,
    /// دورات الحلقة الرئيسة ومرّات انتظار تحديد المعدّل، تراكميًّا.
    pub loop_turns: u32,
    pub rate_waits: u32,
    /// عدد التشغيلات التي جرت لهذه المهمّة.
    pub runs: u32,
    /// كتابات تتبّع (امتدادات) فشلت: لا توقف المهمّة لكنها لا تُخفى.
    pub telemetry_failures: u32,
    /// الإثبات كما حُسم عند آخر إنهاء، بحواجزه.
    pub proof: Option<CompletionProof>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            format: RUNTIME_STATE_FORMAT,
            usage: BudgetUsage::default(),
            elapsed_ms: 0,
            denial_counts: BTreeMap::new(),
            untrusted_input: false,
            sensitive_data: false,
            loop_turns: 0,
            rate_waits: 0,
            runs: 0,
            telemetry_failures: 0,
            proof: None,
        }
    }
}

impl RuntimeState {
    /// يقرأ حالة محفوظة. غيابها (مهمّة أقدم من v18) حالة فارغة؛ صيغة أحدث أو تالفة خطأ صريح لا حالة فارغة.
    pub fn parse(json: Option<&str>) -> Result<Self, String> {
        let Some(text) = json else { return Ok(Self::default()) };
        let state: Self = serde_json::from_str(text).map_err(|e| format!("runtime state is unreadable: {e}"))?;
        if state.format > RUNTIME_STATE_FORMAT {
            return Err(format!("runtime state format {} is newer than this build ({RUNTIME_STATE_FORMAT})", state.format));
        }
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_state_is_empty_and_a_newer_format_is_refused() {
        assert_eq!(RuntimeState::parse(None).unwrap(), RuntimeState::default());
        let newer = RuntimeState { format: RUNTIME_STATE_FORMAT + 1, ..RuntimeState::default() };
        assert!(RuntimeState::parse(Some(&serde_json::to_string(&newer).unwrap())).is_err());
        assert!(RuntimeState::parse(Some("not json")).is_err());
    }

    #[test]
    fn the_state_round_trips() {
        let mut state = RuntimeState::default();
        state.usage.model_calls = 7;
        state.denial_counts.insert("polaris.execution.command:POLICY_DENIED".into(), 2);
        state.untrusted_input = true;
        let back = RuntimeState::parse(Some(&serde_json::to_string(&state).unwrap())).unwrap();
        assert_eq!(back, state);
    }
}
