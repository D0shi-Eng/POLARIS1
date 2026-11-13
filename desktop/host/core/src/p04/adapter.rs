// منفذ محوّل الأداة: الحدّ الذي يعبره كل تنفيذ فعلي.
//
// المحوّل لا يقرّر شيئًا أمنيًّا: البوابة قرّرت قبله (الصلاحية، والميزانية، والسياسة،
// والموافقة)، وهو ينفّذ ما أُذن به ويعيد ما قاسه. ولذلك لا يملك أي محوّل هنا مسارًا
// عامًّا: لا صدفة، ولا نظام ملفات حرّ، ولا وجهة شبكة يسمّيها المستدعي.

use serde::Serialize;

use polaris_host_providers::net::CancelToken;

use super::approval::ApprovalContext;
use super::effect::ToolEffect;
use super::tool::ToolDescriptor;

/// ما يعرفه المحوّل عن النداء الجاري. لا يحمل سرًّا ولا صلاحية.
pub struct ToolCallContext<'a> {
    pub mission_id: &'a str,
    pub task_id: &'a str,
    /// الوكيل الذي اقترح النداء، كما ختمه زمن التشغيل. هويّة لا صلاحية.
    pub agent_id: &'a str,
    /// مشروع المهمّة، إن كان لها مشروع. هو حدّ نطاق كل أداة محلّية.
    pub project_id: Option<&'a str>,
    /// المهلة المتبقّية لهذا النداء، مشتقّة من ميزانية أدوات المهمّة.
    pub timeout_ms: u64,
    /// رمز إلغاء المهمّة. المحوّل يفحصه، ولا يتجاهله لأن عمله «قصير».
    pub cancel: &'a CancelToken,
}

/// ما يعرفه مُقيِّم السياسة عن الطلب قبل أي أثر. لا يحمل سرًّا ولا موافقة.
pub struct ToolAssessContext<'a> {
    pub mission_id: &'a str,
    pub task_id: &'a str,
    pub agent_id: &'a str,
    pub project_id: Option<&'a str>,
    pub cancel: &'a CancelToken,
}

/// حكم نقطة قرار السياسة (PDP) على طلب واحد، قبل القدرة والميزانية والموافقة.
///
/// الحكم يستطيع أن يوسّع الآثار (نقرةٌ تبيّن أنها «إرسال» تصير أثرًا خارجيًّا)،
/// ولا يستطيع أن يضيّقها: البوابة تأخذ اتحاد آثار الواصف وما أضافه الحكم، فلا
/// طريق يُسقط منه موافقةً أوجبها الواصف.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolAssessment {
    pub extra_effects: Vec<ToolEffect>,
    /// ملخّص موثوق يُعرض على المستخدم إن احتاج الطلب موافقة. يكتبه زمن التشغيل
    /// من حالته هو، لا من نثر النموذج.
    pub approval_context: Option<ApprovalContext>,
}

/// كيف يقف الدليل المسجَّل من ادّعاءات المهمّة الفرعية.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvidenceNoteStance {
    /// الفعل وقع، ولا يقول شيئًا عن نتيجته. يُسجَّل دليلًا ولا يؤيّد ادّعاءً.
    Neutral,
    /// ما لوحظ بعد القياس، نصًّا محدودًا. يؤيّد ادّعاءً مهيكلًا تظهر قيمته فيه فقط.
    Observed(String),
}

/// ملاحظة الدليل: نوعه المصدري وموقفه. غيابها يعني سلوك Phase-04 كما هو.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolEvidenceNote {
    /// مثل `BROWSER_OBSERVATION` أو `COMPUTER_ACTION_RESULT`. بيانات مصدر، لا نوع دليل جديد.
    pub kind: &'static str,
    pub stance: EvidenceNoteStance,
}

