// مُنتِج أدلّة موثوق حقيقي: نتائج اختبار/مسبار ينفّذها POLARIS نفسه.
//
// هذا هو الطرف الآخر من طبقة الحقيقة. الوكيل يستطيع أن يقول «نجحت الاختبارات»؛
// ولا يستطيع أن يجعلها نجحت. ما يجعلها كذلك هو تنفيذ تملكه POLARIS ينتج نتيجة
// مهيكلة، تعبر حدًّا أصليًّا موثوقًا، فتصير دليلًا مقيسًا.
//
// ما لا يدخل من هنا أبدًا (وهو جوهر الأمر):
//   - نثر نموذج،
//   - ادّعاء وكيل،
//   - نصّ من العارض يقول «نجحت الاختبارات»،
//   - نصّ مستخدم حرّ،
//   - مخرجات مزوّد.
// المدخل الوحيد `ingest`، ولا عملية IPC تصل إليه، ولا رسالة وكيل تستدعيه.

use std::collections::BTreeMap;
use std::sync::Mutex;

use serde::Deserialize;

use crate::digest::sha256_hex;

use super::evidence::EvidenceType;
use super::port::{EvidenceStance, TrustedEvidence, TrustedEvidenceSource};
use super::task::TaskType;

/// نتيجة تنفيذ مسبار/اختبار. مفردات مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProbeOutcome {
    Passed,
    Failed,
    Errored,
}

impl ProbeOutcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Passed => "PASSED",
            Self::Failed => "FAILED",
            Self::Errored => "ERRORED",
        }
    }

    /// نتيجة ناجحة تؤيّد الادّعاء الإيجابي؛ وما عداها يناقضه.
    /// لولا هذا التمييز لأثبت الفشلُ النجاحَ لمجرّد أنه مقيس.
    fn stance(self) -> EvidenceStance {
        match self {
            Self::Passed => EvidenceStance::Supports,
            Self::Failed | Self::Errored => EvidenceStance::Counters,
        }
    }
}

/// ما يُنتجه المسبار: نوع الدليل الذي تستحقّه هذه النتيجة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProbeKind {
    /// تنفيذ حالة اختبار.
    Test,
    /// قياس وقت تشغيل (زمن، عدد، حالة مورد).
    Measurement,
}

impl ProbeKind {
    fn evidence_type(self) -> EvidenceType {
        match self {
            Self::Test => EvidenceType::TestResult,
            Self::Measurement => EvidenceType::RuntimeMeasurement,
        }
    }
}

/// نتيجة مسبار واحدة، مهيكلة. تُنتَج من تنفيذ تملكه POLARIS.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TestProbeResult {
    /// معرّف المسبار/الحالة كما يعرفه المُشغّل.
    pub probe_id: String,
    /// المهمّة التي تخصّها هذه النتيجة. العزل يبدأ من هنا.
    pub mission_id: String,
    /// العقدة التي تخصّها. نتيجة عقدة أخرى لا تحقّق هذه.
    pub task_id: String,
    pub kind: ProbeKind,
    pub outcome: ProbeOutcome,
    pub measured_at: String,
    /// مرجع داخلي لما نُفِّذ: `test:run-42#case-7`. ليس عنوانًا يُجلب.
    pub source_ref: String,
    /// ملخّص محدود عمّا أظهرته النتيجة.
    pub detail: String,
    /// بصمة بايتات النتيجة الأصلية كما أنتجها المُشغّل.
    pub digest: String,
}

/// سبب رفض نتيجة. مغلق.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrustedEvidenceError {
    /// الحقول التعريفية ناقصة، فلا هوية لما قِيس.
    Incomplete(&'static str),
    /// البصمة ليست بصمة SHA-256 سداسية.
    MalformedDigest,
    /// نتيجة بالمعرّف نفسه مُستوعَبة سلفًا بمحتوى مختلف.
    Conflict(String),
}

/// مصدر أدلّة موثوق مبنيّ على نتائج مسبار حقيقية.
#[derive(Debug, Default)]
pub struct TrustedTestEvidenceSource {
    /// النتائج المُستوعَبة، بمفتاح (مهمّة، عقدة).
    by_task: BTreeMap<(String, String), Vec<TestProbeResult>>,
    /// معرّفات المسابر المُستوعَبة، لكشف التكرار.
    seen: BTreeMap<String, String>,
}

impl TrustedTestEvidenceSource {
    pub fn new() -> Self {
        Self::default()
    }

