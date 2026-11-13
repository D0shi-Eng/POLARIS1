// دفتر الاستعمال: كل نداء نموذج وأداة ومتصفّح وحاسوب وموصل، بمصدر كل رقم.
//
// التجميع لا يخلط المصادر: المبالغ تُجمع لكل (عملة، مصدر) على حدة، والنداءات التي
// كلفتها مجهولة تُعدّ ولا تُسعَّر. والدفتر يبقى بعد الإقلاع لأنه في القاعدة نفسها.

use std::collections::BTreeMap;
use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;

use crate::storage::{Database, StorageError};

use super::model::{Cost, Provenance, UsageCategory, UsageRecord};

/// مجموع مبالغ مصدر واحد في عملة واحدة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CostBucket {
    pub currency: String,
    pub provenance: Provenance,
    pub micros: u64,
    pub calls: u64,
}

/// مجموع مجموعة واحدة (يوم، مهمّة، مزوّد، نموذج، موصل…).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Default)]
pub struct UsageTotals {
    pub key: String,
    pub calls: u64,
    pub input_tokens_reported: u64,
    pub output_tokens_reported: u64,
    /// نداءات لم يُبلَّغ فيها عدد الرموز. لا تُقدَّر أرقامها.
    pub calls_without_reported_tokens: u64,
    pub wall_ms: u64,
    pub external_requests: u64,
    pub costs: Vec<CostBucket>,
    /// نداءات كلفتها مجهولة: بلا سعر وبلا تقرير.
    pub calls_with_unknown_cost: u64,
}

impl UsageTotals {
    fn add(&mut self, record: &UsageRecord) {
        self.calls += 1;
        if record.category == UsageCategory::Model {
            match (record.input_tokens, record.output_tokens, record.tokens_provenance) {
                (Some(i), Some(o), Provenance::ProviderReported) => {
                    self.input_tokens_reported += i;
                    self.output_tokens_reported += o;
                }
                _ => self.calls_without_reported_tokens += 1,
            }
        }
        self.wall_ms = self.wall_ms.saturating_add(record.wall_ms);
        self.external_requests += record.external_requests;
        match (&record.cost.micros, &record.cost.currency) {
            (Some(micros), Some(currency)) => {
                match self.costs.iter_mut().find(|b| &b.currency == currency && b.provenance == record.cost.provenance) {
                    Some(bucket) => {
                        bucket.micros = bucket.micros.saturating_add(*micros);
                        bucket.calls += 1;
                    }
                    None => self.costs.push(CostBucket { currency: currency.clone(), provenance: record.cost.provenance, micros: *micros, calls: 1 }),
                }
            }
            _ => self.calls_with_unknown_cost += 1,
        }
    }
}

/// ما يُطابَق عند جمع استعمال ميزانية أو ملخّص.
#[derive(Debug, Clone, Default)]
pub struct UsageFilter {
    pub day: Option<String>,
    pub mission_id: Option<String>,
    pub project_id: Option<String>,
    pub provider_id: Option<String>,
    pub connector_id: Option<String>,
    pub category: Option<UsageCategory>,
}

pub struct UsageLedger {
    db: Arc<Database>,
}

fn opt_u64(v: Option<i64>) -> Option<u64> {
    v.map(|n| n.max(0) as u64)
}

