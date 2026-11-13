// اختبارات الحدّ: ما الذي يُرفض، وكيف يُرفض، وماذا لا يعبر.
//
// كل اختبار هنا يقابل ادعاءً في مصفوفة البوابة. الأسماء مطابقة عمدًا حتى يكون
// الربط بين الادعاء ودليله مقروءًا بلا وثيقة وسيطة.

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

fn request(operation: &str, payload: Value) -> Value {
    json!({
        "contract_version": "1.1",
        "protocol_version": "1.1",
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
        "timestamp": "2026-09-15T00:00:00Z",
        "operation": operation,
        "payload": payload
    })
}

fn error_code(response: &Value) -> &str {
    response["error"]["code"].as_str().unwrap_or("")
}

// ── الطريق السعيد ───────────────────────────────────────────────────────────

#[test]
fn p01_h4_bootstrap_completes_and_returns_a_validated_snapshot() {
    let outcome = gateway().handle(&request("desktop.bootstrap", json!({})));
    assert!(outcome.denied_category.is_none(), "{:?}", outcome.response["error"]);
    let snapshot = &outcome.response["result"];
    // المضيف يتكلّم إصدارًا أحدث مع كل مرحلة، ومستندات 1.1 ما تزال مقبولة (الطلب
    // أعلاه 1.1) — وهذا هو معنى الترقية الإضافية: لا كسر للأقدم. الرقم نفسه لا
    // يُثبَّت هنا، بل يُقارَن بما يُعلنه المضيف: تثبيته جعل كل مرحلة تالية تكسر
    // اختبار Phase-01 دون أن يتغيّر ادعاؤه.
    assert_eq!(snapshot["ipc_protocol_version"], polaris_host_core::IPC_PROTOCOL_VERSION);
    let declared = snapshot["ipc_protocol_version"].as_str().unwrap_or_default();
    assert!(declared.starts_with("1."), "a new MAJOR would break every existing document");
    assert_eq!(snapshot["settings_schema_version"], "1.0");
    assert!(snapshot["enabled_capabilities"].is_array());
    assert!(snapshot["unavailable_capabilities"].is_array());
}

#[test]
fn all_five_routed_operations_answer() {
    let gateway = gateway();
    let cases = [
        ("desktop.bootstrap", json!({})),
        ("desktop.runtime.status", json!({})),
        (
            "desktop.capability.availability",
            json!({ "capability_ids": ["polaris.desktop.missions"] }),
        ),
        ("desktop.settings.describe", json!({})),
        ("desktop.settings.read", json!({ "section_id": "general.appearance" })),
    ];
    for (operation, payload) in cases {
        let outcome = gateway.handle(&request(operation, payload));
        assert!(
            outcome.denied_category.is_none(),
            "{operation} was denied: {:?}",
            outcome.response["error"]
        );
        assert!(outcome.response["result"].is_object(), "{operation} returned no result");
    }
}

#[test]
fn the_response_carries_the_causal_chain() {
    let outcome = gateway().handle(&request("desktop.runtime.status", json!({})));
    assert_eq!(outcome.response["request_id"], MESSAGE);
    assert_eq!(outcome.response["causation_id"], MESSAGE);
    assert_eq!(outcome.response["correlation_id"], CORRELATION);
    assert_eq!(outcome.response["message_type"], "RESPONSE");
}

// ── P01-S1 — عملية غير معروفة ───────────────────────────────────────────────

#[test]
fn p01_s1_an_unknown_operation_is_denied() {
    // اسم خارج تعداد العقد أصلًا: يسقط عند التحقق البنيوي قبل أي توجيه.
    let outcome = gateway().handle(&request("desktop.filesystem.read", json!({})));
    assert!(outcome.denied_category.is_some());
    assert!(outcome.response["result"].is_null());
}

#[test]
fn p01_s1_a_core_operation_is_not_routed_by_the_desktop_host() {
    // `system.ping` عضو صالح في تعداد الظرف، وليس عملية سطح مكتب. البوابة ترفضه
    // لأن السجل لا يوجّهه، لا لأن المخطط لا يعرفه.
    let outcome = gateway().handle(&request("system.ping", json!({})));
    assert_eq!(outcome.denied_category, Some("UNSUPPORTED_OPERATION"));
    assert_eq!(error_code(&outcome.response), "CONTRACT_VIOLATION");
}

