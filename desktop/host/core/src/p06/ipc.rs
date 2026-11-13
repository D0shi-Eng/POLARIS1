// طبقة IPC لـPhase-06: حمولة مُتحقَّق منها (بالمخطط في البوابة) إلى نداء خدمة، ونتيجة إلى JSON.
//
// القائمة مغلقة ومطابقة للسجل. وما ليس فيها هو الخاصيّة الأمنية: لا `connector.invoke`
// ولا `connector.execute` ولا `connector.call`، ولا عملية تأخذ عنوانًا حرًّا ولا تكشف
// سرًّا. العارض يسجّل ويضبط ويفحص ويقرأ؛ وعملية الموصل تبدأ من زمن تشغيل المهمّة وحده.

use serde_json::Value;

use crate::ipc::errors::{DesktopErrorCategory, HostError};
use crate::p03::service::Phase03;

use super::config::model::{format_decimal, parse_decimal, Layer};
use super::config::registry::catalogue;
use super::config::{ConfigScope, ConfigWriteError, Section};
use super::connector::model::{ConnectorCategory, RateLimit};
use super::connector::service::{ConnectorServiceError, RegisterInput, RestInput};
use super::cost::budget::{validate as validate_budget, Budget, BudgetDimension, BudgetMode, BudgetScope, CallContext};
use super::cost::ledger::UsageFilter;
use super::cost::model::{Provenance, UsageCategory};
use super::cost::pricing::{validate as validate_pricing, PricingEntry, PricingTarget, PricingUnit};
use super::observe::event::{Component, Severity};
use super::service::Phase06;

/// العمليات التي يملكها Phase-06. مغلقة ومطابقة للسجل.
pub const OPERATIONS: [&str; 30] = [
    "connector.list",
    "connector.get",
    "connector.register",
    "connector.configure",
    "connector.remove",
    "connector.test",
    "connector.credential.set",
    "connector.credential.clear",
    "connector.openapi.import",
    "connector.openapi.approve",
    "connector.preset.list",
    "connector.preset.register",
    "usage.summary",
    "usage.list",
    "budget.list",
    "budget.set",
    "budget.remove",
    "pricing.list",
    "pricing.set",
    "pricing.remove",
    "observability.health",
    "observability.events",
    "observability.metrics",
    "observability.errors",
    "observability.alerts",
    "diagnostics.export",
    "config.describe",
    "config.effective",
    "config.set",
    "config.reset",
];

/// أسماء يحرسها هذا الملف بالاسم: وجود أحدها يعني أن للعارض مسارًا إلى خدمة خارجية.
pub const FORBIDDEN_OPERATIONS: [&str; 9] = [
    "connector.invoke",
    "connector.execute",
    "connector.call",
    "connector.request",
    "connector.secret.get",
    "connector.credential.get",
    "config.raw_set",
    "budget.override",
    "http.request",
];

/// رفض قيمة إعداد كما يعبر الحدّ. ما يرفضه القرار الأمني (توسيع، أو تجاوز سقف البناء، أو
/// طبقة لا تملك الإعداد، أو ميزة ليست في هذا البناء) رفضُ سياسة لا خطأ صياغة، فيُعرض كذلك.
fn refusal_error(refusal: &super::config::ValueRefusal) -> HostError {
    use super::config::ValueRefusal;
    match refusal {
        ValueRefusal::WidensSecurity | ValueRefusal::AboveCeiling | ValueRefusal::LayerNotPermitted | ValueRefusal::Unavailable => HostError::permission_denied(refusal.as_str()),
        _ => HostError::validation(refusal.as_str()),
    }
}

fn required_str(payload: &Value, key: &str) -> Result<String, HostError> {
    payload.get(key).and_then(Value::as_str).map(str::to_string).ok_or_else(|| HostError::validation(format!("{key} is absent")).at(format!("/{key}")))
}

fn optional_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, HostError> {
    serde_json::to_value(value).map_err(|e| HostError::internal(format!("result serialisation failed: {e}")))
}

