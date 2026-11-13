// طبقة IPC لـPhase-04: حمولة مُتحقَّق منها إلى نداء خدمة، ونتيجة إلى JSON.
//
// لا قاعدة عمل هنا. والمطابقة شاملة فوق قائمة مغلقة: لا فرع «أي شيء آخر» بمنطق
// عام، ولا اسم فعل يأتي من الحمولة (البند 77).
//
// وما لا يوجد في هذه القائمة هو الخاصيّة الأمنية: لا عملية تنفّذ أداة، ولا عملية
// تنادي خادم MCP نداءً حرًّا، ولا عملية تُقدّم دليلًا.

use serde_json::Value;

use crate::ipc::errors::HostError;

use super::approval::ApprovalDecision;
use super::effect::ToolEffect;
use super::service::{Phase04, RegisterServerInput};

/// العمليات التي يملكها Phase-04، بالاسم الكامل. مغلقة ومطابقة للسجل.
pub const OPERATIONS: [&str; 12] = [
    "skill.list",
    "skill.get",
    "skill.configure",
    "tool.list",
    "tool.get",
    "tool.activity.list",
    "mcp.list",
    "mcp.register",
    "mcp.configure",
    "mcp.refresh",
    "approval.list",
    "tool.approval.respond",
];

/// أسماء يحرسها هذا الملف بالاسم: وجودها يعني أن مسارًا عامًّا عاد.
pub const FORBIDDEN_OPERATIONS: [&str; 6] =
    ["tool.execute", "tool.invoke", "tool.run", "tool.call", "mcp.call", "skill.execute"];

pub fn handle(p04: &Phase04, operation: &str, payload: &Value, session: &str) -> Result<Value, HostError> {
    match operation {
        "skill.list" => to_value(&p04.list_skills()?),
        "skill.get" => to_value(&p04.get_skill(&required_str(payload, "skill_id")?)?),
        "skill.configure" => to_value(&p04.configure_skill(&required_str(payload, "skill_id")?, required_bool(payload, "enabled")?)?),
        "tool.list" => to_value(&p04.list_tools(optional_str(payload, "provider"), optional_str(payload, "skill_id"))?),
        "tool.get" => to_value(&p04.get_tool(&required_str(payload, "tool_id")?)?),
        "tool.activity.list" => to_value(&p04.list_activity(optional_str(payload, "mission_id"), optional_usize(payload, "limit"))?),
        "mcp.list" => to_value(&p04.list_servers()?),
        "mcp.register" => to_value(&p04.register_server(register_input(payload)?)?),
        "mcp.configure" => to_value(&p04.configure_server(&required_str(payload, "server_id")?, required_bool(payload, "enabled")?)?),
        "mcp.refresh" => to_value(&p04.refresh_server(&required_str(payload, "server_id")?)?),
        "approval.list" => to_value(&p04.list_approvals(optional_str(payload, "mission_id"))?),
        "tool.approval.respond" => {
            let approval_id = required_str(payload, "approval_id")?;
            let decision = decision(payload)?;
            // ADR-042: «لهذه المهمّة» صراحةً بحقل مستقلّ؛ غيابه يعني مرّة واحدة كما كان.
            let mission_scope = match optional_str(payload, "scope") {
                None | Some("ONCE") => false,
                Some("MISSION") => true,
                Some(_) => return Err(HostError::validation("the scope is not ONCE or MISSION").at("/scope")),
            };
            to_value(&p04.respond_approval_scoped(&approval_id, decision, mission_scope, session)?)
        }
        "tool.approval.grants" => {
            let mission_id = required_str(payload, "mission_id")?;
            let grants = p04.mission_grants(&mission_id)?;
            Ok(serde_json::json!({ "mission_id": mission_id, "grants": grants }))
        }
        "tool.approval.grant.revoke" => {
            let mission_id = required_str(payload, "mission_id")?;
            let revoked = p04.revoke_mission_grants(&mission_id, optional_str(payload, "grant_id"))?;
            Ok(serde_json::json!({ "mission_id": mission_id, "revoked": revoked }))
        }
        other => Err(HostError::internal(format!("routed operation {other} has no Phase-04 owner"))),
    }
}

fn required_str(payload: &Value, key: &str) -> Result<String, HostError> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| HostError::validation(format!("{key} is absent")).at(format!("/{key}")))
}

fn optional_str<'a>(payload: &'a Value, key: &str) -> Option<&'a str> {
    payload.get(key).and_then(Value::as_str)
}

