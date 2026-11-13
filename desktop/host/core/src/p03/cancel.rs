// إلغاء المهمّة أثناء الطيران.
//
// العيب الذي يغلقه هذا الملف: كان الإلغاء يمنع جدولةً جديدة ولا يوقف ما هو قائم.
// نداء نموذج بدأ يبقى جاريًا، وأداة بدأت تبقى جارية، فيستمر الإنفاق والأثر بعد أن
// قال المالك «قف».
//
// ما يفعله الإلغاء الآن، بالترتيب:
//   ١ — يرفع رمز إلغاء المهمّة، فيلاحظه زمن التشغيل قبل كل خطوة تالية.
//   ٢ — يُلغي كل استدعاء نموذج مسجَّل لهذه المهمّة عبر مسار Phase-02 نفسه.
//   ٣ — يرفع رمز الأدوات نفسه، فتُرفض الأداة التالية وتُقطع الجارية.
// ولا تبقى عملية يتيمة: التسجيل يُزال حين ينتهي التشغيل، نجح أو أُلغي.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use polaris_host_providers::net::CancelToken;

thread_local! {
    /// خطوة الخيط الجاري (E4): حين تجري نداءات تنفيذ أولى لعدّة خطوات معًا، لكل خيط خطوته، فلا تكفي الخانة المشتركة.
    static THREAD_STEP: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

/// يُجري `f` وخطوته معلنة لهذا الخيط وحده؛ النداء الذي يبدأ داخله يُنسب إليها.
pub fn with_thread_step<T>(step: &str, f: impl FnOnce() -> T) -> T {
    THREAD_STEP.with(|cell| *cell.borrow_mut() = Some(step.to_string()));
    let out = f();
    THREAD_STEP.with(|cell| *cell.borrow_mut() = None);
    out
}

fn thread_step() -> Option<String> {
    THREAD_STEP.with(|cell| cell.borrow().clone())
}

/// ما يُسجَّل عن تشغيل قائم.
#[derive(Clone)]
pub struct MissionRunHandle {
    pub mission_id: String,
    /// رمز واحد يتشاركه زمن التشغيل وبوابة الأدوات.
    pub token: CancelToken,
    /// جلسة المستدعي، كما ختمها النقل. الإلغاء يمرّ بها فلا تُلغي جلسةٌ عملَ أخرى.
    pub session: String,
    /// معرّفات استدعاءات النموذج القائمة لهذه المهمّة.
    pub invocations: Arc<Mutex<Vec<String>>>,
    /// بوّابة الحسم (Phase-08): تفصل «قُبل الإلغاء» عن «حُسمت الحالة النهائية» بقفل واحد،
    /// فلا يُقال للمستخدم «أُلغيت» ثم تُحفظ حالةٌ أخرى.
    pub gate: RunGate,
    /// الخطوة الجارية الآن (معرّف العقدة)، يضعها زمن التشغيل (خطة 2026-10-05، A2): بها يُنسب كل نداء نموذج إلى خطوته.
    pub step: Arc<Mutex<Option<String>>>,
    /// خطوة كل استدعاء بدأ في خيط أعلن خطوته (E4). ما ليس هنا يُنسب إلى الخانة المشتركة.
    pub pinned_steps: Arc<Mutex<Vec<(String, String)>>>,
}

/// ما تحمله بوّابة الحسم: هل حُسمت الحالة النهائية، وبأيّ حالة، ومتى قُبل الإلغاء.
#[derive(Debug, Default)]
struct GateState {
    decided: Option<&'static str>,
    cancel_accepted_at_ms: Option<u64>,
}

/// بوّابة حسم تشغيل واحد. الإلغاء يُقبل ما دامت الحالة لم تُحسم؛ وحين تُحسم يُغلق الباب
/// فيعود أي إلغاء لاحق بالحالة المحسومة نفسها بدل أن يُعلن إلغاءً لم يقع.
#[derive(Clone, Debug, Default)]
pub struct RunGate(Arc<Mutex<GateState>>);

/// نتيجة محاولة قبول إلغاء عند البوّابة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateAdmission {
    /// قُبل الإلغاء: كل ما يلي من نتائج عادية لا يغيّر الحالة إلى فشل.
    Accepted,
    /// الحالة حُسمت قبل وصول الإلغاء؛ تُعاد كما هي.
    AlreadyDecided(&'static str),
}

impl RunGate {
    /// يحاول قبول إلغاء: يرفع الرمز داخل القفل نفسه الذي يُحسم فيه المصير.
    pub fn admit_cancel(&self, token: &CancelToken, now_ms: u64) -> GateAdmission {
        let Ok(mut state) = self.0.lock() else { return GateAdmission::AlreadyDecided("UNKNOWN") };
        if let Some(decided) = state.decided {
            return GateAdmission::AlreadyDecided(decided);
        }
        token.cancel();
        state.cancel_accepted_at_ms.get_or_insert(now_ms);
        GateAdmission::Accepted
    }

    /// يحسم الحالة النهائية. `decide` يرى هل قُبل إلغاء قبل هذه اللحظة، ويعيد الحالة. بعد
    /// الحسم لا يُقبل إلغاء. استدعاء ثانٍ يعيد الحسم الأول ولا يغيّره.
    pub fn decide(&self, token: &CancelToken, decide: impl FnOnce(bool) -> &'static str) -> &'static str {
        let Ok(mut state) = self.0.lock() else { return decide(token.is_cancelled()) };
        if let Some(decided) = state.decided {
            return decided;
        }
        let cancelled = state.cancel_accepted_at_ms.is_some() || token.is_cancelled();
        let outcome = decide(cancelled);
        state.decided = Some(outcome);
        outcome
    }

    /// متى قُبل الإلغاء (بتوقيت زمن التشغيل)، إن قُبل.
    pub fn cancel_accepted_at_ms(&self) -> Option<u64> {
        self.0.lock().ok().and_then(|s| s.cancel_accepted_at_ms)
    }

    pub fn decided(&self) -> Option<&'static str> {
        self.0.lock().ok().and_then(|s| s.decided)
    }
}

impl MissionRunHandle {
    /// يسجّل استدعاء نموذج بدأ. يُستدعى من محوّل الإنتاج قبل النداء.
    pub fn note_invocation(&self, invocation_id: &str) {
        if let Ok(mut guard) = self.invocations.lock() {
            guard.push(invocation_id.to_string());
        }
        if let (Some(step), Ok(mut pinned)) = (thread_step(), self.pinned_steps.lock()) {
            pinned.push((invocation_id.to_string(), step));
        }
    }

    /// يزيل استدعاءً انتهى. لا يبقى معرّف ميت يُلغى لاحقًا بلا معنى.
    pub fn forget_invocation(&self, invocation_id: &str) {
        if let Ok(mut guard) = self.invocations.lock() {
            guard.retain(|id| id != invocation_id);
        }
        if let Ok(mut pinned) = self.pinned_steps.lock() {
            pinned.retain(|(id, _)| id != invocation_id);
        }
    }

    pub fn live_invocations(&self) -> Vec<String> {
        self.invocations.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }
}

/// حكم طلب إلغاء.
pub enum CancelArbitration {
    Accepted(MissionRunHandle),
    AlreadyDecided(&'static str),
    NotRunning,
}

/// سجل التشغيلات القائمة. مالك واحد لكل مهمّة (البند 142).
#[derive(Default)]
pub struct MissionCancellation {
    runs: Mutex<BTreeMap<String, MissionRunHandle>>,
    /// مهامّ حجزت مكانًا ولم تبدأ تشغيلها بعد (حدّ المهامّ المتزامنة، 2026-11-13). يُعدّ مع القائمة تحت القفل نفسه
    /// فلا تأخذ مهمّتان منتظرتان المكان الأخير معًا.
    reserved: Mutex<std::collections::BTreeSet<String>>,
}

impl MissionCancellation {
    pub fn new() -> Self {
        Self::default()
    }

    /// يبدأ تسجيل تشغيل. تشغيل سابق بالمعرّف نفسه يُلغى أولًا: مالك واحد لا اثنان.
    pub fn begin(&self, mission_id: &str, session: &str) -> MissionRunHandle {
        let handle = MissionRunHandle {
            mission_id: mission_id.to_string(),
            token: CancelToken::new(),
            session: session.to_string(),
            invocations: Arc::new(Mutex::new(Vec::new())),
            gate: RunGate::default(),
            pinned_steps: Arc::new(Mutex::new(Vec::new())),
            step: Arc::new(Mutex::new(None)),
        };
        if let Ok(mut runs) = self.runs.lock() {
            if let Some(previous) = runs.insert(mission_id.to_string(), handle.clone()) {
                previous.token.cancel();
            }
            // الحجز صار تشغيلًا. القفلان بالترتيب نفسه في كل مكان (runs ثم reserved).
            if let Ok(mut reserved) = self.reserved.lock() {
                reserved.remove(mission_id);
            }
        }
        handle
    }

    /// يحجز مكانًا للمهمّة إن كان القائم والمحجوز معًا دون `limit`. مهمّة تعمل أو محجوزة أصلًا تُقبل (إعادة تشغيلها
    /// تستبدل نفسها ولا تأخذ مكانًا ثانيًا).
    pub fn reserve(&self, mission_id: &str, limit: usize) -> bool {
        let Ok(runs) = self.runs.lock() else { return false };
        let Ok(mut reserved) = self.reserved.lock() else { return false };
        if runs.contains_key(mission_id) || reserved.contains(mission_id) {
            return true;
        }
        let pending = reserved.iter().filter(|id| !runs.contains_key(id.as_str())).count();
        if runs.len() + pending >= limit.max(1) {
            return false;
        }
        reserved.insert(mission_id.to_string());
        true
    }

    /// يحرّر حجزًا لم يصر تشغيلًا (البدء رُفض قبل أن يُسجَّل). لا يمسّ تشغيلًا قائمًا.
    pub fn release(&self, mission_id: &str) {
        if let Ok(mut reserved) = self.reserved.lock() {
            reserved.remove(mission_id);
        }
    }

    /// ينهي التسجيل. يُستدعى دائمًا عند نهاية التشغيل، حتى بعد الإلغاء.
    pub fn end(&self, mission_id: &str) {
        if let Ok(mut runs) = self.runs.lock() {
            runs.remove(mission_id);
        }
    }

    /// يرفع رمز الإلغاء ويعيد المقبض ليُلغى ما هو قائم. `None` يعني لا تشغيل الآن.
    /// تشغيلٌ حُسمت حالته قبل الإلغاء لا يُلغى: يعيد المقبض مع الحالة المحسومة عبر `arbitrate`.
    pub fn cancel(&self, mission_id: &str) -> Option<MissionRunHandle> {
        match self.arbitrate(mission_id, 0) {
            CancelArbitration::Accepted(handle) => Some(handle),
            _ => None,
        }
    }

    /// يحكم في طلب إلغاء: مقبول، أو وصل بعد حسم الحالة، أو لا تشغيل.
    pub fn arbitrate(&self, mission_id: &str, now_ms: u64) -> CancelArbitration {
        let Some(handle) = self.runs.lock().ok().and_then(|runs| runs.get(mission_id).cloned()) else {
            return CancelArbitration::NotRunning;
        };
        match handle.gate.admit_cancel(&handle.token, now_ms) {
            GateAdmission::Accepted => CancelArbitration::Accepted(handle),
            GateAdmission::AlreadyDecided(state) => CancelArbitration::AlreadyDecided(state),
        }
    }

    pub fn is_running(&self, mission_id: &str) -> bool {
        self.runs.lock().map(|runs| runs.contains_key(mission_id)).unwrap_or(false)
    }

    /// عدد التشغيلات القائمة. يُقرأ في القياس لإثبات ألّا عملية يتيمة.
    pub fn running_count(&self) -> usize {
        self.runs.lock().map(|runs| runs.len()).unwrap_or(0)
    }

    /// المهمّة التي سجّلت استدعاء نموذج قائمًا (Phase-06: نسبة الاستعمال والميزانية إلى
    /// مهمّتها). قراءة فقط: لا تمنح شيئًا ولا تغيّر تشغيلًا.
    /// الخطوة التي كانت تجري حين بدأ هذا الاستدعاء (A2). `None` لنداء خارج الخطوات (التخطيط، والردّ) أو لتشغيل منتهٍ.
    pub fn step_of_invocation(&self, invocation_id: &str) -> Option<String> {
        let runs = self.runs.lock().ok()?;
        let run = runs.values().find(|run| run.live_invocations().iter().any(|id| id == invocation_id))?;
        let pinned = run.pinned_steps.lock().ok().and_then(|p| p.iter().find(|(id, _)| id == invocation_id).map(|(_, s)| s.clone()));
        if pinned.is_some() {
            return pinned;
        }
        let slot = run.step.clone();
        drop(runs);
        let step = slot.lock().ok()?.clone();
        step
    }

    pub fn mission_of_invocation(&self, invocation_id: &str) -> Option<String> {
        let runs = self.runs.lock().ok()?;
        runs.values().find(|run| run.live_invocations().iter().any(|id| id == invocation_id)).map(|run| run.mission_id.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_run_is_registered_and_then_forgotten() {
        let registry = MissionCancellation::new();
        assert_eq!(registry.running_count(), 0);
        let handle = registry.begin("m1", "s1");
        assert!(registry.is_running("m1"));
        assert!(!handle.is_cancelled());
        registry.end("m1");
        assert_eq!(registry.running_count(), 0);
    }

    #[test]
    fn cancelling_raises_the_token_the_runtime_shares() {
        let registry = MissionCancellation::new();
        let handle = registry.begin("m1", "s1");
        let cancelled = registry.cancel("m1").expect("the run is registered");
        assert!(cancelled.is_cancelled());
        // الرمز نفسه، لا نسخة أخرى: ما يراه زمن التشغيل هو ما رُفع.
        assert!(handle.is_cancelled());
        assert!(handle.token.is_cancelled());
    }

    #[test]
    fn cancelling_a_mission_that_is_not_running_changes_nothing() {
        let registry = MissionCancellation::new();
        assert!(registry.cancel("m1").is_none());
    }

    #[test]
    fn live_model_calls_are_tracked_so_they_can_be_cancelled_mid_flight() {
        let registry = MissionCancellation::new();
        let handle = registry.begin("m1", "s1");
        handle.note_invocation("i1");
        handle.note_invocation("i2");
        assert_eq!(handle.live_invocations(), vec!["i1".to_string(), "i2".to_string()]);
        handle.forget_invocation("i1");
        assert_eq!(handle.live_invocations(), vec!["i2".to_string()]);
    }

    #[test]
    fn a_second_run_of_one_mission_cancels_the_first_rather_than_running_beside_it() {
        let registry = MissionCancellation::new();
        let first = registry.begin("m1", "s1");
        let second = registry.begin("m1", "s1");
        assert!(first.is_cancelled(), "two runs of one mission were live at once");
        assert!(!second.is_cancelled());
        assert_eq!(registry.running_count(), 1);
    }

    #[test]
    fn a_cancel_accepted_before_the_decision_wins_and_one_after_it_is_refused() {
        let registry = MissionCancellation::new();
        let handle = registry.begin("m1", "s1");
        assert!(matches!(registry.arbitrate("m1", 10), CancelArbitration::Accepted(_)));
        // الحسم يرى الإلغاء المقبول، مهما كانت النتيجة العادية التي وصلت بعده.
        let decided = handle.gate.decide(&handle.token, |cancelled| if cancelled { "CANCELLED" } else { "FAILED" });
        assert_eq!(decided, "CANCELLED");
        assert_eq!(handle.gate.cancel_accepted_at_ms(), Some(10));
        // حسم ثانٍ لا يغيّر الأول.
        assert_eq!(handle.gate.decide(&handle.token, |_| "FAILED"), "CANCELLED");

        let other = registry.begin("m2", "s1");
        assert_eq!(other.gate.decide(&other.token, |c| if c { "CANCELLED" } else { "COMPLETED" }), "COMPLETED");
        // إلغاء بعد الحسم لا يُعلن إلغاءً لم يقع، ولا يرفع الرمز.
        assert!(matches!(registry.arbitrate("m2", 20), CancelArbitration::AlreadyDecided("COMPLETED")));
        assert!(!other.is_cancelled());
    }

    #[test]
    fn one_mission_cancellation_never_touches_another() {
        let registry = MissionCancellation::new();
        let a = registry.begin("m1", "s1");
        let b = registry.begin("m2", "s1");
        registry.cancel("m1");
        assert!(a.is_cancelled());
        assert!(!b.is_cancelled());
    }

#[cfg(test)]
mod reservation_tests {
    use super::MissionCancellation;

    /// 2026-11-13: ثلاث مهامّ معًا والحدّ 2. الثالثة تنتظر مكانًا ولا تُرفض، ولا تأخذ مهمّتان المكان الأخير معًا.
    #[test]
    fn a_third_mission_waits_for_a_slot_and_two_waiters_never_share_the_last_one() {
        let c = MissionCancellation::new();
        assert!(c.reserve("m1", 2));
        let _h1 = c.begin("m1", "s");
        assert!(c.reserve("m2", 2));
        assert!(!c.reserve("m3", 2), "a third mission took a slot past the limit");
        assert!(c.reserve("m2", 2), "a mission that already holds a slot is refused its own slot");
        let _h2 = c.begin("m2", "s");
        c.end("m1");
        assert!(c.reserve("m3", 2), "the freed slot was not given to the waiting mission");
        assert!(!c.reserve("m4", 2), "two waiters shared the last slot");
        c.release("m3");
        assert!(c.reserve("m4", 2), "a released reservation still held its slot");
        assert_eq!(c.running_count(), 1, "a reservation was counted as a running mission");
    }
}

}
