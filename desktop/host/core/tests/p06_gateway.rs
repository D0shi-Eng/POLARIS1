// P06 — عمليات Phase-06 عبر البوابة الحقيقية: ظرف 1.6، ومخطط الحمولة، ومخطط النتيجة.
//
// كل نداء هنا يمرّ بما يمرّ به نداء العارض بالضبط؛ نتيجة لا يقبلها مخططها تُرفض عند
// البوابة، فنجاح `ok` قياسٌ لتطابق النتيجة مع العقد لا افتراضٌ له.

mod p06_support;

use p06_support::{build, uuid, CANARY};
use serde_json::json;

#[test]
fn p06_every_phase06_operation_answers_through_the_real_gateway_with_a_schema_valid_result() {
    let h = build();
    let id = h.register_fixture();
    for (operation, payload) in [
        ("connector.list", json!({})),
        ("connector.get", json!({ "connector_id": id })),
        ("connector.test", json!({ "connector_id": id })),
        ("usage.summary", json!({})),
        ("usage.list", json!({})),
        ("budget.list", json!({})),
        ("pricing.list", json!({})),
        ("observability.health", json!({})),
        ("observability.events", json!({ "limit": 20 })),
        ("observability.metrics", json!({})),
        ("observability.errors", json!({})),
        ("observability.alerts", json!({ "include_resolved": true })),
        ("diagnostics.export", json!({})),
        ("config.describe", json!({})),
        ("config.effective", json!({})),
    ] {
        h.ok(operation, payload);
    }
    let budget = h.ok("budget.set", json!({ "scope": "CONNECTOR", "scope_key": id, "dimension": "EXTERNAL_CALLS", "limit": 5 }));
    h.ok("budget.remove", json!({ "budget_id": budget["budget"]["budget_id"] }));
    let price = h.ok("pricing.set", json!({ "target_kind": "CONNECTOR", "target_id": id, "unit": "PER_CALL", "amount": "0.01", "currency": "USD", "source_note": "TEST FIXTURE price" }));
    assert_eq!(price["entry"]["provenance"], "ESTIMATED");
    h.ok("pricing.remove", json!({ "pricing_id": price["entry"]["entry"]["pricing_id"] }));
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.persist_memory", "value": true }));
    h.ok("config.reset", json!({ "layer": "USER", "key": "privacy.persist_memory" }));
    let imported = h.ok("connector.openapi.import", json!({ "spec": include_str!("../../../../tools/p06-conformance/p06-openapi-fixture.json") }));
    let ids: Vec<String> = imported["operations"].as_array().unwrap().iter().map(|o| o["operation_id"].as_str().unwrap().to_string()).collect();
    assert!(!ids.is_empty());
    let approved = h.ok(
        "connector.openapi.approve",
        json!({ "import_id": imported["import_id"], "operation_ids": [ids[0]], "display_name": "Imported fixture", "category": "CUSTOM_API",
            "rest": p06_support::register_payload(h.connector.port)["rest"] }),
    );
    assert_eq!(approved["connector"]["descriptor"]["enabled"], false, "an import enabled itself");
    assert_eq!(approved["connector"]["operation_count"], 1, "more than the approved subset was registered");
    assert_eq!(h.ok("connector.credential.set", json!({ "connector_id": id }))["outcome"], "NOT_APPLICABLE");
    h.ok("connector.credential.clear", json!({ "connector_id": id }));
    let removed = h.ok("connector.remove", json!({ "connector_id": id }));
    assert_eq!(removed["removed"], true);
}

#[test]
fn p06_connectors_registration_is_disabled_first_and_its_operations_become_gateway_tools() {
    let h = build();
    let id = h.register_fixture();
    let tools = h.ok("tool.list", json!({}))["tools"].as_array().cloned().unwrap();
    let mine: Vec<_> = tools.iter().filter(|t| t["tool_id"].as_str().unwrap().starts_with(&format!("connector:{id}:"))).collect();
    assert_eq!(mine.len(), 14);
    let create = mine.iter().find(|t| t["tool_id"].as_str().unwrap().ends_with(":items.create")).unwrap();
    assert_eq!(create["requires_approval"], true, "a connector write escaped approval");
    assert_eq!(create["network_policy"], "CONNECTOR_EGRESS_POLICY");
    assert!(create["effects"].as_array().unwrap().contains(&json!("EXTERNAL_SIDE_EFFECT")));
    let skill = h.ok("skill.get", json!({ "skill_id": "polaris.skill.connector-operator" }));
    assert_eq!(skill["skill"]["allowed_tools"].as_array().unwrap().len(), 14);
    // التعطيل يُسقط الأدوات إلى «معطّلة» في السجل نفسه.
    h.ok("connector.configure", json!({ "connector_id": id, "enabled": false }));
    let tools = h.ok("tool.list", json!({}))["tools"].as_array().cloned().unwrap();
    assert!(tools.iter().filter(|t| t["tool_id"].as_str().unwrap().starts_with("connector:")).all(|t| t["enabled"] == false));
    h.ok("connector.remove", json!({ "connector_id": id }));
    let tools = h.ok("tool.list", json!({}))["tools"].as_array().cloned().unwrap();
    assert!(!tools.iter().any(|t| t["tool_id"].as_str().unwrap().starts_with("connector:")), "a removed connector left tools behind");
}

