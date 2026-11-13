// P06 — إعادة التشغيل: ما يبقى يبقى، وما لا يُعرف لا يُعاد، والصحّة تبدأ مجهولة.
//
// إقلاعان حقيقيان على مجلّد بيانات واحد: المضيف الأول يُسقط كاملًا (مع قاعدته) قبل أن
// يُبنى الثاني، فكل ما يقرؤه الثاني جاء من القرص.

mod p06_support;

use p06_support::{build_with, connector_fixture, temp_dir};
use serde_json::json;

#[test]
fn p06_persistence_connectors_settings_budgets_prices_and_usage_survive_a_restart_and_health_starts_unknown() {
    let dir = temp_dir("restart");
    let connector = connector_fixture();
    let port = connector.0.port;
    let (id, budget_id) = {
        let h = build_with(Some(dir.clone()), None, connector);
        let id = h.register_fixture();
        h.ok("connector.test", json!({ "connector_id": id }));
        assert_eq!(h.ok("connector.get", json!({ "connector_id": id }))["connector"]["health"]["state"], "HEALTHY");
        h.ok("config.set", json!({ "layer": "USER", "key": "privacy.diagnostics_level", "value": "DETAILED" }));
        h.ok("config.set", json!({ "layer": "SECURITY", "key": "connectors.max_external_calls_per_mission", "value": 7 }));
        let budget = h.ok("budget.set", json!({ "scope": "CONNECTOR", "scope_key": id, "dimension": "EXTERNAL_CALLS", "limit": 9, "mode": "HARD" }));
        h.ok("pricing.set", json!({ "target_kind": "CONNECTOR", "target_id": id, "unit": "PER_CALL", "amount": "0.5", "currency": "EUR", "source_note": "TEST FIXTURE price" }));
        // نداء كتابة يبقى «جاريًا» عند الإقلاع التالي: يُكتب في دفتر التكرار كما لو قُطع.
        let db = h.host().phase02().unwrap().db.clone();
        db.with(|c| {
            c.execute(
                "INSERT INTO connector_idempotency (connector_id, operation_id, idempotency_key, payload_digest, state, result_json, invocation_id, created_at, updated_at)
                 VALUES (?1, 'items.create', 'interrupted-key-0001', 'd', 'IN_FLIGHT', NULL, 'i', 't', 't')",
                [&id],
            )?;
            Ok(())
        })
        .unwrap();
        (id, budget["budget"]["budget_id"].as_str().unwrap().to_string())
    };

    let h = build_with(Some(dir.clone()), None, connector_fixture_on(port));
    let view = h.ok("connector.get", json!({ "connector_id": id }));
    assert_eq!(view["connector"]["descriptor"]["enabled"], true, "the connector configuration did not survive");
    assert_eq!(view["connector"]["operation_count"], 14);
    assert_eq!(view["connector"]["auth"]["reference"], format!("secret://connectors/{id}/default"), "the auth reference did not survive");
    assert_eq!(view["connector"]["health"]["state"], "UNKNOWN", "a health measurement from the previous start was shown as present");
    let effective = h.ok("config.effective", json!({}));
    let value = |key: &str| effective["values"].as_array().unwrap().iter().find(|v| v["key"] == key).unwrap().clone();
    assert_eq!(value("privacy.diagnostics_level")["value"], "DETAILED");
    assert_eq!(value("connectors.max_external_calls_per_mission")["value"], 7);
    assert_eq!(value("connectors.max_external_calls_per_mission")["source"], "SECURITY_CLAMP");
    let budgets = h.ok("budget.list", json!({}))["budgets"].as_array().cloned().unwrap();
    let recovered = budgets.iter().find(|b| b["budget"]["budget_id"] == budget_id).expect("the budget did not survive");
    assert_eq!(recovered["usage"]["used"], 1, "budget usage did not recover from the ledger");
    assert_eq!(h.ok("pricing.list", json!({}))["entries"].as_array().unwrap().len(), 1);
    assert!(!h.ok("usage.list", json!({}))["records"].as_array().unwrap().is_empty(), "usage did not persist");
    // النداء الذي قطعه الإقلاع لا يُعاد: نتيجته مجهولة، ويُرفض تكراره آليًّا.
    let gateway = h.host().phase06().unwrap().gateway.clone().unwrap();
    assert_eq!(gateway.recovered_at_start, 1);
    let state: String = h
        .host()
        .phase02()
        .unwrap()
        .db
        .with(|c| Ok(c.query_row("SELECT state FROM connector_idempotency WHERE idempotency_key = 'interrupted-key-0001'", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(state, "OUTCOME_UNKNOWN");
    // والصحّة تُقاس من جديد في هذا الإقلاع.
    assert_eq!(h.ok("connector.test", json!({ "connector_id": id }))["health"]["state"], "HEALTHY");
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p06_persistence_a_newer_config_schema_fails_closed_after_a_restart() {
    let dir = temp_dir("newer-config");
    {
        let h = build_with(Some(dir.clone()), None, connector_fixture());
        h.ok("config.set", json!({ "layer": "USER", "key": "privacy.allow_connector_egress", "value": false }));
        h.host()
            .phase02()
            .unwrap()
            .db
            .with(|c| {
                c.execute("UPDATE config_meta SET meta_value = '9' WHERE meta_key = 'config_schema_version'", [])?;
                Ok(())
            })
            .unwrap();
    }
    let h = build_with(Some(dir.clone()), None, connector_fixture());
    let effective = h.ok("config.effective", json!({}));
    assert_eq!(effective["status"]["state"], "UNSUPPORTED_VERSION");
    let remote = effective["values"].as_array().unwrap().iter().find(|v| v["key"] == "privacy.allow_connector_egress").unwrap().clone();
    assert_eq!(remote["source"], "DEFAULT", "a value from a newer schema was interpreted");
    assert!(h.call("config.set", json!({ "layer": "USER", "key": "privacy.persist_memory", "value": true })).get("error").is_some(), "a newer schema accepted a write");
    let alerts = h.ok("observability.alerts", json!({}))["alerts"].as_array().cloned().unwrap();
    assert!(alerts.iter().any(|a| a["kind"] == "STORAGE_ISSUE"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p06_persistence_the_store_is_at_schema_five_after_a_real_open() {
    let dir = temp_dir("schema");
    let h = build_with(Some(dir.clone()), None, connector_fixture());
    let version: i64 = h.host().phase02().unwrap().db.with(|c| Ok(c.query_row("PRAGMA user_version", [], |r| r.get(0))?)).unwrap();
    assert_eq!(version, polaris_host_core::storage::migrations::SUPPORTED_VERSION);
    assert!(version >= 5);
    drop(h);
    let _ = std::fs::remove_dir_all(&dir);
}

/// تجهيزة موصل جديدة على المنفذ نفسه لا تُضمن؛ يكفي أن تُبنى أخرى، والعنوان المحفوظ هو
/// الذي يُقاس به البقاء. الفحص بعد الإقلاع يمرّ عبر تجهيزة حيّة على المنفذ الأصلي إن بقي.
fn connector_fixture_on(_port: u16) -> (p06_support::support::MockServer, std::sync::Arc<std::sync::Mutex<p06_support::FixtureState>>) {
    connector_fixture()
}
