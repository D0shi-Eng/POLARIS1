// نموذج الاستعمال والكلفة: كل رقم يحمل مصدره (البند 19).
//
// أربعة مصادر لا خامس لها: ما أبلغه المزوّد، وما قاسه المضيف محليًّا، وما قُدِّر من
// سعر أدخله المستخدم، والمجهول. المقدَّر لا يُعرض فاتورةً، والمجهول لا يحمل مبلغًا،
// ولا يُجمع مبلغان من مصدرين مختلفين في رقم واحد.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Provenance {
    ProviderReported,
    LocallyMeasured,
    Estimated,
    Unknown,
}

impl Provenance {
    pub const ALL: [Provenance; 4] = [Self::ProviderReported, Self::LocallyMeasured, Self::Estimated, Self::Unknown];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ProviderReported => "PROVIDER_REPORTED",
            Self::LocallyMeasured => "LOCALLY_MEASURED",
            Self::Estimated => "ESTIMATED",
            Self::Unknown => "UNKNOWN",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == code)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UsageCategory {
    Model,
    Tool,
    Browser,
    Computer,
    Connector,
}

impl UsageCategory {
    pub const ALL: [UsageCategory; 5] = [Self::Model, Self::Tool, Self::Browser, Self::Computer, Self::Connector];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Model => "MODEL",
            Self::Tool => "TOOL",
            Self::Browser => "BROWSER",
            Self::Computer => "COMPUTER",
            Self::Connector => "CONNECTOR",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|c| c.as_str() == code)
    }

    /// صنف أداة بمعرّفها. الموصل يسجّل استعماله بنفسه، فلا يُحسب مرّتين.
    pub fn of_tool(tool_id: &str) -> Self {
        if tool_id.starts_with("polaris.web.") {
            Self::Browser
        } else if tool_id.starts_with("polaris.desktop.") {
            Self::Computer
        } else if tool_id.starts_with("connector:") {
            Self::Connector
        } else {
            Self::Tool
        }
    }
}

/// مبلغ بأجزاء المليون من وحدة العملة، مع عملته ومصدره. لا عائم.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Cost {
    pub micros: Option<u64>,
    pub currency: Option<String>,
    pub provenance: Provenance,
    /// مصدر السعر للمقدَّر: ملاحظة المستخدم على مدخل التسعير. للمُبلَّغ: المزوّد.
    pub pricing_source: Option<String>,
}

impl Cost {
    pub fn unknown() -> Self {
        Self { micros: None, currency: None, provenance: Provenance::Unknown, pricing_source: None }
    }

    /// كلفة مقدَّرة من سعر. بلا مصدر سعر لا يوجد تقدير.
    pub fn estimated(micros: u64, currency: &str, source: &str) -> Self {
        Self { micros: Some(micros), currency: Some(currency.to_string()), provenance: Provenance::Estimated, pricing_source: Some(source.chars().take(200).collect()) }
    }

    pub fn reported(micros: u64, currency: &str, source: &str) -> Self {
        Self {
            micros: Some(micros),
            currency: Some(currency.to_string()),
            provenance: Provenance::ProviderReported,
            pricing_source: Some(source.chars().take(200).collect()),
        }
    }

    /// المبلغ متّسق مع مصدره؟ المجهول بلا مبلغ، والمقدَّر بمصدر، والمبلغ بعملة.
    pub fn is_consistent(&self) -> bool {
        let amount_matches_currency = self.micros.is_some() == self.currency.is_some();
        let unknown_has_no_amount = self.provenance != Provenance::Unknown || self.micros.is_none();
        let estimate_has_source = self.provenance != Provenance::Estimated || self.pricing_source.is_some();
        let currency_ok = self.currency.as_deref().is_none_or(is_currency);
        amount_matches_currency && unknown_has_no_amount && estimate_has_source && currency_ok
    }
}

/// رمز عملة ISO-4217 بالشكل: ثلاثة أحرف كبيرة. لا تحويل بين العملات (البند 49).
pub fn is_currency(code: &str) -> bool {
    code.len() == 3 && code.chars().all(|c| c.is_ascii_uppercase())
}

/// سجل استعمال واحد، كما يُحفظ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UsageRecord {
    pub record_id: String,
    pub recorded_at: String,
    pub category: UsageCategory,
    /// معرّف الاستدعاء أو النداء الذي قيس.
    pub subject_id: String,
    pub mission_id: Option<String>,
    pub project_id: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub connector_id: Option<String>,
    pub tool_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cached_tokens: Option<u64>,
    pub tokens_provenance: Provenance,
    pub wall_ms: u64,
    pub external_requests: u64,
    pub cost: Cost,
}

impl UsageRecord {
    pub fn day(&self) -> String {
        self.recorded_at.chars().take(10).collect()
    }

    pub fn tokens(&self) -> u64 {
        self.input_tokens.unwrap_or(0) + self.output_tokens.unwrap_or(0)
    }
}

/// كلفة من أجزاء مليون لكل مليون رمز: رموز × سعر ÷ مليون، مُقرَّبة إلى الأقرب.
pub fn per_million(tokens: u64, micros_per_million: u64) -> u64 {
    let product = u128::from(tokens) * u128::from(micros_per_million);
    ((product + 500_000) / 1_000_000).min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unknown_cost_carries_no_amount_and_an_estimate_needs_a_source() {
        assert!(Cost::unknown().is_consistent());
        assert!(Cost::estimated(10, "USD", "user price list").is_consistent());
        let fake = Cost { micros: Some(5), currency: Some("USD".into()), provenance: Provenance::Unknown, pricing_source: None };
        assert!(!fake.is_consistent(), "an unknown cost carried an amount");
        let unsourced = Cost { micros: Some(5), currency: Some("USD".into()), provenance: Provenance::Estimated, pricing_source: None };
        assert!(!unsourced.is_consistent(), "an estimate without a pricing source");
        let odd = Cost { micros: Some(5), currency: Some("usd".into()), provenance: Provenance::ProviderReported, pricing_source: Some("p".into()) };
        assert!(!odd.is_consistent());
    }

    #[test]
    fn per_million_pricing_is_exact_and_rounded() {
        // 150 رمزًا بسعر 2.5 وحدة لكل مليون = 375 جزءًا من المليون.
        assert_eq!(per_million(150, 2_500_000), 375);
        assert_eq!(per_million(1, 1), 0);
        assert_eq!(per_million(1, 500_000), 1);
        assert_eq!(per_million(0, 9_999_999), 0);
    }

    #[test]
    fn a_tool_is_filed_under_the_subsystem_it_belongs_to() {
        assert_eq!(UsageCategory::of_tool("polaris.web.navigate"), UsageCategory::Browser);
        assert_eq!(UsageCategory::of_tool("polaris.desktop.click"), UsageCategory::Computer);
        assert_eq!(UsageCategory::of_tool("connector:c1:items.list"), UsageCategory::Connector);
        assert_eq!(UsageCategory::of_tool("polaris.tool.audit.chain.verify"), UsageCategory::Tool);
    }
}
