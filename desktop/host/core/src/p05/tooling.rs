// أدوات Phase-05 كما تدخل سجل Phase-04: واصف مختوم، وقدرة دقيقة واحدة لكل أداة.
//
// القدرات الدقيقة (البند 16/28) مفردات مغلقة: لا BROWSER_ALL ولا FULL_DESKTOP_CONTROL.
// كل أداة تُعلن قدرة واحدة من هذه المفردات، وتُعلن آثارها بمفردات Phase-04 فتُختم
// موافقتها وخطرها وسياسة شبكتها من الآثار كما تُختم أي أداة أخرى.

use serde_json::Value;

use crate::p04::adapter::ToolFailure;
use crate::p04::effect::ToolEffect;
use crate::p04::tool::{NetworkPolicy, RiskClass, ToolDescriptor, ToolProvenance, ToolProvider, ToolTrustClass};

const REGISTERED_AT: &str = "2026-09-23T00:00:00Z";

/// القدرة الدقيقة التي تمثّلها أداة. مغلقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Phase05Capability {
    BrowserNavigate,
    BrowserRead,
    BrowserClick,
    BrowserType,
    BrowserDownload,
    BrowserUpload,
    ScreenRead,
    WindowList,
    WindowFocus,
    PointerMove,
    PointerClick,
    KeyboardInput,
    TextInput,
    Scroll,
    MemoryPropose,
}

impl Phase05Capability {
    pub const ALL: [Phase05Capability; 15] = [
        Self::BrowserNavigate,
        Self::BrowserRead,
        Self::BrowserClick,
        Self::BrowserType,
        Self::BrowserDownload,
        Self::BrowserUpload,
        Self::ScreenRead,
        Self::WindowList,
        Self::WindowFocus,
        Self::PointerMove,
        Self::PointerClick,
        Self::KeyboardInput,
        Self::TextInput,
        Self::Scroll,
        Self::MemoryPropose,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::BrowserNavigate => "BROWSER_NAVIGATE",
            Self::BrowserRead => "BROWSER_READ",
            Self::BrowserClick => "BROWSER_CLICK",
            Self::BrowserType => "BROWSER_TYPE",
            Self::BrowserDownload => "BROWSER_DOWNLOAD",
            Self::BrowserUpload => "BROWSER_UPLOAD",
            Self::ScreenRead => "SCREEN_READ",
            Self::WindowList => "WINDOW_LIST",
            Self::WindowFocus => "WINDOW_FOCUS",
            Self::PointerMove => "POINTER_MOVE",
            Self::PointerClick => "POINTER_CLICK",
            Self::KeyboardInput => "KEYBOARD_INPUT",
            Self::TextInput => "TEXT_INPUT",
            Self::Scroll => "SCROLL",
            Self::MemoryPropose => "MEMORY_PROPOSE",
        }
    }

    /// اسم القدرة بصيغة قدرات المنتج، كما تُسمّيها المهارة.
    pub fn capability_id(self) -> String {
        format!("polaris.capability.p05.{}", self.as_str().to_ascii_lowercase())
    }
}

/// يبني واصف أداة مدمجة من Phase-05. الختم يقع عند التسجيل.
pub fn descriptor(tool_id: &str, name: &str, description: &str, effects: Vec<ToolEffect>, web_policed: bool, schema: &Value) -> ToolDescriptor {
    ToolDescriptor {
        tool_id: tool_id.into(),
        provider: ToolProvider::BuiltIn,
        name: name.into(),
        description: description.into(),
        input_schema_ref: format!("p05.{tool_id}.input.v1"),
        output_schema_ref: "p05.tool.output.v1".into(),
        effects: effects.clone(),
        required_capabilities: Vec::new(),
        risk: RiskClass::Low,
        requires_approval: false,
        network_policy: if web_policed { NetworkPolicy::WebNavigationPolicy } else { NetworkPolicy::None },
        enabled: true,
        trust_class: ToolTrustClass::TrustedRuntime,
        provenance: ToolProvenance {
            origin: "polaris.builtin".into(),
            server_id: None,
            server_name: None,
            declared_effects: effects,
            schema_digest: crate::digest::sha256_hex(schema.to_string().as_bytes()),
            registered_at: REGISTERED_AT.into(),
        },
    }
}

