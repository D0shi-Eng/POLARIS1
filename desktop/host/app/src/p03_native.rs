// مسابر Phase-03 الأصلية وقراءة أثر التوجيه. تُترجَم مع الميزة `e2e` وحدها.
//
// لماذا يوجد هذا الملف: طبقة القياس تحتاج أن تُثبت أمرين لا مسار لهما من الواجهة
// عمدًا — أن دليلًا مقيسًا حقيقيًّا يُنتَج من تنفيذ تملكه POLARIS ويحقّق ادّعاءً،
// وأن نداء الوكيل عبر فعلًا مسار استدعاء Phase-02 لا مسارًا آخر.
//
// الحدّ الذي يبقى قائمًا: العارض هنا يسمّي مسبارًا من قائمة مغلقة، ولا يقدّم نتيجة
// ولا محتوى دليل ولا بصمة. التنفيذ والقياس والبصمة كلها أصلية. والأمر نفسه غير
// مُترجَم في ثنائي المنتج، فليس بابًا محجوبًا وقت التشغيل بل غير موجود.

use std::sync::Arc;

use polaris_host_core::audit::ChainVerification;
use polaris_host_core::p03::probe_runner::{outcome_of, ProbeExecution, TaskProbe};
use polaris_host_core::p03::task::TaskType;
use polaris_host_core::p03::trusted_test_evidence::ProbeKind;
use polaris_host_core::services::host::DesktopHost;
use serde_json::{json, Value};

/// مسبار يقيس سلامة سلسلة التدقيق فعلًا: ينفّذ التحقق ويعيد ما وجده.
///
/// هذا قياس لا رأي: السلسلة إما متماسكة وإما مكسورة عند سجلّ بعينه، والنتيجة
/// تأتي من تنفيذ حقيقي على قاعدة البيانات الحيّة.
struct AuditChainProbe {
    audit: Arc<polaris_host_core::audit::AuditLedger>,
}

impl TaskProbe for AuditChainProbe {
    fn probe_id(&self) -> &str {
        "polaris.probe.audit-chain-intact"
    }

    fn kind(&self) -> ProbeKind {
        ProbeKind::Test
    }

    fn applies_to(&self, task_type: TaskType) -> bool {
        matches!(task_type, TaskType::Build | TaskType::Test | TaskType::Debug)
    }

    fn source_ref(&self, mission_id: &str, task_id: &str) -> String {
        format!("probe:audit-chain#{mission_id}/{task_id}")
    }

    fn execute(&self, _mission_id: &str, _task_id: &str) -> ProbeExecution {
        // التنفيذ الحقيقي. فشل المخزن ليس نجاحًا ولا فشلًا للادّعاء: يُبلَّغ خطأً.
        let (outcome, detail, bytes) = match self.audit.verify() {
            Ok(ChainVerification::Intact { records }) => (
                outcome_of(true),
                format!("the audit chain verified over {records} records"),
                format!("AUDIT_CHAIN INTACT records={records}"),
            ),
            Ok(ChainVerification::Broken { at_seq, reason }) => (
                outcome_of(false),
                format!("the audit chain broke at record {at_seq}: {reason}"),
                format!("AUDIT_CHAIN BROKEN at={at_seq}"),
            ),
            Err(error) => (
                polaris_host_core::p03::trusted_test_evidence::ProbeOutcome::Errored,
                format!("the audit chain could not be read: {error}"),
                "AUDIT_CHAIN UNREADABLE".to_string(),
            ),
        };
        ProbeExecution { outcome, detail, measured_bytes: bytes.into_bytes() }
    }
}

/// مسبار قضيّته كاذبة عن الواقع: «لم تُنشأ أي مهمّة في هذا المخزن».
///
/// يُقاس فعلًا، ويفشل فعلًا، لأن الواقع يناقض القضيّة. هذا ما يجعله صالحًا لإثبات
/// أن دليلًا مقيسًا فاشلًا لا يفي بتحقّق إيجابي لمجرّد أنه مقيس.
struct NoMissionEverCreatedProbe {
    audit: Arc<polaris_host_core::audit::AuditLedger>,
}

impl TaskProbe for NoMissionEverCreatedProbe {
    fn probe_id(&self) -> &str {
        "polaris.probe.no-mission-ever-created"
    }

    fn kind(&self) -> ProbeKind {
        ProbeKind::Test
    }

    fn applies_to(&self, task_type: TaskType) -> bool {
        matches!(task_type, TaskType::Build | TaskType::Test | TaskType::Debug)
    }

    fn source_ref(&self, mission_id: &str, task_id: &str) -> String {
        format!("probe:no-mission-created#{mission_id}/{task_id}")
    }

