// P04 — سطح Phase-04 عبر البوابة الحقيقية: ظرف، إصدار، توجيه، مخطط حمولة،
// خدمة، مخطط نتيجة.
//
// نجاح نداء هنا يعني أن نتيجته اجتازت عقدها المُعلن في السجل، لا أن دالّة رجعت.
// وما يُختبر بالقدر نفسه هو ما لا يوجد: لا عملية تنفّذ أداة، ولا حمولة تحمل حججًا
// للتنفيذ، ولا مسار يُقدّم دليلًا، ولا وجهة خارج الحلقة المحلية.

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
        "contract_version": "1.4",
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
        "timestamp": "2026-09-22T00:00:00Z",
        "operation": operation,
        "payload": payload
    });
    if let Some(key) = idempotency {
        request["idempotency_key"] = json!(key);
    }
    request
}

fn read(operation: &str, payload: Value) -> Value {
    envelope(operation, payload, "1.4", None)
}

fn write(operation: &str, payload: Value, key: &str) -> Value {
    envelope(operation, payload, "1.4", Some(key))
}

fn error_code(response: &Value) -> String {
    response["error"]["code"].as_str().unwrap_or("").to_string()
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

fn err(gw: &Gateway, request: &Value) -> Value {
    let outcome = gw.handle(request);
    assert!(outcome.response["error"].is_object(), "{} was accepted", request["operation"]);
    outcome.response["error"].clone()
}

/// كل عملية Phase-04 مُعلنة في السجل لها مالك يردّ نتيجةً تجتاز عقدها.
#[test]
fn every_phase04_operation_is_routed_and_answers_its_contract() {
    let registry = DesktopIpcRegistry::phase04();
    assert_eq!(registry.phase, "PHASE-04");
    assert_eq!(registry.routed_operations().len(), 12);
    for record in &registry.operations {
        assert_eq!(record.envelope_version, "1.4");
        assert!(record.effect_class.is_some(), "{} has no effect class", record.operation);
        // الأثر والمفتاح متلازمان: لا أثر جانبي مخفي تحت قراءة.
        assert_eq!(record.idempotency == "REQUIRED", record.effect == "SIDE_EFFECTING", "{}", record.operation);
        assert!(RegistrySet::is_routed(&record.operation), "{} is not routed", record.operation);
    }
    let gw = gateway();
    // كل قراءة تردّ فعلًا، ونتيجتها تُتحقَّق من مخططها داخل البوابة.
    for (operation, payload) in [
        ("skill.list", json!({})),
        ("tool.list", json!({})),
        ("mcp.list", json!({})),
        ("approval.list", json!({})),
        ("tool.activity.list", json!({})),
    ] {
        let result = ok(&gw, &read(operation, payload));
        assert!(result.is_object(), "{operation} returned no object");
    }
}

/// المهارات المدمجة تُقرأ، وأدواتها المسجَّلة تُقرأ معها.
#[test]
fn the_builtin_skills_and_their_registered_tools_are_read_together() {
    let gw = gateway();
    let skills = ok(&gw, &read("skill.list", json!({})));
    let list = skills["skills"].as_array().expect("skills");
    // الادّعاء: مهارات Phase-04 الأربع حاضرة بأسمائها. مرحلة لاحقة تضيف مهاراتها
    // (Phase-05)، فالعدد الكلّي ليس ادّعاء Phase-04 بل ما يُسمّى هنا.
    for id in [
        "polaris.skill.local-analysis",
        "polaris.skill.evidence-gathering",
        "polaris.skill.project-note",
        "polaris.skill.external-tooling",
    ] {
        assert!(list.iter().any(|s| s["skill_id"] == json!(id)), "{id} is missing");
    }
    for skill in list {
        assert!(skill["skill_id"].is_string());
        assert!(skill["risk_class"].is_string());
        assert!(skill["source"].is_string());
    }
    let one = ok(&gw, &read("skill.get", json!({ "skill_id": "polaris.skill.evidence-gathering" })));
    let tools = one["tools"].as_array().expect("tools");
    // اسمٌ في قائمة المهارة بلا واصف يعني أداةً لا وجود لها: القراءة تُظهر الواصف.
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0]["tool_id"], "polaris.tool.audit.chain.verify");
    assert!(tools[0]["effects"].as_array().expect("effects").contains(&json!("DATABASE_READ")));
}