fn conflict(detail: impl Into<String>) -> HostError {
    HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", detail)
}

fn connector_error(error: ConnectorServiceError) -> HostError {
    match error {
        ConnectorServiceError::Invalid { code, pointer } => HostError::validation(code).at(pointer),
        ConnectorServiceError::NotFound => HostError::validation("no such connector or import").at("/connector_id"),
        ConnectorServiceError::NotAvailable(code) => HostError::feature_not_available(code),
        ConnectorServiceError::Conflict(code) => conflict(code),
        ConnectorServiceError::Storage(detail) => HostError::internal(format!("connector storage: {detail}")),
    }
}

fn storage(error: crate::storage::StorageError) -> HostError {
    HostError::internal(format!("phase-06 storage: {error}"))
}

fn unavailable() -> HostError {
    HostError::feature_not_available("connectors need the tool gateway, which is unavailable on this host")
}

/// نطاق إعدادات مهمّة: مشروعها من Phase-03، لا من العارض.
fn mission_scope(phase03: Option<&Phase03>, mission_id: &str) -> Result<ConfigScope, HostError> {
    let Some(p03) = phase03 else { return Err(HostError::feature_not_available("missions are unavailable")) };
    let mission = p03.get(mission_id)?;
    Ok(ConfigScope::mission(mission_id, mission.mission.project_id.clone()))
}

fn scope_of(phase03: Option<&Phase03>, payload: &Value) -> Result<ConfigScope, HostError> {
    match (optional_str(payload, "mission_id"), optional_str(payload, "project_id")) {
        (Some(mission), _) => mission_scope(phase03, mission),
        (None, Some(project)) => Ok(ConfigScope::project(project)),
        (None, None) => Ok(ConfigScope::global()),
    }
}

