// لقطة الإقلاع: اثنتا عشرة حقيقة، ولا ثالثة عشرة.
//
// الكائن مغلق في المخطط، ومغلق هنا: لا خريطة إضافية ولا حقل حرّ. معرّف عملية أو
// مسار تنفيذي أو تفريغ بيئة ليس «غير مُدرَج اليوم» بل غير قابل للتمثيل، فالمضيف
// الذي ينمو حقيقةً جديدة مضطر لتغيير العقد في العلن.

use serde::{Deserialize, Serialize};

use super::availability::{Availability, CapabilityAvailability};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BuildChannel {
    Dev,
    Beta,
    Stable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Platform {
    Windows,
    Macos,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Architecture {
    X64,
    Arm64,
}

/// اللغات التسع المعمارية. Phase-01 يثبت ar وen؛ والسبع الباقية قابلة للتمثيل
/// حتى تصير إضافة لغة تغييرَ موارد لا تغييرَ عقد.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Locale {
    #[serde(rename = "ar")]
    Ar,
    #[serde(rename = "en")]
    En,
    #[serde(rename = "de")]
    De,
    #[serde(rename = "fr")]
    Fr,
    #[serde(rename = "ru")]
    Ru,
    #[serde(rename = "zh")]
    Zh,
    #[serde(rename = "ko")]
    Ko,
    #[serde(rename = "ja")]
    Ja,
    #[serde(rename = "es")]
    Es,
}

impl Locale {
    /// الاتجاه يُشتق من اللغة في المضيف، ولا يأتي من مفتاح يدوي في الواجهة.
    pub fn direction(self) -> Direction {
        match self {
            Locale::Ar => Direction::Rtl,
            _ => Direction::Ltr,
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Locale::Ar => "ar",
            Locale::En => "en",
            Locale::De => "de",
            Locale::Fr => "fr",
            Locale::Ru => "ru",
            Locale::Zh => "zh",
            Locale::Ko => "ko",
            Locale::Ja => "ja",
            Locale::Es => "es",
        }
    }

    /// كل اللغات المعمارية، بترتيب المخطط.
    pub const ALL: [Locale; 9] = [
        Locale::Ar,
        Locale::En,
        Locale::De,
        Locale::Fr,
        Locale::Ru,
        Locale::Zh,
        Locale::Ko,
        Locale::Ja,
        Locale::Es,
    ];

    /// يحوّل وسم لغة من نظام التشغيل إلى واحدة من التسع، أو لا شيء.
    /// يُقبل الجزء الأساسي فقط: "ar-SA" لغتها "ar".
    pub fn from_system_tag(tag: &str) -> Option<Locale> {
        let base = tag.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
        Locale::ALL.into_iter().find(|l| l.code() == base)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Direction {
    Rtl,
    Ltr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Appearance {
    Light,
    Dark,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuntimeReachability {
    Attached,
    NotAttached,
    Unreachable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub reachability: RuntimeReachability,
    pub availability: Availability,
    /// موجود فقط حين يكون هناك نواة موصولة أعلنت إصدار عقدها. الغياب صادق،
    /// وإصدار مخترع ليس كذلك.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub runtime_contract_version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BootstrapSnapshot {
    pub app_version: String,
    pub build_channel: BuildChannel,
    pub platform: Platform,
    pub architecture: Architecture,
    pub locale: Locale,
    pub direction: Direction,
    pub appearance: Appearance,
    pub runtime_status: RuntimeStatus,
    pub enabled_capabilities: Vec<String>,
    pub unavailable_capabilities: Vec<CapabilityAvailability>,
    pub settings_schema_version: String,
    pub ipc_protocol_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arabic_is_the_only_rtl_locale_in_the_set() {
        for locale in Locale::ALL {
            let expected = if locale == Locale::Ar { Direction::Rtl } else { Direction::Ltr };
            assert_eq!(locale.direction(), expected, "{}", locale.code());
        }
    }

    #[test]
    fn system_tags_reduce_to_the_base_language() {
        assert_eq!(Locale::from_system_tag("ar-SA"), Some(Locale::Ar));
        assert_eq!(Locale::from_system_tag("en_US"), Some(Locale::En));
        assert_eq!(Locale::from_system_tag("pt-BR"), None);
    }
}