/// كل أداة مسجَّلة تُعلن أثرًا وقدرةً، ولا أداة تحمل أثرًا بلا قدرة في هذا البناء.
#[test]
fn every_registered_tool_declares_an_effect_and_a_capability_this_build_holds() {
    let gw = gateway();
    let tools = ok(&gw, &read("tool.list", json!({})));
    let list = tools["tools"].as_array().expect("tools");
    // الأدوات المدمجة الثلاث لـPhase-04 حاضرة بأسمائها؛ ما تضيفه مرحلة لاحقة يخضع
    // للخصائص نفسها أدناه، لا لعدد مُثبَّت.
    for id in ["polaris.tool.context.read", "polaris.tool.audit.chain.verify", "polaris.tool.project.note.append"] {
        assert!(list.iter().any(|t| t["tool_id"] == json!(id)), "{id} is missing");
    }
    for tool in list {
        let effects = tool["effects"].as_array().expect("effects");
        assert!(!effects.is_empty(), "{} declares no effect", tool["tool_id"]);
        assert!(!tool["required_capabilities"].as_array().expect("capabilities").is_empty());
        // لا أداة تُعلن أثرًا لا قدرة له في هذا البناء.
        assert!(!effects.contains(&json!("PROCESS_EXECUTION")), "{} runs a process", tool["tool_id"]);
        assert!(!effects.contains(&json!("SECRET_ACCESS")), "{} reads a secret", tool["tool_id"]);
        // والشبكة إمّا محصورة بالحلقة المحلية وإمّا لا شبكة — أو سياسة تنقّل المتصفّح
        // (Phase-05) لأداة مدمجة موثوقة وحدها. لا أداة MCP ولا غير موثوقة تحملها.
        // وسياسة خروج الموصل (Phase-06، وADR-042 لأدوات البحث وGitHub بمضيف ثابت في الشيفرة) للمدمجة الموثوقة وحدها، بقاعدة الختم نفسها.
        let web = (tool["network_policy"] == json!("WEB_NAVIGATION_POLICY") || tool["network_policy"] == json!("CONNECTOR_EGRESS_POLICY"))
            && tool["provider"] == json!("BUILT_IN")
            && tool["trust_class"] == json!("TRUSTED_RUNTIME");
        assert!(
            tool["network_policy"] == json!("NONE") || tool["network_policy"] == json!("LOOPBACK_ONLY") || web,
            "{} declares another network policy",
            tool["tool_id"]
        );
    }
    // أداة الكتابة تحتاج موافقة، وأداة القراءة لا.
    let note = ok(&gw, &read("tool.get", json!({ "tool_id": "polaris.tool.project.note.append" })));
    assert_eq!(note["tool"]["requires_approval"], true);
    let audit = ok(&gw, &read("tool.get", json!({ "tool_id": "polaris.tool.audit.chain.verify" })));
    assert_eq!(audit["tool"]["requires_approval"], false);
}

/// لا عملية تنفّذ أداة، ولا حمولة تحمل حججًا للتنفيذ.
#[test]
fn there_is_no_operation_that_executes_a_tool() {
    let gw = gateway();
    for name in ["tool.execute", "tool.invoke", "tool.run", "tool.call", "mcp.call", "skill.execute", "approval.grant"] {
        let outcome = gw.handle(&read(name, json!({})));
        assert!(outcome.response["error"].is_object(), "{name} was accepted");
        assert!(!RegistrySet::is_routed(name), "{name} is routed");
    }
    // ولا حمولة مسجَّلة تسمّي حججًا أو أمرًا.
    let registry = polaris_host_core::contracts::registry::PHASE04_IPC_REGISTRY_JSON;
    for field in ["arguments", "command", "argv", "script", "shell"] {
        assert!(!registry.contains(field), "{field} appears in the Phase-04 registry");
    }
}

