// الحقيقة ومصدرها.
//
// كل قيمة تُعرض عن مزوّد أو نموذج تحمل مصدرها: أبلغ بها المزوّد، أو قاسها المضيف،
// أو هي من واصف ثابت موثّق، أو مقدّرة، أو مجهولة. «مجهول» قيمة من الدرجة الأولى:
// غيابها لا يُملأ بتخمين، و`Support::Unknown` لا يساوي «مدعوم» في أي قرار.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Provenance {
    ProviderReported,
    LocallyMeasured,
    StaticDescriptor,
    Estimated,
    Unknown,
}

/// قيمة قد تكون مجهولة. المجهول لا يحمل قيمة، والمعلوم لا يكون بلا مصدر.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fact<T> {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub value: Option<T>,
    pub provenance: Provenance,
}

impl<T> Fact<T> {
    pub fn unknown() -> Self {
        Self { value: None, provenance: Provenance::Unknown }
    }

    pub fn reported(value: T) -> Self {
        Self { value: Some(value), provenance: Provenance::ProviderReported }
    }

    pub fn measured(value: T) -> Self {
        Self { value: Some(value), provenance: Provenance::LocallyMeasured }
    }

    /// قيمة من واصف ثابت موثّق (فهرس المزوّدات، أو ما أعلنه المستخدم لمزوّده المخصّص). ليست ما أبلغ به المزوّد.
    pub fn documented(value: T) -> Self {
        Self { value: Some(value), provenance: Provenance::StaticDescriptor }
    }

    pub fn estimated(value: T) -> Self {
        Self { value: Some(value), provenance: Provenance::Estimated }
    }

    /// قيمة اختيارية من المزوّد: غيابها مجهول، لا صفر.
    pub fn reported_opt(value: Option<T>) -> Self {
        match value {
            Some(v) => Self::reported(v),
            None => Self::unknown(),
        }
    }

    pub fn is_known(&self) -> bool {
        self.value.is_some()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Support {
    Supported,
    Unsupported,
    Unknown,
}

/// ادعاء قدرة ومصدره.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapabilityClaim {
    pub support: Support,
    pub provenance: Provenance,
}

impl CapabilityClaim {
    pub const UNKNOWN: Self = Self { support: Support::Unknown, provenance: Provenance::Unknown };

    pub const fn documented(supported: bool) -> Self {
        Self {
            support: if supported { Support::Supported } else { Support::Unsupported },
            provenance: Provenance::StaticDescriptor,
        }
    }

    pub const fn reported(supported: bool) -> Self {
        Self {
            support: if supported { Support::Supported } else { Support::Unsupported },
            provenance: Provenance::ProviderReported,
        }
    }

    /// القاعدة الوحيدة التي يقرأ بها التوجيه القدرة: المدعوم المُثبت وحده صحيح.
    pub fn is_proven(&self) -> bool {
        self.support == Support::Supported && self.provenance != Provenance::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_is_never_proven() {
        assert!(!CapabilityClaim::UNKNOWN.is_proven());
        assert!(CapabilityClaim::documented(true).is_proven());
        assert!(!CapabilityClaim::reported(false).is_proven());
    }

    #[test]
    fn an_unknown_fact_serialises_without_a_value() {
        let json = serde_json::to_value(Fact::<u64>::unknown()).unwrap();
        assert_eq!(json, serde_json::json!({ "provenance": "UNKNOWN" }));
        let json = serde_json::to_value(Fact::reported(4096_u64)).unwrap();
        assert_eq!(json, serde_json::json!({ "value": 4096, "provenance": "PROVIDER_REPORTED" }));
    }
}