pub fn handle(p06: &Phase06, phase03: Option<&Phase03>, operation: &str, payload: &Value, _session: &str) -> Result<Value, HostError> {
    match operation {
        // ——— الموصلات
        "connector.list" => to_value(&p06.connectors.as_ref().ok_or_else(unavailable)?.list()),
        "connector.get" => to_value(&p06.connectors.as_ref().ok_or_else(unavailable)?.get(&required_str(payload, "connector_id")?).map_err(connector_error)?),
        "connector.register" => {
            let service = p06.connectors.as_ref().ok_or_else(unavailable)?;
            let input: RegisterInput = serde_json::from_value(payload.clone()).map_err(|e| HostError::validation(format!("the registration does not match its schema: {e}")))?;
            to_value(&service.register(input).map_err(connector_error)?)
        }
        "connector.configure" => {
            let service = p06.connectors.as_ref().ok_or_else(unavailable)?;
            let rate = match (payload.get("requests_per_minute").and_then(Value::as_u64), payload.get("max_concurrent").and_then(Value::as_u64)) {
                (None, None) => None,
                (rpm, conc) => {
                    let current = service.get(&required_str(payload, "connector_id")?).map_err(connector_error)?.connector.rest;
                    let base = current.map(|r| RateLimit { requests_per_minute: r.requests_per_minute, max_concurrent: r.max_concurrent }).unwrap_or_default();
                    Some(RateLimit {
                        requests_per_minute: rpm.map(|v| v.min(u32::MAX as u64) as u32).unwrap_or(base.requests_per_minute),
                        max_concurrent: conc.map(|v| v.min(u32::MAX as u64) as u32).unwrap_or(base.max_concurrent),
                    })
                }
            };
            let enabled = payload.get("enabled").and_then(Value::as_bool);
            to_value(&service.configure(&required_str(payload, "connector_id")?, enabled, optional_str(payload, "display_name"), rate).map_err(connector_error)?)
        }
        "connector.remove" => to_value(&p06.connectors.as_ref().ok_or_else(unavailable)?.remove(&required_str(payload, "connector_id")?).map_err(connector_error)?),
        "connector.test" => to_value(&p06.connectors.as_ref().ok_or_else(unavailable)?.test(&required_str(payload, "connector_id")?).map_err(connector_error)?),
        "connector.credential.set" => to_value(&p06.connectors.as_ref().ok_or_else(unavailable)?.credential_set(&required_str(payload, "connector_id")?).map_err(connector_error)?),
        "connector.credential.clear" => to_value(&p06.connectors.as_ref().ok_or_else(unavailable)?.credential_clear(&required_str(payload, "connector_id")?).map_err(connector_error)?),
        "connector.openapi.import" => to_value(&p06.connectors.as_ref().ok_or_else(unavailable)?.import(&required_str(payload, "spec")?).map_err(connector_error)?),
        // PHASE-05: إعدادات جاهزة مدمجة. التسجيل يمرّ بالمسار نفسه وفحصه، والموصل معطّل وبلا اعتماد حتى يضع المستخدم رمزه.
        "connector.preset.list" => Ok(serde_json::json!({ "presets": super::connector::presets::list() })),
        "connector.preset.register" => {
            let service = p06.connectors.as_ref().ok_or_else(unavailable)?;
            let display_name = payload.get("display_name").and_then(Value::as_str);
            to_value(&service.register_preset(&required_str(payload, "preset_id")?, display_name).map_err(connector_error)?)
        }
        "connector.openapi.approve" => {
            let service = p06.connectors.as_ref().ok_or_else(unavailable)?;
            let ids: Vec<String> = payload.get("operation_ids").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
            let category = ConnectorCategory::parse(&required_str(payload, "category")?).ok_or_else(|| HostError::validation("unknown category").at("/category"))?;
            let rest: RestInput = serde_json::from_value(payload.get("rest").cloned().unwrap_or(Value::Null)).map_err(|e| HostError::validation(format!("rest: {e}")).at("/rest"))?;
            to_value(&service.approve_import(&required_str(payload, "import_id")?, &ids, &required_str(payload, "display_name")?, category, rest).map_err(connector_error)?)
        }

        // ——— الاستعمال والكلفة
        "usage.summary" => usage_summary(p06, payload),
        "usage.list" => {
            let category = match optional_str(payload, "category") {
                Some(c) => Some(UsageCategory::parse(c).ok_or_else(|| HostError::validation("unknown category").at("/category"))?),
                None => None,
            };
            let filter = UsageFilter { mission_id: optional_str(payload, "mission_id").map(str::to_string), category, ..Default::default() };
            let limit = payload.get("limit").and_then(Value::as_u64).unwrap_or(100) as usize;
            let records = p06.books.ledger.records(&filter, limit.min(500)).map_err(storage)?;
            Ok(serde_json::json!({ "records": records }))
        }
        "budget.list" => {
            let ctx = CallContext {
                day: p06.observe.clock().now().chars().take(10).collect(),
                mission_id: optional_str(payload, "mission_id").map(str::to_string),
                project_id: optional_str(payload, "project_id").map(str::to_string),
                provider_id: None,
                connector_id: None,
            };
            let mut budgets = Vec::new();
            for budget in p06.books.budgets.list().map_err(storage)? {
                let mut local = ctx.clone();
                match budget.scope {
                    BudgetScope::Provider => local.provider_id = Some(budget.scope_key.clone()),
                    BudgetScope::Connector => local.connector_id = Some(budget.scope_key.clone()),
                    BudgetScope::Mission if !budget.scope_key.is_empty() => local.mission_id = Some(budget.scope_key.clone()),
                    BudgetScope::Project if !budget.scope_key.is_empty() => local.project_id = Some(budget.scope_key.clone()),
                    _ => {}
                }
                let usage = p06.books.budgets.usage_of(&budget, &local).map_err(storage)?;
                budgets.push(serde_json::json!({
                    "budget": budget,
                    "window": budget.scope.window(),
                    "usage": usage,
                    "limit_display": budget_display(budget.dimension, budget.limit),
                    "used_display": budget_display(budget.dimension, usage.used),
                }));
            }
            Ok(serde_json::json!({ "budgets": budgets }))
        }
        "budget.set" => budget_set(p06, payload),
        "budget.remove" => {
            let id = required_str(payload, "budget_id")?;
            let removed = p06.books.budgets.remove(&id).map_err(storage)?;
            audit(p06, crate::audit::AuditEventType::BudgetRemoved, &id, removed);
            Ok(serde_json::json!({ "budget_id": id, "removed": removed }))
        }
        "pricing.list" => Ok(serde_json::json!({ "entries": p06.books.pricing.list().map_err(storage)?.iter().map(pricing_view).collect::<Vec<_>>() })),
        "pricing.set" => pricing_set(p06, payload),
        "pricing.remove" => {
            let id = required_str(payload, "pricing_id")?;
            let removed = p06.books.pricing.remove(&id).map_err(storage)?;
            audit(p06, crate::audit::AuditEventType::PricingRemoved, &id, removed);
            Ok(serde_json::json!({ "pricing_id": id, "removed": removed }))
        }

        // ——— الرصد
        "observability.health" => to_value(&p06.health()),
        "observability.events" => {
            let default_page = p06.config.uint("general.activity_page_size", &ConfigScope::global()) as usize;
            let limit = payload.get("limit").and_then(Value::as_u64).map(|n| n as usize).unwrap_or(default_page);
            let component = match optional_str(payload, "component") {
                Some(c) => Some(Component::parse(c).ok_or_else(|| HostError::validation("unknown component").at("/component"))?),
                None => None,
            };
            let severity = match optional_str(payload, "min_severity") {
                Some(s) => Some(Severity::parse(s).ok_or_else(|| HostError::validation("unknown severity").at("/min_severity"))?),
                None => None,
            };
            Ok(serde_json::json!({ "events": p06.observe.events.recent(limit.min(500), component, severity), "label": "STRUCTURED EVENTS — DIAGNOSTIC, NOT AUDIT" }))
        }
        "observability.metrics" => Ok(serde_json::json!({ "metrics": p06.observe.metrics.snapshot(), "queue_depths": p06.queue_depths() })),
        "observability.errors" => {
            let snapshot = p06.observe.metrics.snapshot();
            Ok(serde_json::json!({ "errors_by_code": snapshot.errors_by_code, "overflow": snapshot.error_overflow, "distinct_keys": snapshot.distinct_error_keys, "scope": snapshot.scope }))
        }
        "observability.alerts" => {
            let include = payload.get("include_resolved").and_then(Value::as_bool).unwrap_or(false);
            Ok(serde_json::json!({ "alerts": p06.observe.alerts.list(include) }))
        }
        "diagnostics.export" => to_value(&p06.export_diagnostics()),

        // ——— الإعدادات
        "config.describe" => config_describe(p06),
        "config.effective" => {
            let scope = scope_of(phase03, payload)?;
            let values: Vec<_> = p06.config.effective(&scope).iter().map(|r| r.view()).collect();
            Ok(serde_json::json!({
                "scope": { "project_id": scope.project_id, "mission_id": scope.mission_id },
                "values": values,
                "status": p06.config.status(),
                "sensitive": p06.sensitive_statuses(),
            }))
        }
        "config.set" => {
            let layer = Layer::parse(&required_str(payload, "layer")?).ok_or_else(|| HostError::validation("unknown layer").at("/layer"))?;
            let key = required_str(payload, "key")?;
            let scope_id = optional_str(payload, "scope_id");
            let value = payload.get("value").cloned().ok_or_else(|| HostError::validation("value is absent").at("/value"))?;
            // سياق الطبقة الأمّ يُقرأ من المضيف: مشروع المهمّة من Phase-03، لا من الحمولة.
            let context = match (layer, scope_id) {
                (Layer::Mission, Some(mission)) => mission_scope(phase03, mission)?,
                _ => ConfigScope::global(),
            };
            match p06.config.set(layer, scope_id, &key, &value, &context) {
                Ok(resolved) => Ok(serde_json::json!({ "key": key, "layer": layer.as_str(), "value": resolved.view() })),
                Err(ConfigWriteError::Refused(refusal)) => Err(refusal_error(&refusal).at("/value")),
                Err(ConfigWriteError::ScopeInvalid) => Err(HostError::validation("SCOPE_INVALID").at("/scope_id")),
                Err(ConfigWriteError::Store(detail)) => Err(HostError::new(DesktopErrorCategory::ConfigUnavailable, "DEPENDENCY_UNAVAILABLE", detail)),
            }
        }
        "config.reset" => {
            let layer = Layer::parse(&required_str(payload, "layer")?).ok_or_else(|| HostError::validation("unknown layer").at("/layer"))?;
            let key = required_str(payload, "key")?;
            let scope_id = optional_str(payload, "scope_id");
            match p06.config.reset(layer, scope_id, &key) {
                Ok(removed) => {
                    let scope = match (layer, scope_id) {
                        (Layer::Project, Some(p)) => ConfigScope::project(p),
                        (Layer::Mission, Some(m)) => mission_scope(phase03, m).unwrap_or_else(|_| ConfigScope::mission(m, None)),
                        _ => ConfigScope::global(),
                    };
                    let value = p06.config.resolve(&key, &scope).map(|r| r.view());
                    Ok(serde_json::json!({ "key": key, "layer": layer.as_str(), "removed": removed, "value": value }))
                }
                Err(ConfigWriteError::Refused(refusal)) => Err(refusal_error(&refusal).at("/key")),
                Err(ConfigWriteError::ScopeInvalid) => Err(HostError::validation("SCOPE_INVALID").at("/scope_id")),
                Err(ConfigWriteError::Store(detail)) => Err(HostError::new(DesktopErrorCategory::ConfigUnavailable, "DEPENDENCY_UNAVAILABLE", detail)),
            }
        }
        other => Err(HostError::internal(format!("routed operation {other} has no Phase-06 owner"))),
    }
}