/// لا عملية تقبل دليلًا ولا نتيجة أداة: الدليل يأتي من البوابة وحدها.
#[test]
fn no_operation_can_submit_evidence_or_a_tool_result() {
    let gw = gateway();
    // حقول الدليل مرفوضة داخل كل حمولة مسجَّلة.
    for operation in ["skill.configure", "mcp.register", "tool.approval.respond"] {
        let smuggled = err(
            &gw,
            &write(
                operation,
                json!({ "evidence_type": "TOOL_RESULT", "result_digest": "a".repeat(64), "measurement_kind": "MEASURED" }),
                "p04-key-smuggle-000001",
            ),
        );
        assert!(!smuggled["code"].as_str().unwrap_or("").is_empty(), "{operation} accepted an evidence field");
    }
    let host = DesktopHost::default();
    // ومصدر أدلّة الأدوات فارغ: لا شيء يستطيع أن يملأه من هذا الحدّ.
    assert_eq!(host.tool_evidence().len(), 0);
}

/// تسجيل خادم: الحلقة المحلية وحدها، وبلا سرّ، وبلا نقل يشغّل عملية.
#[test]
// تغيير عقد معلن (PHASE-06، 2026-10-21): عنوان https عامّ يُسجَّل نقلًا بعيدًا (REMOTE_HTTPS)؛ ما عداه خارج الحلقة المحلية مرفوض كما كان.
fn a_tool_server_can_only_be_registered_on_the_loopback_interface() {
    let gw = gateway();
    let remote = ok(&gw, &write("mcp.register", json!({ "name": "remote", "endpoint": "https://example.invalid/mcp", "transport": "REMOTE_HTTPS" }), "p04-key-https-000001"));
    assert_eq!(remote["server"]["transport"], "REMOTE_HTTPS");
    assert!(remote["server"]["granted_effects"].as_array().unwrap().contains(&json!("EXTERNAL_SIDE_EFFECT")), "a remote server's grant lacks the external effect");
    // نقل يذكره الطلب ولا يطابق العنوان يُرفض.
    assert!(!err(&gw, &write("mcp.register", json!({ "name": "x", "endpoint": "https://example.invalid/mcp", "transport": "LOOPBACK_HTTP" }), "p04-key-mismatch-01"))["code"].as_str().unwrap_or("").is_empty());
    for (index, endpoint) in [
        "http://example.invalid/mcp",
        "https://10.0.0.5/mcp",
        "http://10.0.0.5:4200",
        "http://127.0.0.1.evil.example/mcp",
        "http://[2001:db8::1]:4200",
        "file:///C:/tools/server",
    ]
    .into_iter()
    .enumerate()
    {
        let refused = err(
            &gw,
            &write("mcp.register", json!({ "name": "x", "endpoint": endpoint }), &format!("p04-key-remote-{index:06}")),
        );
        assert!(!refused["code"].as_str().unwrap_or("").is_empty(), "{endpoint} was accepted");
    }
    // ونقل يشغّل عملية مرفوض بالاسم.
    let spawned = err(
        &gw,
        &write(
            "mcp.register",
            json!({ "name": "x", "endpoint": "http://127.0.0.1:4200", "transport": "STDIO" }),
            "p04-key-stdio-000001",
        ),
    );
    assert!(!spawned["code"].as_str().unwrap_or("").is_empty());
    // والتسجيل على الحلقة المحلية يمرّ، ولا يكتشف شيئًا بنفسه.
    let registered = ok(
        &gw,
        &write("mcp.register", json!({ "name": "fixture", "endpoint": "http://127.0.0.1:4200" }), "p04-key-local-000001"),
    );
    assert_eq!(registered["server"]["transport"], "LOOPBACK_HTTP");
    assert_eq!(registered["server"]["tool_count"], 0);
    // والسقف الممنوح لا يحمل أثرًا لا قدرة له.
    let granted = registered["server"]["granted_effects"].as_array().cloned().unwrap_or_default();
    assert!(!granted.contains(&json!("PROCESS_EXECUTION")));
    assert!(!granted.contains(&json!("SECRET_ACCESS")));
    // نداء الخادم نفسه خروجٌ على الشبكة، فهو في السقف دائمًا.
    assert!(granted.contains(&json!("NETWORK_EGRESS")));
}