#[test]
fn p01_s3_a_schema_valid_but_unrouted_operation_is_refused() {
    // نفس المبدأ من الزاوية الأخرى: `capability.invoke` صالح للمخطط، وهو أخطر ما
    // يمكن أن يُمرَّر. صحة المخطط ليست إذنًا بالتوجيه.
    let outcome = gateway().handle(&json!({
        "contract_version": "1.1",
        "protocol_version": "1.1",
        "message_type": "REQUEST",
        "message_id": MESSAGE,
        "correlation_id": CORRELATION,
        "session_id": SESSION,
        "caller_identity": {
            "caller_type": "CORE_UI", "principal_id": PRINCIPAL,
            "trust_tier": "TIER_2_UNTRUSTED", "session_id": SESSION
        },
        "timestamp": "2026-09-15T00:00:00Z",
        "operation": "capability.invoke",
        "idempotency_key": "polaris-desktop-probe-0001",
        "payload": {}
    }));
    assert_eq!(outcome.denied_category, Some("UNSUPPORTED_OPERATION"));
}

// ── P01-S2 — ظرف مشوَّه ─────────────────────────────────────────────────────

#[test]
fn p01_s2_a_malformed_envelope_is_rejected() {
    for broken in [
        json!({}),
        json!({ "message_type": "REQUEST" }),
        json!({ "operation": "desktop.bootstrap", "payload": {} }),
        json!("not an object"),
        json!([1, 2, 3]),
    ] {
        let outcome = gateway().handle(&broken);
        assert!(outcome.denied_category.is_some(), "accepted {broken}");
    }
}

#[test]
fn p01_s2_an_unknown_message_type_is_rejected() {
    let mut envelope = request("desktop.bootstrap", json!({}));
    envelope["message_type"] = json!("COMMAND");
    assert!(gateway().handle(&envelope).denied_category.is_some());
}

#[test]
fn p01_s2_an_extra_envelope_field_is_rejected() {
    // الظرف مغلق: حقل إضافي ليس «غير مقروء» بل مرفوض.
    let mut envelope = request("desktop.bootstrap", json!({}));
    envelope["debug_hook"] = json!("run");
    assert!(gateway().handle(&envelope).denied_category.is_some());
}

#[test]
fn p01_s2_a_malformed_payload_is_rejected() {
    let outcome = gateway().handle(&request("desktop.bootstrap", json!({ "extra": true })));
    assert!(outcome.denied_category.is_some());
}

#[test]
fn p01_s2_an_out_of_range_query_is_rejected() {
    // الاستعلام محدود في العقد: قائمة فارغة مرفوضة، وهي الشكل الأقرب إلى «أعطني كل شيء».
    let outcome = gateway().handle(&request(
        "desktop.capability.availability",
        json!({ "capability_ids": [] }),
    ));
    assert!(outcome.denied_category.is_some());
}

// ── إصدار البروتوكول ────────────────────────────────────────────────────────

#[test]
fn a_desktop_operation_cannot_travel_in_a_one_zero_document() {
    let mut envelope = request("desktop.bootstrap", json!({}));
    envelope["protocol_version"] = json!("1.0");
    let outcome = gateway().handle(&envelope);
    assert_eq!(outcome.denied_category, Some("UNSUPPORTED_OPERATION"));
    assert_eq!(error_code(&outcome.response), "UNSUPPORTED_VERSION");
}

#[test]
fn a_higher_minor_than_the_host_speaks_is_rejected() {
    let mut envelope = request("desktop.bootstrap", json!({}));
    envelope["protocol_version"] = json!("1.9");
    assert_eq!(gateway().handle(&envelope).denied_category, Some("UNSUPPORTED_OPERATION"));
}

#[test]
fn a_different_major_is_rejected() {
    let mut envelope = request("desktop.bootstrap", json!({}));
    envelope["protocol_version"] = json!("2.0");
    assert_eq!(gateway().handle(&envelope).denied_category, Some("UNSUPPORTED_OPERATION"));
}

// ── الهوية ──────────────────────────────────────────────────────────────────

#[test]
fn a_renderer_claiming_tier_zero_is_denied() {
    let mut envelope = request("desktop.bootstrap", json!({}));
    envelope["caller_identity"]["trust_tier"] = json!("TIER_0_TRUSTED");
    let outcome = gateway().handle(&envelope);
    assert_eq!(outcome.denied_category, Some("PERMISSION_DENIED"));
}

#[test]
fn the_identity_on_the_response_is_stamped_by_the_transport() {
    let mut envelope = request("desktop.bootstrap", json!({}));
    // ادّعاء هوية أخرى ضمن الحدود المسموح بها بنيويًا: المضيف يكتب فوقه.
    envelope["caller_identity"]["principal_id"] = json!("00000000-0000-4000-8000-000000000000");
    let outcome = gateway().handle(&envelope);
    assert_eq!(outcome.response["caller_identity"]["principal_id"], PRINCIPAL);
    assert_eq!(outcome.response["caller_identity"]["trust_tier"], "TIER_2_UNTRUSTED");
    assert_eq!(outcome.response["caller_identity"]["caller_type"], "CORE_UI");
}