fn audit(p06: &Phase06, event: crate::audit::AuditEventType, subject: &str, ok: bool) {
    let _ = p06.observe_audit().append(&crate::audit::AuditRecord::new(
        event,
        "cost",
        subject,
        if ok { crate::audit::AuditOutcome::Success } else { crate::audit::AuditOutcome::Denied },
        serde_json::json!({}),
    ));
}

fn budget_display(dimension: BudgetDimension, value: u64) -> String {
    match dimension {
        BudgetDimension::CostMicros => format_decimal(value.min(i64::MAX as u64) as i64),
        _ => value.to_string(),
    }
}

fn budget_set(p06: &Phase06, payload: &Value) -> Result<Value, HostError> {
    let scope = BudgetScope::parse(&required_str(payload, "scope")?).ok_or_else(|| HostError::validation("unknown scope").at("/scope"))?;
    let dimension = BudgetDimension::parse(&required_str(payload, "dimension")?).ok_or_else(|| HostError::validation("unknown dimension").at("/dimension"))?;
    let global = ConfigScope::global();
    let mode = match optional_str(payload, "mode") {
        Some(m) => BudgetMode::parse(m).ok_or_else(|| HostError::validation("unknown mode").at("/mode"))?,
        None => BudgetMode::parse(&p06.config.code("budgets.default_mode", &global)).unwrap_or(BudgetMode::Hard),
    };
    let warn = payload.get("warn_ratio_pct").and_then(Value::as_u64).unwrap_or_else(|| p06.config.uint("budgets.default_warn_ratio", &global)).clamp(1, 100) as u8;
    // الحدّ: عدد صحيح للرموز والنداءات، ونصّ عشري للكلفة يُحلّ إلى أجزاء المليون.
    let limit = match dimension {
        BudgetDimension::CostMicros => {
            let text = required_str(payload, "limit")?;
            let micros = parse_decimal(&text).filter(|m| *m >= 0).ok_or_else(|| HostError::validation("the cost limit must be a non-negative decimal").at("/limit"))?;
            micros as u64
        }
        _ => payload.get("limit").and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))).ok_or_else(|| HostError::validation("the limit must be a non-negative integer").at("/limit"))?,
    };
    let now = p06.observe.clock().now();
    let budget = Budget {
        budget_id: p06.observe.clock().id(),
        scope,
        scope_key: optional_str(payload, "scope_key").unwrap_or("").to_string(),
        dimension,
        limit,
        currency: optional_str(payload, "currency").map(str::to_string),
        mode,
        warn_ratio_pct: warn,
        created_at: now.clone(),
        updated_at: now,
    };
    validate_budget(&budget).map_err(|r| HostError::validation(r.as_str()).at("/scope_key"))?;
    let stored = p06.books.budgets.put(&budget).map_err(storage)?;
    audit(p06, crate::audit::AuditEventType::BudgetSet, &stored.budget_id, true);
    Ok(serde_json::json!({ "budget": stored, "limit_display": budget_display(stored.dimension, stored.limit) }))
}

