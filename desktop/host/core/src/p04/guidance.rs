// إرشاد رفض الوسائط (خطة 2026-10-05، البند B6): حين ترفض البوابة وسائط أداة لها مخطط، يرى الوكيل ثلاثة أشياء
// قابلة للتنفيذ بدل جملة عامّة: موضع كل خطأ (مؤشر JSON) وما خالفه، وشكل الوسائط المتوقَّع، ومثالًا أدنى صالحًا.
//
// المصدر: Anthropic، «Writing effective tools for agents» (2025-09-11): رسائل الخطأ تقول للنموذج ما يصلحه بالضبط؛
// و«Advanced tool use» (2025-11-24): مثال صالح مع المخطط يرفع دقّة الوسائط في قياسهم (72% إلى 90%، رقمهم لا رقمنا).
//
// الحدود: الإرشاد يُشتقّ من مخطط المحوّل وحده، لا من نصّ النموذج. لا يغيّر قرار البوابة ولا يُصلح الوسائط: الرفض
// يبقى رفضًا، والوكيل هو من يعيد الطلب. المثال الأدنى يحمل الحقول المطلوبة فقط بقيم نائبة، لا قيمًا يخترعها المضيف.

use serde_json::{Map, Value};

/// أقصى عدد أخطاء تُذكر، وأقصى طول للإرشاد كله.
const MAX_ERRORS: usize = 3;
pub const MAX_GUIDANCE_CHARS: usize = 900;

/// إرشاد رفض الوسائط من مخطط الأداة. `None` إن لم يُترجم المخطط (فيبقى سبب المحوّل وحده).
pub fn argument_guidance(schema: &Value, arguments: &Value) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Some(errors) = schema_errors(schema, arguments) {
        if !errors.is_empty() {
            parts.push(format!("Where it fails: {}.", errors.join("; ")));
        }
    }
    let shape = shape_of(schema)?;
    parts.push(format!("Expected arguments: {shape}."));
    if let Some(rule) = schema.get("description").and_then(Value::as_str).filter(|d| !d.trim().is_empty()) {
        parts.push(format!("Rule: {}.", clip(rule.trim().trim_end_matches('.'), 200)));
    }
    let example = example_of(schema, "", 0);
    parts.push(format!("A minimal valid example (string values are placeholders to replace): {}", serde_json::to_string(&example).ok()?));
    let text = parts.join(" ");
    Some(if text.chars().count() > MAX_GUIDANCE_CHARS { format!("{}…", text.chars().take(MAX_GUIDANCE_CHARS).collect::<String>()) } else { text })
}

/// أخطاء التحقق بمؤشراتها، من أدقّها (أوراق شجرة boon) حتى `MAX_ERRORS`.
fn schema_errors(schema: &Value, arguments: &Value) -> Option<Vec<String>> {
    let mut compiler = boon::Compiler::new();
    compiler.set_default_draft(boon::Draft::V2020_12);
    compiler.add_resource("polaris:/tool-guidance.json", schema.clone()).ok()?;
    let mut schemas = boon::Schemas::new();
    let index = compiler.compile("polaris:/tool-guidance.json", &mut schemas).ok()?;
    let Err(error) = schemas.validate(arguments, index) else {
        return Some(Vec::new());
    };
    let mut leaves = Vec::new();
    leaves_of(&error, &mut leaves);
    Some(leaves.into_iter().take(MAX_ERRORS).collect())
}

fn leaves_of(error: &boon::ValidationError, into: &mut Vec<String>) {
    if error.causes.is_empty() {
        let at = error.instance_location.to_string();
        let at = if at.is_empty() { "/".to_string() } else { at };
        into.push(format!("{at}: {}", clip(&error.kind.to_string(), 160)));
        return;
    }
    for cause in &error.causes {
        leaves_of(cause, into);
    }
}