    /// المدخل الموثوق الوحيد.
    ///
    /// يُستدعى من كود أصلي موثوق يملك التنفيذ: مُشغّل الاختبارات، أو أداة القياس،
    /// أو أدوات المطابقة. لا يصل إليه العارض ولا وكيل ولا مزوّد؛ ولا توجد عملية
    /// IPC تقبل دليلًا، فالمسار غير قابل للاستدعاء من خارج الحدّ الموثوق.
    pub fn ingest(&mut self, result: TestProbeResult) -> Result<(), TrustedEvidenceError> {
        if result.probe_id.trim().is_empty() {
            return Err(TrustedEvidenceError::Incomplete("probe_id"));
        }
        if result.mission_id.trim().is_empty() {
            return Err(TrustedEvidenceError::Incomplete("mission_id"));
        }
        if result.task_id.trim().is_empty() {
            return Err(TrustedEvidenceError::Incomplete("task_id"));
        }
        if result.source_ref.trim().is_empty() {
            return Err(TrustedEvidenceError::Incomplete("source_ref"));
        }
        if result.digest.len() != 64 || !result.digest.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(TrustedEvidenceError::MalformedDigest);
        }
        // نتيجة بالمعرّف نفسه وبصمة مختلفة تعارض: لا تُستبدل بصمت.
        let key = format!("{}|{}|{}", result.mission_id, result.task_id, result.probe_id);
        match self.seen.get(&key) {
            Some(existing) if existing != &result.digest => {
                return Err(TrustedEvidenceError::Conflict(result.probe_id.clone()))
            }
            Some(_) => return Ok(()),
            None => {}
        }
        self.seen.insert(key, result.digest.clone());
        self.by_task
            .entry((result.mission_id.clone(), result.task_id.clone()))
            .or_default()
            .push(result);
        Ok(())
    }

    /// يستوعب تقرير مسابر مهيكلًا أنتجته أدوات POLARIS.
    ///
    /// التفكيك صارم: حقل غير مُعلن يُرفض، فنثر لا يصير تقريرًا بالمصادفة.
    pub fn ingest_report(&mut self, json: &str) -> Result<usize, TrustedEvidenceError> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Report {
            tool: String,
            results: Vec<TestProbeResult>,
        }
        let report: Report =
            serde_json::from_str(json).map_err(|_| TrustedEvidenceError::Incomplete("probe report shape"))?;
        if report.tool.trim().is_empty() {
            return Err(TrustedEvidenceError::Incomplete("tool"));
        }
        let mut accepted = 0;
        for result in report.results {
            self.ingest(result)?;
            accepted += 1;
        }
        Ok(accepted)
    }

    /// عدد النتائج المُستوعَبة.
    pub fn len(&self) -> usize {
        self.by_task.values().map(Vec::len).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// بصمة محتوى نتيجة، كما يحسبها مُنتِجها. مُعين للمُشغّلات الموثوقة.
    pub fn digest_of(bytes: &[u8]) -> String {
        sha256_hex(bytes)
    }
}

impl TrustedEvidenceSource for TrustedTestEvidenceSource {
    fn evidence_for(&self, mission_id: &str, task_id: &str, _task_type: TaskType) -> Vec<TrustedEvidence> {
        // العزل مزدوج: المهمّة ثم العقدة. نتيجة مهمّة أخرى أو عقدة أخرى لا تُعاد
        // هنا أصلًا، فلا تستطيع أن تحقّق ما لم تُقَس من أجله.
        let Some(results) = self.by_task.get(&(mission_id.to_string(), task_id.to_string())) else {
            return Vec::new();
        };
        results
            .iter()
            .map(|r| TrustedEvidence {
                evidence_type: r.kind.evidence_type(),
                producer: format!("polaris.probe/{}", r.probe_id),
                source_ref: r.source_ref.clone(),
                summary: format!("{} — {}", r.outcome.as_str(), r.detail),
                // السلالة هي مرجع التنفيذ نفسه: نتيجتان من التنفيذ ذاته سلالة واحدة.
                lineage: vec![r.source_ref.clone()],
                digest: r.digest.clone(),
                stance: r.outcome.stance(),
            })
            .collect()
    }
}

/// غلاف قابل للمشاركة، ليملأه كودٌ أصليّ موثوق أثناء التشغيل.
///
/// هذا ما يربطه المضيف: المصدر موجود دائمًا، ويبقى فارغًا حتى ينفّذ شيءٌ نملكه
/// اختبارًا أو قياسًا فعليًّا. الفراغ جواب صادق — لا قياس ⇒ لا تحقّق.
#[derive(Debug, Default)]
pub struct SharedTrustedTestEvidence {
    inner: Mutex<TrustedTestEvidenceSource>,
}

impl SharedTrustedTestEvidence {
    pub fn new() -> Self {
        Self::default()
    }

    /// المدخل الموثوق. يُستدعى من طبقة أصلية تملك التنفيذ، لا من العارض ولا من وكيل.
    pub fn ingest(&self, result: TestProbeResult) -> Result<(), TrustedEvidenceError> {
        match self.inner.lock() {
            Ok(mut guard) => guard.ingest(result),
            Err(_) => Err(TrustedEvidenceError::Incomplete("trusted evidence lock")),
        }
    }

    /// يستوعب تقرير مسابر مهيكلًا أنتجته أدوات POLARIS.
    pub fn ingest_report(&self, json: &str) -> Result<usize, TrustedEvidenceError> {
        match self.inner.lock() {
            Ok(mut guard) => guard.ingest_report(json),
            Err(_) => Err(TrustedEvidenceError::Incomplete("trusted evidence lock")),
        }
    }