fn required_bool(payload: &Value, key: &str) -> Result<bool, HostError> {
    payload
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| HostError::validation(format!("{key} is absent")).at(format!("/{key}")))
}

fn optional_usize(payload: &Value, key: &str) -> Option<usize> {
    payload.get(key).and_then(Value::as_u64).map(|n| n as usize)
}

/// القرار من مفردات مغلقة. قيمة أخرى تُرفض بدل أن تُفسَّر «لا» بالظنّ.
fn decision(payload: &Value) -> Result<ApprovalDecision, HostError> {
    let raw = required_str(payload, "decision")?;
    ApprovalDecision::parse(&raw).ok_or_else(|| HostError::validation("the decision is not GRANT or DENY").at("/decision"))
}

fn register_input(payload: &Value) -> Result<RegisterServerInput, HostError> {
    let name = required_str(payload, "name")?;
    let endpoint = required_str(payload, "endpoint")?;
    // النقل، إن ذُكر، يجب أن يطابق ما يحلّه العنوان فعلًا (PHASE-06): LOOPBACK_HTTP للحلقة المحلية، وREMOTE_HTTPS لعنوان عامّ.
    // اسم نقل آخر، أو نقل لا يطابق العنوان، يُرفض ولا يُترجَم إلى الافتراضي.
    if let Some(transport) = optional_str(payload, "transport") {
        let derived = super::mcp::client::resolve_registered(&endpoint).map(|(_, t)| t.as_str());
        if !matches!(transport, "LOOPBACK_HTTP" | "REMOTE_HTTPS") || derived.ok() != Some(transport) {
            return Err(HostError::validation("the transport is not LOOPBACK_HTTP or REMOTE_HTTPS matching the endpoint").at("/transport"));
        }
    }
    let granted_effects = match payload.get("granted_effects").and_then(Value::as_array) {
        Some(items) => {
            let mut effects: Vec<ToolEffect> = Vec::new();
            for item in items {
                let code = item.as_str().unwrap_or("");
                let effect = ToolEffect::parse(code)
                    .ok_or_else(|| HostError::validation("an effect outside the closed vocabulary was requested").at("/granted_effects"))?;
                effects.push(effect);
            }
            Some(effects)
        }
        None => None,
    };
    Ok(RegisterServerInput { name, endpoint, granted_effects })
}

fn to_value<T: serde::Serialize>(value: &T) -> Result<Value, HostError> {
    serde_json::to_value(value).map_err(|e| HostError::internal(format!("result serialisation failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_operation_list_is_closed_and_carries_no_execution_path() {
        assert_eq!(OPERATIONS.len(), 12);
        for forbidden in FORBIDDEN_OPERATIONS {
            assert!(!OPERATIONS.contains(&forbidden), "{forbidden} is in the Phase-04 vocabulary");
        }
        // ولا عملية تحمل كلمة تنفيذ في اسمها.
        for operation in OPERATIONS {
            for verb in ["execute", "invoke", "run", "call"] {
                assert!(!operation.contains(verb), "{operation} reads like an execution path");
            }
        }
    }

    #[test]
    fn a_decision_outside_the_vocabulary_is_refused() {
        assert!(decision(&serde_json::json!({ "decision": "MAYBE" })).is_err());
        assert!(decision(&serde_json::json!({ "decision": "grant" })).is_err());
        assert_eq!(decision(&serde_json::json!({ "decision": "GRANT" })).unwrap(), ApprovalDecision::Grant);
    }

    #[test]
    fn a_registration_cannot_name_another_transport() {
        let payload = serde_json::json!({ "name": "x", "endpoint": "http://127.0.0.1:4200", "transport": "STDIO" });
        assert!(register_input(&payload).is_err(), "a process-spawning transport was accepted");
    }

    #[test]
    fn a_registration_cannot_request_an_effect_outside_the_vocabulary() {
        let payload = serde_json::json!({ "name": "x", "endpoint": "http://127.0.0.1:4200", "granted_effects": ["EVERYTHING"] });
        assert!(register_input(&payload).is_err());
        let ok = serde_json::json!({ "name": "x", "endpoint": "http://127.0.0.1:4200", "granted_effects": ["NETWORK_EGRESS"] });
        assert_eq!(register_input(&ok).unwrap().granted_effects, Some(vec![ToolEffect::NetworkEgress]));
    }
}
