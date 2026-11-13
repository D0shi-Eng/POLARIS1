// P06 — بوابة الموصلات مع خدمة حقيقية على الحلقة المحلية (TEST FIXTURE).
//
// النداءات هنا تدخل بوابة الموصلات مباشرةً، بلا مهمّة، لتقيس ما تفعله هي وحدها: المعدّل،
// وRetry-After المحدود، وإعادة التوجيه، والحجم، والتشوّه، والادّعاء المزيّف، والكلفة
// المزيّفة، وإعادة المحاولة الآمنة وغير الآمنة، والإلغاء، والتكرار. مسار الوكيل الكامل
// يُقاس في p06_agent.

mod p06_support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use p06_support::{build, Harness, CANARY};
use polaris_host_core::p06::connector::{ConnectorCall, ConnectorFailure, ConnectorGateway};
use polaris_host_providers::net::CancelToken;
use serde_json::{json, Value};

fn gateway(h: &Harness) -> Arc<ConnectorGateway> {
    h.host().phase06().unwrap().gateway.clone().unwrap()
}

fn invoke(g: &ConnectorGateway, connector: &str, operation: &str, arguments: Value, mission: Option<&str>) -> Result<polaris_host_core::p06::connector::gateway::ConnectorSuccess, ConnectorFailure> {
    let cancel = CancelToken::new();
    g.invoke(&ConnectorCall {
        connector_id: connector,
        operation_id: operation,
        arguments: &arguments,
        mission_id: mission,
        task_id: mission.map(|_| "99999999-9999-4999-8999-999999999999"),
        agent_id: None,
        project_id: None,
        timeout_ms: 10_000,
        cancel: &cancel,
        probe: false,
    })
}

#[test]
fn p06_connectors_a_read_returns_a_bounded_untrusted_summary_and_a_provider_reported_cost() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let done = invoke(&g, &id, "items.list", json!({}), None).expect("the read failed");
    assert_eq!(done.result.result_summary, "count=2");
    assert_eq!(done.result.provenance, "CONNECTOR_UNTRUSTED");
    assert_eq!(done.result.usage.cost_provenance, "PROVIDER_REPORTED");
    let usage = h.ok("usage.list", json!({ "category": "CONNECTOR" }))["records"].as_array().cloned().unwrap();
    assert_eq!(usage[0]["cost"]["micros"], 1_200);
    assert_eq!(usage[0]["cost"]["provenance"], "PROVIDER_REPORTED");
    assert_eq!(usage[0]["external_requests"], 1);
}

#[test]
fn p06_connector_security_injected_content_stays_data_and_cannot_grant_approval_or_change_policy() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let skills_before = h.ok("skill.list", json!({}));
    let config_before = h.ok("config.effective", json!({}));
    let injected = invoke(&g, &id, "items.get", json!({ "item_id": "inject" }), None).unwrap();
    assert!(injected.result.result_summary.contains("P06-INJECTION-MARKER"), "the content was not returned as data");
    let fake = invoke(&g, &id, "fake.approval", json!({}), None).unwrap();
    assert_eq!(fake.result.result_summary, "count=1", "an unrequested field reached the summary");
    assert_eq!(h.ok("skill.list", json!({})), skills_before, "a connector response changed the skills");
    let config_after = h.ok("config.effective", json!({}));
    assert_eq!(config_after["values"], config_before["values"], "a connector response changed a setting");
    assert!(h.ok("approval.list", json!({}))["approvals"].as_array().unwrap().is_empty(), "a connector response created an approval");
}

#[test]
fn p06_connector_security_a_redirect_is_never_followed_and_an_oversized_or_malformed_body_is_refused() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    assert_eq!(invoke(&g, &id, "redirect.get", json!({}), None).unwrap_err(), ConnectorFailure::RedirectRefused);
    assert_eq!(invoke(&g, &id, "huge.get", json!({}), None).unwrap_err(), ConnectorFailure::TooLarge);
    assert!(matches!(invoke(&g, &id, "malformed.get", json!({}), None).unwrap_err(), ConnectorFailure::Malformed(_)));
    let paths: Vec<String> = h.connector.recorded().iter().map(|r| r.path.clone()).collect();
    assert!(!paths.iter().any(|p| p.contains("latest/meta-data")), "the redirect target was fetched");
}