    pub fn len(&self) -> usize {
        self.inner.lock().map(|g| g.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl TrustedEvidenceSource for SharedTrustedTestEvidence {
    fn evidence_for(&self, mission_id: &str, task_id: &str, task_type: TaskType) -> Vec<TrustedEvidence> {
        // قفل مسموم لا يُترجم إلى دليل: الفشل هنا يعني «لا قياس»، لا «قياس ناجح».
        match self.inner.lock() {
            Ok(guard) => guard.evidence_for(mission_id, task_id, task_type),
            Err(_) => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn digest(seed: &str) -> String {
        sha256_hex(seed.as_bytes())
    }

    fn result(mission: &str, task: &str, outcome: ProbeOutcome) -> TestProbeResult {
        TestProbeResult {
            probe_id: format!("case-{}", task),
            mission_id: mission.into(),
            task_id: task.into(),
            kind: ProbeKind::Test,
            outcome,
            measured_at: "2026-01-01T00:00:00Z".into(),
            source_ref: format!("test:run-1#{task}"),
            detail: "the case ran".into(),
            digest: digest(task),
        }
    }

    #[test]
    fn a_passed_probe_becomes_measured_supporting_test_evidence() {
        let mut source = TrustedTestEvidenceSource::new();
        source.ingest(result("m1", "t1", ProbeOutcome::Passed)).unwrap();
        let out = source.evidence_for("m1", "t1", TaskType::Test);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].evidence_type, EvidenceType::TestResult);
        assert!(out[0].evidence_type.is_measured());
        assert_eq!(out[0].stance, EvidenceStance::Supports);
        assert_eq!(out[0].digest, digest("t1"), "the producer's digest was not preserved");
    }

    #[test]
    fn a_failed_probe_is_measured_but_counters_the_claim() {
        let mut source = TrustedTestEvidenceSource::new();
        source.ingest(result("m1", "t1", ProbeOutcome::Failed)).unwrap();
        let out = source.evidence_for("m1", "t1", TaskType::Test);
        assert_eq!(out[0].stance, EvidenceStance::Counters, "a failing test was treated as support");
        assert!(out[0].evidence_type.is_measured());
    }

    #[test]
    fn results_are_scoped_to_their_mission_and_task() {
        let mut source = TrustedTestEvidenceSource::new();
        source.ingest(result("m1", "t1", ProbeOutcome::Passed)).unwrap();
        assert!(source.evidence_for("m2", "t1", TaskType::Test).is_empty(), "evidence crossed missions");
        assert!(source.evidence_for("m1", "t2", TaskType::Test).is_empty(), "evidence crossed tasks");
    }

    #[test]
    fn an_incomplete_or_malformed_result_is_refused() {
        let mut source = TrustedTestEvidenceSource::new();
        let mut bad = result("m1", "t1", ProbeOutcome::Passed);
        bad.digest = "not-a-digest".into();
        assert_eq!(source.ingest(bad).unwrap_err(), TrustedEvidenceError::MalformedDigest);
        let mut bad = result("m1", "t1", ProbeOutcome::Passed);
        bad.mission_id = String::new();
        assert_eq!(source.ingest(bad).unwrap_err(), TrustedEvidenceError::Incomplete("mission_id"));
        assert!(source.is_empty());
    }

    #[test]
    fn the_same_probe_with_a_different_digest_conflicts() {
        let mut source = TrustedTestEvidenceSource::new();
        source.ingest(result("m1", "t1", ProbeOutcome::Passed)).unwrap();
        let mut changed = result("m1", "t1", ProbeOutcome::Passed);
        changed.digest = digest("something else");
        assert!(matches!(source.ingest(changed), Err(TrustedEvidenceError::Conflict(_))));
    }

    #[test]
    fn a_structured_report_is_ingested_but_prose_is_not() {
        let mut source = TrustedTestEvidenceSource::new();
        let report = serde_json::json!({
            "tool": "polaris.p03.probe",
            "results": [{
                "probe_id": "case-1",
                "mission_id": "m1",
                "task_id": "t1",
                "kind": "TEST",
                "outcome": "PASSED",
                "measured_at": "2026-01-01T00:00:00Z",
                "source_ref": "test:run-9#case-1",
                "detail": "ok",
                "digest": digest("case-1")
            }]
        })
        .to_string();
        assert_eq!(source.ingest_report(&report).unwrap(), 1);

        // نثر نموذج لا يصير تقريرًا.
        let mut source = TrustedTestEvidenceSource::new();
        assert!(source.ingest_report("All tests passed successfully!").is_err());
        // وتقرير بحقل غير مُعلن يُرفض كذلك.
        let sneaky = serde_json::json!({
            "tool": "t",
            "results": [],
            "claimed_by_agent": "tests passed"
        })
        .to_string();
        assert!(source.ingest_report(&sneaky).is_err(), "an undeclared field was accepted");
    }
}