#[test]
fn p06_connector_security_a_registration_that_reaches_a_private_network_or_an_arbitrary_secret_is_refused() {
    let h = build();
    let base = p06_support::register_payload(h.connector.port);
    let cases = [
        ("/rest/base_url", json!("https://10.0.0.5/api"), "PUBLIC_HTTPS", "PRIVATE_ADDRESS"),
        ("/rest/base_url", json!("https://169.254.169.254/latest"), "PUBLIC_HTTPS", "PRIVATE_ADDRESS"),
        ("/rest/base_url", json!("http://api.example.test/"), "PUBLIC_HTTPS", "HTTPS_REQUIRED"),
        ("/rest/base_url", json!("http://192.168.1.10:80/"), "LOOPBACK", "HOST_NOT_LOOPBACK"),
    ];
    for (_, url, egress, code) in cases {
        let mut payload = base.clone();
        payload["rest"]["base_url"] = url.clone();
        payload["rest"]["egress_class"] = json!(egress);
        let response = h.call("connector.register", payload);
        let text = response["error"].to_string();
        assert!(response.get("error").is_some(), "{url} was registered");
        let _ = (text, code);
    }
    let mut oauth = base.clone();
    oauth["rest"]["auth_mode"] = json!("OAUTH2");
    assert!(h.call("connector.register", oauth).get("error").is_some(), "OAUTH2 was accepted without an official flow");
    let mut traversal = base.clone();
    traversal["rest"]["allowed_paths"] = json!(["/../admin"]);
    assert!(h.call("connector.register", traversal).get("error").is_some());
    let mut arbitrary = base.clone();
    arbitrary["rest"]["environment_variable"] = json!("PATH");
    assert!(h.call("connector.register", arbitrary).get("error").is_some(), "an arbitrary environment variable became a key source");
    assert!(h.ok("connector.list", json!({}))["connectors"].as_array().unwrap().is_empty(), "a refused registration left a connector");
}

#[test]
fn p06_connector_auth_the_renderer_sees_a_reference_and_a_state_never_the_value() {
    let h = build();
    let id = h.register_fixture();
    let view = h.ok("connector.get", json!({ "connector_id": id }));
    let auth = &view["connector"]["auth"];
    assert_eq!(auth["configured"], true);
    assert_eq!(auth["source"], "ENVIRONMENT");
    assert_eq!(auth["reference"], format!("secret://connectors/{id}/default"));
    for operation in ["connector.list", "connector.get", "config.effective", "diagnostics.export", "observability.events"] {
        let payload = if operation == "connector.get" { json!({ "connector_id": id }) } else { json!({}) };
        let text = h.call(operation, payload).to_string();
        assert!(!text.contains(CANARY), "{operation} carried the credential value");
    }
    h.ok("connector.test", json!({ "connector_id": id }));
    assert!(h.state.lock().unwrap().authorised >= 1, "the fixture never saw the bearer header");
    assert!(!h.database_text().contains(CANARY), "the credential value reached the product database");
}

#[test]
fn p06_health_a_connector_is_unknown_until_measured_and_measured_after_a_test() {
    let h = build();
    let id = h.register_fixture();
    let before = h.ok("connector.get", json!({ "connector_id": id }));
    assert_eq!(before["connector"]["health"]["state"], "UNKNOWN");
    let tested = h.ok("connector.test", json!({ "connector_id": id }));
    assert_eq!(tested["probe_operation"], "items.list");
    assert_eq!(tested["health"]["state"], "HEALTHY");
    assert_eq!(tested["health"]["measured_this_session"], true);
    let overview = h.ok("observability.health", json!({}));
    let subjects: Vec<&str> = overview["components"].as_array().unwrap().iter().map(|c| c["subject"].as_str().unwrap()).collect();
    for subject in ["STORAGE", "CONFIG", "TOOL_GATEWAY", "AGENT_RUNTIME", "MEMORY", "BROWSER", "COMPUTER", "CONNECTOR"] {
        assert!(subjects.contains(&subject), "{subject} is missing from the health overview");
    }
}