#[test]
fn p06_connector_security_an_agent_cannot_name_a_url_a_path_or_a_header() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    for arguments in [json!({ "item_id": "item-1", "url": "http://169.254.169.254/" }), json!({ "item_id": "../../admin" }), json!({ "item_id": ".." }), json!({ "item_id": "item-1", "headers": { "Host": "x" } })] {
        match invoke(&g, &id, "items.get", arguments.clone(), None) {
            Err(ConnectorFailure::ArgumentsInvalid(_)) => {}
            Ok(done) => {
                // «../../admin» يُرمَّز في مقطعه ولا يغادره.
                assert_eq!(arguments["item_id"], "../../admin");
                assert!(done.result.result_summary.is_empty() || !done.result.result_summary.contains("admin"));
            }
            Err(other) => assert!(matches!(other, ConnectorFailure::Upstream(404)), "{arguments}: {other:?}"),
        }
    }
    let paths: Vec<String> = h.connector.recorded().iter().map(|r| r.path.clone()).collect();
    assert!(paths.iter().all(|p| p.starts_with("/api/")), "a request left the base path: {paths:?}");
    assert!(paths.iter().any(|p| p == "/api/items/..%2F..%2Fadmin"), "the traversal attempt was not confined to its segment: {paths:?}");
}

#[test]
fn p06_connector_gateway_a_429_with_a_short_retry_after_is_retried_once_and_a_long_one_is_not_retried() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let started = Instant::now();
    let limited = invoke(&g, &id, "limited.get", json!({}), None).expect("a bounded retry-after did not recover");
    assert_eq!(limited.result.usage.attempts, 2);
    assert!(started.elapsed() >= Duration::from_millis(900), "the retry did not honour Retry-After");
    let before = h.connector.recorded().len();
    let started = Instant::now();
    assert!(matches!(invoke(&g, &id, "throttled.get", json!({}), None).unwrap_err(), ConnectorFailure::RateLimited(_)));
    assert!(started.elapsed() < Duration::from_secs(5), "a 30 s Retry-After was waited for");
    assert_eq!(h.connector.recorded().len() - before, 1, "a long Retry-After was retried: a retry storm");
}

#[test]
fn p06_connector_gateway_a_safe_read_is_retried_and_an_unprotected_write_is_never_retried() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let flaky = invoke(&g, &id, "flaky.get", json!({}), None).unwrap();
    assert_eq!(flaky.result.usage.attempts, 2);
    let outcome = invoke(&g, &id, "unsafe.send", json!({ "text": "hello" }), Some("88888888-8888-4888-8888-888888888888"));
    assert!(matches!(outcome, Err(ConnectorFailure::OutcomeUnknown(_))), "{outcome:?}");
    assert_eq!(h.state.lock().unwrap().unsafe_hits, 1, "an unprotected write was retried");
    // والنتيجة المجهولة لا تُعاد آليًّا ولو اقترحها الوكيل مرّة ثانية.
    let again = invoke(&g, &id, "unsafe.send", json!({ "text": "hello" }), Some("88888888-8888-4888-8888-888888888888"));
    assert_eq!(again.unwrap_err(), ConnectorFailure::IdempotencyConflict("PREVIOUS_OUTCOME_UNKNOWN"));
    assert_eq!(h.state.lock().unwrap().unsafe_hits, 1);
}

#[test]
fn p06_connector_gateway_the_same_key_and_payload_replays_and_a_different_payload_conflicts() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let mission = Some("77777777-7777-4777-8777-777777777777");
    let first = invoke(&g, &id, "items.create", json!({ "name": "alpha" }), mission).unwrap();
    assert_eq!(first.result.external_resource_refs, vec!["item-101".to_string()]);
    assert!(first.result.outcome_confirmed);
    let replay = invoke(&g, &id, "items.create", json!({ "name": "alpha" }), mission).unwrap();
    assert_eq!(replay.result.status.as_str(), "REPLAYED");
    assert_eq!(replay.result.external_resource_refs, vec!["item-101".to_string()]);
    assert_eq!(h.state.lock().unwrap().created.len(), 1, "a replay reached the service");
    invoke(&g, &id, "items.create", json!({ "name": "beta", "idempotency_key": "user-key-0001" }), mission).unwrap();
    let conflict = invoke(&g, &id, "items.create", json!({ "name": "gamma", "idempotency_key": "user-key-0001" }), mission);
    assert_eq!(conflict.unwrap_err(), ConnectorFailure::IdempotencyConflict("IDEMPOTENCY_CONFLICT"));
    assert_eq!(h.state.lock().unwrap().created.len(), 2);
}

