// دليل الأداة: ما قاسه تنفيذٌ تملكه POLARIS عبر بوابتها، لا ما قاله عنه أحد.
//
// الحدّ الذي يقيمه هذا الملف (البند 42/49): نتيجة الأداة ليست «محقَّقة» تلقائيًّا.
// هي دليل مقيس من نوع `TOOL_RESULT`، ويخضع لقاعدة التحقق مثل أي دليل آخر: يؤيّد
// أو يناقض، ويُعدّ مصدرًا واحدًا بسلالته، ولا يفي بقاعدة تطلب أثر اختبار.
//
// وما لا يدخل من هنا: نثر وكيل، وادّعاء نموذج، وناتج خادم MCP يسمّي نفسه دليلًا.
// المدخل الوحيد `record`، ولا يُستدعى إلا من بوابة الأدوات بعد تنفيذ فعليّ.

use std::collections::BTreeMap;
use std::sync::Mutex;

use crate::p03::evidence::EvidenceType;
use crate::p03::port::{EvidenceStance, TrustedEvidence, TrustedEvidenceSource};
use crate::p03::task::TaskType;

use super::adapter::{EvidenceNoteStance, ToolEvidenceNote};

/// ما تسجّله البوابة عن تنفيذ واحد ليصير دليلًا.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolEvidenceRecord {
    pub invocation_id: String,
    pub mission_id: String,
    pub task_id: String,
    pub tool_id: String,
    pub arguments_digest: String,
    pub result_digest: String,
    /// الأثر الذي وقع فعلًا، بنصّه المفرد.
    pub effects: Vec<String>,
    pub status: String,
    pub summary: String,
    pub measured_at: String,
    /// هل أيّد ما قِيس القضيّة؟ نداء ناجح لأداة تقول «مكسور» قياسٌ ضدّ الادّعاء.
    pub supports: bool,
    /// صنف ثقة الأداة. أداة MCP تبقى موسومة حتى داخل الدليل.
    pub trust_class: String,
    /// ملاحظة الدليل (Phase-05): نوعه المصدري وموقفه. غيابها سلوك Phase-04 كما هو.
    pub note: Option<ToolEvidenceNote>,
}

impl ToolEvidenceRecord {
    /// السلالة: التنفيذ نفسه. نداءان لأداة واحدة بحجج واحدة في مهمّة واحدة
    /// يتشاركان السلالة، فلا يُحسبان مصدرين مستقلّين.
    pub fn lineage_root(&self) -> String {
        format!("tool:{}#{}", self.tool_id, self.arguments_digest)
    }

    pub fn source_ref(&self) -> String {
        format!("tool:{}#{}", self.tool_id, self.invocation_id)
    }
}

/// مصدر أدلّة الأدوات. يعيش بجانب مصادر Phase-03 الأخرى ويخضع لقواعدها.
#[derive(Debug, Default)]
pub struct ToolEvidenceSource {
    by_task: Mutex<BTreeMap<(String, String), Vec<ToolEvidenceRecord>>>,
}

impl ToolEvidenceSource {
    pub fn new() -> Self {
        Self::default()
    }

    /// المدخل الموثوق الوحيد. تستدعيه البوابة بعد تنفيذ وقع فعلًا.
    ///
    /// النداء المرفوض لا يُسجَّل دليلًا: الرفض حقيقة عن السياسة لا قياسٌ عن العالم،
    /// ويعيش في سجل النشاط وفي التدقيق. تحويله إلى دليل يجعل «مُنع» تبدو «قِيست».
    pub fn record(&self, record: ToolEvidenceRecord) {
        if record.mission_id.is_empty() || record.task_id.is_empty() {
            return;
        }
        if let Ok(mut guard) = self.by_task.lock() {
            let entry = guard.entry((record.mission_id.clone(), record.task_id.clone())).or_default();
            // التنفيذ نفسه لا يُسجَّل مرّتين بمعرّفين مختلفين.
            if entry.iter().any(|r| r.invocation_id == record.invocation_id) {
                return;
            }
            entry.push(record);
        }
    }