fn pricing_view(entry: &PricingEntry) -> Value {
    serde_json::json!({
        "entry": entry,
        "amount": format_decimal(entry.amount_micros.min(i64::MAX as u64) as i64),
        // السعر مصدره المستخدم؛ كل كلفة تُحسب منه مقدَّرة، لا فاتورة.
        "provenance": Provenance::Estimated.as_str(),
    })
}

fn pricing_set(p06: &Phase06, payload: &Value) -> Result<Value, HostError> {
    let target_kind = PricingTarget::parse(&required_str(payload, "target_kind")?).ok_or_else(|| HostError::validation("unknown target").at("/target_kind"))?;
    let unit = PricingUnit::parse(&required_str(payload, "unit")?).ok_or_else(|| HostError::validation("unknown unit").at("/unit"))?;
    let amount = parse_decimal(&required_str(payload, "amount")?).filter(|m| *m >= 0).ok_or_else(|| HostError::validation("the amount must be a non-negative decimal").at("/amount"))?;
    let entry = PricingEntry {
        pricing_id: p06.observe.clock().id(),
        target_kind,
        target_id: required_str(payload, "target_id")?,
        unit,
        amount_micros: amount as u64,
        currency: required_str(payload, "currency")?,
        source_note: required_str(payload, "source_note")?.trim().to_string(),
        created_at: p06.observe.clock().now(),
    };
    validate_pricing(&entry).map_err(|r| HostError::validation(r.as_str()).at("/amount"))?;
    p06.books.pricing.put(&entry).map_err(storage)?;
    audit(p06, crate::audit::AuditEventType::PricingSet, &entry.pricing_id, true);
    let stored = p06.books.pricing.list().map_err(storage)?.into_iter().find(|e| e.target_kind == entry.target_kind && e.target_id == entry.target_id && e.unit == entry.unit).unwrap_or(entry);
    Ok(serde_json::json!({ "entry": pricing_view(&stored) }))
}

