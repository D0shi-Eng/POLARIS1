// دفتر الأسعار: الأسعار يدخلها المستخدم بمصدرها، ولا يخترعها البناء (البند 20).
//
// لا سعر مدمج لأي نموذج أو خدمة. سعرٌ مكتوب في الشيفرة يشيخ بصمت ثم يُعرض فاتورة.
// نموذج بلا سعر إدخال وسعر إخراج معًا كلفته UNKNOWN؛ نصف سعر ليس سعرًا.

use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;

use crate::storage::{Database, StorageError};

use super::model::{is_currency, per_million, Cost};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PricingTarget {
    Model,
    Connector,
}

impl PricingTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Model => "MODEL",
            Self::Connector => "CONNECTOR",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "MODEL" => Some(Self::Model),
            "CONNECTOR" => Some(Self::Connector),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PricingUnit {
    PerMillionInputTokens,
    PerMillionOutputTokens,
    PerCall,
}

impl PricingUnit {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PerMillionInputTokens => "PER_MILLION_INPUT_TOKENS",
            Self::PerMillionOutputTokens => "PER_MILLION_OUTPUT_TOKENS",
            Self::PerCall => "PER_CALL",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "PER_MILLION_INPUT_TOKENS" => Some(Self::PerMillionInputTokens),
            "PER_MILLION_OUTPUT_TOKENS" => Some(Self::PerMillionOutputTokens),
            "PER_CALL" => Some(Self::PerCall),
            _ => None,
        }
    }

    /// الوحدات الصالحة لكل هدف. نموذج لا يُسعَّر بالنداء، وموصل لا يُسعَّر بالرموز.
    pub fn fits(self, target: PricingTarget) -> bool {
        match target {
            PricingTarget::Model => matches!(self, Self::PerMillionInputTokens | Self::PerMillionOutputTokens),
            PricingTarget::Connector => self == Self::PerCall,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PricingEntry {
    pub pricing_id: String,
    pub target_kind: PricingTarget,
    pub target_id: String,
    pub unit: PricingUnit,
    pub amount_micros: u64,
    pub currency: String,
    /// من أين جاء السعر، كما كتبه المستخدم. إلزامي: سعر بلا مصدر لا يُقبل.
    pub source_note: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PricingRefusal {
    UnitDoesNotFitTarget,
    CurrencyInvalid,
    SourceMissing,
    AmountOutOfRange,
    TargetInvalid,
}

impl PricingRefusal {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::UnitDoesNotFitTarget => "UNIT_DOES_NOT_FIT_TARGET",
            Self::CurrencyInvalid => "CURRENCY_INVALID",
            Self::SourceMissing => "SOURCE_MISSING",
            Self::AmountOutOfRange => "AMOUNT_OUT_OF_RANGE",
            Self::TargetInvalid => "TARGET_INVALID",
        }
    }
}

/// أعلى سعر مقبول لوحدة واحدة: مليون وحدة عملة. ما فوقه خطأ إدخال أو تلاعب.
pub const MAX_PRICE_MICROS: u64 = 1_000_000_000_000;

pub fn validate(entry: &PricingEntry) -> Result<(), PricingRefusal> {
    if !entry.unit.fits(entry.target_kind) {
        return Err(PricingRefusal::UnitDoesNotFitTarget);
    }
    if !is_currency(&entry.currency) {
        return Err(PricingRefusal::CurrencyInvalid);
    }
    let note = entry.source_note.trim();
    if note.is_empty() || note.chars().count() > 200 || note.chars().any(char::is_control) {
        return Err(PricingRefusal::SourceMissing);
    }
    if entry.amount_micros > MAX_PRICE_MICROS {
        return Err(PricingRefusal::AmountOutOfRange);
    }
    let id = &entry.target_id;
    if id.is_empty() || id.len() > 200 || id.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(PricingRefusal::TargetInvalid);
    }
    Ok(())
}

pub struct PricingBook {
    db: Arc<Database>,
}