    pub fn len(&self) -> usize {
        self.by_task.lock().map(|g| g.values().map(Vec::len).sum()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn for_task(&self, mission_id: &str, task_id: &str) -> Vec<ToolEvidenceRecord> {
        self.by_task
            .lock()
            .map(|g| g.get(&(mission_id.to_string(), task_id.to_string())).cloned().unwrap_or_default())
            .unwrap_or_default()
    }
}

impl TrustedEvidenceSource for ToolEvidenceSource {
    fn evidence_for(&self, mission_id: &str, task_id: &str, _task_type: TaskType) -> Vec<TrustedEvidence> {
        // العزل مزدوج كما في مصادر Phase-03: المهمّة ثم العقدة. دليل مهمّة أخرى
        // لا يُعاد هنا أصلًا، فلا يستطيع أن يحقّق ما لم يُقَس من أجله.
        let Ok(guard) = self.by_task.lock() else {
            return Vec::new();
        };
        let Some(records) = guard.get(&(mission_id.to_string(), task_id.to_string())) else {
            return Vec::new();
        };
        records
            .iter()
            .map(|record| TrustedEvidence {
                evidence_type: EvidenceType::ToolResult,
                producer: format!("polaris.tool/{}", record.tool_id),
                source_ref: record.source_ref(),
                summary: match &record.note {
                    Some(note) => format!("[{}] {} — {} [{}]", note.kind, record.status, record.summary, record.trust_class),
                    None => format!("{} — {} [{}]", record.status, record.summary, record.trust_class),
                },
                lineage: vec![record.lineage_root()],
                // البصمة كما قاستها البوابة من بايتات النتيجة، لا من ملخّصنا عنها.
                digest: record.result_digest.clone(),
                stance: match record.note.as_ref().map(|n| &n.stance) {
                    // فعلٌ وقع لا يؤيّد نتيجته ولا يناقضها: التنفيذ ليس تحقّقًا.
                    Some(EvidenceNoteStance::Neutral) => EvidenceStance::Neutral,
                    Some(EvidenceNoteStance::Observed(text)) => EvidenceStance::Observed(text.clone()),
                    None if record.supports => EvidenceStance::Supports,
                    None => EvidenceStance::Counters,
                },
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(invocation: &str, mission: &str, task: &str, supports: bool) -> ToolEvidenceRecord {
        ToolEvidenceRecord {
            invocation_id: invocation.into(),
            mission_id: mission.into(),
            task_id: task.into(),
            tool_id: "polaris.tool.audit.chain.verify".into(),
            arguments_digest: crate::digest::sha256_hex(b"{}"),
            result_digest: crate::digest::sha256_hex(b"AUDIT_CHAIN INTACT records=3"),
            effects: vec!["DATABASE_READ".into()],
            status: "SUCCEEDED".into(),
            summary: "the audit chain verified over 3 records".into(),
            measured_at: "2026-09-22T00:00:00Z".into(),
            supports,
            trust_class: "TRUSTED_RUNTIME".into(),
            note: None,
        }
    }

    #[test]
    fn a_recorded_tool_result_is_measured_evidence_of_its_own_type() {
        let source = ToolEvidenceSource::new();
        source.record(record("i1", "m1", "t1", true));
        let evidence = source.evidence_for("m1", "t1", TaskType::Build);
        assert_eq!(evidence.len(), 1);
        assert_eq!(evidence[0].evidence_type, EvidenceType::ToolResult);
        assert!(evidence[0].evidence_type.is_measured());
        assert_eq!(evidence[0].stance, EvidenceStance::Supports);
        assert!(evidence[0].producer.starts_with("polaris.tool/"));
    }

    #[test]
    fn a_tool_result_does_not_satisfy_a_rule_that_requires_a_test_artefact() {
        // الفارق مقصود: أداة عملت ليست اختبارًا جرى. القاعدة التي تطلب أثر اختبار
        // تبقى غير مستوفاة، وهذا هو الجواب الصادق.
        assert_ne!(EvidenceType::ToolResult, EvidenceType::TestResult);
        assert!(EvidenceType::ToolResult.is_measured());
        assert!(!EvidenceType::ToolResult.is_agent_output());
    }

    #[test]
    fn a_failing_measurement_counters_instead_of_supporting() {
        let source = ToolEvidenceSource::new();
        source.record(record("i1", "m1", "t1", false));
        assert_eq!(source.evidence_for("m1", "t1", TaskType::Build)[0].stance, EvidenceStance::Counters);
    }

    #[test]
    fn evidence_measured_for_one_task_or_mission_cannot_reach_another() {
        let source = ToolEvidenceSource::new();
        source.record(record("i1", "m1", "t1", true));
        assert!(source.evidence_for("m1", "t2", TaskType::Build).is_empty());
        assert!(source.evidence_for("m2", "t1", TaskType::Build).is_empty());
    }

    #[test]
    fn two_calls_with_the_same_arguments_share_one_lineage() {
        let source = ToolEvidenceSource::new();
        source.record(record("i1", "m1", "t1", true));
        source.record(record("i2", "m1", "t1", true));
        let evidence = source.evidence_for("m1", "t1", TaskType::Build);
        assert_eq!(evidence.len(), 2);
        assert_eq!(evidence[0].lineage, evidence[1].lineage, "two calls of one tool became two sources");
    }

    #[test]
    fn one_execution_is_never_recorded_twice() {
        let source = ToolEvidenceSource::new();
        source.record(record("i1", "m1", "t1", true));
        source.record(record("i1", "m1", "t1", true));
        assert_eq!(source.len(), 1);
    }

    #[test]
    fn a_record_without_a_task_is_refused_rather_than_stored_loose() {
        let source = ToolEvidenceSource::new();
        source.record(record("i1", "m1", "", true));
        source.record(record("i2", "", "t1", true));
        assert!(source.is_empty());
    }
}
