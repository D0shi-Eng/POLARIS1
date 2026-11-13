// الميزانيات: حجز قبل التنفيذ، وتسوية بالاستعمال المقيس بعده (البند 23/24).
//
// الصلبة تمنع النداء التالي حين لا يتّسع ما بقي لما يُحجز. الليّنة تنبّه وتسمح.
// والحجز يُحسب مع ما سُجِّل فعلًا، فلا يعبر نداءان متوازيان حدًّا كان يتّسع لواحد.
//
// حدّ الكلفة بعملة واحدة ولا يعرف إلا المبالغ المعلومة. نداءٌ كلفته لا تُقدَّر مسبقًا
// (لا سعر له) تحت ميزانية كلفة صلبة يُمنع: لا يستطيع المضيف أن يضمن حدًّا لا يقيسه،
// والفشل هنا مغلق لا مفتوح.

use std::sync::{Arc, Mutex};

use rusqlite::params;
use serde::Serialize;

use crate::storage::{Database, StorageError};

use super::ledger::{UsageFilter, UsageLedger};
use super::model::{is_currency, Provenance, UsageRecord};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BudgetScope {
    Mission,
    Project,
    Day,
    Provider,
    Connector,
}

impl BudgetScope {
    pub const ALL: [BudgetScope; 5] = [Self::Mission, Self::Project, Self::Day, Self::Provider, Self::Connector];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mission => "MISSION",
            Self::Project => "PROJECT",
            Self::Day => "DAY",
            Self::Provider => "PROVIDER",
            Self::Connector => "CONNECTOR",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == code)
    }

    /// نافذة العدّ: المهمّة والمشروع طوال عمرهما، واليوم والمزوّد والموصل ليومٍ UTC.
    pub fn window(self) -> &'static str {
        match self {
            Self::Mission | Self::Project => "LIFETIME",
            Self::Day | Self::Provider | Self::Connector => "UTC_DAY",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BudgetDimension {
    CostMicros,
    ModelTokens,
    ExternalCalls,
}

impl BudgetDimension {
    pub const ALL: [BudgetDimension; 3] = [Self::CostMicros, Self::ModelTokens, Self::ExternalCalls];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::CostMicros => "COST_MICROS",
            Self::ModelTokens => "MODEL_TOKENS",
            Self::ExternalCalls => "EXTERNAL_CALLS",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|d| d.as_str() == code)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BudgetMode {
    Soft,
    Hard,
}

impl BudgetMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Soft => "SOFT",
            Self::Hard => "HARD",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "SOFT" => Some(Self::Soft),
            "HARD" => Some(Self::Hard),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Budget {
    pub budget_id: String,
    pub scope: BudgetScope,
    /// معرّف المهمّة أو المشروع أو المزوّد أو الموصل. فارغ يعني «كل واحد» (كل مهمّة، كل يوم).
    pub scope_key: String,
    pub dimension: BudgetDimension,
    pub limit: u64,
    pub currency: Option<String>,
    pub mode: BudgetMode,
    pub warn_ratio_pct: u8,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BudgetRefusal {
    CurrencyRequired,
    CurrencyNotApplicable,
    CurrencyInvalid,
    ScopeKeyRequired,
    ScopeKeyInvalid,
    WarnRatioInvalid,
}

impl BudgetRefusal {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::CurrencyRequired => "CURRENCY_REQUIRED",
            Self::CurrencyNotApplicable => "CURRENCY_NOT_APPLICABLE",
            Self::CurrencyInvalid => "CURRENCY_INVALID",
            Self::ScopeKeyRequired => "SCOPE_KEY_REQUIRED",
            Self::ScopeKeyInvalid => "SCOPE_KEY_INVALID",
            Self::WarnRatioInvalid => "WARN_RATIO_INVALID",
        }
    }
}

pub fn validate(budget: &Budget) -> Result<(), BudgetRefusal> {
    match (budget.dimension, &budget.currency) {
        (BudgetDimension::CostMicros, None) => return Err(BudgetRefusal::CurrencyRequired),
        (BudgetDimension::CostMicros, Some(c)) if !is_currency(c) => return Err(BudgetRefusal::CurrencyInvalid),
        (BudgetDimension::ModelTokens | BudgetDimension::ExternalCalls, Some(_)) => return Err(BudgetRefusal::CurrencyNotApplicable),
        _ => {}
    }
    // المزوّد والموصل يُسمَّيان دائمًا؛ «كل مزوّد» ليست ميزانية مزوّد.
    if matches!(budget.scope, BudgetScope::Provider | BudgetScope::Connector) && budget.scope_key.is_empty() {
        return Err(BudgetRefusal::ScopeKeyRequired);
    }
    if budget.scope == BudgetScope::Day && !budget.scope_key.is_empty() {
        return Err(BudgetRefusal::ScopeKeyInvalid);
    }
    if budget.scope_key.len() > 200 || budget.scope_key.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(BudgetRefusal::ScopeKeyInvalid);
    }
    if !(1..=100).contains(&budget.warn_ratio_pct) {
        return Err(BudgetRefusal::WarnRatioInvalid);
    }
    Ok(())
}