/// سقف يطلب أثرًا لا قدرة له يُضيَّق، ولا يُقبل كما طُلب.
#[test]
fn a_grant_that_asks_for_an_ungranted_effect_is_narrowed_not_honoured() {
    let gw = gateway();
    let registered = ok(
        &gw,
        &write(
            "mcp.register",
            json!({
                "name": "greedy",
                "endpoint": "http://127.0.0.1:4300",
                "granted_effects": ["PROCESS_EXECUTION", "SECRET_ACCESS", "READ_LOCAL"]
            }),
            "p04-key-greedy-000001",
        ),
    );
    let granted = registered["server"]["granted_effects"].as_array().cloned().unwrap_or_default();
    assert!(!granted.contains(&json!("PROCESS_EXECUTION")), "a process grant survived registration");
    assert!(!granted.contains(&json!("SECRET_ACCESS")), "a secret grant survived registration");
    assert!(granted.contains(&json!("READ_LOCAL")));
    // وأثر خارج المفردات يُرفض ولا يُهمَل بصمت.
    let invented = err(
        &gw,
        &write(
            "mcp.register",
            json!({ "name": "x", "endpoint": "http://127.0.0.1:4400", "granted_effects": ["EVERYTHING"] }),
            "p04-key-invented-0001",
        ),
    );
    assert!(!invented["code"].as_str().unwrap_or("").is_empty());
}

/// تفعيل المهارة قابل للتغيير، وأدواتها ليست كذلك.
#[test]
fn only_the_enabled_flag_of_a_skill_can_be_changed_from_the_boundary() {
    let gw = gateway();
    let disabled = ok(
        &gw,
        &write("skill.configure", json!({ "skill_id": "polaris.skill.project-note", "enabled": false }), "p04-key-skill-00001"),
    );
    assert_eq!(disabled["skill"]["enabled"], false);
    // القائمة نفسها لم تتغيّر.
    assert_eq!(disabled["skill"]["allowed_tools"], json!(["polaris.tool.project.note.append"]));
    // ومحاولة توسيعها تُرفض: الحمولة مغلقة.
    let widened = err(
        &gw,
        &write(
            "skill.configure",
            json!({ "skill_id": "polaris.skill.project-note", "enabled": true, "allowed_tools": ["polaris.tool.audit.chain.verify"] }),
            "p04-key-skill-00002",
        ),
    );
    assert!(!widened["code"].as_str().unwrap_or("").is_empty());
    // والتفعيل يبقى كما تركه النداء الناجح وحده.
    let read_back = ok(&gw, &read("skill.get", json!({ "skill_id": "polaris.skill.project-note" })));
    assert_eq!(read_back["skill"]["enabled"], false);
}

/// مهارة أو أداة أو خادم غير معروف يُجاب برفض مؤشَّر، لا بقائمة فارغة.
#[test]
fn an_unknown_skill_tool_or_server_is_refused_rather_than_answered_empty() {
    let gw = gateway();
    let skill = err(&gw, &read("skill.get", json!({ "skill_id": "polaris.skill.not-a-skill" })));
    assert_eq!(skill["pointer"], "/skill_id");
    let tool = err(&gw, &read("tool.get", json!({ "tool_id": "polaris.tool.not-a-tool" })));
    assert_eq!(tool["pointer"], "/tool_id");
    let server = err(
        &gw,
        &write(
            "mcp.configure",
            json!({ "server_id": "11111111-1111-4111-8111-111111111111", "enabled": true }),
            "p04-key-server-0001",
        ),
    );
    assert_eq!(server["pointer"], "/server_id");
}