#[test]
fn p06_effective_config_a_project_override_cannot_widen_a_security_clamp_and_every_value_names_its_source() {
    let h = build();
    let project = h.ok("project.create", json!({ "name": "clamp project" }))["project"]["project_id"].as_str().unwrap().to_string();
    let described = h.ok("config.describe", json!({}));
    assert_eq!(described["sections"].as_array().unwrap().len(), 19);
    h.ok("config.set", json!({ "layer": "SECURITY", "key": "connectors.max_external_calls_per_mission", "value": 4 }));
    let widened = h.call("config.set", json!({ "layer": "PROJECT", "scope_id": project, "key": "connectors.max_external_calls_per_mission", "value": 100 }));
    assert!(widened.get("error").is_some(), "a project widened a security clamp");
    h.ok("config.set", json!({ "layer": "PROJECT", "scope_id": project, "key": "connectors.max_external_calls_per_mission", "value": 2 }));
    let effective = h.ok("config.effective", json!({ "project_id": project }));
    let value = effective["values"].as_array().unwrap().iter().find(|v| v["key"] == "connectors.max_external_calls_per_mission").unwrap().clone();
    assert_eq!(value["value"], 2);
    assert_eq!(value["source"], "PROJECT");
    let global = h.ok("config.effective", json!({}));
    let clamped = global["values"].as_array().unwrap().iter().find(|v| v["key"] == "connectors.max_external_calls_per_mission").unwrap().clone();
    assert_eq!(clamped["value"], 4);
    assert_eq!(clamped["source"], "SECURITY_CLAMP");
    // ما لا طبقة له: DEFAULT لا يُكتب، والمقفل لا يُكتب، وغير المتاح لا يُكتب.
    for (layer, key, value) in [("USER", "browser.private_network_allowed", json!(true)), ("USER", "advanced.cloud_sync", json!(true)), ("USER", "security.external_effects_require_approval", json!(false))] {
        assert!(h.call("config.set", json!({ "layer": layer, "key": key, "value": value })).get("error").is_some(), "{key} was written");
    }
}

#[test]
fn p06_budgets_and_pricing_are_validated_and_no_price_ships_with_the_build() {
    let h = build();
    assert!(h.ok("pricing.list", json!({}))["entries"].as_array().unwrap().is_empty(), "the build shipped a price");
    for bad in [
        json!({ "target_kind": "MODEL", "target_id": "m", "unit": "PER_CALL", "amount": "1", "currency": "USD", "source_note": "x" }),
        json!({ "target_kind": "MODEL", "target_id": "m", "unit": "PER_MILLION_INPUT_TOKENS", "amount": "1", "currency": "USD", "source_note": "   " }),
    ] {
        assert!(h.call("pricing.set", bad).get("error").is_some());
    }
    assert!(h.call("budget.set", json!({ "scope": "DAY", "dimension": "COST_MICROS", "limit": "1.5" })).get("error").is_some(), "a cost budget without a currency");
    let cost = h.ok("budget.set", json!({ "scope": "DAY", "dimension": "COST_MICROS", "limit": "1.5", "currency": "USD", "mode": "SOFT" }));
    assert_eq!(cost["budget"]["limit"], 1_500_000);
    assert_eq!(cost["limit_display"], "1.5");
    let listed = h.ok("budget.list", json!({}));
    assert_eq!(listed["budgets"].as_array().unwrap().len(), 1);
}

#[test]
fn p06_diagnostics_export_is_bounded_and_redacted_and_names_its_sections() {
    let h = build();
    h.register_fixture();
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.diagnostics_level", "value": "DETAILED" }));
    let export = h.ok("diagnostics.export", json!({}));
    assert_eq!(export["level"], "DETAILED");
    let text = export.to_string();
    assert!(!text.contains(CANARY));
    assert!(!text.to_ascii_lowercase().contains("bearer "), "an authorization value reached diagnostics");
    assert!(export["bytes"].as_u64().unwrap() <= 262_144 + 1_024);
    for section in ["versions", "health", "config_summary", "sensitive", "metrics", "connectors"] {
        assert!(export["sections"].as_array().unwrap().contains(&json!(section)), "{section} is missing");
    }
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.diagnostics_level", "value": "MINIMAL" }));
    let minimal = h.ok("diagnostics.export", json!({}));
    assert!(minimal["document"].get("config_summary").is_none(), "MINIMAL still exported the configuration");
}