    fn execute(&self, _mission_id: &str, _task_id: &str) -> ProbeExecution {
        let created = self.audit.count("MISSION_CREATED").unwrap_or(u64::MAX);
        ProbeExecution {
            outcome: outcome_of(created == 0),
            detail: format!("the ledger holds {created} mission creation records; the case asserted none"),
            measured_bytes: format!("MISSION_CREATED count={created}").into_bytes(),
        }
    }
}

/// الأفعال المتاحة لطبقة القياس. قائمة مغلقة: لا اسم فعل يأتي حرًّا من العارض.
const ACTIONS: [&str; 8] = [
    "probe.register.audit-chain",
    "probe.register.impossible",
    "probe.register.audit-chain.twice",
    "probe.stats",
    "routing.trace",
    "inflight.count",
    "component.delegation",
    "component.message-bus",
];

/// ينفّذ فعلًا أصليًّا مسمّى. مهمّة غير معروفة أو فعل غير معروف يُرفض صراحةً.
pub fn handle(host: &DesktopHost, action: &str, mission_id: &str) -> Value {
    if !ACTIONS.contains(&action) {
        return json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": action });
    }
    let Some(phase02) = host.phase02() else {
        return json!({ "ok": false, "reason": "PHASE_02_UNAVAILABLE", "action": action });
    };
    let audit = phase02.audit.clone();
    let probes = host.probes();

    match action {
        "probe.register.audit-chain" => {
            probes.register(mission_id, Arc::new(AuditChainProbe { audit }));
            json!({
                "ok": true,
                "action": action,
                "probe_id": "polaris.probe.audit-chain-intact",
                "registered": probes.registered_count(mission_id),
                "note": "registered by trusted native code; the caller supplied no outcome and no digest",
            })
        }
        "probe.register.impossible" => {
            probes.register(mission_id, Arc::new(NoMissionEverCreatedProbe { audit }));
            json!({
                "ok": true,
                "action": action,
                "probe_id": "polaris.probe.no-mission-ever-created",
                "registered": probes.registered_count(mission_id),
            })
        }
        "probe.register.audit-chain.twice" => {
            probes.register(mission_id, Arc::new(AuditChainProbe { audit: audit.clone() }));
            probes.register(mission_id, Arc::new(AuditChainProbe { audit }));
            json!({
                "ok": true,
                "action": action,
                "probe_id": "polaris.probe.audit-chain-intact",
                "registered": probes.registered_count(mission_id),
            })
        }
        "probe.stats" => json!({
            "ok": true,
            "action": action,
            "registered": probes.registered_count(mission_id),
            "measured_results": probes.measured_count(),
        }),
        "routing.trace" => routing_trace(&audit),
        "inflight.count" => json!({
            "ok": true,
            "action": action,
            "running_model_requests": phase02.invocations.running_count(),
        }),
        "component.delegation" => delegation_bounds(mission_id),
        "component.message-bus" => message_scope(mission_id),
        // المطابقة شاملة فوق القائمة المغلقة؛ هذا الفرع غير قابل للبلوغ.
        other => json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": other }),
    }
}

/// أثر التوجيه كما سجّله Phase-02 نفسه أثناء الاستدعاء.
///
/// لا يُستنتج من نجاح الواجهة: يُقرأ من سجل التدقيق الذي تكتبه خدمة الاستدعاء،
/// ويحمل النموذج والمزوّد وصنف الشبكة لكل نداء عبر فعلًا.
fn routing_trace(audit: &Arc<polaris_host_core::audit::AuditLedger>) -> Value {
    let Ok(text) = audit.all_detail_text() else {
        return json!({ "ok": false, "reason": "AUDIT_UNREADABLE", "action": "routing.trace" });
    };
    let mut initiated: Vec<Value> = Vec::new();
    let mut failures: Vec<Value> = Vec::new();
    let mut completed = 0u64;
    let mut denied = 0u64;
    let mut remote = 0u64;
    let detail_of = |line: &str| -> Option<Value> { line.find('{').and_then(|at| serde_json::from_str::<Value>(&line[at..]).ok()) };
    for line in text.lines() {
        if line.starts_with("INVOCATION_INITIATED ") {
            if let Some(value) = detail_of(line) {
                initiated.push(json!({
                    "model_id": value.get("model_id").cloned().unwrap_or(Value::Null),
                    "provider_id": value.get("provider_id").cloned().unwrap_or(Value::Null),
                    "network_class": value.get("network_class").cloned().unwrap_or(Value::Null),
                }));
            }
        } else if line.starts_with("REMOTE_INVOCATION_INITIATED ") {
            remote += 1;
        } else if line.starts_with("INVOCATION_COMPLETED ") {
            completed += 1;
        } else if line.starts_with("INVOCATION_DENIED ") {
            denied += 1;
            // سبب الرفض جزء من أثر التوجيه: بلا رمزه لا يُعرف أين توقّف المسار.
            if let Some(value) = detail_of(line) {
                failures.push(json!({ "event": "DENIED", "detail": value }));
            }
        } else if line.starts_with("INVOCATION_FAILED ") || line.starts_with("INVOCATION_CANCELLED ") {
            if let Some(value) = detail_of(line) {
                failures.push(json!({ "event": "FAILED", "detail": value }));
            }
        }
    }
    let mission_started = audit.count("MISSION_STARTED").unwrap_or(0);
    json!({
        "ok": true,
        "action": "routing.trace",
        "mission_started": mission_started,
        "invocations_initiated": initiated.len(),
        "invocations_completed": completed,
        "invocations_denied": denied,
        "remote_invocations_initiated": remote,
        "initiated": initiated,
        "failures": failures,
    })
}