impl UsageLedger {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// يسجّل استعمالًا. سجلّ كلفته غير متّسقة مع مصدرها يُرفض: لا كلفة وهمية تُحفظ.
    pub fn record(&self, record: &UsageRecord) -> Result<(), StorageError> {
        if !record.cost.is_consistent() {
            return Err(StorageError::Invalid("a usage record carries a cost inconsistent with its provenance".into()));
        }
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO usage_records (record_id, recorded_at, day, category, subject_id, mission_id, project_id, provider_id, model_id, connector_id, tool_id,
                    input_tokens, output_tokens, cached_tokens, token_provenance, wall_ms, external_requests, cost_micros, currency, cost_provenance, pricing_source)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21)",
                params![
                    record.record_id,
                    record.recorded_at,
                    record.day(),
                    record.category.as_str(),
                    record.subject_id,
                    record.mission_id,
                    record.project_id,
                    record.provider_id,
                    record.model_id,
                    record.connector_id,
                    record.tool_id,
                    record.input_tokens.map(|n| n as i64),
                    record.output_tokens.map(|n| n as i64),
                    record.cached_tokens.map(|n| n as i64),
                    record.tokens_provenance.as_str(),
                    record.wall_ms as i64,
                    record.external_requests as i64,
                    record.cost.micros.map(|n| n as i64),
                    record.cost.currency,
                    record.cost.provenance.as_str(),
                    record.cost.pricing_source,
                ],
            )?;
            Ok(())
        })
    }

    /// السجلّات المطابقة، الأحدث أولًا، بحدّ.
    pub fn records(&self, filter: &UsageFilter, limit: usize) -> Result<Vec<UsageRecord>, StorageError> {
        let limit = limit.clamp(1, 100_000) as i64;
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT record_id, recorded_at, category, subject_id, mission_id, project_id, provider_id, model_id, connector_id, tool_id,
                        input_tokens, output_tokens, cached_tokens, token_provenance, wall_ms, external_requests, cost_micros, currency, cost_provenance, pricing_source
                 FROM usage_records
                 WHERE (?1 IS NULL OR day = ?1) AND (?2 IS NULL OR mission_id = ?2) AND (?3 IS NULL OR project_id = ?3)
                   AND (?4 IS NULL OR provider_id = ?4) AND (?5 IS NULL OR connector_id = ?5) AND (?6 IS NULL OR category = ?6)
                 ORDER BY recorded_at DESC, record_id DESC LIMIT ?7",
            )?;
            let rows = statement.query_map(
                params![
                    filter.day,
                    filter.mission_id,
                    filter.project_id,
                    filter.provider_id,
                    filter.connector_id,
                    filter.category.map(UsageCategory::as_str),
                    limit
                ],
                |r| {
                    Ok((
                        (r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?),
                        (
                            r.get::<_, Option<String>>(4)?,
                            r.get::<_, Option<String>>(5)?,
                            r.get::<_, Option<String>>(6)?,
                            r.get::<_, Option<String>>(7)?,
                            r.get::<_, Option<String>>(8)?,
                            r.get::<_, Option<String>>(9)?,
                        ),
                        (r.get::<_, Option<i64>>(10)?, r.get::<_, Option<i64>>(11)?, r.get::<_, Option<i64>>(12)?, r.get::<_, String>(13)?),
                        (r.get::<_, i64>(14)?, r.get::<_, i64>(15)?),
                        (r.get::<_, Option<i64>>(16)?, r.get::<_, Option<String>>(17)?, r.get::<_, String>(18)?, r.get::<_, Option<String>>(19)?),
                    ))
                },
            )?;
            let mut out = Vec::new();
            for row in rows {
                let (head, owners, tokens, measured, cost) = row?;
                let Some(category) = UsageCategory::parse(&head.2) else { continue };
                out.push(UsageRecord {
                    record_id: head.0,
                    recorded_at: head.1,
                    category,
                    subject_id: head.3,
                    mission_id: owners.0,
                    project_id: owners.1,
                    provider_id: owners.2,
                    model_id: owners.3,
                    connector_id: owners.4,
                    tool_id: owners.5,
                    input_tokens: opt_u64(tokens.0),
                    output_tokens: opt_u64(tokens.1),
                    cached_tokens: opt_u64(tokens.2),
                    tokens_provenance: Provenance::parse(&tokens.3).unwrap_or(Provenance::Unknown),
                    wall_ms: measured.0.max(0) as u64,
                    external_requests: measured.1.max(0) as u64,
                    cost: Cost {
                        micros: opt_u64(cost.0),
                        currency: cost.1,
                        provenance: Provenance::parse(&cost.2).unwrap_or(Provenance::Unknown),
                        pricing_source: cost.3,
                    },
                });
            }
            Ok(out)
        })
    }

    /// مجموع واحد لكل المطابق.
    pub fn totals(&self, filter: &UsageFilter) -> Result<UsageTotals, StorageError> {
        let mut totals = UsageTotals { key: "ALL".into(), ..Default::default() };
        for record in self.records(filter, 100_000)? {
            totals.add(&record);
        }
        Ok(totals)
    }

    /// مجاميع مجمّعة بمفتاح يستخرجه المستدعي (مزوّد، نموذج، موصل…). ما لا مفتاح له لا يُعدّ.
    pub fn grouped(&self, filter: &UsageFilter, key: impl Fn(&UsageRecord) -> Option<String>) -> Result<Vec<UsageTotals>, StorageError> {
        let mut groups: BTreeMap<String, UsageTotals> = BTreeMap::new();
        for record in self.records(filter, 100_000)? {
            let Some(k) = key(&record) else { continue };
            groups.entry(k.clone()).or_insert_with(|| UsageTotals { key: k, ..Default::default() }).add(&record);
        }
        Ok(groups.into_values().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model_record(id: &str, day: &str, cost: Cost, reported: bool) -> UsageRecord {
        UsageRecord {
            record_id: id.into(),
            recorded_at: format!("{day}T10:00:00Z"),
            category: UsageCategory::Model,
            subject_id: id.into(),
            mission_id: Some("m1".into()),
            project_id: None,
            provider_id: Some("local-openai-compatible".into()),
            model_id: Some("local-openai-compatible:fixture-chat".into()),
            connector_id: None,
            tool_id: None,
            input_tokens: reported.then_some(150),
            output_tokens: reported.then_some(60),
            cached_tokens: None,
            tokens_provenance: if reported { Provenance::ProviderReported } else { Provenance::Unknown },
            wall_ms: 40,
            external_requests: 0,
            cost,
        }
    }

    #[test]
    fn totals_keep_each_provenance_apart_and_count_unknown_cost_without_pricing_it() {
        let ledger = UsageLedger::new(Arc::new(Database::in_memory().unwrap()));
        ledger.record(&model_record("r1", "2026-09-23", Cost::estimated(540, "USD", "user pricing"), true)).unwrap();
        ledger.record(&model_record("r2", "2026-09-23", Cost::reported(1_000, "USD", "provider"), true)).unwrap();
        ledger.record(&model_record("r3", "2026-09-23", Cost::unknown(), false)).unwrap();
        let totals = ledger.totals(&UsageFilter { day: Some("2026-09-23".into()), ..Default::default() }).unwrap();
        assert_eq!(totals.calls, 3);
        assert_eq!(totals.input_tokens_reported, 300);
        assert_eq!(totals.calls_without_reported_tokens, 1);
        assert_eq!(totals.calls_with_unknown_cost, 1);
        assert_eq!(totals.costs.len(), 2, "an estimate and a report were summed into one number");
    }

    #[test]
    fn a_fake_cost_is_refused_before_it_is_stored() {
        let ledger = UsageLedger::new(Arc::new(Database::in_memory().unwrap()));
        let fake = Cost { micros: Some(99), currency: Some("USD".into()), provenance: Provenance::Unknown, pricing_source: None };
        assert!(ledger.record(&model_record("r1", "2026-09-23", fake, true)).is_err());
        let unsourced = Cost { micros: Some(99), currency: Some("USD".into()), provenance: Provenance::Estimated, pricing_source: None };
        assert!(ledger.record(&model_record("r2", "2026-09-23", unsourced, true)).is_err());
        assert_eq!(ledger.totals(&UsageFilter::default()).unwrap().calls, 0);
    }

    #[test]
    fn records_group_by_a_key_and_filter_by_day() {
        let ledger = UsageLedger::new(Arc::new(Database::in_memory().unwrap()));
        ledger.record(&model_record("r1", "2026-09-22", Cost::unknown(), true)).unwrap();
        ledger.record(&model_record("r2", "2026-09-23", Cost::unknown(), true)).unwrap();
        let today = ledger.totals(&UsageFilter { day: Some("2026-09-23".into()), ..Default::default() }).unwrap();
        assert_eq!(today.calls, 1);
        let by_model = ledger.grouped(&UsageFilter::default(), |r| r.model_id.clone()).unwrap();
        assert_eq!(by_model.len(), 1);
        assert_eq!(by_model[0].calls, 2);
    }
}
