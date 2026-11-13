// سجل الأدوات: واصف مغلق لكل أداة، ومصدر الحقيقة الوحيد لما يمكن استدعاؤه.
//
// القاعدة (البند 77): لا `tool.execute` باسم حرّ. اسم غير مسجَّل ليس أداة معطّلة،
// بل ليس أداة أصلًا. والواصف يحمل أثره وقدراته وسياسة شبكته وحاجته إلى موافقة،
// فيُقرأ القرار من الواصف لا من نيّة المستدعي.
//
// أداة MCP تدخل هذا السجل مثل غيرها، بفارق واحد معلن: صنف ثقتها `McpUntrusted`،
// ووصفها ومخططها بيانات جاءت من خادم، لا تعليمة ولا إذن.

use serde::{Deserialize, Serialize};

use super::effect::{self, ToolEffect};

/// منشأ أدوات الموصلات في سجل الأدوات. مصدر واحد يقرؤه من يبني الواصف (`p06/connector/tool.rs`) ومن يصنّفه.
pub const CONNECTOR_ORIGIN: &str = "polaris.connector";

/// من قدّم الأداة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ToolProvider {
    BuiltIn,
    Mcp,
}

impl ToolProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BuiltIn => "BUILT_IN",
            Self::Mcp => "MCP",
        }
    }
}

/// صنف ثقة الأداة. يقرّره السجل من المصدر، لا الخادم عن نفسه.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ToolTrustClass {
    /// محوّل تكتبه POLARIS نفسها.
    TrustedRuntime,
    /// كل ما جاء من خادم MCP: وصفه ومخططه وناتجه.
    McpUntrusted,
}

impl ToolTrustClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TrustedRuntime => "TRUSTED_RUNTIME",
            Self::McpUntrusted => "MCP_UNTRUSTED",
        }
    }
}

/// درجة الخطر. وصفية للعرض والسياسة، لا مصدر إذن.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RiskClass {
    Low,
    Moderate,
    High,
    Critical,
}

impl RiskClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "LOW",
            Self::Moderate => "MODERATE",
            Self::High => "HIGH",
            Self::Critical => "CRITICAL",
        }
    }

    /// الخطر المشتق من الآثار. الواصف لا يستطيع أن يُنزل خطره دون هذا الحدّ.
    pub fn from_effects(effects: &[ToolEffect]) -> Self {
        if effects.iter().any(|e| e.is_external()) {
            Self::High
        } else if effects.iter().any(|e| e.mutates()) {
            Self::Moderate
        } else {
            Self::Low
        }
    }
}

/// الشبكة التي يجوز للأداة بلوغها.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NetworkPolicy {
    None,
    LoopbackOnly,
    /// سياسة تنقّل المتصفّح المدمج (Phase-05): http/https فقط، ولا حلقة محلية ولا
    /// عنوان خاص ولا نقطة بيانات وصفية، وكل عنوان يُحلّ ويُفحص عند الاتصال، وكل
    /// إعادة توجيه تُفحص من جديد. ليست «خروجًا حرًّا»: لا تُمنح لأداة MCP ولا لأداة
    /// غير موثوقة، والختم يُنزلها إلى الحلقة المحلية لكل أداة غير أداة المتصفّح.
    WebNavigationPolicy,
    /// خروج موصل Phase-06 إلى عنوانه الأساسي الذي سجّله المستخدم وحده: القالب والأسلوب
    /// والمضيف من الإعداد الموثوق، والعناوين العامّة تُحلّ وتُفحص عند الاتصال، والحلقة
    /// المحلية حرفية. تحمله أداة موصل مدمجة موثوقة وحدها، وتفرضه بوابة الموصلات.
    ConnectorEgressPolicy,
    /// PHASE-06: أداة خادم MCP بعيد سجّله المستخدم (HTTPS إلى عنوان عامّ، يُحلّ ويُفحص عند كل اتصال). تحملها أداة MCP غير موثوقة
    /// وحدها، وأثرها الخارجي يوجب الموافقة بنيويًّا: وسائط الأداة تغادر الجهاز إلى طرف ثالث.
    McpRegisteredHttps,
}

