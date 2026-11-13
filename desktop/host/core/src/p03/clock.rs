// مصدرا الوقت والمعرّف لطبقة Phase-03، محقونان دائمًا.
//
// كل زمن وكل معرّف في وقت التشغيل يأتيان من هذين المنفذين لا من `SystemTime`
// مباشرةً. السبب واحد: الاختبار الحتمي (البند 137/138). التشغيل يستعمل ساعة النظام
// ومولّد UUID الحقيقي، والاختبار يحقن ساعة تتقدّم بخطوة ثابتة ومولّد تسلسلي، فلا
// يفشل اختبار إعادة تشغيل بسبب العشوائية.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// منفذ الوقت. يعيد طابعًا زمنيًا بصيغة العقد (RFC 3339 بتوقيت UTC).
pub trait Clock: Send + Sync {
    fn now_rfc3339(&self) -> String;
    /// لحظة يونكس بالميلي ثانية، لقياس المهلات دون النوم دقائق (البند 137).
    fn now_millis(&self) -> u64;
}

/// منفذ المعرّفات. البادئة توثيقية فقط؛ الشكل يبقى UUID مقبولًا في العقد.
pub trait IdSource: Send + Sync {
    fn new_id(&self) -> String;
}

/// ساعة التشغيل: تقرأ زمن النظام الحقيقي.
#[derive(Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_rfc3339(&self) -> String {
        crate::time::now_rfc3339_utc()
    }

    fn now_millis(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}

/// مصدر التشغيل: UUID v4 حقيقي.
#[derive(Default)]
pub struct UuidSource;

impl IdSource for UuidSource {
    fn new_id(&self) -> String {
        crate::ids::new_uuid_v4()
    }
}

/// ساعة اختبار تتقدّم بخطوة ثابتة عند كل قراءة. تبدأ من لحظة معلومة، فكل تشغيل
/// اختبار يعطي التسلسل الزمني نفسه.
pub struct FixedClock {
    start_millis: u64,
    step_millis: u64,
    ticks: AtomicU64,
}

impl FixedClock {
    pub fn new(start_millis: u64, step_millis: u64) -> Self {
        Self { start_millis, step_millis, ticks: AtomicU64::new(0) }
    }

    /// لحظة ابتدائية شائعة للاختبار: 2026-01-01T00:00:00Z، بخطوة ثانية واحدة.
    pub fn for_tests() -> Self {
        Self::new(1_767_225_600_000, 1_000)
    }
}

impl Clock for FixedClock {
    fn now_rfc3339(&self) -> String {
        crate::time::format_rfc3339_utc((self.now_millis() / 1_000) as i64)
    }

    fn now_millis(&self) -> u64 {
        let tick = self.ticks.fetch_add(1, Ordering::SeqCst);
        self.start_millis + tick * self.step_millis
    }
}

/// مصدر معرّفات تسلسلي حتمي، بشكل UUID صالح: `00000000-0000-4000-8000-<12 hex>`.
/// النسخة 4 والمتغيّر ثابتان حتى يقبله نمط العقد، والعدّاد يملأ الجزء الأخير.
pub struct SequenceSource {
    counter: AtomicU64,
}

impl SequenceSource {
    pub fn new() -> Self {
        Self::starting_at(1)
    }

    /// يبدأ العدّ من قيمة معلومة. يتيح فضاءات معرّفات حتمية ومتمايزة في اختبار
    /// يُنشئ أكثر من مهمّة: الحتمية تبقى، والتصادم يزول.
    pub fn starting_at(start: u64) -> Self {
        Self { counter: AtomicU64::new(start) }
    }
}

impl Default for SequenceSource {
    fn default() -> Self {
        Self::new()
    }
}

impl IdSource for SequenceSource {
    fn new_id(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::SeqCst);
        format!("00000000-0000-4000-8000-{n:012x}")
    }
}

/// حزمة المنفذين معًا، تُمرَّر إلى الخدمات فتحمل مصدرًا واحدًا للزمن والمعرّف.
#[derive(Clone)]
pub struct RuntimeClock {
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdSource>,
}

impl RuntimeClock {
    pub fn system() -> Self {
        Self { clock: Arc::new(SystemClock), ids: Arc::new(UuidSource) }
    }

    pub fn deterministic() -> Self {
        Self::deterministic_seeded(1)
    }

    /// حتمي بفضاء معرّفات يبدأ من `seed`. لمهامّ متعدّدة في اختبار واحد.
    pub fn deterministic_seeded(seed: u64) -> Self {
        Self { clock: Arc::new(FixedClock::for_tests()), ids: Arc::new(SequenceSource::starting_at(seed)) }
    }

    pub fn now(&self) -> String {
        self.clock.now_rfc3339()
    }

    pub fn now_millis(&self) -> u64 {
        self.clock.now_millis()
    }

    pub fn id(&self) -> String {
        self.ids.new_id()
    }

    /// طابع زمني للحظة معلومة بالميلي ثانية. يُستعمل حين يُحسب أجلٌ من الآن،
    /// فلا تُقرأ الساعة مرّتين ويختلف الرقمان (ساعة الاختبار تتقدّم عند كل قراءة).
    pub fn at_millis(&self, millis: u64) -> String {
        crate::time::format_rfc3339_utc((millis / 1_000) as i64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fixed_clock_advances_by_a_known_step() {
        let clock = FixedClock::new(1_000, 500);
        assert_eq!(clock.now_millis(), 1_000);
        assert_eq!(clock.now_millis(), 1_500);
        assert_eq!(clock.now_millis(), 2_000);
    }

    #[test]
    fn the_sequence_source_is_deterministic_and_uuid_shaped() {
        let src = SequenceSource::new();
        let first = src.new_id();
        let second = src.new_id();
        assert_eq!(first, "00000000-0000-4000-8000-000000000001");
        assert_ne!(first, second);
        // الشكل مقبول: نسخة 4 ومتغيّر 8.
        let parts: Vec<&str> = first.split('-').collect();
        assert_eq!(parts[2].as_bytes()[0], b'4');
        assert_eq!(parts[3].as_bytes()[0], b'8');
    }

    #[test]
    fn a_known_instant_formats_without_reading_the_clock_again() {
        let runtime = RuntimeClock::deterministic();
        let first = runtime.now_millis();
        // القراءة مرّة واحدة: التنسيق لا يحرّك الساعة، فلا ينجرف الأجل عن أساسه.
        assert_eq!(runtime.at_millis(first), runtime.at_millis(first));
        assert_ne!(runtime.at_millis(first), runtime.at_millis(first + 60_000));
    }

    #[test]
    fn the_deterministic_runtime_repeats_across_constructions() {
        let a = RuntimeClock::deterministic();
        let b = RuntimeClock::deterministic();
        assert_eq!(a.now(), b.now());
        assert_eq!(a.id(), b.id());
    }
}
