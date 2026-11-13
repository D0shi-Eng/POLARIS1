// P03 — المسار الكامل عبر البوابة الحقيقية: ظرف، إصدار، توجيه، مخطط حمولة،
// خدمة، مخطط نتيجة.
//
// نجاح نداء هنا يعني أن نتيجته اجتازت عقدها المُعلن في السجل، لا أن دالّة رجعت.
// ما يُختبر أيضًا هو ما يُرفض: عملية بلا مالك، واسم فعل عام، ومستند أقدم من إصدار
// العملية، ومفتاح idempotency غائب لعملية ذات أثر.

use polaris_host_core::contracts::registry::{DesktopIpcRegistry, RegistrySet};
use polaris_host_core::ipc::gateway::Gateway;
use polaris_host_core::ipc::identity::TransportIdentity;
use polaris_host_core::services::host::DesktopHost;
use serde_json::{json, Value};

const PRINCIPAL: &str = "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60";
const SESSION: &str = "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50";
const MESSAGE: &str = "3f2b1a09-8c7d-4e6f-b5a4-0d9c8b7a6e51";
const CORRELATION: &str = "5d4c3b2a-1908-4f7e-a6d5-c4b3a2918071";
const OUTGOING: &str = "9e8d7c6b-5a49-4382-b170-6f5e4d3c2b1a";

fn gateway() -> Gateway {
    Gateway::new(
        DesktopHost::default(),
        TransportIdentity { principal_id: PRINCIPAL.to_string(), session_id: SESSION.to_string() },
        Box::new(|| OUTGOING.to_string()),
    )
}

fn envelope(operation: &str, payload: Value, protocol: &str, idempotency: Option<&str>) -> Value {
    let mut request = json!({
        "contract_version": "1.3",
        "protocol_version": protocol,
        "message_type": "REQUEST",
        "message_id": MESSAGE,
        "correlation_id": CORRELATION,
        "session_id": SESSION,
        "caller_identity": {
            "caller_type": "CORE_UI",
            "principal_id": PRINCIPAL,
            "trust_tier": "TIER_2_UNTRUSTED",
            "session_id": SESSION
        },
        "timestamp": "2026-09-18T00:00:00Z",
        "operation": operation,
        "payload": payload
    });
    if let Some(key) = idempotency {
        request["idempotency_key"] = json!(key);
    }
    request
}

fn read(operation: &str, payload: Value) -> Value {
    envelope(operation, payload, "1.3", None)
}

fn write(operation: &str, payload: Value, key: &str) -> Value {
    envelope(operation, payload, "1.3", Some(key))
}

fn error_code(response: &Value) -> &str {
    response["error"]["code"].as_str().unwrap_or("")
}

fn ok(gw: &Gateway, request: &Value) -> Value {
    let outcome = gw.handle(request);
    assert!(
        outcome.denied_category.is_none(),
        "{} was denied: {:?}",
        request["operation"],
        outcome.response["error"]
    );
    outcome.response["result"].clone()
}

/// كل عملية Phase-03 مُعلنة في السجل لها مالك يردّ نتيجةً تجتاز عقدها.
#[test]
fn every_phase03_operation_is_routed_and_answers_its_contract() {
    let registry = DesktopIpcRegistry::phase03();
    assert_eq!(registry.phase, "PHASE-03");
    assert_eq!(registry.routed_operations().len(), 10);
    for record in &registry.operations {
        assert_eq!(record.envelope_version, "1.3");
        assert!(record.effect_class.is_some(), "{} has no effect class", record.operation);
        // الأثر والمفتاح متلازمان: لا أثر جانبي مخفي تحت قراءة.
        assert_eq!(record.idempotency == "REQUIRED", record.effect == "SIDE_EFFECTING", "{}", record.operation);
        assert!(RegistrySet::is_routed(&record.operation), "{} is not routed", record.operation);
    }
}