impl NetworkPolicy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "NONE",
            Self::LoopbackOnly => "LOOPBACK_ONLY",
            Self::WebNavigationPolicy => "WEB_NAVIGATION_POLICY",
            Self::ConnectorEgressPolicy => "CONNECTOR_EGRESS_POLICY",
            Self::McpRegisteredHttps => "MCP_REGISTERED_HTTPS",
        }
    }
}

/// مصدر الأداة كما يسجّله المضيف.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolProvenance {
    /// من أين جاءت: `polaris.builtin` أو معرّف خادم.
    pub origin: String,
    pub server_id: Option<String>,
    pub server_name: Option<String>,
    /// ما أعلنه الخادم عن نفسه. طلبٌ يُسجَّل، لا منحة تُنفَّذ.
    pub declared_effects: Vec<ToolEffect>,
    /// بصمة تعريف الأداة كما وصل. تكشف انحراف المخطط بعد الاكتشاف.
    pub schema_digest: String,
    pub registered_at: String,
}

/// واصف أداة واحدة. مغلق: كل ما يحتاجه القرار موجود هنا.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolDescriptor {
    pub tool_id: String,
    pub provider: ToolProvider,
    pub name: String,
    pub description: String,
    /// مرجع مخطط المدخلات بالاسم. المخطط نفسه يعيش عند المحوّل أو عند سجل MCP.
    pub input_schema_ref: String,
    pub output_schema_ref: String,
    pub effects: Vec<ToolEffect>,
    pub required_capabilities: Vec<String>,
    pub risk: RiskClass,
    pub requires_approval: bool,
    pub network_policy: NetworkPolicy,
    pub enabled: bool,
    pub trust_class: ToolTrustClass,
    pub provenance: ToolProvenance,
}

impl ToolDescriptor {
    /// صفات قاعدة الاثنين من هذا الواصف (R-04، 2026-10-12): المزوّد وصنف الثقة والمنشأ والآثار، لا الاسم ولا بادئته.
    /// أداة MCP مصدرها غير موثوق وأثرها خارجي، لأن ما يفعله خادم لا يُعرف من وصفه. أداة الموصل تحمل اعتمادات المستخدم
    /// فهي حسّاسة، وناتجها من خدمة خارجية حتى لو لم تخرج إلى الشبكة (موصل مساحة العمل). خروج الشبكة أو الأثر الخارجي فعلٌ خارجي.
    pub fn rule_of_two_traits(&self) -> crate::p03::port::ToolTraits {
        let mcp = self.provider == ToolProvider::Mcp || self.trust_class == ToolTrustClass::McpUntrusted;
        let connector = self.provenance.origin == CONNECTOR_ORIGIN;
        let network = self.effects.iter().any(|e| e.is_network());
        crate::p03::port::ToolTraits {
            untrusted_source: mcp || connector || network,
            sensitive: connector || self.effects.iter().any(|e| matches!(e, ToolEffect::SecretAccess | ToolEffect::DesktopInput)),
            external: mcp || network || self.effects.iter().any(|e| e.is_external()),
        }
    }

    /// يبني واصفًا متّسقًا مع آثاره: القدرات والخطر والموافقة وسياسة الشبكة كلها
    /// تُشتق من الآثار، فلا يستطيع واصف أن يُعلن أثرًا ويتهرّب من حارسه.
    /// يعلن سياسة الخروج قبل الختم. الختم يُبقيها لأداة مدمجة موثوقة وحدها، ويُنزل غيرها إلى الحلقة المحلية.
    pub fn with_network_policy(mut self, policy: NetworkPolicy) -> Self {
        self.network_policy = policy;
        self
    }