#[test]
fn p06_connector_gateway_cancellation_stops_an_in_flight_call_and_its_retries() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let cancel = CancelToken::new();
    let trigger = cancel.clone();
    let canceller = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        trigger.cancel();
    });
    let arguments = json!({});
    let started = Instant::now();
    let outcome = g.invoke(&ConnectorCall {
        connector_id: &id,
        operation_id: "slow.get",
        arguments: &arguments,
        mission_id: None,
        task_id: None,
        agent_id: None,
        project_id: None,
        timeout_ms: 20_000,
        cancel: &cancel,
        probe: false,
    });
    canceller.join().unwrap();
    assert_eq!(outcome.unwrap_err(), ConnectorFailure::Cancelled);
    assert!(started.elapsed() < Duration::from_secs(5), "the cancel did not stop the call");
    assert_eq!(g.limiter.in_flight(&id), 0, "a cancelled call kept its concurrency seat");
}

#[test]
fn p06_connector_gateway_the_local_rate_limit_refuses_rather_than_storms() {
    let h = build();
    let id = h.register_fixture();
    h.ok("connector.configure", json!({ "connector_id": id, "requests_per_minute": 2 }));
    let g = gateway(&h);
    invoke(&g, &id, "items.list", json!({}), None).unwrap();
    invoke(&g, &id, "items.list", json!({}), None).unwrap();
    let before = h.connector.recorded().len();
    let refused = invoke(&g, &id, "items.list", json!({}), None);
    assert!(matches!(refused, Err(ConnectorFailure::RateLimited(_))), "{refused:?}");
    assert_eq!(h.connector.recorded().len(), before, "a locally rate-limited call reached the service");
}

#[test]
fn p06_connector_security_a_fake_cost_report_is_rejected_and_no_invented_price_appears() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let done = invoke(&g, &id, "fake.cost", json!({}), None).unwrap();
    assert_eq!(done.result.usage.cost_provenance, "UNKNOWN", "a negative cost report was accepted");
    let events = h.ok("observability.events", json!({ "component": "COST" }))["events"].as_array().cloned().unwrap();
    assert!(events.iter().any(|e| e["reason_code"] == "COST_REPORT_REJECTED"));
    let usage = h.ok("usage.list", json!({ "category": "CONNECTOR" }))["records"].as_array().cloned().unwrap();
    assert!(usage[0]["cost"]["micros"].is_null());
}

#[test]
fn p06_connector_policy_privacy_and_the_side_effect_policy_refuse_before_any_request() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    h.ok("config.set", json!({ "layer": "USER", "key": "connectors.side_effect_policy", "value": "DENY" }));
    let before = h.connector.recorded().len();
    assert_eq!(invoke(&g, &id, "items.create", json!({ "name": "x" }), None).unwrap_err(), ConnectorFailure::PolicyDenied("CONNECTOR_SIDE_EFFECTS_DENIED"));
    assert_eq!(h.connector.recorded().len(), before);
    // موصل عامّ: الخصوصية تمنعه قبل أي اتصال.
    let mut public = p06_support::register_payload(h.connector.port);
    public["rest"]["base_url"] = json!("https://api.fixture.invalid/api");
    public["rest"]["egress_class"] = json!("PUBLIC_HTTPS");
    let pid = h.ok("connector.register", public)["connector"]["descriptor"]["connector_id"].as_str().unwrap().to_string();
    h.ok("connector.configure", json!({ "connector_id": pid, "enabled": true }));
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.allow_connector_egress", "value": false }));
    assert_eq!(invoke(&g, &pid, "items.list", json!({}), None).unwrap_err(), ConnectorFailure::EgressDenied("PRIVACY_CONNECTOR_EGRESS_OFF"));
    // الحلقة المحلية ليست خروجًا: الموصل المحلي يعمل والخروج العامّ مغلق.
    assert!(invoke(&g, &id, "items.list", json!({}), None).is_ok());
    h.ok("config.set", json!({ "layer": "USER", "key": "privacy.allow_connector_egress", "value": true }));
    h.ok("config.set", json!({ "layer": "USER", "key": "security.allow_environment_secrets", "value": false }));
    assert_eq!(invoke(&g, &id, "items.list", json!({}), None).unwrap_err(), ConnectorFailure::PolicyDenied("ENVIRONMENT_SECRETS_DISALLOWED"));
}