/// إنشاء مهمّة ثم قراءتها: الحالة والإثبات يعبران معًا.
#[test]
fn a_mission_can_be_created_and_read_back_through_the_gateway() {
    let gw = gateway();
    let created = ok(
        &gw,
        &write(
            "mission.create",
            json!({
                "title": "summarise the architecture",
                "objective": "summarise the selected project context and identify three explicit constraints",
                "requirements": [
                    { "requirement_id": "req-1", "text": "three constraints are identified", "mandatory": true }
                ]
            }),
            "p03-key-create-0001",
        ),
    );
    assert_eq!(created["state"], "CREATED");
    // مهمّة جديدة لم تُقيَّم بعد: ليست مُثبَتة، وليست غير مُثبَتة.
    assert_eq!(created["completion_proof_status"], "NOT_EVALUATED");
    let mission_id = created["mission_id"].as_str().expect("mission_id").to_string();

    let got = ok(&gw, &read("mission.get", json!({ "mission_id": mission_id })));
    assert_eq!(got["mission"]["state"], "CREATED");
    assert_eq!(got["mission"]["title_authority"], "DIRECT_USER_INSTRUCTION");
    assert_eq!(got["mission"]["requirements"][0]["requirement_id"], "req-1");
    // الإثبات موجود في كل قراءة، فلا تُقرأ الحالة وحدها.
    assert!(got["completion_proof"]["status"].is_string());
    assert_ne!(got["completion_proof"]["status"], "PROVEN");

    let listed = ok(&gw, &read("mission.list", json!({})));
    assert_eq!(listed["missions"].as_array().unwrap().len(), 1);
    assert_eq!(listed["missions"][0]["mission_id"], mission_id.as_str());
}

