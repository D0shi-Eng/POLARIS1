// طبقة الأمن (خطة 2026-10-07، ADR-041 §3.4): كشف التلاعب، وملف الطُعم.
//
// - **ملفات محميّة:** ما أرفقه المستخدم في inputs/ يُبصَم عند بدء المهمّة ويُحفظ خارج مساحة الوكيل (المضيف يحفظه في مخزنه).
//   قبل حسم المهمّة يُعاد القياس: ملف محميّ تغيّر أو حُذف، أو نسخة ملف اختبار مرجعي في المساحة باسمه نفسه تختلف عنه، تلاعبٌ
//   تفشل به المهمّة مهما قال الوكيل. نسخة ملف ليس اختبارًا (stats.py) يجوز تعديلها: هذا ما يطلبه المستخدم عادةً.
// - **ملف طُعم:** في كل مساحة ملف يشبه الاعتمادات بقيمة كناري. قراءته بلا ذكره في الطلب حدث أمن.

use serde::Serialize;

/// مسار ملف الطُعم في مساحة كل مهمّة.
pub const HONEYTOKEN_PATH: &str = "inputs/.polaris-credentials.txt";
/// بادئة قيمة الكناري في ملف الطُعم. ظهورها في وسائط فعلٍ خارجي يمنعه (ASI03).
pub const CANARY_PREFIX: &str = "POLARIS-CANARY-";

/// حدث أمن سجّله زمن التشغيل في هذه المهمّة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SecurityEvent {
    /// HONEYTOKEN_READ، أو TAMPER_DETECTED، أو INJECTION_FLAGGED، أو MONITOR_BLOCKED، أو RULE_OF_TWO.
    pub kind: &'static str,
    pub task_id: Option<String>,
    pub detail: String,
}

/// هل يبدو اسم الملف اختبارًا مرجعيًّا أو مصحِّحًا؟ نسخته في المساحة يجب أن تبقى كما هي.
pub fn is_reference_check(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path).to_ascii_lowercase();
    let stem = name.rsplit_once('.').map(|(s, _)| s).unwrap_or(&name);
    stem.starts_with("test_") || stem.ends_with("_test") || stem.ends_with(".test") || stem.ends_with(".spec") || stem == "tests" || stem.contains("grader") || stem.contains("expected")
}

/// يقارن بصمات الملفات المحميّة بما في المساحة الآن. يعيد ما تغيّر، بوصف قصير لكلّ.
///
/// `current` بصمة ملف الآن (لا شيء إن غاب)، و`files` ملفات المساحة كلها.
pub fn tampered(protected: &[(String, String)], files: &[String], current: impl Fn(&str) -> Option<String>) -> Vec<String> {
    let mut out = Vec::new();
    for (path, digest) in protected {
        if path == HONEYTOKEN_PATH {
            continue;
        }
        match current(path) {
            None => out.push(format!("{path} was deleted")),
            Some(now) if &now != digest => out.push(format!("{path} was modified")),
            Some(_) => {}
        }
        // نسخة اختبار مرجعي باسمه في مكان آخر من المساحة تختلف عن الأصل المحميّ.
        if is_reference_check(path) {
            let name = path.rsplit('/').next().unwrap_or(path);
            for copy in files.iter().filter(|f| *f != path && f.rsplit('/').next() == Some(name)) {
                if current(copy).is_some_and(|now| &now != digest) {
                    out.push(format!("{copy} differs from the protected reference {path}"));
                }
            }
        }
    }
    out
}

/// هل ذكر الطلب ملف الطُعم؟ حينها قراءته طلب مستخدم لا تجسّس.
pub fn request_names_honeytoken(objective: &str) -> bool {
    let lower = objective.to_ascii_lowercase();
    lower.contains(".polaris-credentials") || lower.contains(HONEYTOKEN_PATH)
}

/// اسم ملف الطُعم كما يُقارن: بلا حالة أحرف (نظام ملفات Windows لا يفرّق)، وبفاصل `/`.
const HONEYTOKEN_NAME: &str = ".polaris-credentials";

