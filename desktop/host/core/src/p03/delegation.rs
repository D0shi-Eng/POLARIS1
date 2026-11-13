// متحكّم التفويض: صريح ومحدود.
//
// الوكيل يقترح تفويضًا؛ المنسّق يقرّر (البند 34). لا يُنشئ الوكيل أبناءً بلا حدّ،
// ولا يُنشئ دورًا مُميَّزًا لنفسه (البند 97). العمق محدود بحدّ صلب ضمن مدى مسموح
// (البند 35): 0، 1، الحدّ الأقصى، والحدّ+1 مرفوض.

use serde::{Deserialize, Serialize};

use super::agent::{AgentRegistry, AgentRole};

/// طلب تفويض من وكيل.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelegationRequest {
    pub request_id: String,
    pub mission_id: String,
    pub requesting_agent_id: String,
    pub requesting_agent_depth: u32,
    pub requested_role: AgentRole,
    pub objective: String,
    pub reason: String,
    pub required_capabilities: Vec<String>,
    pub expected_output: String,
}

/// قرار التفويض. مغلق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "decision", content = "detail")]
pub enum DelegationDecision {
    /// مقبول: عمق الابن الجديد.
    Approved { child_depth: u32 },
    RoleDisabled(String),
    DepthExceeded { requested_depth: u32, max_depth: u32 },
    DuplicateRequest(String),
}

/// متحكّم التفويض لمهمّة واحدة. يمنع التكرار الحرفي والعمق الزائد.
pub struct DelegationController {
    max_depth: u32,
    seen: Vec<String>,
}

impl DelegationController {
    pub fn new(max_depth: u32) -> Self {
        Self { max_depth, seen: Vec::new() }
    }

    /// يقيّم طلبًا. المنسّق وحده يستدعي هذا؛ الوكيل لا يُنشئ ابنًا مباشرة.
    /// `registry` يقرّر إن كان الدور مُفعَّلًا ومعروفًا.
    pub fn evaluate(&mut self, request: &DelegationRequest, registry: &AgentRegistry) -> DelegationDecision {
        // تكرار حرفي لطلب سابق (نفس الطالب والدور والهدف).
        let signature = format!("{}|{}|{}", request.requesting_agent_id, request.requested_role.as_str(), request.objective);
        if self.seen.contains(&signature) {
            return DelegationDecision::DuplicateRequest(request.request_id.clone());
        }
        // الدور معروف ومُفعَّل.
        if !registry.is_available(request.requested_role) {
            return DelegationDecision::RoleDisabled(request.requested_role.as_str().to_string());
        }
        // العمق: عمق الابن = عمق الطالب + 1، ويجب ألّا يتجاوز الحدّ.
        let child_depth = request.requesting_agent_depth + 1;
        if child_depth > self.max_depth {
            return DelegationDecision::DepthExceeded { requested_depth: child_depth, max_depth: self.max_depth };
        }
        self.seen.push(signature);
        DelegationDecision::Approved { child_depth }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(agent: &str, depth: u32, role: AgentRole, objective: &str) -> DelegationRequest {
        DelegationRequest {
            request_id: format!("req-{agent}-{objective}"),
            mission_id: "m1".into(),
            requesting_agent_id: agent.into(),
            requesting_agent_depth: depth,
            requested_role: role,
            objective: objective.into(),
            reason: "r".into(),
            required_capabilities: Vec::new(),
            expected_output: "o".into(),
        }
    }

    #[test]
    fn a_valid_delegation_at_depth_zero_is_approved_at_depth_one() {
        let reg = AgentRegistry::builtin();
        let mut ctrl = DelegationController::new(3);
        let decision = ctrl.evaluate(&request("root", 0, AgentRole::Builder, "build"), &reg);
        assert_eq!(decision, DelegationDecision::Approved { child_depth: 1 });
    }

    #[test]
    fn delegation_at_the_max_depth_is_allowed_but_beyond_is_denied() {
        let reg = AgentRegistry::builtin();
        let mut ctrl = DelegationController::new(3);
        // الطالب عند عمق 2 → الابن عند 3 = الحدّ، مسموح.
        assert_eq!(
            ctrl.evaluate(&request("a", 2, AgentRole::Builder, "x"), &reg),
            DelegationDecision::Approved { child_depth: 3 }
        );
        // الطالب عند عمق 3 → الابن عند 4 > الحدّ، مرفوض.
        assert_eq!(
            ctrl.evaluate(&request("b", 3, AgentRole::Builder, "y"), &reg),
            DelegationDecision::DepthExceeded { requested_depth: 4, max_depth: 3 }
        );
    }

    #[test]
    fn a_disabled_target_role_is_denied() {
        let mut reg = AgentRegistry::builtin();
        let idx = reg.descriptors().iter().position(|d| d.agent_type == AgentRole::Builder).unwrap();
        // نعطّل عبر إعادة بناء وصف معطّل.
        let mut descriptors: Vec<_> = reg.descriptors().to_vec();
        descriptors[idx].enabled = false;
        reg = rebuild(descriptors);
        let mut ctrl = DelegationController::new(3);
        assert_eq!(
            ctrl.evaluate(&request("a", 0, AgentRole::Builder, "x"), &reg),
            DelegationDecision::RoleDisabled("BUILDER".into())
        );
    }

    #[test]
    fn a_duplicate_delegation_request_is_denied() {
        let reg = AgentRegistry::builtin();
        let mut ctrl = DelegationController::new(3);
        ctrl.evaluate(&request("a", 0, AgentRole::Builder, "same"), &reg);
        let again = ctrl.evaluate(&request("a", 0, AgentRole::Builder, "same"), &reg);
        assert!(matches!(again, DelegationDecision::DuplicateRequest(_)));
    }

    /// مُعين اختبار: يعيد بناء سجل من أوصاف مُعدَّلة عبر التسلسل/إلغائه.
    fn rebuild(descriptors: Vec<super::super::agent::AgentDescriptor>) -> AgentRegistry {
        let json = serde_json::to_string(&descriptors).unwrap();
        let restored: Vec<super::super::agent::AgentDescriptor> = serde_json::from_str(&json).unwrap();
        AgentRegistry::from_descriptors(restored)
    }
}