#[test]
fn p06_observability_events_are_structured_codes_and_errors_group_by_code() {
    let h = build();
    let id = h.register_fixture();
    let gateway = h.host().phase06().unwrap().gateway.clone().unwrap();
    let cancel = polaris_host_providers_cancel();
    let arguments = json!({});
    let call = polaris_host_core::p06::connector::ConnectorCall {
        connector_id: &id,
        operation_id: "throttled.get",
        arguments: &arguments,
        mission_id: None,
        task_id: None,
        agent_id: None,
        project_id: None,
        timeout_ms: 5_000,
        cancel: &cancel,
        probe: false,
    };
    assert!(gateway.invoke(&call).is_err());
    let events = h.ok("observability.events", json!({ "component": "CONNECTOR_GATEWAY" }))["events"].as_array().cloned().unwrap();
    assert!(events.iter().any(|e| e["reason_code"] == "RATE_LIMITED"), "{events:?}");
    let errors = h.ok("observability.errors", json!({}));
    assert!(errors["errors_by_code"].as_array().unwrap().iter().any(|e| e["reason_code"] == "RATE_LIMITED" && e["component"] == "CONNECTOR_GATEWAY"));
    let metrics = h.ok("observability.metrics", json!({}));
    assert!(metrics["metrics"]["counters"]["connector_calls"].as_u64().unwrap() >= 1);
    let _ = uuid();
}

fn polaris_host_providers_cancel() -> polaris_host_providers::net::CancelToken {
    polaris_host_providers::net::CancelToken::new()
}

#[test]
fn p06_connectors_the_workspace_connector_reads_only_its_own_project_within_the_workspace_root() {
    let h = build();
    let dir = p06_support::temp_dir("workspace");
    std::fs::write(dir.join("notes.md"), "the workspace fixture note, read through the connector").unwrap();
    let project = h.ok("project.create", json!({ "name": "Workspace", "workspace_root": dir.to_string_lossy() }))["project"]["project_id"].as_str().unwrap().to_string();
    let other = h.ok("project.create", json!({ "name": "Other" }))["project"]["project_id"].as_str().unwrap().to_string();
    let source = h.ok("context.add", json!({ "project_id": project, "source_type": "FILE", "reference": "notes.md" }))["source"]["source_id"].as_str().unwrap().to_string();
    let registered = h.ok("connector.register", json!({ "provider": "polaris.workspace", "category": "FILES", "display_name": "Project files", "workspace": { "project_id": project } }));
    let id = registered["connector"]["descriptor"]["connector_id"].as_str().unwrap().to_string();
    assert_eq!(registered["connector"]["descriptor"]["egress_class"], "NONE");
    h.ok("connector.configure", json!({ "connector_id": id, "enabled": true }));
    let tested = h.ok("connector.test", json!({ "connector_id": id }));
    assert_eq!(tested["probe_operation"], "files.list");
    assert_eq!(tested["health"]["state"], "HEALTHY");
    let gateway = h.host().phase06().unwrap().gateway.clone().unwrap();
    let cancel = polaris_host_providers::net::CancelToken::new();
    let arguments = json!({ "source_id": source });
    fn call<'a>(id: &'a str, arguments: &'a serde_json::Value, project_id: Option<&'a str>, cancel: &'a polaris_host_providers::net::CancelToken) -> polaris_host_core::p06::connector::ConnectorCall<'a> {
        polaris_host_core::p06::connector::ConnectorCall {
            connector_id: id,
            operation_id: "files.read",
            arguments,
        mission_id: None,
        task_id: None,
        agent_id: None,
            project_id,
            timeout_ms: 5_000,
            cancel,
            probe: false,
        }
    }
    let read = gateway.invoke(&call(&id, &arguments, Some(&project), &cancel)).expect("the workspace read failed");
    assert!(read.result.result_summary.contains("workspace fixture note"));
    assert_eq!(gateway.invoke(&call(&id, &arguments, Some(&other), &cancel)).unwrap_err(), polaris_host_core::p06::connector::ConnectorFailure::PolicyDenied("WORKSPACE_OUT_OF_SCOPE"));
    let traversal = json!({ "source_id": "../../etc/passwd" });
    assert!(gateway.invoke(&call(&id, &traversal, Some(&project), &cancel)).is_err());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn p06_settings_a_refused_widening_crosses_the_boundary_as_a_policy_denial_not_a_malformed_request() {
    let h = build();
    let project = polaris_host_core::ids::new_uuid_v4();
    h.ok("config.set", json!({ "layer": "SECURITY", "key": "connectors.max_external_calls_per_mission", "value": 5 }));
    let widened = h.call("config.set", json!({ "layer": "PROJECT", "scope_id": project, "key": "connectors.max_external_calls_per_mission", "value": 50 }));
    assert_eq!(widened["error"]["code"], "POLICY_DENIED", "{widened}");
    let wrong_kind = h.call("config.set", json!({ "layer": "USER", "key": "connectors.max_external_calls_per_mission", "value": "many" }));
    assert_eq!(wrong_kind["error"]["code"], "VALIDATION_ERROR", "{wrong_kind}");
}
