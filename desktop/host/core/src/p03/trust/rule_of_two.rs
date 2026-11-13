// قاعدة الاثنين (Meta، «Agents Rule of Two»، 2025-10-31؛ خطة 2026-10-07، ADR-041 §3.1).
//
// في جلسة وكيل واحدة لا تجتمع ثلاث بلا إنسان: [A] مدخل غير موثوق دخل السياق، و[B] وصول إلى بيانات حسّاسة، و[C] فعل يغيّر
// حالة خارج مساحة المهمّة أو يتواصل خارجيًّا. زمن التشغيل يحسبها من الأدوات المعروضة وما دخل السياق فعلًا، لا من قول
// الوكيل. اجتماع الثلاث يجعل كل فعل [C] بعده ينتظر إنسانًا، ولو كانت سياسة الأداة تجيزه آليًّا.

use serde_json::Value;

use crate::p03::port::ToolTraits;

// R-04 (تكليف 2026-10-12): كانت القاعدة تصنّف أدوات MCP والموصلات ببادئتين `mcp.` و`connector.`، والسجل يصدر معرّفاتها
// `mcp:<server>:<name>` و`connector:<id>:<op>`، فلا تطابق أيّ أداة منها. التصنيف الآن:
// - الأدوات المدمجة (`polaris.*`، معرّفات ثابتة يكتبها هذا البناء) بجداولها المسمّاة أدناه، كما كانت.
// - كل أداة سواها بصفاتها التي يشتقّها المضيف من واصفها المسجَّل (`ToolTraits`): المزوّد وصنف الثقة والمنشأ والآثار.
// - أداة ليست مدمجة ولا واصف لها عند الوسيط: أسوأ الاحتمالات الثلاثة معًا. ما لا يُعرف أثره لا يُفترض آمنًا.

/// معرّف من سجلّ POLARIS المدمج.
fn is_builtin(tool_id: &str) -> bool {
    tool_id.starts_with("polaris.")
}

/// أدوات تُدخل محتوى غير موثوق إلى السياق حين تنجح: ملفات، وصفحات، وموصلات، وMCP.
pub fn brings_untrusted(tool_id: &str, traits: Option<ToolTraits>) -> bool {
    if is_builtin(tool_id) {
        return matches!(tool_id, "polaris.workspace.read" | "polaris.tool.context.read" | "polaris.web.read_page" | "polaris.web.search" | "polaris.web.navigate" | "polaris.web.download")
            || tool_id.starts_with("polaris.browser.")
            // ADR-042: نصّ قضية أو وصف مستودع قد يحمل تعليمات.
            || tool_id.starts_with("polaris.github.");
    }
    traits.is_none_or(|t| t.untrusted_source)
}

/// أدوات تصل إلى بيانات حسّاسة بذاتها: سطح المكتب، والموصلات باعتماداتها.
pub fn touches_sensitive(tool_id: &str, traits: Option<ToolTraits>) -> bool {
    if is_builtin(tool_id) {
        // ADR-042: GitHub برمز المستخدم يصل إلى مستودعاته الخاصّة.
        return tool_id.starts_with("polaris.desktop.") || tool_id == "polaris.capability.tool.secret" || tool_id.starts_with("polaris.github.");
    }
    traits.is_none_or(|t| t.sensitive)
}

/// فعل [C]: يغيّر حالة خارج المساحة أو يتواصل خارجيًّا. Python داخل الصندوق بلا شبكة يبقى داخل المساحة؛ بالشبكة [C].
pub fn external_change(tool_id: &str, arguments: &Value, traits: Option<ToolTraits>) -> bool {
    if !is_builtin(tool_id) {
        return traits.is_none_or(|t| t.external);
    }
    match tool_id {
        "polaris.execution.python" => arguments.get("network").and_then(Value::as_bool).unwrap_or(false),
        "polaris.execution.command" | "polaris.workspace.export" | "polaris.browser.permit_write" => true,
        _ => {
            tool_id.starts_with("polaris.web.") && !matches!(tool_id, "polaris.web.read_page")
                || matches!(tool_id, "polaris.browser.open" | "polaris.browser.click" | "polaris.browser.type" | "polaris.browser.press" | "polaris.browser.select" | "polaris.browser.upload")
                || tool_id.starts_with("polaris.desktop.") && tool_id != "polaris.desktop.observe" && tool_id != "polaris.desktop.windows"
        }
    }
}

/// حالة الجلسة.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RuleOfTwo {
    pub untrusted_input: bool,
    pub sensitive_data: bool,
}

impl RuleOfTwo {
    /// هل يحتاج هذا الفعل إنسانًا؟ حين يكون [C] واجتمع قبله [A] و[B].
    pub fn requires_human(&self, tool_id: &str, arguments: &Value, traits: Option<ToolTraits>) -> bool {
        self.untrusted_input && self.sensitive_data && external_change(tool_id, arguments, traits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_all_three_together_require_a_human() {
        let both = RuleOfTwo { untrusted_input: true, sensitive_data: true };
        assert!(both.requires_human("polaris.execution.command", &json!({}), None));
        assert!(both.requires_human("polaris.execution.python", &json!({ "network": true }), None));
        assert!(!both.requires_human("polaris.execution.python", &json!({ "code": "print(1)" }), None));
        assert!(!both.requires_human("polaris.workspace.write", &json!({}), None));
        assert!(!RuleOfTwo { untrusted_input: true, sensitive_data: false }.requires_human("polaris.execution.command", &json!({}), None));
        assert!(!RuleOfTwo { untrusted_input: false, sensitive_data: true }.requires_human("polaris.web.navigate", &json!({}), None));
        assert!(brings_untrusted("polaris.workspace.read", None) && !brings_untrusted("polaris.workspace.write", None));
    }

    #[test]
    fn registry_ids_are_classified_by_descriptor_and_the_unknown_by_the_worst_case() {
        // المعرّفات كما يصدرها الاكتشاف والموصلات فعلًا.
        let mcp = ToolTraits { untrusted_source: true, sensitive: false, external: true };
        let connector = ToolTraits { untrusted_source: true, sensitive: true, external: true };
        let read_only = ToolTraits { untrusted_source: true, sensitive: false, external: false };
        assert!(brings_untrusted("mcp:11111111:echo", Some(mcp)));
        assert!(external_change("mcp:11111111:echo", &json!({}), Some(mcp)));
        assert!(touches_sensitive("connector:22222222:post", Some(connector)));
        assert!(!external_change("mcp:11111111:list", &json!({}), Some(read_only)));
        // أداة غير مسجَّلة: الثلاثة معًا.
        assert!(brings_untrusted("mcp:99999999:redefined", None) && touches_sensitive("mcp:99999999:redefined", None) && external_change("mcp:99999999:redefined", &json!({}), None));
        // البادئات القديمة الخاطئة لم تعد مسارًا خاصًّا: تُصنَّف بالقاعدة العامّة نفسها.
        assert!(external_change("mcp.x", &json!({}), None));
    }
}
