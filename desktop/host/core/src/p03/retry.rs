// سياسة الإخفاقات العابرة لمزوّد النموذج (Phase-08).
//
// العيب الذي يغلقه هذا الملف (قِيس في تشغيل Phase-08 الأصلي): انتهاء مهلة نداء نموذج محلي
// واحد، أو خطأ داخلي عابر من خادمه، كان يُقرأ «مخرجات غير صالحة»، فيُعاد النداء نفسه فورًا
// مع رسالة إصلاح JSON مضلِّلة، والخادم ما يزال مشغولًا بالطلب المتروك فيرفض خلال ثانية، ثم
// تُحجب المهمّة كلها. تسع مهامّ انتهت هكذا.
//
// ما يفعله الآن: الإخفاق العابر صنف مستقل عن عيب المخرجات. يُعاد النداء بعد انتظار محدود
// (يُقطع فورًا عند الإلغاء)، بعدد محاولات محدود لكل نداء ولكل مهمّة، وكل محاولة تُحجز من
// ميزانية النداءات نفسها. استنفاد المحاولات يُعلن «المزوّد غير متاح» صراحةً، لا نجاحًا ولا
// عيبَ مخرجات.

use std::time::{Duration, Instant};

use polaris_host_providers::net::CancelToken;

/// سياسة الإعادة. كل حدّ فيها صريح ومحدود.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransientPolicy {
    /// أقصى إعادة لنداء واحد بعد إخفاق عابر.
    pub max_retries_per_call: u32,
    /// أقصى إعادات في المهمّة كلها: مزوّد متعثّر باستمرار لا يستهلك المهمّة بإعادات.
    pub max_retries_per_mission: u32,
    /// الانتظار قبل كل إعادة، بالترتيب. آخر قيمة تتكرّر إن زادت المحاولات.
    pub backoff_ms: Vec<u64>,
}

impl TransientPolicy {
    /// لا إعادة: السلوك المغلق لتجهيزات Phase-03..07.
    pub fn none() -> Self {
        Self { max_retries_per_call: 0, max_retries_per_mission: 0, backoff_ms: Vec::new() }
    }

    /// سياسة المنتج: إعادتان للنداء، وست للمهمّة، بانتظار يسمح لخادم محلي بإنهاء طلب متروك.
    pub fn product() -> Self {
        Self { max_retries_per_call: 2, max_retries_per_mission: 6, backoff_ms: vec![20_000, 60_000] }
    }

    /// سياسة الاختبار: الحدود نفسها بلا انتظار حقيقي.
    pub fn immediate(max_retries_per_call: u32, max_retries_per_mission: u32) -> Self {
        Self { max_retries_per_call, max_retries_per_mission, backoff_ms: vec![0] }
    }

    pub fn delay_for(&self, attempt: u32) -> Duration {
        let index = (attempt as usize).min(self.backoff_ms.len().saturating_sub(1));
        Duration::from_millis(self.backoff_ms.get(index).copied().unwrap_or(0))
    }
}

/// عدّاد الإعادات في مهمّة واحدة.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TransientLedger {
    pub retries_used: u32,
    /// آخر رموز الإخفاق العابر، للتشخيص (محدودة).
    pub recent_codes: Vec<String>,
}

impl TransientLedger {
    /// هل تُسمح إعادة أخرى لهذا النداء؟ تُحسب من الحدّين معًا.
    pub fn allows(&self, policy: &TransientPolicy, attempts_for_call: u32) -> bool {
        attempts_for_call < policy.max_retries_per_call && self.retries_used < policy.max_retries_per_mission
    }

    pub fn record(&mut self, code: &str) {
        self.retries_used += 1;
        if self.recent_codes.len() >= 8 {
            self.recent_codes.remove(0);
        }
        self.recent_codes.push(code.chars().take(120).collect());
    }
}

/// الانتظار قُطع لأن المهمّة أُلغيت.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WaitCancelled;

/// ينتظر مدّة الإعادة بشرائح قصيرة. يعيد «خطأ» فور رفع الإلغاء: انتظارٌ لا يؤخّر «قف».
pub fn wait_unless_cancelled(delay: Duration, cancel: Option<&CancelToken>) -> Result<(), WaitCancelled> {
    let started = Instant::now();
    loop {
        if cancel.is_some_and(CancelToken::is_cancelled) {
            return Err(WaitCancelled);
        }
        let elapsed = started.elapsed();
        if elapsed >= delay {
            return Ok(());
        }
        std::thread::sleep((delay - elapsed).min(Duration::from_millis(200)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_are_bounded_per_call_and_per_mission() {
        let policy = TransientPolicy::immediate(2, 3);
        let mut ledger = TransientLedger::default();
        assert!(ledger.allows(&policy, 0));
        assert!(ledger.allows(&policy, 1));
        assert!(!ledger.allows(&policy, 2), "a third retry of one call was allowed");
        ledger.record("PROVIDER_TIMEOUT");
        ledger.record("PROVIDER_TIMEOUT");
        ledger.record("PROVIDER_INTERNAL_ERROR");
        assert!(!ledger.allows(&policy, 0), "the mission-wide retry limit was not enforced");
        assert_eq!(TransientPolicy::none().max_retries_per_call, 0);
    }

    #[test]
    fn the_backoff_repeats_its_last_step_and_a_cancel_ends_the_wait_at_once() {
        let policy = TransientPolicy::product();
        assert_eq!(policy.delay_for(0), Duration::from_millis(20_000));
        assert_eq!(policy.delay_for(5), Duration::from_millis(60_000));
        let token = CancelToken::new();
        token.cancel();
        let started = Instant::now();
        assert!(wait_unless_cancelled(Duration::from_secs(30), Some(&token)).is_err());
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(wait_unless_cancelled(Duration::from_millis(10), None).is_ok());
    }
}
