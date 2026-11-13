// نطاق خوادم MCP: الواصف، والحالة، والسقف الذي يمنحه المستخدم.
//
// القاعدة (البند 39): الخادم لا يمنح نفسه شيئًا. ما يستطيع بلوغه هو تقاطع ما
// أعلنه مع السقف الذي منحه المستخدم عند التسجيل، وذلك التقاطع نفسه محصور داخل
// مِنحة زمن التشغيل الثابتة. ثلاث حلقات متداخلة، أضيقها هي الفعّالة.

use serde::{Deserialize, Serialize};

use crate::p04::effect::{self, ToolEffect};

/// النقل. مذكور صراحةً حتى يكون أي جديد تغييرَ عقد مرئيًّا. البعيد (PHASE-06): HTTPS إلى عنوان عامّ، وكل نداء فيه أثر خارجي يطلب موافقة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpTransport {
    LoopbackHttp,
    RemoteHttps,
}

impl McpTransport {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LoopbackHttp => "LOOPBACK_HTTP",
            Self::RemoteHttps => "REMOTE_HTTPS",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "LOOPBACK_HTTP" => Some(Self::LoopbackHttp),
            "REMOTE_HTTPS" => Some(Self::RemoteHttps),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpServerState {
    Registered,
    Enabled,
    Disabled,
    Unreachable,
}

impl McpServerState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Registered => "REGISTERED",
            Self::Enabled => "ENABLED",
            Self::Disabled => "DISABLED",
            Self::Unreachable => "UNREACHABLE",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        Some(match code {
            "REGISTERED" => Self::Registered,
            "ENABLED" => Self::Enabled,
            "DISABLED" => Self::Disabled,
            "UNREACHABLE" => Self::Unreachable,
            _ => return None,
        })
    }

    pub fn is_usable(self) -> bool {
        matches!(self, Self::Enabled)
    }
}

/// السقف الافتراضي الذي يُمنح لخادم لم يُحدَّد له سقف صراحةً.
///
/// نداء الخادم نفسه خروجٌ على الشبكة، فلا معنى لسقف يخلو منه. وما عداه يبقى
/// خارجًا: خادم يريد الكتابة أو أثرًا خارجيًّا يحتاج منحًا صريحًا من المستخدم.
pub fn default_grant() -> Vec<ToolEffect> {
    vec![ToolEffect::NetworkEgress, ToolEffect::LocalCompute]
}

/// يضيّق سقفًا طلبه المستخدم إلى ما يملكه زمن التشغيل أصلًا، ويضمن وجود أثر الشبكة.
pub fn sanitise_grant(requested: &[ToolEffect]) -> Vec<ToolEffect> {
    let mut granted: Vec<ToolEffect> = requested
        .iter()
        .copied()
        .filter(|e| effect::runtime_holds(e.required_capability()))
        .collect();
    granted.push(ToolEffect::NetworkEgress);
    effect::normalise(&granted)
}

/// سقف خادم بنقله (PHASE-06، CP-06-6): خادم بعيد يتلقّى وسائط أدواته خارج الجهاز، فأثر كل أداة منه خارجي، والسقف يحمله دائمًا
/// كما يحمل أثر الشبكة؛ وبدونه ترفض البوابة كل نداء (`EFFECT_NOT_PERMITTED`) بدل أن تسأل المستخدم. الأثر الخارجي يوجب الموافقة.
pub fn grant_for(requested: &[ToolEffect], transport: McpTransport) -> Vec<ToolEffect> {
    let mut granted = sanitise_grant(requested);
    if transport == McpTransport::RemoteHttps {
        granted.push(ToolEffect::ExternalSideEffect);
    }
    effect::normalise(&granted)
}

/// خادم MCP مسجَّل.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpServer {
    pub server_id: String,
    pub name: String,
    /// النقطة كما حلّها المضيف. لا سرّ فيها لأن خادم أدوات لا يُعطى سرًّا.
    pub endpoint: String,
    pub transport: McpTransport,
    pub state: McpServerState,
    /// السقف الذي منحه المستخدم، بعد تضييقه بمنحة زمن التشغيل.
    pub granted_effects: Vec<ToolEffect>,
    pub tool_count: u32,
    pub rejected_tool_count: u32,
    pub last_error: Option<String>,
    pub last_refresh_at: Option<String>,
    pub registered_at: String,
}

impl McpServer {
    /// هل يجوز لهذا الخادم أن يحمل أداة بهذا الأثر؟
    pub fn grants(&self, effect: ToolEffect) -> bool {
        self.granted_effects.contains(&effect)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_requested_grant_is_narrowed_to_what_the_runtime_holds() {
        let granted = sanitise_grant(&[ToolEffect::ProcessExecution, ToolEffect::SecretAccess, ToolEffect::ReadLocal]);
        assert!(!granted.contains(&ToolEffect::ProcessExecution), "a process grant survived");
        assert!(!granted.contains(&ToolEffect::SecretAccess), "a secret grant survived");
        assert!(granted.contains(&ToolEffect::ReadLocal));
    }

    #[test]
    fn calling_a_server_is_network_egress_whatever_the_user_asked_for() {
        assert!(sanitise_grant(&[]).contains(&ToolEffect::NetworkEgress));
        assert!(default_grant().contains(&ToolEffect::NetworkEgress));
    }

    #[test]
    fn the_grant_is_deterministic_and_free_of_repetition() {
        let a = sanitise_grant(&[ToolEffect::ReadLocal, ToolEffect::NetworkEgress, ToolEffect::ReadLocal]);
        let b = sanitise_grant(&[ToolEffect::NetworkEgress, ToolEffect::ReadLocal]);
        assert_eq!(a, b);
    }

    #[test]
    fn only_an_enabled_server_is_usable() {
        for state in [McpServerState::Registered, McpServerState::Disabled, McpServerState::Unreachable] {
            assert!(!state.is_usable(), "{} was usable", state.as_str());
        }
        assert!(McpServerState::Enabled.is_usable());
    }
}