/// نتيجة تنفيذ ناجح.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolOutcome {
    /// ملخّص محدود للعرض وللدليل. ليس الجسم الخام.
    pub summary: String,
    /// البايتات التي قِيست فعلًا. منها تُشتق بصمة النتيجة (البند 152).
    #[serde(skip)]
    pub measured_bytes: Vec<u8>,
    /// هل أيّد ما قِيس القضيّة التي نُفِّذت الأداة من أجلها؟ نتيجة «نجح النداء»
    /// ليست «القضيّة صحيحة»: أداةٌ تعمل وتعيد «مكسور» هي قياس ناجح لواقع سلبي.
    pub supports: bool,
    pub detail: String,
    /// ملاحظة الدليل. `None` لأدوات Phase-04: موقفها يُشتق من `supports` وحده.
    #[serde(skip)]
    pub evidence: Option<ToolEvidenceNote>,
    /// ما يُعاد إلى النموذج في الجولة التالية (Phase-08): مخرجات عملية أو نصّ ملف، منقّاة
    /// ومحدودة. بيانات غير موثوقة دائمًا، تُسيَّج في المُوجِّه ولا تُقرأ تعليمات.
    #[serde(skip)]
    pub observation: Option<String>,
}

/// لماذا فشل التنفيذ. مغلق، ويطابق مفردات رفض البوابة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "code", content = "detail")]
pub enum ToolFailure {
    ArgumentsInvalid(String),
    /// المورد المسمّى ليس ضمن نطاق هذه المهمّة.
    OutOfScope(String),
    Unavailable(String),
    TimedOut,
    Cancelled,
    ResultTooLarge(u64),
    ResultMalformed(String),
    /// حاول الطرف الآخر أن يوسّع صلاحياته أو يطلب سرًّا.
    Refused(String),
    /// السياسة لا تسمح بهذا الأثر على هذا الهدف (حقل كلمة مرور، نافذة أمان).
    NotPermitted(String),
    /// ميزانية الجلسة (تصفّح أو تحكّم) استُنفدت قبل الأثر.
    BudgetExhausted(String),
    /// الملاحظة التي بُني عليها الاقتراح لم تعد تطابق الهدف.
    Stale(String),
}

/// منفذ المحوّل. تنفيذ واحد لكل أداة مسجَّلة.
pub trait ToolAdapter: Send + Sync {
    fn tool_id(&self) -> &str;

    /// الواصف الذي يدخل السجل. يُختم بـ`sealed` عند التسجيل.
    fn descriptor(&self) -> ToolDescriptor;

    /// تحقق بنيوي من الحجج قبل أي تنفيذ. الرفض هنا يسبق كل أثر.
    fn validate(&self, arguments: &serde_json::Value) -> Result<(), ToolFailure>;

    /// مخطط JSON لوسائط الأداة، يُعرض على النموذج في الاستدعاء الأصيل (خطة 2026-10-05، B1). عرضٌ لا حارس:
    /// `validate` يبقى الحَكَم. الافتراض: لا مخطط دقيق، فيُعرض كائن عامّ ويبقى الوصف النثري دليلًا.
    fn input_schema(&self) -> Option<serde_json::Value> {
        None
    }

    /// نقطة قرار السياسة. تُستدعى بعد التحقق من المخطط وقبل كل شيء آخر. الافتراض:
    /// لا إضافة، فيبقى سلوك أدوات Phase-04 كما أُغلق.
    fn assess(&self, _arguments: &serde_json::Value, _context: &ToolAssessContext<'_>) -> Result<ToolAssessment, ToolFailure> {
        Ok(ToolAssessment::default())
    }