// ── P01-S4 / P01-S5 — ما لا يعبر ────────────────────────────────────────────

#[test]
fn p01_s4_the_bootstrap_snapshot_carries_no_secret_like_value() {
    let outcome = gateway().handle(&request("desktop.bootstrap", json!({})));
    let text = outcome.response.to_string();
    for forbidden in [
        "password", "passwd", "secret", "token", "api_key", "apikey", "access_key",
        "private_key", "credential", "authorization", "bearer",
    ] {
        assert!(
            !text.to_ascii_lowercase().contains(forbidden),
            "the snapshot carried {forbidden}"
        );
    }
}

#[test]
fn p01_s4_the_bootstrap_snapshot_carries_no_host_internals() {
    let outcome = gateway().handle(&request("desktop.bootstrap", json!({})));
    let text = outcome.response.to_string();
    for forbidden in
        ["process_id", "executable_path", "environment", "stack_trace", "policy_set", "native_handles"]
    {
        assert!(!text.contains(forbidden), "the snapshot carried {forbidden}");
    }
}

#[test]
fn p01_s5_no_error_response_carries_internal_detail_or_a_stack() {
    let cases = [
        request("desktop.filesystem.read", json!({})),
        request("system.ping", json!({})),
        request("desktop.bootstrap", json!({ "extra": true })),
        request("desktop.settings.read", json!({ "section_id": "nope" })),
        json!({ "message_type": "REQUEST" }),
    ];
    for case in cases {
        let outcome = gateway().handle(&case);
        let error = &outcome.response["error"];
        assert!(error.is_object(), "no error object for {case}");
        let object = error.as_object().unwrap();
        assert!(!object.contains_key("internal_detail"), "internal_detail crossed the boundary");
        assert!(!object.contains_key("stack"), "a stack crossed the boundary");
        let text = outcome.response.to_string();
        assert!(!text.contains("D:\\"), "a host path crossed the boundary");
        assert!(!text.contains(".rs:"), "a source location crossed the boundary");
    }
}

#[test]
fn p01_s5_the_display_message_is_a_localization_key() {
    let outcome = gateway().handle(&request("system.ping", json!({})));
    let message = outcome.response["error"]["display_message"].as_str().unwrap();
    assert!(message.starts_with("desktop.error."), "{message} is not a key");
    assert!(!message.contains(' '), "{message} looks like prose");
}

#[test]
fn p01_s5_internal_detail_is_retained_on_the_host_side() {
    let gateway = gateway();
    let _ = gateway.handle(&request("system.ping", json!({})));
    let lines = gateway.diagnostics().snapshot();
    assert_eq!(lines.len(), 1);
    assert!(lines[0].contains("UNSUPPORTED_OPERATION"));
    assert!(lines[0].contains("system.ping"));
}

// ── P01-C3 — لا نقطة إرسال عامة ─────────────────────────────────────────────

#[test]
fn p01_c3_no_operation_outside_the_five_reaches_a_service() {
    // كل اسم هنا يمثّل طريقًا كان سيكون كارثة لو كان هناك مُرسِل عامّ.
    for operation in [
        "desktop.exec",
        "desktop.shell",
        "desktop.eval",
        "desktop.fs.write",
        "desktop.*",
        "desktop.",
        "desktop.settings.write",
        "capability.describe",
        "policy.evaluate",
        "audit.append",
        "model.complete",
    ] {
        let outcome = gateway().handle(&request(operation, json!({})));
        assert!(outcome.denied_category.is_some(), "{operation} was not denied");
        assert!(outcome.response["result"].is_null(), "{operation} produced a result");
    }
}

// ── P01-H5 — فشل الإقلاع صادق وقابل للاسترداد ───────────────────────────────

#[test]
fn p01_h5_a_failed_request_is_an_error_envelope_not_invented_defaults() {
    let outcome = gateway().handle(&request("desktop.settings.read", json!({ "section_id": "nope" })));
    assert_eq!(outcome.denied_category, Some("FEATURE_NOT_AVAILABLE"));
    assert!(outcome.response["result"].is_null());
    // الظرف نفسه صالح: الفشل لا يُنتج مستندًا مكسورًا.
    assert_eq!(outcome.response["message_type"], "RESPONSE");
    assert!(outcome.response["timestamp"].is_string());
}

#[test]
fn p01_h5_the_error_states_whether_a_retry_is_meaningful() {
    let outcome = gateway().handle(&request("system.ping", json!({})));
    assert_eq!(outcome.response["error"]["retryable"], false);
}