#[test]
fn p06_budgets_a_hard_budget_blocks_the_next_call_and_a_soft_budget_warns_but_permits() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    h.ok("budget.set", json!({ "scope": "CONNECTOR", "scope_key": id, "dimension": "EXTERNAL_CALLS", "limit": 1, "mode": "HARD" }));
    invoke(&g, &id, "items.list", json!({}), None).unwrap();
    let before = h.connector.recorded().len();
    assert!(matches!(invoke(&g, &id, "items.list", json!({}), None).unwrap_err(), ConnectorFailure::BudgetExhausted(_)));
    assert_eq!(h.connector.recorded().len(), before, "a blocked call reached the service");
    let alerts = h.ok("observability.alerts", json!({}))["alerts"].as_array().cloned().unwrap();
    assert!(alerts.iter().any(|a| a["kind"] == "BUDGET_EXCEEDED"));
    h.ok("budget.set", json!({ "scope": "CONNECTOR", "scope_key": id, "dimension": "EXTERNAL_CALLS", "limit": 1, "mode": "SOFT" }));
    assert!(invoke(&g, &id, "items.list", json!({}), None).is_ok(), "a soft budget blocked");
    let events = h.ok("observability.events", json!({ "component": "BUDGET" }))["events"].as_array().cloned().unwrap();
    assert!(events.iter().any(|e| e["reason_code"] == "SOFT_BUDGET"));
}

#[test]
fn p06_connector_security_the_credential_never_reaches_the_store_events_or_evidence() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    for op in ["items.list", "throttled.get", "redirect.get", "fake.approval"] {
        let _ = invoke(&g, &id, op, json!({}), Some("66666666-6666-4666-8666-666666666666"));
    }
    let _ = invoke(&g, &id, "items.create", json!({ "name": "secret-probe" }), Some("66666666-6666-4666-8666-666666666666"));
    assert!(!h.database_text().contains(CANARY), "the credential value reached the product database");
    let export = h.ok("diagnostics.export", json!({})).to_string();
    assert!(!export.contains(CANARY));
    let host_log = h.gateway.diagnostics().snapshot().join("\n");
    assert!(!host_log.contains(CANARY), "the credential value reached the host diagnostics log");
}

#[test]
fn p06_connector_gateway_timings_count_each_call_and_exclude_the_wait_for_the_service() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    let before = g.timings();
    let started = Instant::now();
    // ‏429 ثم Retry-After ثانية ثم 200: النداء يستغرق ثانية على الأقل، وجلّها انتظار مقصود.
    invoke(&g, &id, "limited.get", json!({}), None).unwrap();
    let wall = started.elapsed();
    let after = g.timings();
    assert_eq!(after.invocations, before.invocations + 1);
    let overhead = Duration::from_micros(after.overhead_micros_total - before.overhead_micros_total);
    assert!(wall >= Duration::from_millis(900), "the Retry-After wait did not happen: {wall:?}");
    assert!(overhead < wall / 2, "the gateway's own time {overhead:?} still counts the wait inside {wall:?}");
    assert!(after.auth_resolutions > before.auth_resolutions && after.cost_writes > before.cost_writes && after.budget_checks > before.budget_checks);
}

#[test]
fn p06_connector_gateway_a_header_idempotent_write_always_sends_the_key_its_ledger_uses() {
    let h = build();
    let id = h.register_fixture();
    let g = gateway(&h);
    // بلا مفتاح صريح من الوكيل: المفتاح المشتقّ هو ما يحرس الدفتر، ويجب أن يصل إلى الخدمة.
    invoke(&g, &id, "items.create", json!({ "name": "keyed" }), Some("12121212-1212-4121-8121-121212121212")).unwrap();
    let sent: Vec<String> = h.connector.recorded().iter().filter(|r| r.method == "POST" && r.path == "/api/items").filter_map(|r| r.header("idempotency-key").map(str::to_string)).collect();
    assert_eq!(sent.len(), 1, "the create reached the service without its idempotency key");
    assert!(sent[0].starts_with("polaris-"), "the service saw a key the ledger does not know: {}", sent[0]);
    assert_eq!(h.state.lock().unwrap().idempotency.len(), 1);
    // والمفتاح الصريح يصل كما هو.
    invoke(&g, &id, "items.create", json!({ "name": "explicit", "idempotency_key": "agent-key-000001" }), None).unwrap();
    assert!(h.connector.recorded().iter().any(|r| r.header("idempotency-key") == Some("agent-key-000001")));
}

// ——— PHASE-05 (2026-10-20): قراءة القوائم، والإعدادات الجاهزة.

