// مُشغّل مسابر مربوط بمهمّة: الطرف الذي يجعل مسار الدليل المقيس قابلًا للوصول فعلًا.
//
// المشكلة التي يحلّها: `TrustedTestEvidenceSource` يفهرس نتائجه بـ(مهمّة، عقدة)،
// ومعرّفات العُقد يصدرها وقت التشغيل أثناء التخطيط. فما من طريق لاستيعاب نتيجة
// قبل التشغيل بمعرّف عقدة لا يوجد بعد، وبعد التشغيل تكون المهمّة قد انتهت. أي أن
// المصدر الموثوق كان سليمًا ولا مدخل له في مسار المنتج.
//
// الحلّ: المسبار يُسجَّل للمهمّة لا للعقدة، ويُنفَّذ عند الطلب حين يسأل وقتُ التشغيل
// عن دليل عقدةٍ بعينها — فيكون معرّفها معروفًا لحظتئذٍ. ما يدخل هنا تنفيذٌ تملكه
// POLARIS وينتج نتيجة مقيسة؛ لا نصّ نموذج ولا ادّعاء وكيل ولا حمولة من العارض.
//
// الحدود التي لا تُخترق: النتيجة تمرّ عبر `TrustedTestEvidenceSource::ingest`
// نفسه، فتبقى كل قواعده سارية — العزل بالمهمّة والعقدة، والبصمة كما أنتجها
// المُنفِّذ، وفشل المسبار موقفه مضادّ لا مؤيّد.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use crate::time::now_rfc3339_utc;

use super::port::{TrustedEvidence, TrustedEvidenceSource};
use super::task::TaskType;
use super::trusted_test_evidence::{ProbeKind, ProbeOutcome, TestProbeResult, TrustedTestEvidenceSource};

/// ما ينتجه تنفيذ مسبار واحد.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProbeExecution {
    pub outcome: ProbeOutcome,
    /// ملخّص محدود لما أظهره التنفيذ. ليس نثر نموذج.
    pub detail: String,
    /// البايتات التي قِيست فعلًا، كما أنتجها التنفيذ. البصمة تُحسب عنها وحدها،
    /// فهوية الدليل هي ما قِيس لا ما قلناه عنه.
    pub measured_bytes: Vec<u8>,
}

/// مسبار ينفّذه POLARIS بنفسه على عقدة من عُقد مهمّة.
///
/// المنفّذون المشروعون: مُشغّل اختبارات المشروع، ومسبار تشغيل يقيس حالة مورد،
/// وأداة مطابقة. وليس منهم وكيل ولا نموذج ولا عارض.
pub trait TaskProbe: Send + Sync {
    /// معرّف ثابت للمسبار. يدخل هوية الدليل.
    fn probe_id(&self) -> &str;

    /// نوع الدليل الذي تستحقّه نتيجته.
    fn kind(&self) -> ProbeKind;

    /// هل يخصّ هذا المسبار عقدة من هذا النوع؟ مسبار اختبار لا يقيس عقدة تصميم.
    fn applies_to(&self, task_type: TaskType) -> bool;

    /// مرجع داخلي لما نُفِّذ. ليس عنوانًا يُجلب، وهو سلالة الدليل.
    fn source_ref(&self, mission_id: &str, task_id: &str) -> String;

    /// ينفّذ المسبار فعلًا ويعيد ما قاسه. تنفيذ حقيقي لا حكم مُسبق.
    fn execute(&self, mission_id: &str, task_id: &str) -> ProbeExecution;
}

/// مسابر مُسجَّلة لكل مهمّة، تُنفَّذ عند أول سؤال عن عقدة.
///
/// التسجيل يقع من طبقة أصلية موثوقة. مهمّة بلا مسابر تُعيد لا شيء، فتبقى
/// ادّعاءات وكلائها غير محقَّقة — وهو الجواب الصادق حين لا قياس.
#[derive(Default)]
pub struct MissionProbeRunner {
    registered: Mutex<BTreeMap<String, Vec<Arc<dyn TaskProbe>>>>,
    /// النتائج المُستوعَبة. كل قواعد المصدر الموثوق تُطبَّق هنا بلا استثناء.
    results: Mutex<TrustedTestEvidenceSource>,
    /// ما نُفِّذ سلفًا: (مهمّة|عقدة|مسبار). التنفيذ مرة واحدة لكل ثلاثية، فلا
    /// يتضاعف أثر جانبي ولا تُحسب السلالة نفسها مرّتين.
    executed: Mutex<BTreeSet<String>>,
}

