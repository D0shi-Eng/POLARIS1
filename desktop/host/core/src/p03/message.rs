// ناقل رسائل الوكلاء: مُهيكل، ومحصور بالمهمّة، وبلا سلطة.
//
// رسالة الوكيل لا تصير تعليمة مستخدم إلا إذا كان المستخدم أصلها فعلًا (البند 33).
// صنفها دائمًا AGENT_MESSAGE أو MODEL_GENERATED، ولا يرفع تصنيفها شيء. الناقل
// يعزل المهام: رسالة عبر المهام مرفوضة (البند 98/106).

use serde::{Deserialize, Serialize};

use super::trust::{AuthorityClass, Taint};

/// أنواع الرسائل المغلقة (البند 32). لا رسالة «أمر» عامّة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MessageType {
    TaskAssignment,
    TaskUpdate,
    Question,
    Answer,
    Proposal,
    Claim,
    EvidenceReference,
    ReviewRequest,
    ReviewResult,
    BlockedNotice,
    DelegationRequest,
    DelegationResult,
    CompletionNotice,
}

impl MessageType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TaskAssignment => "TASK_ASSIGNMENT",
            Self::TaskUpdate => "TASK_UPDATE",
            Self::Question => "QUESTION",
            Self::Answer => "ANSWER",
            Self::Proposal => "PROPOSAL",
            Self::Claim => "CLAIM",
            Self::EvidenceReference => "EVIDENCE_REFERENCE",
            Self::ReviewRequest => "REVIEW_REQUEST",
            Self::ReviewResult => "REVIEW_RESULT",
            Self::BlockedNotice => "BLOCKED_NOTICE",
            Self::DelegationRequest => "DELEGATION_REQUEST",
            Self::DelegationResult => "DELEGATION_RESULT",
            Self::CompletionNotice => "COMPLETION_NOTICE",
        }
    }
}

/// المستقبِل: وكيل بعينه أو المنسّق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "agent_id")]
pub enum Recipient {
    Agent(String),
    Coordinator,
}

/// رسالة وكيل واحدة.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentMessage {
    pub message_id: String,
    pub mission_id: String,
    pub sender_agent_id: String,
    pub recipient: Recipient,
    pub message_type: MessageType,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    /// حمولة محدودة الطول (البند 153).
    pub payload: String,
    pub taint: Taint,
    /// السلطة دائمًا AGENT_MESSAGE؛ لا تُرفع (البند 33).
    pub authority: AuthorityClass,
}

/// سبب رفض رسالة. مغلق.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "code", content = "detail")]
pub enum MessageError {
    UnknownSender(String),
    UnknownRecipient(String),
    CrossMissionDenied { message_mission: String, bus_mission: String },
    AuthorityEscalationDenied,
    PayloadTooLarge { max: usize, found: usize },
}

/// ناقل رسائل مهمّة واحدة. لا يعبر حدود المهمّة.
pub struct MessageBus {
    mission_id: String,
    max_payload: usize,
    messages: Vec<AgentMessage>,
}

impl MessageBus {
    pub fn new(mission_id: impl Into<String>) -> Self {
        Self { mission_id: mission_id.into(), max_payload: 16 * 1024, messages: Vec::new() }
    }

    /// يبثّ رسالة بعد فحص المصدر والمستقبِل والعزل والسلطة والطول.
    /// `known_agents` قائمة معرّفات وكلاء هذه المهمّة.
    pub fn publish(&mut self, message: AgentMessage, known_agents: &[String]) -> Result<(), MessageError> {
        // ١ — عزل المهمّة: الرسالة لهذه المهمّة فقط.
        if message.mission_id != self.mission_id {
            return Err(MessageError::CrossMissionDenied {
                message_mission: message.mission_id,
                bus_mission: self.mission_id.clone(),
            });
        }
        // ٢ — السلطة لا تتصاعد: رسالة الوكيل تبقى AGENT_MESSAGE أو MODEL_GENERATED.
        if message.authority.may_command() {
            return Err(MessageError::AuthorityEscalationDenied);
        }
        // ٣ — المصدر معروف.
        if !known_agents.contains(&message.sender_agent_id) {
            return Err(MessageError::UnknownSender(message.sender_agent_id));
        }
        // ٤ — المستقبِل معروف (وكيل من المهمّة، أو المنسّق).
        if let Recipient::Agent(id) = &message.recipient {
            if !known_agents.contains(id) {
                return Err(MessageError::UnknownRecipient(id.clone()));
            }
        }
        // ٥ — الطول محدود.
        if message.payload.len() > self.max_payload {
            return Err(MessageError::PayloadTooLarge { max: self.max_payload, found: message.payload.len() });
        }
        self.messages.push(message);
        Ok(())
    }