fn usage_summary(p06: &Phase06, payload: &Value) -> Result<Value, HostError> {
    let show_estimated = p06.config.bool("cost.show_estimated", &ConfigScope::global());
    let today: String = p06.observe.clock().now().chars().take(10).collect();
    let ledger = &p06.books.ledger;
    let hide = |mut totals: super::cost::ledger::UsageTotals| {
        if !show_estimated {
            totals.costs.retain(|b| b.provenance != Provenance::Estimated);
        }
        totals
    };
    let day = hide(ledger.totals(&UsageFilter { day: Some(today.clone()), ..Default::default() }).map_err(storage)?);
    let mission = match optional_str(payload, "mission_id") {
        Some(m) => Some(hide(ledger.totals(&UsageFilter { mission_id: Some(m.to_string()), ..Default::default() }).map_err(storage)?)),
        None => None,
    };
    let project = match optional_str(payload, "project_id") {
        Some(p) => Some(hide(ledger.totals(&UsageFilter { project_id: Some(p.to_string()), ..Default::default() }).map_err(storage)?)),
        None => None,
    };
    let all = UsageFilter::default();
    let by_provider: Vec<_> = ledger.grouped(&all, |r| r.provider_id.clone()).map_err(storage)?.into_iter().map(hide).collect();
    let by_model: Vec<_> = ledger.grouped(&all, |r| r.model_id.clone()).map_err(storage)?.into_iter().map(hide).collect();
    let by_connector: Vec<_> = ledger.grouped(&all, |r| r.connector_id.clone()).map_err(storage)?.into_iter().map(hide).collect();
    let by_category: Vec<_> = ledger.grouped(&all, |r| Some(r.category.as_str().to_string())).map_err(storage)?.into_iter().map(hide).collect();
    Ok(serde_json::json!({
        "day": today,
        "today": day,
        "mission": mission,
        "project": project,
        "by_provider": by_provider,
        "by_model": by_model,
        "by_connector": by_connector,
        "by_category": by_category,
        "show_estimated": show_estimated,
        "provenance_vocabulary": Provenance::ALL.iter().map(|p| p.as_str()).collect::<Vec<_>>(),
        "note": "amounts of different provenance and currency are never summed together; no currency is converted",
    }))
}