/// القراءات الأربع الأخرى تعمل على مهمّة موجودة وتبقى محصورة بها.
#[test]
fn the_read_operations_answer_for_a_real_mission() {
    let gw = gateway();
    let created = ok(&gw, &write("mission.create", json!({ "title": "t", "objective": "o" }), "p03-key-create-0002"));
    let mission_id = created["mission_id"].as_str().unwrap().to_string();

    let tasks = ok(&gw, &read("task.list", json!({ "mission_id": mission_id })));
    assert_eq!(tasks["mission_id"], mission_id.as_str());
    assert!(tasks["tasks"].as_array().unwrap().is_empty(), "a mission that never ran has no tasks");
    assert!(tasks["ready"].as_array().unwrap().is_empty());

    let agents = ok(&gw, &read("agent.list", json!({ "mission_id": mission_id })));
    // أوصاف الأدوار التسعة تُعرض دائمًا؛ ولا أمثلة وكلاء لمهمّة لم تعمل.
    assert_eq!(agents["roles"].as_array().unwrap().len(), 9);
    assert!(agents["instances"].as_array().unwrap().is_empty());
    let security = agents["roles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["agent_type"] == "SECURITY_REVIEWER")
        .expect("the security reviewer role is listed");
    assert_eq!(security["security_class"], "SECURITY_SENSITIVE");

    for operation in ["claim.list", "evidence.list"] {
        let result = ok(&gw, &read(operation, json!({ "mission_id": mission_id })));
        assert_eq!(result["mission_id"], mission_id.as_str());
    }
}

/// بدء مهمّة بلا نموذج مُوجَّه: التشغيل يحدث، والنتيجة فشل مُعلن لا نجاح مُختلق.
///
/// المضيف الافتراضي لا مزوّد مُفعَّل فيه، فتوجيه Phase-02 يرفض. ما يُثبَت هنا أن
/// الرفض يصل كسبب توقّف مقيس (`NO_MODEL_ROUTED`) وأن الإثبات لا يُرقّى بحال.
#[test]
fn starting_a_mission_without_a_routed_model_fails_honestly() {
    let gw = gateway();
    let created = ok(&gw, &write("mission.create", json!({ "title": "t", "objective": "o" }), "p03-key-create-0003"));
    let mission_id = created["mission_id"].as_str().unwrap().to_string();

    let started = ok(&gw, &write("mission.start", json!({ "mission_id": mission_id }), "p03-key-start-00001"));
    assert_eq!(started["state"], "FAILED", "a mission with no routed model did not fail");
    assert_eq!(started["report"]["stop_reason"], "NO_MODEL_ROUTED");
    assert_eq!(started["report"]["tasks_succeeded"], 0);
    assert_eq!(started["report"]["verified_claims"], 0);
    assert_ne!(started["completion_proof"]["status"], "PROVEN");

    // والحالة المحفوظة تقول الشيء نفسه بعد إعادة القراءة.
    let got = ok(&gw, &read("mission.get", json!({ "mission_id": mission_id })));
    assert_eq!(got["mission"]["state"], "FAILED");
    assert_ne!(got["mission"]["completion_proof_status"], "PROVEN");
}

/// عملية Phase-03 لا تسافر في مستند يعلن إصدارًا أدنى من إصدار إدخالها.
#[test]
fn a_phase03_operation_cannot_travel_in_a_one_two_document() {
    let gw = gateway();
    let outcome = gw.handle(&envelope("mission.list", json!({}), "1.2", None));
    assert!(outcome.denied_category.is_some(), "a 1.2 document carried a 1.3 operation");
    assert_eq!(error_code(&outcome.response), "UNSUPPORTED_VERSION");
}

/// لا اسم فعل عام: عملية تسمح بحمولة تُسمّي فعلًا اختياريًّا غير موجودة أصلًا.
#[test]
fn there_is_no_generic_agent_dispatch_operation() {
    let gw = gateway();
    for forbidden in ["agent.execute", "agent.raw", "agent.call", "orchestrator.command", "mission.run"] {
        assert!(!RegistrySet::is_routed(forbidden), "{forbidden} is routed");
        let outcome = gw.handle(&read(forbidden, json!({ "action": "anything" })));
        assert!(outcome.denied_category.is_some(), "{forbidden} was accepted");
    }
}

/// عملية ذات أثر بلا مفتاح idempotency تُرفض قبل أن تُنفَّذ.
#[test]
fn a_side_effecting_operation_requires_an_idempotency_key() {
    let gw = gateway();
    let outcome = gw.handle(&envelope("mission.create", json!({ "title": "t", "objective": "o" }), "1.3", None));
    assert!(outcome.denied_category.is_some(), "mission.create ran without an idempotency key");
    // ولا مهمّة كُتبت.
    let listed = ok(&gw, &read("mission.list", json!({})));
    assert!(listed["missions"].as_array().unwrap().is_empty());
}

/// المفتاح نفسه مرتين يعيد النتيجة نفسها ولا ينشئ مهمّتين.
#[test]
fn repeating_an_idempotency_key_replays_rather_than_duplicating() {
    let gw = gateway();
    let payload = json!({ "title": "t", "objective": "o" });
    let first = ok(&gw, &write("mission.create", payload.clone(), "p03-key-same-000001"));
    let second = ok(&gw, &write("mission.create", payload, "p03-key-same-000001"));
    assert_eq!(first["mission_id"], second["mission_id"], "the same key created two missions");
    let listed = ok(&gw, &read("mission.list", json!({})));
    assert_eq!(listed["missions"].as_array().unwrap().len(), 1);
}

/// حمولة مخالفة لمخططها تُرفض قبل أي عمل.
#[test]
fn a_payload_that_violates_its_schema_is_refused() {
    let gw = gateway();
    // عنوان فارغ يخالف MissionTitle (الحد الأدنى 1).
    let outcome = gw.handle(&write("mission.create", json!({ "title": "", "objective": "o" }), "p03-key-bad-000001"));
    assert!(outcome.denied_category.is_some(), "an empty title was accepted");
    // حقل غير مُعلن يخالف additionalProperties: false.
    let outcome = gw.handle(&write("mission.create", json!({ "title": "t", "objective": "o", "api_key": "x" }), "p03-key-bad-000002"));
    assert!(outcome.denied_category.is_some(), "an undeclared field was accepted");
}

/// لا نتيجة Phase-03 تحمل اسم حقل يوحي بسرّ.
#[test]
fn no_phase03_result_carries_a_secret_shaped_field() {
    let gw = gateway();
    let created = ok(&gw, &write("mission.create", json!({ "title": "t", "objective": "o" }), "p03-key-create-0004"));
    let mission_id = created["mission_id"].as_str().unwrap().to_string();
    let mut bodies = vec![created];
    for operation in ["mission.list", "mission.get", "task.list", "agent.list", "claim.list", "evidence.list"] {
        let payload = if operation == "mission.list" { json!({}) } else { json!({ "mission_id": mission_id }) };
        bodies.push(ok(&gw, &read(operation, payload)));
    }
    for body in bodies {
        let text = serde_json::to_string(&body).unwrap();
        for forbidden in ["api_key", "secret", "password", "raw_token", "authorization", "bearer"] {
            assert!(!text.to_lowercase().contains(forbidden), "{forbidden} appeared in a Phase-03 result");
        }
    }
}