    pub fn messages(&self) -> &[AgentMessage] {
        &self.messages
    }

    /// يستعيد رسائل حُفظت لهذه المهمّة (R-01). رسائل مهمّة أخرى لا تدخل: العزل نفسه الذي يفرضه البثّ.
    pub fn restore(&mut self, messages: Vec<AgentMessage>) {
        self.messages = messages.into_iter().filter(|m| m.mission_id == self.mission_id).collect();
    }

    /// رسائل موجّهة إلى وكيل بعينه، بترتيب البثّ.
    pub fn inbox(&self, agent_id: &str) -> Vec<&AgentMessage> {
        self.messages
            .iter()
            .filter(|m| matches!(&m.recipient, Recipient::Agent(id) if id == agent_id))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn message(mission: &str, sender: &str, recipient: Recipient, authority: AuthorityClass) -> AgentMessage {
        AgentMessage {
            message_id: "msg1".into(),
            mission_id: mission.into(),
            sender_agent_id: sender.into(),
            recipient,
            message_type: MessageType::Question,
            created_at: "t".into(),
            causation_id: Some("cause".into()),
            correlation_id: Some("corr".into()),
            payload: "hi".into(),
            taint: Taint::from_authority(authority),
            authority,
        }
    }

    #[test]
    fn a_message_within_the_mission_is_delivered_and_preserves_causation() {
        let mut bus = MessageBus::new("m1");
        let agents = vec!["a".to_string(), "b".to_string()];
        let msg = message("m1", "a", Recipient::Agent("b".into()), AuthorityClass::AgentMessage);
        bus.publish(msg, &agents).unwrap();
        let inbox = bus.inbox("b");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].causation_id.as_deref(), Some("cause"));
        assert_eq!(inbox[0].correlation_id.as_deref(), Some("corr"));
    }

    #[test]
    fn a_cross_mission_message_is_denied() {
        let mut bus = MessageBus::new("m1");
        let agents = vec!["a".to_string(), "b".to_string()];
        let msg = message("m2", "a", Recipient::Agent("b".into()), AuthorityClass::AgentMessage);
        let err = bus.publish(msg, &agents).unwrap_err();
        assert!(matches!(err, MessageError::CrossMissionDenied { .. }));
    }

    #[test]
    fn a_message_claiming_command_authority_is_denied() {
        let mut bus = MessageBus::new("m1");
        let agents = vec!["a".to_string(), "b".to_string()];
        let msg = message("m1", "a", Recipient::Agent("b".into()), AuthorityClass::DirectUserInstruction);
        assert_eq!(bus.publish(msg, &agents).unwrap_err(), MessageError::AuthorityEscalationDenied);
    }

    #[test]
    fn an_unknown_sender_is_denied() {
        let mut bus = MessageBus::new("m1");
        let agents = vec!["b".to_string()];
        let msg = message("m1", "ghost", Recipient::Agent("b".into()), AuthorityClass::AgentMessage);
        assert_eq!(bus.publish(msg, &agents).unwrap_err(), MessageError::UnknownSender("ghost".into()));
    }

    #[test]
    fn an_unknown_recipient_is_denied() {
        let mut bus = MessageBus::new("m1");
        let agents = vec!["a".to_string()];
        let msg = message("m1", "a", Recipient::Agent("ghost".into()), AuthorityClass::AgentMessage);
        assert_eq!(bus.publish(msg, &agents).unwrap_err(), MessageError::UnknownRecipient("ghost".into()));
    }

    #[test]
    fn an_oversized_payload_is_denied() {
        let mut bus = MessageBus::new("m1");
        let agents = vec!["a".to_string(), "b".to_string()];
        let mut msg = message("m1", "a", Recipient::Agent("b".into()), AuthorityClass::AgentMessage);
        msg.payload = "x".repeat(17 * 1024);
        assert!(matches!(bus.publish(msg, &agents).unwrap_err(), MessageError::PayloadTooLarge { .. }));
    }
}