impl std::fmt::Debug for MissionProbeRunner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MissionProbeRunner")
            .field("missions", &self.registered.lock().map(|g| g.len()).unwrap_or(0))
            .field("results", &self.results.lock().map(|g| g.len()).unwrap_or(0))
            .finish()
    }
}

impl MissionProbeRunner {
    pub fn new() -> Self {
        Self::default()
    }

    /// يسجّل مسبارًا لمهمّة. يُستدعى من كود أصلي موثوق وحده.
    pub fn register(&self, mission_id: &str, probe: Arc<dyn TaskProbe>) {
        if let Ok(mut guard) = self.registered.lock() {
            guard.entry(mission_id.to_string()).or_default().push(probe);
        }
    }

    /// عدد المسابر المُسجَّلة لمهمّة.
    pub fn registered_count(&self, mission_id: &str) -> usize {
        self.registered.lock().map(|g| g.get(mission_id).map_or(0, Vec::len)).unwrap_or(0)
    }

    /// عدد النتائج المُستوعَبة حتى الآن.
    pub fn measured_count(&self) -> usize {
        self.results.lock().map(|g| g.len()).unwrap_or(0)
    }

    /// ينفّذ ما لم يُنفَّذ بعد لهذه العقدة، ويستوعب نتائجه.
    fn execute_pending(&self, mission_id: &str, task_id: &str, task_type: TaskType) {
        let applicable: Vec<Arc<dyn TaskProbe>> = {
            let Ok(registered) = self.registered.lock() else { return };
            let Some(probes) = registered.get(mission_id) else { return };
            probes.iter().filter(|p| p.applies_to(task_type)).cloned().collect()
        };

        for probe in applicable {
            let key = format!("{mission_id}|{task_id}|{}", probe.probe_id());
            {
                let Ok(mut executed) = self.executed.lock() else { return };
                if !executed.insert(key) {
                    continue;
                }
            }
            let execution = probe.execute(mission_id, task_id);
            let result = TestProbeResult {
                probe_id: probe.probe_id().to_string(),
                mission_id: mission_id.to_string(),
                task_id: task_id.to_string(),
                kind: probe.kind(),
                outcome: execution.outcome,
                measured_at: now_rfc3339_utc(),
                source_ref: probe.source_ref(mission_id, task_id),
                detail: execution.detail,
                // البصمة عن البايتات المقيسة، لا عن ملخّصنا عنها.
                digest: TrustedTestEvidenceSource::digest_of(&execution.measured_bytes),
            };
            if let Ok(mut results) = self.results.lock() {
                // نتيجة مرفوضة لا تُترجَم إلى دليل ولا تُبتلع كنجاح: تبقى غائبة.
                let _ = results.ingest(result);
            }
        }
    }
}

/// نتيجة مسبار ناجح أو فاشل، كما يعبّر عنها منفّذ خارج هذه الوحدة.
pub fn outcome_of(passed: bool) -> ProbeOutcome {
    if passed {
        ProbeOutcome::Passed
    } else {
        ProbeOutcome::Failed
    }
}

impl TrustedEvidenceSource for MissionProbeRunner {
    fn evidence_for(&self, mission_id: &str, task_id: &str, task_type: TaskType) -> Vec<TrustedEvidence> {
        self.execute_pending(mission_id, task_id, task_type);
        match self.results.lock() {
            Ok(guard) => guard.evidence_for(mission_id, task_id, task_type),
            // قفل مسموم يعني «لا قياس»، لا «قياس ناجح».
            Err(_) => Vec::new(),
        }
    }
}

/// عدّة مصادر موثوقة خلف منفذ واحد. الترتيب محفوظ، والسلالة تبقى كما أنتجها كلٌّ.
pub struct ChainedTrustedEvidence {
    sources: Vec<Arc<dyn TrustedEvidenceSource>>,
}

impl ChainedTrustedEvidence {
    pub fn new(sources: Vec<Arc<dyn TrustedEvidenceSource>>) -> Self {
        Self { sources }
    }
}