    fn execute(&self, arguments: &serde_json::Value, context: &ToolCallContext<'_>) -> Result<ToolOutcome, ToolFailure>;

    /// هل تُعرض الأداة على النموذج الآن؟ (ADR-042) أداة لا تعمل في هذه اللحظة لغياب إعداد يملكه المستخدم (GitHub غير مربوط مثلًا)
    /// لا تُعرض فتأخذ من نافذة نموذج محلي صغير بلا فائدة. العرض ليس إذنًا: البوابة تحكم كل نداء كما هي، ونداء يسمّيها يُرفض بسببه.
    fn offered(&self) -> bool {
        true
    }
}

/// يقصّ نصًّا إلى حدّ آمن للعرض، بلا كسر محرف متعدد البايتات.
pub fn bounded(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

/// حقول غلاف طلب الأداة (خارج «arguments»).
const ENVELOPE_FIELDS: [&str; 3] = ["reason", "expected_effect", "expected_output"];

/// يرفض حقلًا غير مُعلن في كائن حجج. الرفض لا التجاهل: حقل مجهول قد يكون محاولة.
pub fn reject_unknown_fields(arguments: &serde_json::Value, allowed: &[&str]) -> Result<(), ToolFailure> {
    let Some(map) = arguments.as_object() else {
        return Err(ToolFailure::ArgumentsInvalid("the arguments must be a JSON object".into()));
    };
    for key in map.keys() {
        if !allowed.contains(&key.as_str()) {
            // حقل من غلاف الطلب وُضع داخل الحجج خطأ شائع لنموذج محلي (قِيس في Phase-08): الرفض يبقى،
            // والرسالة تقول أين مكانه ليصحّحه النموذج في محاولته التالية. لا شيء يُنقل آليًّا.
            let hint = if ENVELOPE_FIELDS.contains(&key.as_str()) {
                format!("; {key} belongs beside \"arguments\" in the tool request, not inside it")
            } else {
                String::new()
            };
            return Err(ToolFailure::ArgumentsInvalid(format!("the argument {key} is not declared by this tool{hint}")));
        }
    }
    Ok(())
}

/// يقرأ حقلًا نصّيًّا مقيّد الطول.
pub fn string_field(arguments: &serde_json::Value, name: &str, max_len: usize) -> Result<String, ToolFailure> {
    let value = arguments
        .get(name)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| ToolFailure::ArgumentsInvalid(format!("{name} is absent or is not a string")))?;
    if value.is_empty() || value.len() > max_len {
        return Err(ToolFailure::ArgumentsInvalid(format!("{name} must be between 1 and {max_len} bytes")));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_undeclared_argument_is_refused_rather_than_ignored() {
        let arguments = serde_json::json!({ "source_id": "s", "path": "../../etc/passwd" });
        let outcome = reject_unknown_fields(&arguments, &["source_id"]);
        assert!(matches!(outcome, Err(ToolFailure::ArgumentsInvalid(_))));
    }

    #[test]
    fn a_non_object_argument_payload_is_refused() {
        assert!(matches!(reject_unknown_fields(&serde_json::json!("x"), &[]), Err(ToolFailure::ArgumentsInvalid(_))));
        assert!(matches!(reject_unknown_fields(&serde_json::json!([1, 2]), &[]), Err(ToolFailure::ArgumentsInvalid(_))));
    }

    #[test]
    fn a_string_field_is_bounded_on_both_sides() {
        let arguments = serde_json::json!({ "note": "" });
        assert!(string_field(&arguments, "note", 10).is_err());
        let long = serde_json::json!({ "note": "x".repeat(11) });
        assert!(string_field(&long, "note", 10).is_err());
        assert_eq!(string_field(&serde_json::json!({ "note": "ok" }), "note", 10).unwrap(), "ok");
        assert!(string_field(&serde_json::json!({ "note": 7 }), "note", 10).is_err());
    }

    #[test]
    fn bounding_never_splits_a_multibyte_character() {
        let arabic = "تعليق عربي طويل جدًّا يتجاوز الحدّ المسموح به";
        let cut = bounded(arabic, 10);
        assert!(cut.chars().count() <= 10);
        assert!(cut.ends_with('…'));
        assert_eq!(bounded("short", 10), "short");
    }
}

#[cfg(test)]
mod envelope_hint_tests {
    use super::*;

    #[test]
    fn a_misplaced_envelope_field_is_still_refused_and_the_refusal_says_where_it_belongs() {
        let err = reject_unknown_fields(&serde_json::json!({"path": "x", "reason": "validate"}), &["path"]).unwrap_err();
        let ToolFailure::ArgumentsInvalid(text) = err else { panic!("not an argument refusal") };
        assert!(text.contains("reason is not declared") && text.contains("beside \"arguments\""), "{text}");
        let ToolFailure::ArgumentsInvalid(other) = reject_unknown_fields(&serde_json::json!({"colour": 1}), &["path"]).unwrap_err() else { panic!() };
        assert!(!other.contains("beside"));
    }
}