    pub fn sealed(mut self) -> Self {
        self.effects = effect::normalise(&self.effects);
        self.required_capabilities = self.effects.iter().map(|e| e.required_capability().to_string()).collect();
        self.required_capabilities.sort();
        self.required_capabilities.dedup();
        let derived = RiskClass::from_effects(&self.effects);
        if derived > self.risk {
            self.risk = derived;
        }
        if self.effects.iter().any(|e| e.always_requires_approval()) {
            self.requires_approval = true;
        }
        // سياسة التنقّل لا تُعلَن: تبقى فقط لأداة مدمجة موثوقة تُعلن أثر شبكة وتطلبها
        // صراحةً. كل ما عداها يُختم بالحلقة المحلية كما في Phase-04.
        let trusted_builtin = self.provider == ToolProvider::BuiltIn && self.trust_class == ToolTrustClass::TrustedRuntime;
        let web_policed = self.network_policy == NetworkPolicy::WebNavigationPolicy && trusted_builtin;
        let connector_policed = self.network_policy == NetworkPolicy::ConnectorEgressPolicy && trusted_builtin;
        let mcp_remote = self.network_policy == NetworkPolicy::McpRegisteredHttps
            && self.provider == ToolProvider::Mcp
            && self.trust_class == ToolTrustClass::McpUntrusted
            && self.effects.contains(&ToolEffect::ExternalSideEffect);
        self.network_policy = if !self.effects.iter().any(|e| e.is_network()) {
            NetworkPolicy::None
        } else if web_policed {
            NetworkPolicy::WebNavigationPolicy
        } else if connector_policed {
            NetworkPolicy::ConnectorEgressPolicy
        } else if mcp_remote {
            NetworkPolicy::McpRegisteredHttps
        } else {
            NetworkPolicy::LoopbackOnly
        };
        self
    }

    /// هل كل قدرات هذه الأداة ضمن مِنحة زمن التشغيل؟
    pub fn capabilities_are_granted(&self) -> bool {
        self.required_capabilities.iter().all(|c| effect::runtime_holds(c))
    }

    pub fn missing_capability(&self) -> Option<&str> {
        self.required_capabilities.iter().find(|c| !effect::runtime_holds(c)).map(String::as_str)
    }

    pub fn is_external(&self) -> bool {
        self.effects.iter().any(|e| e.is_external())
    }

    pub fn is_network(&self) -> bool {
        self.effects.iter().any(|e| e.is_network())
    }
}

/// شكل معرّف الأداة. يطابق نمط العقد حرفًا بحرف.
pub fn is_valid_tool_id(value: &str) -> bool {
    let bytes = value.as_bytes();
    if value.len() < 3 || value.len() > 160 {
        return false;
    }
    let Some(first) = bytes.first() else { return false };
    if !(first.is_ascii_lowercase() || first.is_ascii_digit()) {
        return false;
    }
    value.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | ':' | '-'))
}

/// سجل الأدوات. مغلق للقراءة من زمن التشغيل، ويُحدَّث من مسارات موثوقة وحدها.
#[derive(Debug, Default, Clone)]
pub struct ToolRegistry {
    tools: Vec<ToolDescriptor>,
}

/// لماذا رُفض واصف عند التسجيل. مغلق، ويطابق مفردات العقد.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RegistrationRefusal {
    UnknownTool,
    ArgumentsInvalid,
    CapabilityMissing,
    EffectNotPermitted,
    NetworkPolicyDenied,
    SchemaDrift,
    SecretRequested,
}

