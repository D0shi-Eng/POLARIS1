// أنواع الإعدادات: الوصف شيء، والقراءة شيء آخر.
//
// الواصف لا يحمل قيمة أبدًا — لا `value` ولا `current_value` ولا `resolved_value` —
// لأن «الوصف» و«القراءة» عمليتان منفصلتان عمدًا. والقراءة تعيد قيمة مُصنَّفة بنوعها
// لا حقلًا عامًّا، فلا يمكن لشكل غير متوقَّع أن يجتاز التحقق.

use serde::{Deserialize, Serialize};

use super::availability::AvailabilityReason;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SettingMode {
    Active,
    ReadOnly,
    UnavailableThisPhase,
}

impl SettingMode {
    pub fn requires_reason(self) -> bool {
        self != SettingMode::Active
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SettingValueKind {
    Boolean,
    Integer,
    Text,
    Enum,
    Locale,
    Appearance,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingDescriptor {
    pub setting_id: String,
    pub value_kind: SettingValueKind,
    pub mode: SettingMode,
    pub label_key: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub description_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub availability_reason: Option<AvailabilityReason>,
    /// إلزامية لنوع ENUM وحده. قائمة رموز محدودة، لا تسميات مُوطَّنة.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub allowed_values: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingSectionDescriptor {
    pub section_id: String,
    pub label_key: String,
    pub mode: SettingMode,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub availability_reason: Option<AvailabilityReason>,
    pub settings: Vec<SettingDescriptor>,
}

/// قيمة مُحلَّلة بصيغة آمنة للعرض: حقل واحد لكل نوع، لا حقل عامّ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct DisplaySafeValue {
    pub kind: Option<SettingValueKind>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub boolean_value: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub integer_value: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub code_value: Option<String>,
}

impl DisplaySafeValue {
    pub fn code(kind: SettingValueKind, code: impl Into<String>) -> Self {
        Self { kind: Some(kind), code_value: Some(code.into()), ..Default::default() }
    }

    pub fn boolean(value: bool) -> Self {
        Self {
            kind: Some(SettingValueKind::Boolean),
            boolean_value: Some(value),
            ..Default::default()
        }
    }

    pub fn integer(value: i32) -> Self {
        Self {
            kind: Some(SettingValueKind::Integer),
            integer_value: Some(value),
            ..Default::default()
        }
    }

    pub fn text(value: impl Into<String>) -> Self {
        Self {
            kind: Some(SettingValueKind::Text),
            text_value: Some(value.into()),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedSetting {
    pub setting_id: String,
    pub mode: SettingMode,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value: Option<DisplaySafeValue>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub availability_reason: Option<AvailabilityReason>,
    /// صحيح حين يملك المضيف قيمة ولن يفصح عنها. القيمة عندئذٍ غائبة دائمًا:
    /// أن تعرف الواجهة أن الاعتماد مضبوط شيء، وأن تتسلّمه شيء آخر.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value_withheld: Option<bool>,
}