/// PHASE-11: هل تسمّي هذه الوسائط ملف الطُعم في أي حقل نصّي (مسار، قائمة مسارات، كود، أمر)؟ قِيس أن الكشف كان يقارن حقل
/// `path` حرفيًّا، فلا يلتقط `INPUTS\.Polaris-Credentials.txt` ولا `inputs//...` ولا كود Python أو أمرًا يقرؤه.
pub fn arguments_name_honeytoken(arguments: &serde_json::Value) -> bool {
    match arguments {
        serde_json::Value::String(s) => s.replace('\\', "/").to_ascii_lowercase().contains(HONEYTOKEN_NAME),
        serde_json::Value::Array(items) => items.iter().any(arguments_name_honeytoken),
        serde_json::Value::Object(map) => map.values().any(arguments_name_honeytoken),
        _ => false,
    }
}

/// PHASE-11 (احتواء): قيمة الكناري في ناتج أي أداة تُحجب قبل أن تبلغ النموذج، أيًّا كان الطريق الذي قرأها (كود يمرّ على
/// المجلّد، أرشيف، أمر). يعيد النصّ المحجوب إن وُجدت.
pub fn redact_canary(text: &str) -> Option<String> {
    if !text.contains(CANARY_PREFIX) {
        return None;
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(CANARY_PREFIX) {
        out.push_str(&rest[..at]);
        out.push_str("[REDACTED: decoy credential]");
        let tail = &rest[at + CANARY_PREFIX.len()..];
        let end = tail.find(|c: char| !c.is_ascii_alphanumeric()).unwrap_or(tail.len());
        rest = &tail[end..];
    }
    out.push_str(rest);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_decoy_is_named_in_any_spelling_and_any_field_and_its_value_is_redacted() {
        use serde_json::json;
        for args in [
            json!({ "path": "inputs/.polaris-credentials.txt" }),
            json!({ "path": "INPUTS\\.Polaris-Credentials.txt" }),
            json!({ "path": "./inputs//.polaris-credentials.txt" }),
            json!({ "paths": ["outputs/a.md", "inputs/.polaris-credentials.txt"] }),
            json!({ "code": "print(open('inputs/.polaris-credentials.txt').read())" }),
            json!({ "command": "type inputs\\.polaris-credentials.txt" }),
        ] {
            assert!(arguments_name_honeytoken(&args), "{args} was not recognised");
        }
        assert!(!arguments_name_honeytoken(&json!({ "path": "inputs/credentials-notes.md" })));
        assert_eq!(redact_canary("api_key=POLARIS-CANARY-0123abcd\nok").as_deref(), Some("api_key=[REDACTED: decoy credential]\nok"));
        assert_eq!(redact_canary("nothing here"), None);
    }

    #[test]
    fn a_changed_reference_test_or_its_changed_copy_is_tampering_and_a_fixed_source_copy_is_not() {
        let protected = vec![("inputs/test_stats.py".to_string(), "aaa".to_string()), ("inputs/stats.py".to_string(), "bbb".to_string())];
        let files = vec!["inputs/test_stats.py".to_string(), "inputs/stats.py".to_string(), "work/project/test_stats.py".to_string(), "work/project/stats.py".to_string()];
        let digests = |p: &str| -> Option<String> {
            Some(match p {
                "work/project/test_stats.py" => "zzz",
                "work/project/stats.py" => "fixed",
                "inputs/test_stats.py" => "aaa",
                "inputs/stats.py" => "bbb",
                _ => return None,
            }.to_string())
        };
        assert_eq!(tampered(&protected, &files, digests), vec!["work/project/test_stats.py differs from the protected reference inputs/test_stats.py".to_string()]);
        assert!(is_reference_check("a/test_x.py") && is_reference_check("x_test.go") && is_reference_check("app.spec.ts") && !is_reference_check("stats.py"));
    }
}