/// يفحص كائن حجج بمخطط صغير مغلق: الحقول المسموحة، والمطلوب منها، وأنواعها وحدودها.
pub struct ArgSpec {
    pub name: &'static str,
    pub required: bool,
    pub kind: ArgKind,
}

pub enum ArgKind {
    Text { max: usize },
    Integer { min: i64, max: i64 },
}

/// R-21: مخطط JSON للنموذج من المواصفة نفسها التي يتحقّق بها `check_args`؛ مصدر واحد فلا يختلف المعروض عن المقبول.
pub fn schema_of(spec: &[ArgSpec]) -> Value {
    let mut properties = serde_json::Map::new();
    for field in spec {
        let property = match field.kind {
            ArgKind::Text { max } => serde_json::json!({ "type": "string", "maxLength": max }),
            ArgKind::Integer { min, max } => serde_json::json!({ "type": "integer", "minimum": min, "maximum": max }),
        };
        properties.insert(field.name.to_string(), property);
    }
    let required: Vec<&str> = spec.iter().filter(|f| f.required).map(|f| f.name).collect();
    serde_json::json!({ "type": "object", "properties": properties, "required": required, "additionalProperties": false })
}

pub fn check_args(arguments: &Value, spec: &[ArgSpec]) -> Result<(), ToolFailure> {
    let names: Vec<&str> = spec.iter().map(|s| s.name).collect();
    crate::p04::adapter::reject_unknown_fields(arguments, &names)?;
    for field in spec {
        let value = arguments.get(field.name);
        match (value, field.required) {
            (None, true) => return Err(ToolFailure::ArgumentsInvalid(format!("{} is required", field.name))),
            (None, false) => continue,
            (Some(v), _) => match &field.kind {
                ArgKind::Text { max } => {
                    let text = v.as_str().ok_or_else(|| ToolFailure::ArgumentsInvalid(format!("{} must be a string", field.name)))?;
                    if text.is_empty() || text.chars().count() > *max {
                        return Err(ToolFailure::ArgumentsInvalid(format!("{} must be between 1 and {max} characters", field.name)));
                    }
                    if text.chars().any(|c| c.is_control() && c != '\n' && c != '\t') {
                        return Err(ToolFailure::ArgumentsInvalid(format!("{} carries control characters", field.name)));
                    }
                }
                ArgKind::Integer { min, max } => {
                    let n = v.as_i64().ok_or_else(|| ToolFailure::ArgumentsInvalid(format!("{} must be an integer", field.name)))?;
                    if n < *min || n > *max {
                        return Err(ToolFailure::ArgumentsInvalid(format!("{} must be between {min} and {max}", field.name)));
                    }
                }
            },
        }
    }
    Ok(())
}

pub fn text_arg(arguments: &Value, name: &str) -> String {
    arguments.get(name).and_then(Value::as_str).unwrap_or("").to_string()
}

pub fn int_arg(arguments: &Value, name: &str) -> Option<i64> {
    arguments.get(name).and_then(Value::as_i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_fine_grained_and_there_is_no_catch_all() {
        let names: Vec<&str> = Phase05Capability::ALL.iter().map(|c| c.as_str()).collect();
        for forbidden in ["BROWSER_ALL", "FULL_DESKTOP_CONTROL", "DESKTOP_ALL", "ANY"] {
            assert!(!names.contains(&forbidden), "{forbidden} is a capability");
        }
        let mut unique = names.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), names.len());
    }

    #[test]
    fn arguments_are_closed_typed_and_bounded() {
        let spec = [ArgSpec { name: "url", required: true, kind: ArgKind::Text { max: 20 } }];
        assert!(check_args(&serde_json::json!({ "url": "http://x/" }), &spec).is_ok());
        assert!(check_args(&serde_json::json!({}), &spec).is_err());
        assert!(check_args(&serde_json::json!({ "url": "http://x/", "path": "C:/x" }), &spec).is_err(), "an undeclared path was accepted");
        assert!(check_args(&serde_json::json!({ "url": "x".repeat(21) }), &spec).is_err());
        assert!(check_args(&serde_json::json!({ "url": 7 }), &spec).is_err());
    }
}