fn config_describe(p06: &Phase06) -> Result<Value, HostError> {
    let sections: Vec<Value> = Section::ALL
        .iter()
        .map(|section| {
            let settings: Vec<Value> = catalogue()
                .iter()
                .filter(|d| d.section == *section)
                .map(|d| {
                    serde_json::json!({
                        "key": d.key,
                        "kind": d.kind.as_str(),
                        "state": d.state,
                        "default": d.default_value().to_json(),
                        "layers": d.layers.iter().map(|l| l.as_str()).collect::<Vec<_>>(),
                        "security_bearing": d.security_bearing(),
                        "ceiling": d.ceiling_value().map(|c| c.to_json()),
                        "applies": d.applies,
                        "consumer": d.consumer,
                        "label_key": format!("config.setting.{}", d.key),
                        "hint_key": format!("config.hint.{}", d.key),
                        "bounds": {
                            "min": (matches!(d.kind, super::config::SettingKind::Integer | super::config::SettingKind::Duration | super::config::SettingKind::Bytes)).then_some(d.bounds.min),
                            "max": (matches!(d.kind, super::config::SettingKind::Integer | super::config::SettingKind::Duration | super::config::SettingKind::Bytes)).then_some(d.bounds.max),
                            "min_decimal": (d.kind == super::config::SettingKind::Decimal).then(|| format_decimal(d.bounds.min)),
                            "max_decimal": (d.kind == super::config::SettingKind::Decimal).then(|| format_decimal(d.bounds.max)),
                            "allowed": d.bounds.allowed,
                            "max_length": (d.bounds.max_len > 0).then_some(d.bounds.max_len),
                            "max_items": (d.kind == super::config::SettingKind::List).then_some(d.bounds.max_items),
                        },
                    })
                })
                .collect();
            serde_json::json!({ "section": section.as_str(), "label_key": format!("config.section.{}", section.as_str()), "settings": settings })
        })
        .collect();
    Ok(serde_json::json!({ "sections": sections, "status": p06.config.status(), "layers": Layer::ALL.iter().map(|l| l.as_str()).collect::<Vec<_>>() }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operation_list_is_closed_and_carries_no_path_to_a_service() {
        // 28 + `connector.preset.list` و`connector.preset.register` (PHASE-05).
        assert_eq!(OPERATIONS.len(), 30);
        for forbidden in FORBIDDEN_OPERATIONS {
            assert!(!OPERATIONS.contains(&forbidden), "{forbidden} is in the Phase-06 vocabulary");
        }
        for operation in OPERATIONS {
            for verb in ["invoke", "execute", "call", "request", "raw", "get_secret", "reveal"] {
                assert!(!operation.contains(verb), "{operation} reads like a path to an external service or a secret");
            }
        }
    }
}