/// النداء كما يُعرف قبل تنفيذه.
#[derive(Debug, Clone, Default)]
pub struct CallContext {
    pub day: String,
    pub mission_id: Option<String>,
    pub project_id: Option<String>,
    pub provider_id: Option<String>,
    pub connector_id: Option<String>,
}

/// ما يُحجز لنداء. الكلفة `None` تعني أن لا سعر يسمح بتقديرها.
#[derive(Debug, Clone, Default)]
pub struct Planned {
    pub cost: Option<(u64, String)>,
    pub tokens: u64,
    pub external_calls: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BudgetUse {
    pub budget_id: String,
    pub scope: BudgetScope,
    pub scope_key: String,
    pub dimension: BudgetDimension,
    pub mode: BudgetMode,
    pub limit: u64,
    pub used: u64,
    pub reserved: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// نداءات تحت هذه الميزانية لم تُقس كلفتها. لا تُحسب ولا تُخفى.
    pub unmetered_calls: u64,
    pub state: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BudgetDecision {
    Allow,
    /// ليّنة تجاوزت عتبة التنبيه أو الحدّ نفسه: يُسمح ويُنبَّه.
    Warn(Vec<BudgetUse>),
    /// صلبة لا تتّسع: يُمنع قبل أي أثر.
    Block(BudgetUse, &'static str),
}

struct Reservation {
    id: String,
    budget_id: String,
    amount: u64,
}

pub struct BudgetBook {
    db: Arc<Database>,
    ledger: Arc<UsageLedger>,
    reservations: Mutex<Vec<Reservation>>,
}

fn applies(budget: &Budget, ctx: &CallContext) -> bool {
    let key = &budget.scope_key;
    match budget.scope {
        BudgetScope::Mission => ctx.mission_id.as_ref().is_some_and(|m| key.is_empty() || key == m),
        BudgetScope::Project => ctx.project_id.as_ref().is_some_and(|p| key.is_empty() || key == p),
        BudgetScope::Day => true,
        BudgetScope::Provider => ctx.provider_id.as_deref() == Some(key.as_str()),
        BudgetScope::Connector => ctx.connector_id.as_deref() == Some(key.as_str()),
    }
}

fn filter_for(budget: &Budget, ctx: &CallContext) -> UsageFilter {
    let mut filter = UsageFilter::default();
    match budget.scope {
        BudgetScope::Mission => filter.mission_id = ctx.mission_id.clone(),
        BudgetScope::Project => filter.project_id = ctx.project_id.clone(),
        BudgetScope::Day => filter.day = Some(ctx.day.clone()),
        BudgetScope::Provider => {
            filter.day = Some(ctx.day.clone());
            filter.provider_id = Some(budget.scope_key.clone());
        }
        BudgetScope::Connector => {
            filter.day = Some(ctx.day.clone());
            filter.connector_id = Some(budget.scope_key.clone());
        }
    }
    filter
}

/// ما تستهلكه سجلّات من بُعد ميزانية. الكلفة بعملتها ومن مصدر معلوم وحده.
fn consumed(budget: &Budget, records: &[UsageRecord]) -> (u64, u64) {
    let mut used = 0u64;
    let mut unmetered = 0u64;
    for record in records {
        match budget.dimension {
            BudgetDimension::ExternalCalls => used = used.saturating_add(record.external_requests),
            BudgetDimension::ModelTokens => {
                if record.category == super::model::UsageCategory::Model {
                    // المقدَّر حدّ أعلى محافظ (T-8): يُحسب على الميزانية فتُلزم، ويبقى موسومًا تقديرًا في السجلّ والملخّص.
                    if matches!(record.tokens_provenance, Provenance::ProviderReported | Provenance::Estimated) {
                        used = used.saturating_add(record.tokens());
                    } else {
                        unmetered += 1;
                    }
                }
            }
            BudgetDimension::CostMicros => match (&record.cost.micros, &record.cost.currency) {
                (Some(m), Some(c)) if Some(c) == budget.currency.as_ref() && record.cost.provenance != Provenance::Unknown => used = used.saturating_add(*m),
                _ => {
                    if record.external_requests > 0 || record.category == super::model::UsageCategory::Model {
                        unmetered += 1;
                    }
                }
            },
        }
    }
    (used, unmetered)
}

impl BudgetBook {
    pub fn new(db: Arc<Database>, ledger: Arc<UsageLedger>) -> Self {
        Self { db, ledger, reservations: Mutex::new(Vec::new()) }
    }

    pub fn list(&self) -> Result<Vec<Budget>, StorageError> {
        self.db.with(|conn| {
            let mut statement = conn.prepare(
                "SELECT budget_id, scope, scope_key, dimension, limit_value, currency, mode, warn_ratio_pct, created_at, updated_at FROM budgets ORDER BY scope, scope_key, dimension",
            )?;
            let rows = statement.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                ))
            })?;
            let mut out = Vec::new();
            for row in rows {
                let row = row?;
                let (Some(scope), Some(dimension), Some(mode)) = (BudgetScope::parse(&row.1), BudgetDimension::parse(&row.3), BudgetMode::parse(&row.6)) else { continue };
                out.push(Budget {
                    budget_id: row.0,
                    scope,
                    scope_key: row.2,
                    dimension,
                    limit: row.4.max(0) as u64,
                    currency: row.5,
                    mode,
                    warn_ratio_pct: row.7.clamp(1, 100) as u8,
                    created_at: row.8,
                    updated_at: row.9,
                });
            }
            Ok(out)
        })
    }

    /// يحفظ ميزانية، ويستبدل ما كان للنطاق والبعد نفسيهما.
    pub fn put(&self, budget: &Budget) -> Result<Budget, StorageError> {
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO budgets (budget_id, scope, scope_key, dimension, limit_value, currency, mode, warn_ratio_pct, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT (scope, scope_key, dimension) DO UPDATE SET limit_value = excluded.limit_value, currency = excluded.currency,
                    mode = excluded.mode, warn_ratio_pct = excluded.warn_ratio_pct, updated_at = excluded.updated_at",
                params![
                    budget.budget_id,
                    budget.scope.as_str(),
                    budget.scope_key,
                    budget.dimension.as_str(),
                    budget.limit as i64,
                    budget.currency,
                    budget.mode.as_str(),
                    budget.warn_ratio_pct as i64,
                    budget.created_at,
                    budget.updated_at
                ],
            )?;
            Ok(())
        })?;
        Ok(self
            .list()?
            .into_iter()
            .find(|b| b.scope == budget.scope && b.scope_key == budget.scope_key && b.dimension == budget.dimension)
            .unwrap_or_else(|| budget.clone()))
    }

    pub fn remove(&self, budget_id: &str) -> Result<bool, StorageError> {
        self.db.with(|conn| Ok(conn.execute("DELETE FROM budgets WHERE budget_id = ?1", [budget_id])? > 0))
    }

    fn reserved_for(&self, budget_id: &str) -> u64 {
        self.reservations.lock().map(|r| r.iter().filter(|x| x.budget_id == budget_id).map(|x| x.amount).sum()).unwrap_or(0)
    }

    /// حالة ميزانية في سياق نداء، بلا حجز.
    pub fn usage_of(&self, budget: &Budget, ctx: &CallContext) -> Result<BudgetUse, StorageError> {
        let records = self.ledger.records(&filter_for(budget, ctx), 100_000)?;
        let (used, unmetered) = consumed(budget, &records);
        let reserved = self.reserved_for(&budget.budget_id);
        let total = used.saturating_add(reserved);
        let state = if total > budget.limit {
            "EXCEEDED"
        } else if total == budget.limit {
            "AT_LIMIT"
        } else if budget.limit > 0 && total.saturating_mul(100) >= budget.limit.saturating_mul(budget.warn_ratio_pct as u64) {
            "NEAR_LIMIT"
        } else {
            "WITHIN"
        };
        Ok(BudgetUse {
            budget_id: budget.budget_id.clone(),
            scope: budget.scope,
            scope_key: budget.scope_key.clone(),
            dimension: budget.dimension,
            mode: budget.mode,
            limit: budget.limit,
            used,
            reserved,
            currency: budget.currency.clone(),
            unmetered_calls: unmetered,
            state,
        })
    }

    /// يفحص الميزانيات المنطبقة ويحجز ما يُخطَّط له إن سُمح. معرّف الحجز يُعاد للتسوية.
    pub fn reserve(&self, ctx: &CallContext, planned: &Planned, reservation_id: &str) -> Result<BudgetDecision, StorageError> {
        let budgets: Vec<Budget> = self.list()?.into_iter().filter(|b| applies(b, ctx)).collect();
        let mut warnings = Vec::new();
        let mut holds: Vec<(String, u64)> = Vec::new();
        for budget in &budgets {
            let amount = match budget.dimension {
                BudgetDimension::ExternalCalls => planned.external_calls,
                BudgetDimension::ModelTokens => planned.tokens,
                BudgetDimension::CostMicros => match &planned.cost {
                    Some((micros, currency)) if Some(currency) == budget.currency.as_ref() => *micros,
                    Some(_) => 0,
                    None => {
                        // لا سعر: الصلبة تمنع ما لا تستطيع ضمانه، والليّنة تنبّه.
                        let usage = self.usage_of(budget, ctx)?;
                        if budget.mode == BudgetMode::Hard && (planned.external_calls > 0 || planned.tokens > 0) {
                            return Ok(BudgetDecision::Block(usage, "BUDGET_UNPRICED"));
                        }
                        0
                    }
                },
            };
            if amount == 0 && budget.dimension != BudgetDimension::CostMicros {
                continue;
            }
            let usage = self.usage_of(budget, ctx)?;
            let after = usage.used.saturating_add(usage.reserved).saturating_add(amount);
            let over = after > budget.limit;
            match (budget.mode, over) {
                (BudgetMode::Hard, true) => return Ok(BudgetDecision::Block(usage, "BUDGET_EXHAUSTED")),
                (BudgetMode::Soft, true) => warnings.push(usage),
                _ => {
                    if budget.limit > 0 && after.saturating_mul(100) >= budget.limit.saturating_mul(budget.warn_ratio_pct as u64) {
                        warnings.push(usage);
                    }
                }
            }
            if amount > 0 {
                holds.push((budget.budget_id.clone(), amount));
            }
        }
        if let Ok(mut reservations) = self.reservations.lock() {
            for (budget_id, amount) in holds {
                reservations.push(Reservation { id: reservation_id.to_string(), budget_id, amount });
            }
        }
        Ok(if warnings.is_empty() { BudgetDecision::Allow } else { BudgetDecision::Warn(warnings) })
    }

    /// يحرّر حجزًا. الاستعمال الحقيقي يُكتب في الدفتر قبل هذه الخطوة أو بعدها مباشرةً.
    pub fn release(&self, reservation_id: &str) {
        if let Ok(mut reservations) = self.reservations.lock() {
            reservations.retain(|r| r.id != reservation_id);
        }
    }

    /// الميزانيات التي تجاوزها الاستعمال المسجَّل الآن في سياق. للتنبيه بعد التسوية.
    pub fn exceeded(&self, ctx: &CallContext) -> Result<Vec<BudgetUse>, StorageError> {
        let mut out = Vec::new();
        for budget in self.list()?.into_iter().filter(|b| applies(b, ctx)) {
            let usage = self.usage_of(&budget, ctx)?;
            if usage.state != "WITHIN" {
                out.push(usage);
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::{Cost, UsageCategory};
    use super::*;

    fn book() -> (Arc<UsageLedger>, BudgetBook) {
        let db = Arc::new(Database::in_memory().unwrap());
        let ledger = Arc::new(UsageLedger::new(db.clone()));
        (ledger.clone(), BudgetBook::new(db, ledger))
    }

    fn budget(id: &str, scope: BudgetScope, key: &str, dimension: BudgetDimension, limit: u64, mode: BudgetMode) -> Budget {
        Budget {
            budget_id: id.into(),
            scope,
            scope_key: key.into(),
            dimension,
            limit,
            currency: (dimension == BudgetDimension::CostMicros).then(|| "USD".to_string()),
            mode,
            warn_ratio_pct: 80,
            created_at: "t".into(),
            updated_at: "t".into(),
        }
    }

    fn call(ledger: &UsageLedger, id: &str, connector: &str) {
        ledger
            .record(&UsageRecord {
                record_id: id.into(),
                recorded_at: "2026-09-23T10:00:00Z".into(),
                category: UsageCategory::Connector,
                subject_id: id.into(),
                mission_id: Some("m1".into()),
                project_id: None,
                provider_id: None,
                model_id: None,
                connector_id: Some(connector.into()),
                tool_id: None,
                input_tokens: None,
                output_tokens: None,
                cached_tokens: None,
                tokens_provenance: Provenance::Unknown,
                wall_ms: 5,
                external_requests: 1,
                cost: Cost::unknown(),
            })
            .unwrap();
    }

    fn ctx() -> CallContext {
        CallContext { day: "2026-09-23".into(), mission_id: Some("m1".into()), connector_id: Some("c1".into()), ..Default::default() }
    }

    #[test]
    fn a_hard_budget_blocks_the_next_call_and_a_soft_one_warns_but_permits() {
        let (ledger, book) = book();
        book.put(&budget("b1", BudgetScope::Connector, "c1", BudgetDimension::ExternalCalls, 2, BudgetMode::Hard)).unwrap();
        let one = Planned { external_calls: 1, ..Default::default() };
        assert!(matches!(book.reserve(&ctx(), &one, "r1").unwrap(), BudgetDecision::Allow | BudgetDecision::Warn(_)));
        call(&ledger, "u1", "c1");
        book.release("r1");
        assert!(matches!(book.reserve(&ctx(), &one, "r2").unwrap(), BudgetDecision::Warn(_)), "at the limit it should warn");
        call(&ledger, "u2", "c1");
        book.release("r2");
        match book.reserve(&ctx(), &one, "r3").unwrap() {
            BudgetDecision::Block(usage, reason) => {
                assert_eq!(reason, "BUDGET_EXHAUSTED");
                assert_eq!(usage.used, 2);
            }
            other => panic!("a hard budget let the third call through: {other:?}"),
        }
        book.put(&budget("b1", BudgetScope::Connector, "c1", BudgetDimension::ExternalCalls, 2, BudgetMode::Soft)).unwrap();
        assert!(matches!(book.reserve(&ctx(), &one, "r4").unwrap(), BudgetDecision::Warn(_)), "a soft budget blocked");
    }

    #[test]
    fn a_reservation_counts_before_the_call_is_recorded() {
        let (_, book) = book();
        book.put(&budget("b1", BudgetScope::Mission, "", BudgetDimension::ExternalCalls, 1, BudgetMode::Hard)).unwrap();
        let one = Planned { external_calls: 1, ..Default::default() };
        assert!(!matches!(book.reserve(&ctx(), &one, "r1").unwrap(), BudgetDecision::Block(..)));
        // النداء الأول لم يُسجَّل بعد، لكنّ حجزه يمنع الثاني.
        assert!(matches!(book.reserve(&ctx(), &one, "r2").unwrap(), BudgetDecision::Block(..)));
        book.release("r1");
        assert!(!matches!(book.reserve(&ctx(), &one, "r3").unwrap(), BudgetDecision::Block(..)));
    }

    #[test]
    fn a_hard_cost_budget_blocks_a_call_it_cannot_price() {
        let (_, book) = book();
        book.put(&budget("b1", BudgetScope::Day, "", BudgetDimension::CostMicros, 1_000_000, BudgetMode::Hard)).unwrap();
        let unpriced = Planned { cost: None, external_calls: 1, tokens: 0 };
        assert!(matches!(book.reserve(&ctx(), &unpriced, "r1").unwrap(), BudgetDecision::Block(_, "BUDGET_UNPRICED")));
        let priced = Planned { cost: Some((10, "USD".into())), external_calls: 1, tokens: 0 };
        assert!(!matches!(book.reserve(&ctx(), &priced, "r2").unwrap(), BudgetDecision::Block(..)));
    }

    #[test]
    fn a_budget_is_validated_before_it_is_stored() {
        let mut b = budget("b", BudgetScope::Connector, "", BudgetDimension::ExternalCalls, 1, BudgetMode::Hard);
        assert_eq!(validate(&b), Err(BudgetRefusal::ScopeKeyRequired));
        b.scope_key = "c1".into();
        b.currency = Some("USD".into());
        assert_eq!(validate(&b), Err(BudgetRefusal::CurrencyNotApplicable));
        b.dimension = BudgetDimension::CostMicros;
        b.currency = None;
        assert_eq!(validate(&b), Err(BudgetRefusal::CurrencyRequired));
        b.currency = Some("USD".into());
        assert_eq!(validate(&b), Ok(()));
    }

    #[test]
    fn budgets_survive_a_new_book_over_the_same_store() {
        let db = Arc::new(Database::in_memory().unwrap());
        let ledger = Arc::new(UsageLedger::new(db.clone()));
        BudgetBook::new(db.clone(), ledger.clone()).put(&budget("b1", BudgetScope::Day, "", BudgetDimension::ExternalCalls, 5, BudgetMode::Hard)).unwrap();
        call(&ledger, "u1", "c1");
        let again = BudgetBook::new(db, ledger);
        let list = again.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(again.usage_of(&list[0], &ctx()).unwrap().used, 1, "usage did not recover");
    }
}