/// حدّ عمق التفويض، مُمارَسًا على المتحكّم الحقيقي داخل عملية المنتج.
///
/// نطاق هذا القياس مُعلن بدقّة: لا مسار مهمّة في Phase-03 يصل إلى التفويض، فلا
/// يُقاس من الواجهة. ما يُقاس هنا هو المكوّن نفسه في الثنائي نفسه، لا محاكاة له.
fn delegation_bounds(mission_id: &str) -> Value {
    use polaris_host_core::p03::agent::{AgentRegistry, AgentRole};
    use polaris_host_core::p03::delegation::{DelegationController, DelegationDecision, DelegationRequest};

    let registry = AgentRegistry::builtin();
    let max_depth = 3u32;
    let mut controller = DelegationController::new(max_depth);
    let request = |depth: u32, objective: &str| DelegationRequest {
        request_id: format!("req-{depth}-{objective}"),
        mission_id: mission_id.to_string(),
        requesting_agent_id: "agent-under-measurement".into(),
        requesting_agent_depth: depth,
        requested_role: AgentRole::Builder,
        objective: objective.to_string(),
        reason: "the measurement exercises the real controller".into(),
        required_capabilities: Vec::new(),
        expected_output: "a bounded result".into(),
    };

    let mut decisions: Vec<Value> = Vec::new();
    let mut record = |label: &str, decision: DelegationDecision| {
        decisions.push(json!({ "case": label, "decision": serde_json::to_value(&decision).unwrap_or(Value::Null) }));
        decision
    };

    let at_zero = record("depth_0", controller.evaluate(&request(0, "a"), &registry));
    let at_one = record("depth_1", controller.evaluate(&request(1, "b"), &registry));
    let at_max_minus_one = record("depth_max_minus_1", controller.evaluate(&request(max_depth - 1, "c"), &registry));
    let over_max = record("depth_max_plus_1", controller.evaluate(&request(max_depth, "d"), &registry));
    let duplicate = record("duplicate", controller.evaluate(&request(0, "a"), &registry));

    json!({
        "ok": true,
        "action": "component.delegation",
        "scope": "the real DelegationController inside the product process; no mission path reaches delegation in Phase-03",
        "max_depth": max_depth,
        "approved_within_the_limit": matches!(at_zero, DelegationDecision::Approved { .. })
            && matches!(at_one, DelegationDecision::Approved { .. })
            && matches!(at_max_minus_one, DelegationDecision::Approved { .. }),
        "refused_over_the_limit": matches!(over_max, DelegationDecision::DepthExceeded { .. }),
        "refused_a_literal_repeat": matches!(duplicate, DelegationDecision::DuplicateRequest(_)),
        "decisions": decisions,
    })
}