impl PricingBook {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    pub fn list(&self) -> Result<Vec<PricingEntry>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT pricing_id, target_kind, target_id, unit, amount_micros, currency, source_note, created_at FROM pricing_entries ORDER BY target_kind, target_id, unit",
            )?;
            let rows = statement.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                ))
            })?;
            let mut out = Vec::new();
            for row in rows {
                let row = row?;
                let (Some(target_kind), Some(unit)) = (PricingTarget::parse(&row.1), PricingUnit::parse(&row.3)) else { continue };
                out.push(PricingEntry {
                    pricing_id: row.0,
                    target_kind,
                    target_id: row.2,
                    unit,
                    amount_micros: row.4.max(0) as u64,
                    currency: row.5,
                    source_note: row.6,
                    created_at: row.7,
                });
            }
            Ok(out)
        })
    }

    /// يحفظ سعرًا، ويستبدل السعر السابق للهدف والوحدة نفسيهما.
    pub fn put(&self, entry: &PricingEntry) -> Result<(), StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO pricing_entries (pricing_id, target_kind, target_id, unit, amount_micros, currency, source_note, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT (target_kind, target_id, unit) DO UPDATE SET amount_micros = excluded.amount_micros,
                    currency = excluded.currency, source_note = excluded.source_note, created_at = excluded.created_at",
                params![
                    entry.pricing_id,
                    entry.target_kind.as_str(),
                    entry.target_id,
                    entry.unit.as_str(),
                    entry.amount_micros as i64,
                    entry.currency,
                    entry.source_note,
                    entry.created_at
                ],
            )?;
            Ok(())
        })
    }

    pub fn remove(&self, pricing_id: &str) -> Result<bool, StorageError> {
        self.db.with(|conn| Ok(conn.execute("DELETE FROM pricing_entries WHERE pricing_id = ?1", [pricing_id])? > 0))
    }

    fn find(&self, target: PricingTarget, target_id: &str, unit: PricingUnit) -> Option<PricingEntry> {
        self.list().ok()?.into_iter().find(|e| e.target_kind == target && e.target_id == target_id && e.unit == unit)
    }

    /// كلفة نداء نموذج من رموز أبلغها المزوّد. أي نقص (رمز غير مُبلَّغ، سعر غائب،
    /// عملتان مختلفتان) يعني UNKNOWN، لا تقديرًا جزئيًّا.
    pub fn model_cost(&self, model_id: &str, input_tokens: Option<u64>, output_tokens: Option<u64>) -> Cost {
        let (Some(input), Some(output)) = (input_tokens, output_tokens) else { return Cost::unknown() };
        let input_price = self.find(PricingTarget::Model, model_id, PricingUnit::PerMillionInputTokens);
        let output_price = self.find(PricingTarget::Model, model_id, PricingUnit::PerMillionOutputTokens);
        let (Some(input_price), Some(output_price)) = (input_price, output_price) else { return Cost::unknown() };
        if input_price.currency != output_price.currency {
            return Cost::unknown();
        }
        let micros = per_million(input, input_price.amount_micros).saturating_add(per_million(output, output_price.amount_micros));
        Cost::estimated(micros, &input_price.currency, &format!("user pricing: {}", input_price.source_note))
    }

    /// تقدير مسبق لنداء نموذج، للحجز قبل التنفيذ. `None` حين لا سعر.
    pub fn model_estimate(&self, model_id: &str, input_tokens: u64, output_tokens: u64) -> Option<(u64, String)> {
        match self.model_cost(model_id, Some(input_tokens), Some(output_tokens)) {
            Cost { micros: Some(m), currency: Some(c), .. } => Some((m, c)),
            _ => None,
        }
    }

    /// كلفة نداء موصل بسعر النداء، إن وُجد.
    pub fn connector_cost(&self, connector_id: &str) -> Cost {
        match self.find(PricingTarget::Connector, connector_id, PricingUnit::PerCall) {
            Some(price) => Cost::estimated(price.amount_micros, &price.currency, &format!("user pricing: {}", price.source_note)),
            None => Cost::unknown(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(unit: PricingUnit, amount: u64, currency: &str) -> PricingEntry {
        PricingEntry {
            pricing_id: format!("p-{}", unit.as_str()),
            target_kind: PricingTarget::Model,
            target_id: "local-openai-compatible:fixture-chat".into(),
            unit,
            amount_micros: amount,
            currency: currency.into(),
            source_note: "TEST FIXTURE price".into(),
            created_at: "t".into(),
        }
    }

    #[test]
    fn with_no_price_entered_every_cost_is_unknown() {
        let book = PricingBook::new(Arc::new(Database::in_memory().unwrap()));
        assert_eq!(book.model_cost("any:model", Some(100), Some(10)), Cost::unknown());
        assert_eq!(book.connector_cost("c1"), Cost::unknown());
    }

    #[test]
    fn half_a_price_is_not_a_price_and_two_currencies_do_not_mix() {
        let book = PricingBook::new(Arc::new(Database::in_memory().unwrap()));
        book.put(&entry(PricingUnit::PerMillionInputTokens, 2_000_000, "USD")).unwrap();
        assert_eq!(book.model_cost("local-openai-compatible:fixture-chat", Some(150), Some(60)).provenance, super::super::model::Provenance::Unknown);
        book.put(&entry(PricingUnit::PerMillionOutputTokens, 4_000_000, "EUR")).unwrap();
        assert_eq!(book.model_cost("local-openai-compatible:fixture-chat", Some(150), Some(60)).provenance, super::super::model::Provenance::Unknown);
        book.put(&entry(PricingUnit::PerMillionOutputTokens, 4_000_000, "USD")).unwrap();
        let cost = book.model_cost("local-openai-compatible:fixture-chat", Some(150), Some(60));
        // 150 × 2 + 60 × 4 = 540 جزءًا من المليون، مقدَّرة بمصدرها.
        assert_eq!(cost.micros, Some(540));
        assert_eq!(cost.provenance, super::super::model::Provenance::Estimated);
        assert!(cost.pricing_source.unwrap().contains("TEST FIXTURE price"));
        // رمز غير مُبلَّغ: لا تقدير.
        assert_eq!(book.model_cost("local-openai-compatible:fixture-chat", None, Some(60)), Cost::unknown());
    }

    #[test]
    fn a_price_without_a_source_or_with_a_foreign_unit_is_refused() {
        let mut bad = entry(PricingUnit::PerCall, 1, "USD");
        assert_eq!(validate(&bad), Err(PricingRefusal::UnitDoesNotFitTarget));
        bad.unit = PricingUnit::PerMillionInputTokens;
        bad.source_note = "  ".into();
        assert_eq!(validate(&bad), Err(PricingRefusal::SourceMissing));
        bad.source_note = "vendor page".into();
        bad.currency = "dollars".into();
        assert_eq!(validate(&bad), Err(PricingRefusal::CurrencyInvalid));
        bad.currency = "USD".into();
        bad.amount_micros = MAX_PRICE_MICROS + 1;
        assert_eq!(validate(&bad), Err(PricingRefusal::AmountOutOfRange));
    }
}