/// شكل الوسائط في سطر: كل خاصية بنوعها، والمطلوب موسوم. للمصفوفة نوع عناصرها، وللبدائل أسماء أنواعها.
fn shape_of(schema: &Value) -> Option<String> {
    let properties = schema.get("properties")?.as_object()?;
    let required: Vec<&str> = schema.get("required").and_then(Value::as_array).map(|r| r.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    let fields: Vec<String> = properties
        .iter()
        .map(|(name, sub)| {
            let mark = if required.contains(&name.as_str()) { " (required)" } else { "" };
            format!("{name}: {}{mark}", type_of(sub, 0))
        })
        .collect();
    Some(format!("{{{}}}", fields.join(", ")))
}

fn type_of(schema: &Value, depth: usize) -> String {
    if let Some(value) = schema.get("const") {
        return value.to_string();
    }
    if let Some(options) = schema.get("enum").and_then(Value::as_array) {
        return options.iter().take(8).map(Value::to_string).collect::<Vec<_>>().join("|");
    }
    if let Some(variants) = schema.get("oneOf").or_else(|| schema.get("anyOf")).and_then(Value::as_array) {
        // بدائل بنوع مميِّز (كتل المستند): يُذكر مميِّز كل بديل.
        let tags: Vec<String> = variants.iter().filter_map(|v| v.pointer("/properties/type/const").map(Value::to_string)).collect();
        if !tags.is_empty() {
            return format!("object with type {}", tags.join("|"));
        }
        return "one of several shapes".into();
    }
    match schema.get("type").and_then(Value::as_str) {
        Some("array") if depth < 2 => format!("array of {}", schema.get("items").map(|i| type_of(i, depth + 1)).unwrap_or_else(|| "values".into())),
        Some("object") if depth < 2 => match schema.get("properties").and_then(Value::as_object) {
            Some(p) if !p.is_empty() => format!("object {{{}}}", p.keys().take(6).cloned().collect::<Vec<_>>().join(", ")),
            _ => "object".into(),
        },
        Some(kind) => kind.to_string(),
        None => "value".into(),
    }
}

/// مثال أدنى صالح: الحقول المطلوبة وحدها بقيم نائبة من المخطط (ثابت، أو أول قيمة معدودة، أو أدنى عدد، أو اسم الحقل).
pub fn example_of(schema: &Value, name: &str, depth: usize) -> Value {
    // مثال يعلنه المخطط نفسه (`examples`) يتقدّم على المشتقّ: يحمل ما لا يقوله المخطط (قيد «واحد من اثنين»).
    if let Some(first) = schema.get("examples").and_then(Value::as_array).and_then(|e| e.first()) {
        return first.clone();
    }
    if let Some(value) = schema.get("const") {
        return value.clone();
    }
    if let Some(first) = schema.get("enum").and_then(Value::as_array).and_then(|e| e.first()) {
        return first.clone();
    }
    if let Some(first) = schema.get("oneOf").or_else(|| schema.get("anyOf")).and_then(Value::as_array).and_then(|v| v.first()) {
        return example_of(first, name, depth);
    }
    if depth > 8 {
        return Value::Null;
    }
    // نوع بقائمة (`["number","string","null"]`): أول نوع غير null.
    let kind = match schema.get("type") {
        Some(Value::Array(kinds)) => kinds.iter().filter_map(Value::as_str).find(|k| *k != "null"),
        Some(other) => other.as_str(),
        None => None,
    };
    match kind {
        Some("object") => {
            let mut out = Map::new();
            let required: Vec<&str> = schema.get("required").and_then(Value::as_array).map(|r| r.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
            if let Some(properties) = schema.get("properties").and_then(Value::as_object) {
                for key in required {
                    if let Some(sub) = properties.get(key) {
                        out.insert(key.to_string(), example_of(sub, key, depth + 1));
                    }
                }
            }
            Value::Object(out)
        }
        // مصفوفة مطلوبة تأخذ عنصرًا واحدًا: مخططات الأدوات بلا `minItems` عمدًا (قواعد الفكّ)، والتحقق يطلب عنصرًا غالبًا
        // (قِيس: «a document needs 1..400 blocks» رفض مثالًا بكتل فارغة).
        Some("array") => match schema.get("items") {
            Some(items) => Value::Array(vec![example_of(items, name, depth + 1)]),
            None => Value::Array(Vec::new()),
        },
        Some("integer") | Some("number") => schema.get("minimum").cloned().unwrap_or(Value::from(0)),
        Some("boolean") => Value::Bool(false),
        // اسم الحقل نفسه قيمةً نائبة: بلا محارف خاصة، لأن مثالًا يرفضه التحقق يضلّل (قِيس: «<path>» رُفض لمحرف تمنعه Windows).
        _ => Value::String(if name.is_empty() { "text".into() } else { name.to_string() }),
    }
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write_schema() -> Value {
        json!({
            "type": "object",
            "properties": { "path": { "type": "string" }, "content": { "type": "string" }, "overwrite": { "type": "boolean" } },
            "required": ["path", "content"],
            "additionalProperties": false
        })
    }

    #[test]
    fn a_refusal_names_the_failing_field_the_expected_shape_and_a_valid_example() {
        let guidance = argument_guidance(&write_schema(), &json!({ "path": "notes.txt", "text": "hello" })).unwrap();
        assert!(guidance.contains("Where it fails:"), "{guidance}");
        assert!(guidance.contains("content"), "the missing field was not named: {guidance}");
        assert!(guidance.contains("path: string (required)"), "{guidance}");
        assert!(guidance.contains("overwrite: boolean") && !guidance.contains("overwrite: boolean (required)"));
        assert!(guidance.contains(r#"{"content":"content","path":"path"}"#) || guidance.contains(r#"{"path":"path","content":"content"}"#), "{guidance}");
    }

    #[test]
    fn the_example_is_itself_valid_against_the_schema() {
        let schema = json!({
            "type": "object",
            "properties": {
                "format": { "enum": ["docx", "pdf"] },
                "spec": { "type": "object", "properties": {
                    "title": { "type": "string" },
                    "blocks": { "type": "array", "minItems": 1, "items": { "oneOf": [
                        { "type": "object", "properties": { "type": { "const": "paragraph" }, "text": { "type": "string" } }, "required": ["type", "text"] },
                        { "type": "object", "properties": { "type": { "const": "heading" }, "text": { "type": "string" } }, "required": ["type", "text"] }
                    ] } }
                }, "required": ["title", "blocks"] }
            },
            "required": ["format", "spec"]
        });
        let example = example_of(&schema, "", 0);
        assert_eq!(schema_errors(&schema, &example), Some(Vec::new()), "the minimal example does not satisfy its own schema: {example}");
        let guidance = argument_guidance(&schema, &json!({ "format": "docx", "spec": { "title": "t", "blocks": "just text" } })).unwrap();
        assert!(guidance.contains("/spec/blocks"), "the nested pointer was not named: {guidance}");
        assert!(guidance.contains("docx|pdf") || guidance.contains("\"docx\"|\"pdf\""), "{guidance}");
    }

    #[test]
    fn guidance_is_bounded_and_absent_for_a_schema_without_properties() {
        assert!(argument_guidance(&json!({ "type": "object" }), &json!({ "x": 1 })).is_none());
        let wide: Map<String, Value> = (0..200).map(|i| (format!("field_{i:03}"), json!({ "type": "string" }))).collect();
        let schema = json!({ "type": "object", "properties": wide, "required": ["field_000"] });
        let guidance = argument_guidance(&schema, &json!({})).unwrap();
        assert!(guidance.chars().count() <= MAX_GUIDANCE_CHARS + 1);
    }
}
