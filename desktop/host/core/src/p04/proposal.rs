// اقتراح أداة: مخرجات نموذج مهيكلة، لا أمر تنفيذ.
//
// النموذج يقترح، وزمن التشغيل الموثوق يقرّر (البند 22/66). ولذلك يحمل الاقتراح
// اسم أداة وحججًا وسببًا وأثرًا متوقَّعًا — ولا يحمل قرارًا ولا موافقة ولا نتيجة.
// حقل غير مُعلن في هذا العقد يُرفض، فلا يتسلّل «approved» ولا «effect_granted».

use serde::{Deserialize, Serialize};

use super::effect::ToolEffect;

/// اقتراح واحد كما خرج من النموذج ثم فُكِّك بعقد مغلق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolProposalV1 {
    pub proposal_id: String,
    pub mission_id: String,
    pub task_id: String,
    /// المهارة التي يقترح الوكيل العمل تحتها. اسمٌ يُتحقَّق منه، لا إذن.
    pub skill_id: String,
    pub tool_id: String,
    /// الحجج كما اقترحها النموذج. تُتحقَّق من مخطط الأداة قبل أي تنفيذ.
    pub arguments: serde_json::Value,
    pub reason: String,
    /// ما يظنّ النموذج أن الأداة ستُحدثه. يُقارَن بما يُعلنه الواصف، ولا يُصدَّق بدله.
    pub expected_effect: Vec<ToolEffect>,
    pub expected_output: String,
}

/// عقد ما يعيده النموذج داخل نتيجة المهمّة. مغلق: لا حقل غير مُعلن.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ToolProposalDraft {
    pub skill_id: String,
    pub tool_id: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub expected_effect: Vec<String>,
    #[serde(default)]
    pub expected_output: String,
}

impl ToolProposalDraft {
    /// يرقّي المسوّدة إلى اقتراح كامل. المعرّفات يصدرها وقت التشغيل لا النموذج
    /// (البند 111)، والأثر المتوقَّع يُترجَم بمفردات مغلقة: رمز غير معروف يسقط بدل
    /// أن يُخترع له معنى.
    pub fn into_proposal(self, proposal_id: String, mission_id: &str, task_id: &str) -> ToolProposalV1 {
        let expected_effect = self.expected_effect.iter().filter_map(|code| ToolEffect::parse(code)).collect();
        ToolProposalV1 {
            proposal_id,
            mission_id: mission_id.to_string(),
            task_id: task_id.to_string(),
            skill_id: self.skill_id,
            tool_id: self.tool_id,
            arguments: if self.arguments.is_null() { serde_json::json!({}) } else { self.arguments },
            reason: self.reason,
            expected_effect,
            expected_output: self.expected_output,
        }
    }
}

/// يصف الفارق بين ما توقّعه النموذج وما يُعلنه الواصف. يُسجَّل ولا يغيّر القرار:
/// الواصف هو الحقيقة، وتوقّع النموذج ملاحظة عن النموذج لا عن الأداة.
pub fn effect_mismatch(expected: &[ToolEffect], declared: &[ToolEffect]) -> Vec<ToolEffect> {
    declared.iter().copied().filter(|e| !expected.contains(e)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_undeclared_field_in_a_proposal_is_refused_rather_than_ignored() {
        let out: Result<ToolProposalDraft, _> = serde_json::from_str(
            r#"{"skill_id":"s","tool_id":"t","approved":true}"#,
        );
        assert!(out.is_err(), "a proposal claiming its own approval parsed");
    }

    #[test]
    fn a_proposal_cannot_carry_its_own_identifier() {
        let out: Result<ToolProposalDraft, _> = serde_json::from_str(
            r#"{"skill_id":"s","tool_id":"t","proposal_id":"chosen-by-the-model"}"#,
        );
        assert!(out.is_err(), "the model issued its own proposal identifier");
    }

    #[test]
    fn the_runtime_issues_the_identifiers_and_the_binding() {
        let draft = ToolProposalDraft {
            skill_id: "polaris.skill.local-analysis".into(),
            tool_id: "polaris.tool.context.read".into(),
            arguments: serde_json::Value::Null,
            reason: "read the note".into(),
            expected_effect: vec!["READ_LOCAL".into(), "NOT_A_REAL_EFFECT".into()],
            expected_output: "the note text".into(),
        };
        let proposal = draft.into_proposal("p1".into(), "m1", "t1");
        assert_eq!(proposal.proposal_id, "p1");
        assert_eq!(proposal.mission_id, "m1");
        assert_eq!(proposal.task_id, "t1");
        // الرمز غير المعروف يسقط بلا اختراع معنى.
        assert_eq!(proposal.expected_effect, vec![ToolEffect::ReadLocal]);
        // وغياب الحجج يصير كائنًا فارغًا لا قيمة فارغة تُفسَّر لاحقًا بالظنّ.
        assert_eq!(proposal.arguments, serde_json::json!({}));
    }

    #[test]
    fn a_declared_effect_the_model_did_not_expect_is_reported() {
        let missing = effect_mismatch(&[ToolEffect::ReadLocal], &[ToolEffect::ReadLocal, ToolEffect::WriteLocal]);
        assert_eq!(missing, vec![ToolEffect::WriteLocal]);
    }
}