/// عزل رسائل الوكلاء بالمهمّة، مُمارَسًا على الناقل الحقيقي.
fn message_scope(mission_id: &str) -> Value {
    use polaris_host_core::p03::message::{AgentMessage, MessageBus, MessageError, MessageType, Recipient};
    use polaris_host_core::p03::trust::{AuthorityClass, Taint, TaintFlag};

    let known = vec!["agent-a".to_string(), "agent-b".to_string()];
    let mut bus = MessageBus::new(mission_id);
    let message = |mission: &str, recipient: Recipient, authority: AuthorityClass| AgentMessage {
        message_id: format!("msg-{mission}"),
        mission_id: mission.to_string(),
        sender_agent_id: "agent-a".into(),
        recipient,
        message_type: MessageType::TaskUpdate,
        created_at: polaris_host_core::time::now_rfc3339_utc(),
        causation_id: None,
        correlation_id: None,
        payload: "a bounded note between two agents".into(),
        taint: Taint::with(TaintFlag::ModelGenerated),
        authority,
    };

    let same_mission = bus.publish(
        message(mission_id, Recipient::Agent("agent-b".into()), AuthorityClass::AgentMessage),
        &known,
    );
    let other_mission = bus.publish(
        message("a-different-mission", Recipient::Agent("agent-b".into()), AuthorityClass::AgentMessage),
        &known,
    );
    let unknown_recipient = bus.publish(
        message(mission_id, Recipient::Agent("agent-from-elsewhere".into()), AuthorityClass::AgentMessage),
        &known,
    );
    let escalated = bus.publish(
        message(mission_id, Recipient::Agent("agent-b".into()), AuthorityClass::DirectUserInstruction),
        &known,
    );

    json!({
        "ok": true,
        "action": "component.message-bus",
        "scope": "the real MessageBus inside the product process; the mission runtime does not route agent messages in Phase-03",
        "delivered_within_the_mission": same_mission.is_ok(),
        "refused_across_missions": matches!(other_mission, Err(MessageError::CrossMissionDenied { .. })),
        "refused_an_unknown_recipient": matches!(unknown_recipient, Err(MessageError::UnknownRecipient(_))),
        "refused_an_escalated_authority": matches!(escalated, Err(MessageError::AuthorityEscalationDenied)),
        "delivered_messages": bus.messages().len(),
        "inbox_of_agent_b": bus.inbox("agent-b").len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_action_list_is_closed_and_an_unknown_action_is_refused() {
        assert_eq!(ACTIONS.len(), 8);
        assert!(!ACTIONS.contains(&"probe.register.anything"));
    }

    #[test]
    fn the_probes_declare_the_task_types_they_measure() {
        let ledger = polaris_host_core::audit::AuditLedger::new(Arc::new(
            polaris_host_core::storage::Database::in_memory().expect("an in-memory database"),
        ));
        let probe = AuditChainProbe { audit: Arc::new(ledger) };
        assert!(probe.applies_to(TaskType::Test));
        assert!(!probe.applies_to(TaskType::Design), "a probe claimed to measure a design task");
        assert_eq!(probe.kind(), ProbeKind::Test);
    }

    #[test]
    fn the_audit_chain_probe_reports_what_it_measured_not_what_was_wanted() {
        let db = Arc::new(polaris_host_core::storage::Database::in_memory().expect("an in-memory database"));
        let probe = AuditChainProbe { audit: Arc::new(polaris_host_core::audit::AuditLedger::new(db)) };
        let execution = probe.execute("m1", "t1");
        // سلسلة فارغة سليمة: صفر سجلات متماسكة.
        assert_eq!(execution.outcome, polaris_host_core::p03::trusted_test_evidence::ProbeOutcome::Passed);
        assert!(String::from_utf8_lossy(&execution.measured_bytes).contains("INTACT"));
    }

    #[test]
    fn the_delegation_component_refuses_the_depth_above_the_limit() {
        let out = delegation_bounds("m1");
        assert_eq!(out["approved_within_the_limit"], true);
        assert_eq!(out["refused_over_the_limit"], true);
        assert_eq!(out["refused_a_literal_repeat"], true);
    }

    #[test]
    fn the_message_bus_component_keeps_a_message_inside_its_mission() {
        let out = message_scope("m1");
        assert_eq!(out["delivered_within_the_mission"], true);
        assert_eq!(out["refused_across_missions"], true);
        assert_eq!(out["refused_an_unknown_recipient"], true);
        assert_eq!(out["refused_an_escalated_authority"], true);
        assert_eq!(out["delivered_messages"], 1);
    }

    #[test]
    fn the_impossible_probe_fails_against_a_ledger_that_has_missions() {
        let db = Arc::new(polaris_host_core::storage::Database::in_memory().expect("an in-memory database"));
        let ledger = Arc::new(polaris_host_core::audit::AuditLedger::new(db));
        ledger
            .append(&polaris_host_core::audit::AuditRecord::new(
                polaris_host_core::audit::AuditEventType::MissionCreated,
                "mission",
                "m1",
                polaris_host_core::audit::AuditOutcome::Success,
                serde_json::json!({}),
            ))
            .expect("the record appends");
        let probe = NoMissionEverCreatedProbe { audit: ledger };
        let execution = probe.execute("m1", "t1");
        assert_eq!(execution.outcome, polaris_host_core::p03::trusted_test_evidence::ProbeOutcome::Failed);
    }
}