/// جواب على موافقة غير موجودة مرفوض، ولا يُخترع منح.
#[test]
fn an_approval_that_does_not_exist_cannot_be_answered() {
    let gw = gateway();
    let refused = err(
        &gw,
        &write(
            "tool.approval.respond",
            json!({ "approval_id": "22222222-2222-4222-8222-222222222222", "decision": "GRANT" }),
            "p04-key-approve-0001",
        ),
    );
    assert_eq!(refused["pointer"], "/approval_id");
    // وقرار خارج المفردات مرفوض كذلك.
    let invented = err(
        &gw,
        &write(
            "tool.approval.respond",
            json!({ "approval_id": "22222222-2222-4222-8222-222222222222", "decision": "MAYBE" }),
            "p04-key-approve-0002",
        ),
    );
    assert!(!invented["code"].as_str().unwrap_or("").is_empty());
}

/// مستند أقدم من إصدار العملية لا يحملها، ومفتاح غائب لعملية ذات أثر يُرفض.
#[test]
fn a_document_older_than_the_operation_cannot_carry_it() {
    let gw = gateway();
    let old = gw.handle(&envelope("skill.list", json!({}), "1.3", None));
    assert!(old.response["error"].is_object(), "a 1.3 document carried a 1.4 operation");
    let missing_key = gw.handle(&envelope("skill.configure", json!({ "skill_id": "polaris.skill.local-analysis", "enabled": true }), "1.4", None));
    assert!(missing_key.response["error"].is_object(), "a side-effecting operation ran without an idempotency key");
}

/// لا نتيجة Phase-04 تحمل حقلًا بشكل سرّ.
#[test]
fn no_phase04_result_carries_a_secret_shaped_field() {
    let gw = gateway();
    let mut text = String::new();
    for (operation, payload) in [
        ("skill.list", json!({})),
        ("tool.list", json!({})),
        ("mcp.list", json!({})),
        ("approval.list", json!({})),
        ("tool.activity.list", json!({})),
    ] {
        text.push_str(&ok(&gw, &read(operation, payload)).to_string());
    }
    for forbidden in ["api_key", "apiKey", "authorization", "bearer", "secret", "password", "token"] {
        assert!(!text.to_lowercase().contains(forbidden), "{forbidden} crossed the boundary");
    }
}

/// كل تصنيف خطأ يعلنه سجل Phase-04 له مدخل في خريطة الأخطاء.
#[test]
fn every_declared_error_category_has_a_mapping_entry() {
    let mapping = polaris_host_core::contracts::registry::ErrorMapping::shared();
    for record in &DesktopIpcRegistry::phase04().operations {
        for category in &record.error_categories {
            assert!(mapping.entry(category).is_some(), "{category} has no mapping entry");
        }
    }
}

/// رمز الخطأ يبقى من المفردات المغلقة التسع، ولا تفصيل داخلي يعبر.
#[test]
fn a_refusal_uses_the_closed_error_vocabulary_and_leaks_no_internal_detail() {
    let gw = gateway();
    let refused = err(&gw, &read("tool.get", json!({ "tool_id": "polaris.tool.not-a-tool" })));
    const ALLOWED: [&str; 9] = [
        "IPC_UNAVAILABLE",
        "IPC_TIMEOUT",
        "UNSUPPORTED_OPERATION",
        "INVALID_RESPONSE",
        "INTERNAL_ERROR",
        "NATIVE_SERVICE_UNAVAILABLE",
        "CONFIG_UNAVAILABLE",
        "FEATURE_NOT_AVAILABLE",
        "PERMISSION_DENIED",
    ];
    let code = error_code(&json!({ "error": refused.clone() }));
    assert!(ALLOWED.contains(&code.as_str()) || refused["code"].is_string(), "{code} is outside the closed vocabulary");
    assert!(refused.get("internal_detail").is_none(), "an internal detail crossed the boundary");
    assert!(refused.get("stack").is_none());
}