impl RegistrationRefusal {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnknownTool => "UNKNOWN_TOOL",
            Self::ArgumentsInvalid => "ARGUMENTS_INVALID",
            Self::CapabilityMissing => "CAPABILITY_MISSING",
            Self::EffectNotPermitted => "EFFECT_NOT_PERMITTED",
            Self::NetworkPolicyDenied => "NETWORK_POLICY_DENIED",
            Self::SchemaDrift => "SCHEMA_DRIFT",
            Self::SecretRequested => "SECRET_REQUESTED",
        }
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: Vec::new() }
    }

    pub fn tools(&self) -> &[ToolDescriptor] {
        &self.tools
    }

    pub fn get(&self, tool_id: &str) -> Option<&ToolDescriptor> {
        self.tools.iter().find(|t| t.tool_id == tool_id)
    }

    /// يسجّل واصفًا بعد التحقق منه. الاستبدال مسموح بالمعرّف نفسه، ويبقى محكومًا
    /// بالتحقق نفسه: خادم يغيّر تعريف أداته بعد الاكتشاف لا يتخطّى شيئًا.
    pub fn register(&mut self, descriptor: ToolDescriptor) -> Result<(), RegistrationRefusal> {
        let sealed = descriptor.sealed();
        if !is_valid_tool_id(&sealed.tool_id) {
            return Err(RegistrationRefusal::ArgumentsInvalid);
        }
        if sealed.effects.is_empty() {
            // أداة بلا أثر مُعلن ليست بريئة: هي أداة لم تُصنَّف.
            return Err(RegistrationRefusal::ArgumentsInvalid);
        }
        if let Some(missing) = sealed.missing_capability() {
            return Err(if missing.ends_with(".secret") {
                RegistrationRefusal::SecretRequested
            } else {
                RegistrationRefusal::CapabilityMissing
            });
        }
        if sealed.name.is_empty() || sealed.name.len() > 200 {
            return Err(RegistrationRefusal::ArgumentsInvalid);
        }
        match self.tools.iter_mut().find(|t| t.tool_id == sealed.tool_id) {
            Some(existing) => *existing = sealed,
            None => self.tools.push(sealed),
        }
        self.tools.sort_by(|a, b| a.tool_id.cmp(&b.tool_id));
        Ok(())
    }

    /// يزيل كل أدوات خادم. يُستعمل عند إعادة الاكتشاف وعند التعطيل.
    pub fn remove_server_tools(&mut self, server_id: &str) -> usize {
        let before = self.tools.len();
        self.tools.retain(|t| t.provenance.server_id.as_deref() != Some(server_id));
        before - self.tools.len()
    }

    /// يزيل كل أداة يبدأ معرّفها ببادئة (أدوات موصل Phase-06 عند إعادة المزامنة).
    pub fn remove_prefixed(&mut self, prefix: &str) -> Vec<String> {
        let removed: Vec<String> = self.tools.iter().filter(|t| t.tool_id.starts_with(prefix)).map(|t| t.tool_id.clone()).collect();
        self.tools.retain(|t| !t.tool_id.starts_with(prefix));
        removed
    }

    pub fn set_enabled(&mut self, tool_id: &str, enabled: bool) -> bool {
        match self.tools.iter_mut().find(|t| t.tool_id == tool_id) {
            Some(tool) => {
                tool.enabled = enabled;
                true
            }
            None => false,
        }
    }

    pub fn server_tools(&self, server_id: &str) -> Vec<&ToolDescriptor> {
        self.tools.iter().filter(|t| t.provenance.server_id.as_deref() == Some(server_id)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(id: &str, effects: Vec<ToolEffect>) -> ToolDescriptor {
        ToolDescriptor {
            tool_id: id.into(),
            provider: ToolProvider::BuiltIn,
            name: "a tool".into(),
            description: "does one bounded thing".into(),
            input_schema_ref: "p04.tool.input.v1".into(),
            output_schema_ref: "p04.tool.output.v1".into(),
            effects,
            required_capabilities: Vec::new(),
            risk: RiskClass::Low,
            requires_approval: false,
            network_policy: NetworkPolicy::None,
            enabled: true,
            trust_class: ToolTrustClass::TrustedRuntime,
            provenance: ToolProvenance {
                origin: "polaris.builtin".into(),
                server_id: None,
                server_name: None,
                declared_effects: Vec::new(),
                schema_digest: "d".into(),
                registered_at: "2026-09-22T00:00:00Z".into(),
            },
        }
    }

    /// R-04: أداة موصل بآثارها كما تشتقّها عملياته (`OperationAction::effects`): حسّاسة دائمًا (اعتمادات المستخدم)، وغير موثوقة
    /// المصدر، وفعلها خارجي متى خرجت إلى الشبكة أو غيّرت خدمة. وأداة MCP بلا آثار معلنة تبقى غير موثوقة وخارجية.
    #[test]
    fn rule_of_two_traits_follow_the_descriptor_not_the_name() {
        use crate::p06::connector::model::{EgressClass, OperationAction};
        let connector = |action: OperationAction, egress: EgressClass| {
            let mut d = descriptor("connector:00000000-0000-0000-0000-000000000000:op", action.effects(egress));
            d.provenance.origin = CONNECTOR_ORIGIN.into();
            d.rule_of_two_traits()
        };
        let send = connector(OperationAction::Send, EgressClass::PublicHttps);
        assert!(send.sensitive && send.untrusted_source && send.external, "{send:?}");
        let local_read = connector(OperationAction::Read, EgressClass::None);
        assert!(local_read.sensitive && local_read.untrusted_source && !local_read.external, "{local_read:?}");

        let mut mcp = descriptor("mcp:11111111:anything", Vec::new());
        mcp.provider = ToolProvider::Mcp;
        let mcp = mcp.rule_of_two_traits();
        assert!(mcp.untrusted_source && mcp.external && !mcp.sensitive, "{mcp:?}");

        // الاسم لا يقرّر: أداة مدمجة سُمّيت كأنها موصل تبقى بصفات آثارها.
        let named_like_connector = descriptor("connector:fake:op", vec![ToolEffect::ReadLocal]).rule_of_two_traits();
        assert_eq!(named_like_connector, crate::p03::port::ToolTraits::default());
    }

    #[test]
    fn a_descriptor_cannot_declare_a_write_and_escape_approval() {
        let sealed = descriptor("polaris.tool.writer", vec![ToolEffect::WriteLocal]).sealed();
        assert!(sealed.requires_approval, "a write tool declared itself approval-free");
        assert_eq!(sealed.risk, RiskClass::Moderate);
    }

    #[test]
    fn a_descriptor_cannot_lower_the_risk_its_effects_imply() {
        let sealed = descriptor("polaris.tool.sender", vec![ToolEffect::ExternalSideEffect]).sealed();
        assert_eq!(sealed.risk, RiskClass::High);
    }

    #[test]
    fn declaring_a_network_effect_forces_the_loopback_policy() {
        let sealed = descriptor("polaris.tool.fetch", vec![ToolEffect::NetworkEgress]).sealed();
        assert_eq!(sealed.network_policy, NetworkPolicy::LoopbackOnly);
        let quiet = descriptor("polaris.tool.hash", vec![ToolEffect::LocalCompute]).sealed();
        assert_eq!(quiet.network_policy, NetworkPolicy::None);
    }

    #[test]
    fn only_a_trusted_builtin_network_tool_keeps_the_web_navigation_policy() {
        let mut browser = descriptor("polaris.web.navigate", vec![ToolEffect::NetworkEgress]);
        browser.network_policy = NetworkPolicy::WebNavigationPolicy;
        assert_eq!(browser.clone().sealed().network_policy, NetworkPolicy::WebNavigationPolicy);
        let mut mcp = browser.clone();
        mcp.provider = ToolProvider::Mcp;
        mcp.trust_class = ToolTrustClass::McpUntrusted;
        assert_eq!(mcp.sealed().network_policy, NetworkPolicy::LoopbackOnly, "an MCP tool kept the web policy");
        let mut quiet = browser;
        quiet.effects = vec![ToolEffect::LocalCompute];
        assert_eq!(quiet.sealed().network_policy, NetworkPolicy::None, "a tool with no network effect kept a network policy");
    }

    #[test]
    fn only_a_trusted_builtin_network_tool_keeps_the_connector_egress_policy() {
        let mut connector = descriptor("connector:c:items.list", vec![ToolEffect::NetworkEgress]);
        connector.network_policy = NetworkPolicy::ConnectorEgressPolicy;
        assert_eq!(connector.clone().sealed().network_policy, NetworkPolicy::ConnectorEgressPolicy);
        let mut mcp = connector.clone();
        mcp.provider = ToolProvider::Mcp;
        mcp.trust_class = ToolTrustClass::McpUntrusted;
        assert_eq!(mcp.sealed().network_policy, NetworkPolicy::LoopbackOnly, "an MCP tool kept the connector egress policy");
        let mut quiet = connector;
        quiet.effects = vec![ToolEffect::ReadLocal];
        assert_eq!(quiet.sealed().network_policy, NetworkPolicy::None);
    }

    #[test]
    fn a_tool_that_wants_to_run_a_process_or_read_a_secret_cannot_be_registered() {
        let mut registry = ToolRegistry::new();
        assert_eq!(
            registry.register(descriptor("polaris.tool.shell", vec![ToolEffect::ProcessExecution])),
            Err(RegistrationRefusal::CapabilityMissing)
        );
        assert_eq!(
            registry.register(descriptor("polaris.tool.creds", vec![ToolEffect::SecretAccess])),
            Err(RegistrationRefusal::SecretRequested)
        );
        assert!(registry.tools().is_empty(), "a refused tool entered the registry");
    }

    #[test]
    fn a_tool_with_no_declared_effect_is_refused_rather_than_treated_as_harmless() {
        let mut registry = ToolRegistry::new();
        assert_eq!(registry.register(descriptor("polaris.tool.mystery", vec![])), Err(RegistrationRefusal::ArgumentsInvalid));
    }

    #[test]
    fn an_identifier_outside_the_contract_shape_is_refused() {
        let mut registry = ToolRegistry::new();
        for bad in ["A", "Polaris.Tool", "tool name", "t", "../etc/passwd", "tool/../x"] {
            assert!(
                registry.register(descriptor(bad, vec![ToolEffect::LocalCompute])).is_err(),
                "{bad} was accepted as a tool identifier"
            );
        }
        assert!(registry.register(descriptor("polaris.tool.ok", vec![ToolEffect::LocalCompute])).is_ok());
    }

    #[test]
    fn registration_is_deterministic_and_replaces_rather_than_duplicates() {
        let mut registry = ToolRegistry::new();
        registry.register(descriptor("polaris.tool.b", vec![ToolEffect::LocalCompute])).unwrap();
        registry.register(descriptor("polaris.tool.a", vec![ToolEffect::LocalCompute])).unwrap();
        registry.register(descriptor("polaris.tool.b", vec![ToolEffect::ReadLocal])).unwrap();
        assert_eq!(registry.tools().len(), 2);
        assert_eq!(registry.tools()[0].tool_id, "polaris.tool.a");
        assert_eq!(registry.tools()[1].effects, vec![ToolEffect::ReadLocal]);
    }

    #[test]
    fn removing_one_servers_tools_leaves_the_others_alone() {
        let mut registry = ToolRegistry::new();
        let mut first = descriptor("mcp:one:echo", vec![ToolEffect::LocalCompute]);
        first.provenance.server_id = Some("one".into());
        let mut second = descriptor("mcp:two:echo", vec![ToolEffect::LocalCompute]);
        second.provenance.server_id = Some("two".into());
        registry.register(first).unwrap();
        registry.register(second).unwrap();
        assert_eq!(registry.remove_server_tools("one"), 1);
        assert_eq!(registry.tools().len(), 1);
        assert_eq!(registry.tools()[0].tool_id, "mcp:two:echo");
    }
}