/// قبل PHASE-05 كان الوكيل يرى «items=[2 item(s)]» فقط. عملية تعلن قائمتها وحقولها تعيد عناصرها ناتجًا محدودًا.
#[test]
fn cp05_a_list_operation_returns_its_items_and_an_undeclared_list_returns_none() {
    let h = build();
    let mut payload = p06_support::register_payload(h.connector.port);
    let ops = payload["operations"].as_array_mut().unwrap();
    let list = ops.iter_mut().find(|o| o["operation_id"] == "items.list").unwrap();
    list["list_pointer"] = json!("/items");
    list["item_fields"] = json!(["/id", "/name"]);
    let id = h.ok("connector.register", payload)["connector"]["descriptor"]["connector_id"].as_str().unwrap().to_string();
    h.ok("connector.configure", json!({ "connector_id": id, "enabled": true }));
    let g = gateway(&h);
    let done = invoke(&g, &id, "items.list", json!({}), None).expect("the list call succeeds");
    let items = done.items.expect("the declared list returned no items");
    assert!(items.contains("1. id=item-1; name=blue fixture item") && items.contains("2. id=item-2; name=green"), "{items}");
    // الموصل القديم بلا إعلان: لا عناصر، كما كان.
    let plain = h.register_fixture();
    assert!(invoke(&g, &plain, "items.list", json!({}), None).unwrap().items.is_none());
}

#[test]
fn cp05_presets_register_disabled_without_a_credential_and_cannot_call_out_without_one() {
    let h = build();
    let presets = h.ok("connector.preset.list", json!({}))["presets"].as_array().cloned().unwrap();
    let ids: Vec<&str> = presets.iter().filter_map(|p| p["preset_id"].as_str()).collect();
    // Slack وNotion أولًا، ثم الجدول الموسّع (2026-11-13): 44 إعدادًا بمعرّفات فريدة.
    assert_eq!(&ids[..2], &["slack.read", "notion.read"]);
    assert_eq!(ids.len(), 44);
    assert!(ids.contains(&"github.read") && ids.contains(&"gmail.read") && ids.contains(&"coingecko.read"));
    assert!(presets.iter().all(|p| p["operations"].as_array().unwrap().iter().all(|o| o["action"] == "READ")), "a preset offers a non-read operation");
    let registered = h.ok("connector.preset.register", json!({ "preset_id": "notion.read" }));
    let descriptor = &registered["connector"]["descriptor"];
    assert_eq!(descriptor["enabled"], false, "a preset was registered enabled");
    assert_eq!(descriptor["provenance"]["origin"], "BUILT_IN_PRESET");
    assert_eq!(descriptor["egress_class"], "PUBLIC_HTTPS");
    assert_eq!(registered["connector"]["rest"]["base_url"], "https://api.notion.com");
    // معرّف غير معروف لا يصنع موصلًا.
    assert!(h.call("connector.preset.register", json!({ "preset_id": "unknown.read" })).get("error").is_some(), "an unknown preset produced a connector");
    // مفعّل بلا رمز: يُرفض قبل أي طلب، ولا يُدّعى اتصال.
    let id = descriptor["connector_id"].as_str().unwrap().to_string();
    h.ok("connector.configure", json!({ "connector_id": id, "enabled": true }));
    let refused = invoke(&gateway(&h), &id, "users.list", json!({}), None);
    assert!(refused.is_err(), "a preset connector without a credential reached the service: {refused:?}");
}

/// CP-12-3 (النسخة التنفيذية، 2026-10-21): «أضف» على قالب Slack مرّتين صنع موصلَي Slack متطابقين. القالب نفسه بالعنوان نفسه لا
/// يُسجَّل مرّة ثانية: يُرفض بتعارض، ويبقى موصل واحد.
#[test]
fn cp12_a_template_added_twice_is_refused_the_second_time_and_one_connector_remains() {
    let h = build();
    h.ok("connector.preset.register", json!({ "preset_id": "slack.read" }));
    let again = h.call("connector.preset.register", json!({ "preset_id": "slack.read" }));
    assert_eq!(again["error"]["code"], "CONFLICT", "{again}");
    let slack = h.ok("connector.list", json!({}))["connectors"].as_array().unwrap().iter().filter(|c| c["descriptor"]["provenance"]["origin"] == "BUILT_IN_PRESET" && c["descriptor"]["display_name"] == "Slack").count();
    assert_eq!(slack, 1, "the template produced {slack} connectors");
    // قالب آخر يُضاف كما هو.
    h.ok("connector.preset.register", json!({ "preset_id": "notion.read" }));
}