impl TrustedEvidenceSource for ChainedTrustedEvidence {
    fn evidence_for(&self, mission_id: &str, task_id: &str, task_type: TaskType) -> Vec<TrustedEvidence> {
        let mut seen: BTreeSet<Vec<String>> = BTreeSet::new();
        let mut out: Vec<TrustedEvidence> = Vec::new();
        for source in &self.sources {
            for item in source.evidence_for(mission_id, task_id, task_type) {
                // السلالة نفسها من مصدرين ليست دليلين: تُحسب مرّة واحدة (البند 52).
                if seen.insert(item.lineage.clone()) {
                    out.push(item);
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p03::evidence::EvidenceType;
    use crate::p03::port::EvidenceStance;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct CountingProbe {
        id: String,
        outcome: ProbeOutcome,
        runs: AtomicUsize,
    }

    impl CountingProbe {
        fn new(id: &str, outcome: ProbeOutcome) -> Self {
            Self { id: id.into(), outcome, runs: AtomicUsize::new(0) }
        }
    }

    impl TaskProbe for CountingProbe {
        fn probe_id(&self) -> &str {
            &self.id
        }

        fn kind(&self) -> ProbeKind {
            ProbeKind::Test
        }

        fn applies_to(&self, task_type: TaskType) -> bool {
            matches!(task_type, TaskType::Build | TaskType::Test)
        }

        fn source_ref(&self, mission_id: &str, task_id: &str) -> String {
            format!("probe:{}#{mission_id}/{task_id}", self.id)
        }

        fn execute(&self, _mission_id: &str, task_id: &str) -> ProbeExecution {
            self.runs.fetch_add(1, Ordering::SeqCst);
            ProbeExecution {
                outcome: self.outcome,
                detail: "the probe ran".into(),
                measured_bytes: task_id.as_bytes().to_vec(),
            }
        }
    }

    #[test]
    fn a_probe_registered_for_a_mission_runs_for_a_task_id_issued_later() {
        let runner = MissionProbeRunner::new();
        let probe = Arc::new(CountingProbe::new("case-1", ProbeOutcome::Passed));
        runner.register("m1", probe.clone());
        // معرّف العقدة لم يكن معروفًا عند التسجيل، وهذا بيت القصيد.
        let out = runner.evidence_for("m1", "task-issued-at-runtime", TaskType::Build);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].evidence_type, EvidenceType::TestResult);
        assert_eq!(out[0].stance, EvidenceStance::Supports);
        assert_eq!(probe.runs.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn the_same_probe_and_task_execute_once_however_often_it_is_asked() {
        let runner = MissionProbeRunner::new();
        let probe = Arc::new(CountingProbe::new("case-1", ProbeOutcome::Passed));
        runner.register("m1", probe.clone());
        for _ in 0..4 {
            assert_eq!(runner.evidence_for("m1", "t1", TaskType::Build).len(), 1);
        }
        assert_eq!(probe.runs.load(Ordering::SeqCst), 1, "a probe with a side effect ran more than once");
    }

    #[test]
    fn a_failing_probe_is_measured_but_counters_the_claim() {
        let runner = MissionProbeRunner::new();
        runner.register("m1", Arc::new(CountingProbe::new("case-1", ProbeOutcome::Failed)));
        let out = runner.evidence_for("m1", "t1", TaskType::Test);
        assert!(out[0].evidence_type.is_measured());
        assert_eq!(out[0].stance, EvidenceStance::Counters, "a failing probe was treated as support");
    }

    #[test]
    fn probes_do_not_cross_missions_or_unrelated_task_types() {
        let runner = MissionProbeRunner::new();
        runner.register("m1", Arc::new(CountingProbe::new("case-1", ProbeOutcome::Passed)));
        assert!(runner.evidence_for("m2", "t1", TaskType::Build).is_empty(), "a probe crossed missions");
        assert!(runner.evidence_for("m1", "t1", TaskType::Design).is_empty(), "a probe ran for a task type it does not measure");
    }

    #[test]
    fn a_mission_without_probes_measures_nothing() {
        let runner = MissionProbeRunner::new();
        assert!(runner.evidence_for("m1", "t1", TaskType::Test).is_empty());
        assert_eq!(runner.measured_count(), 0);
    }

    #[test]
    fn chaining_two_sources_does_not_double_count_one_lineage() {
        let shared = Arc::new(MissionProbeRunner::new());
        shared.register("m1", Arc::new(CountingProbe::new("case-1", ProbeOutcome::Passed)));
        let chained = ChainedTrustedEvidence::new(vec![shared.clone(), shared.clone()]);
        assert_eq!(chained.evidence_for("m1", "t1", TaskType::Build).len(), 1, "one lineage was counted twice");
    }

    #[test]
    fn outcome_of_maps_a_real_result_not_a_wish() {
        assert_eq!(outcome_of(true), ProbeOutcome::Passed);
        assert_eq!(outcome_of(false), ProbeOutcome::Failed);
    }
}
