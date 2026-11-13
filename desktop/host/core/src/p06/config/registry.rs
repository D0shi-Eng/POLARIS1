// فهرس إعدادات Phase-06: كل إعداد مُصنَّف ومحدود، ويسمّي مستهلكه.
//
// القاعدة التي يفرضها الاختبار أدناه: إعداد قابل للتعديل بلا مستهلك في المضيف أو
// العارض هو بالضبط «عنصر يبدو شغّالًا ولا يفعل شيئًا». لذلك يحمل كل تعريف اسم
// المكان الذي يقرؤه، ويُقاس أثره في مجموعة P06-SETTINGS وP06-PRIVACY.
//
// ما يحمل أمنًا يُعلن اتجاه توسيعه وسقفه، فتقرأ الطبقاتُ الأدنى التعريفَ نفسه ولا
// تستطيع توسيعه. وما ليس لهذه المرحلة يُعلَن غير متاح بسببه، بلا تحكّم.

use super::model::{Applies, Bounds, DefaultValue, Layer, Section, SettingDef, SettingKind, SettingState, Widening};

const USER: &[Layer] = &[Layer::User];
const USER_PROJECT: &[Layer] = &[Layer::User, Layer::Project];
const ALL_LAYERS: &[Layer] = &[Layer::User, Layer::Project, Layer::Mission, Layer::Security];
const USER_SECURITY: &[Layer] = &[Layer::User, Layer::Security];
const NO_LAYER: &[Layer] = &[];

pub const LOCALES: &[&str] = &["SYSTEM", "ar", "en", "de", "fr", "ru", "zh", "ko", "ja", "es"];
pub const SIDE_EFFECT_ORDER: &[&str] = &["DENY", "REQUIRE_APPROVAL"];
pub const DIAGNOSTICS_ORDER: &[&str] = &["MINIMAL", "STANDARD", "DETAILED"];

#[allow(clippy::too_many_arguments)]
const fn def(
    key: &'static str,
    section: Section,
    kind: SettingKind,
    default: DefaultValue,
    bounds: Bounds,
    layers: &'static [Layer],
    widening: Option<Widening>,
    ceiling: Option<DefaultValue>,
    applies: Applies,
    consumer: &'static str,
) -> SettingDef {
    SettingDef { key, section, kind, default, bounds, layers, widening, ceiling, applies, state: SettingState::Editable, consumer }
}

fn locked(mut d: SettingDef) -> SettingDef {
    d.state = SettingState::Locked;
    d
}

fn later(key: &'static str, section: Section) -> SettingDef {
    SettingDef {
        key,
        section,
        kind: SettingKind::Boolean,
        default: DefaultValue::Boolean(false),
        bounds: Bounds::NONE,
        layers: NO_LAYER,
        widening: None,
        ceiling: None,
        applies: Applies::NextOperation,
        state: SettingState::UnavailableThisPhase,
        consumer: "PHASE_07",
    }
}

use Applies::{Immediately, NextMission, NextOperation};
use DefaultValue as D;
use Section as S;
use SettingKind as K;

/// الفهرس كله، مبنيًّا مرّة واحدة لعمر العملية.
pub fn catalogue() -> &'static [SettingDef] {
    static CATALOGUE: std::sync::OnceLock<Vec<SettingDef>> = std::sync::OnceLock::new();
    CATALOGUE.get_or_init(build)
}

fn build() -> Vec<SettingDef> {
    vec![
        // ——— عام
        def("general.activity_page_size", S::General, K::Integer, D::Integer(100), Bounds::range(10, 500), USER, None, None, NextOperation, "observability.events default page size"),
        // ——— المظهر
        def("appearance.theme", S::Appearance, K::Enum, D::Enum("SYSTEM"), Bounds::options(&["SYSTEM", "LIGHT", "DARK"]), USER, None, None, Immediately, "renderer: document data-theme at start and on change"),
        def("appearance.density", S::Appearance, K::Enum, D::Enum("COMFORTABLE"), Bounds::options(&["COMFORTABLE", "COMPACT"]), USER, None, None, Immediately, "renderer: document data-density"),
        // ——— اللغة
        def("language.locale", S::Language, K::Enum, D::Enum("SYSTEM"), Bounds::options(LOCALES), USER, None, None, Immediately, "renderer: document lang and dir at start and on change"),
        def("language.fallback_locale", S::Language, K::Enum, D::Enum("en"), Bounds::options(&["en", "ar"]), USER, None, None, Immediately, "renderer: translator fallback for an untranslated key"),
        // ——— النماذج
        def(
            "models.max_input_tokens_per_call",
            S::Models,
            K::Integer,
            // الافتراضي هو السقف: لا حدّ جديد يُفرض على من لم يطلبه، ويُضيَّق من الإعدادات.
            D::Integer(1_000_000),
            Bounds::range(256, 1_000_000),
            ALL_LAYERS,
            Some(Widening::LargerIsWider),
            Some(D::Integer(1_000_000)),
            NextOperation,
            "p06 invocation guard: refuses a model call whose estimated input exceeds it",
        ),
        // ——— المزوّدون
        def("providers.unhealthy_alert", S::Providers, K::Boolean, D::Boolean(true), Bounds::NONE, USER, None, None, NextOperation, "p06 alerts: PROVIDER_UNHEALTHY"),
        // ——— الوكلاء
        def(
            "agents.max_concurrent_missions",
            S::Agents,
            K::Integer,
            D::Integer(2),
            Bounds::range(1, 8),
            USER_SECURITY,
            Some(Widening::LargerIsWider),
            Some(D::Integer(8)),
            NextMission,
            "host: mission.start refuses beyond it",
        ),
        def(
            "agents.max_tool_calls_per_mission",
            S::Agents,
            K::Integer,
            // ADR-039 (2026-10-06): الافتراض صار قيمة «ملف العمل» نفسها. بـ16 نداءً لكل مهمّة (و4 لكل خطوة) لا تتّسع مهمّة
            // عمل حقيقية في حلقة الوكيل، وكل قياسات العُدّة منذ Phase-08 جرت بـ64. السقف (200) والطبقات وقاعدة «طبقة المهمّة لا
            // توسّع» كما هي، والموافقة البشرية على كل أثر يوجبها باقية.
            D::Integer(64),
            Bounds::range(0, 200),
            ALL_LAYERS,
            Some(Widening::LargerIsWider),
            Some(D::Integer(200)),
            NextMission,
            "p06 broker factory: the mission tool budget",
        ),
        def(
            "agents.max_external_side_effects_per_mission",
            S::Agents,
            K::Integer,
            D::Integer(2),
            Bounds::range(0, 6),
            ALL_LAYERS,
            Some(Widening::LargerIsWider),
            Some(D::Integer(6)),
            NextMission,
            "p06 broker factory: the mission external side-effect budget",
        ),
        // ——— المهارات
        def(
            "skills.allow_high_risk_tools",
            S::Skills,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextOperation,
            "p06 tool policy overlay: refuses HIGH and CRITICAL tools when off",
        ),
        // ——— الأدوات
        def(
            "tools.max_runtime_per_mission",
            S::Tools,
            K::Duration,
            // ADR-039: دقيقة واحدة لكل أدوات المهمّة لا تكفي تشغيل Python واختبارات مشروع؛ الافتراض قيمة «ملف العمل» (20 دقيقة).
            D::DurationMs(1_200_000),
            Bounds::range(1_000, 3_600_000),
            ALL_LAYERS,
            Some(Widening::LargerIsWider),
            Some(D::DurationMs(3_600_000)),
            NextMission,
            "p06 broker factory: the mission tool runtime budget",
        ),
        def(
            "tools.max_network_calls_per_mission",
            S::Tools,
            K::Integer,
            // ADR-039: تصفّح Chromium الحقيقي وبحث الويب خطوات كثيرة لكل صفحة؛ الافتراض قيمة «ملف العمل» (48).
            D::Integer(48),
            Bounds::range(0, 96),
            ALL_LAYERS,
            Some(Widening::LargerIsWider),
            Some(D::Integer(96)),
            NextMission,
            "p06 broker factory: the mission network tool budget",
        ),
        // ——— MCP
        def(
            "mcp.tools_enabled",
            S::Mcp,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextOperation,
            "p06 tool policy overlay: refuses every MCP tool when off",
        ),
        // ——— الذاكرة
        def("memory.context_max_tokens", S::Memory, K::Integer, D::Integer(700), Bounds::range(0, 2_000), USER_PROJECT, None, None, NextOperation, "p06 agent context provider: the memory block budget"),
        def(
            "memory.connector_results_to_memory",
            S::Memory,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            USER_PROJECT,
            None,
            None,
            NextOperation,
            "p06 connector gateway: a read result becomes a CONNECTOR_UNTRUSTED working memory",
        ),
        // ——— المتصفّح
        locked(def(
            "browser.private_network_allowed",
            S::Browser,
            K::Boolean,
            D::Boolean(false),
            Bounds::NONE,
            USER_SECURITY,
            Some(Widening::TrueIsWider),
            Some(D::Boolean(false)),
            NextOperation,
            "p05 navigation policy: private, loopback and metadata destinations stay refused",
        )),
        // ——— الحاسوب
        def(
            "computer.use_enabled",
            S::Computer,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextOperation,
            "p06 tool policy overlay: refuses every desktop tool when off",
        ),
        // ——— الموصلات
        def(
            "connectors.side_effect_policy",
            S::Connectors,
            K::Enum,
            D::Enum("REQUIRE_APPROVAL"),
            Bounds::options(SIDE_EFFECT_ORDER),
            ALL_LAYERS,
            Some(Widening::Ordered(SIDE_EFFECT_ORDER)),
            Some(D::Enum("REQUIRE_APPROVAL")),
            NextOperation,
            "p06 connector gateway: DENY refuses every external side effect before approval",
        ),
        def(
            "connectors.max_external_calls_per_mission",
            S::Connectors,
            K::Integer,
            D::Integer(20),
            Bounds::range(0, 200),
            ALL_LAYERS,
            Some(Widening::LargerIsWider),
            Some(D::Integer(200)),
            NextOperation,
            "p06 connector gateway: calls beyond it are refused",
        ),
        def(
            "connectors.max_attempts",
            S::Connectors,
            K::Integer,
            D::Integer(3),
            Bounds::range(1, 4),
            USER_SECURITY,
            Some(Widening::LargerIsWider),
            Some(D::Integer(4)),
            NextOperation,
            "p06 connector gateway: attempts per call, retries included",
        ),
        def(
            "connectors.max_retry_wait",
            S::Connectors,
            K::Duration,
            D::DurationMs(5_000),
            Bounds::range(0, 10_000),
            USER_SECURITY,
            Some(Widening::LargerIsWider),
            Some(D::DurationMs(10_000)),
            NextOperation,
            "p06 connector gateway: the longest Retry-After it will wait for",
        ),
        def(
            "connectors.max_response_bytes",
            S::Connectors,
            K::Bytes,
            D::Bytes(1_048_576),
            Bounds::range(1_024, 4_194_304),
            USER_SECURITY,
            Some(Widening::LargerIsWider),
            Some(D::Bytes(4_194_304)),
            NextOperation,
            "p06 connector gateway: the response size above which a result is refused",
        ),
        // ——— الخصوصية
        // لا «محلي فقط» ولا «اسمح بالنماذج البعيدة» (ADR-040): اختيار النموذج للمستخدم وحده، من أيّ صنف.
        def(
            "privacy.allow_connector_egress",
            S::Privacy,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextOperation,
            "p06 connector gateway: a connector outside the device is refused when off",
        ),
        def(
            "privacy.allow_browser_internet",
            S::Privacy,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextOperation,
            "p06 tool policy overlay: every web tool is refused when off",
        ),
        def(
            "privacy.persist_browser_history",
            S::Privacy,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextMission,
            "p06 mission observer: addresses and titles are erased from the browser store when the mission ends",
        ),
        def(
            "privacy.persist_computer_observations",
            S::Privacy,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextMission,
            "p06 mission observer: observation rows are erased when the mission ends",
        ),
        def(
            "privacy.persist_memory",
            S::Privacy,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            ALL_LAYERS,
            Some(Widening::TrueIsWider),
            None,
            NextOperation,
            "p06 mission observer and overlay: no working, episodic or proposed memory is written when off",
        ),
        def(
            "privacy.diagnostics_level",
            S::Privacy,
            K::Enum,
            D::Enum("STANDARD"),
            Bounds::options(DIAGNOSTICS_ORDER),
            USER_SECURITY,
            Some(Widening::Ordered(DIAGNOSTICS_ORDER)),
            None,
            NextOperation,
            "p06 diagnostics export: which sections are included",
        ),
        // ——— الأمان: حدود الطبقة SECURITY تُضبط لكل إعداد يحمل أمنًا من قسمه، وهذان منه هنا.
        locked(def(
            "security.external_effects_require_approval",
            S::Security,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            USER_SECURITY,
            Some(Widening::FalseIsWider),
            Some(D::Boolean(true)),
            NextOperation,
            "p04 effect sealing: EXTERNAL_SIDE_EFFECT always requires approval; no setting can turn it off",
        )),
        def(
            "security.allow_environment_secrets",
            S::Security,
            K::Boolean,
            D::Boolean(true),
            Bounds::NONE,
            USER_SECURITY,
            Some(Widening::TrueIsWider),
            None,
            NextOperation,
            "p06 connector gateway: a connector whose secret comes from a POLARIS_CONNECTOR_ environment variable is refused when off",
        ),
        // ——— الميزانيات
        def("budgets.default_mode", S::Budgets, K::Enum, D::Enum("HARD"), Bounds::options(&["SOFT", "HARD"]), USER, None, None, NextOperation, "budget.set: the mode of a budget created without one"),
        def("budgets.default_warn_ratio", S::Budgets, K::Integer, D::Integer(80), Bounds::range(1, 100), USER, None, None, NextOperation, "budget.set: the warning threshold of a budget created without one"),
        // ——— الكلفة
        def("cost.show_estimated", S::Cost, K::Boolean, D::Boolean(true), Bounds::NONE, USER, None, None, NextOperation, "usage.summary: ESTIMATED amounts are withheld when off"),
        // ——— الرصد
        def("observability.event_retention", S::Observability, K::Integer, D::Integer(5_000), Bounds::range(100, 20_000), USER, None, None, NextOperation, "p06 event store: rows beyond it are pruned"),
        def("observability.error_spike_threshold", S::Observability, K::Integer, D::Integer(10), Bounds::range(3, 100), USER, None, None, NextOperation, "p06 alerts: ERROR_SPIKE over five minutes"),
        def("observability.budget_alerts", S::Observability, K::Boolean, D::Boolean(true), Bounds::NONE, USER, None, None, NextOperation, "p06 alerts: BUDGET_NEAR_LIMIT and BUDGET_EXCEEDED"),
        // ——— متقدّم
        def(
            "advanced.connector_invocation_retention",
            S::Advanced,
            K::Integer,
            D::Integer(2_000),
            Bounds::range(100, 10_000),
            USER,
            None,
            None,
            NextOperation,
            "p06 connector store: invocation rows beyond it are pruned",
        ),
        later("advanced.auto_update", S::Advanced),
        later("advanced.cloud_sync", S::Advanced),
        later("advanced.cloud_telemetry", S::Advanced),
    ]
}

pub fn find(key: &str) -> Option<&'static SettingDef> {
    catalogue().iter().find(|d| d.key == key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_section_has_at_least_one_setting_and_keys_are_unique_and_prefixed_by_their_section() {
        let all = catalogue();
        for section in Section::ALL {
            assert!(all.iter().any(|d| d.section == section), "{} has no setting", section.as_str());
        }
        let mut keys: Vec<&str> = all.iter().map(|d| d.key).collect();
        let count = keys.len();
        keys.sort_unstable();
        keys.dedup();
        assert_eq!(keys.len(), count, "two settings share a key");
        for d in all {
            let prefix = d.key.split('.').next().unwrap();
            assert_eq!(prefix.to_ascii_uppercase(), d.section.as_str(), "{} is filed under the wrong section", d.key);
        }
    }

    #[test]
    fn every_editable_setting_names_a_consumer_and_a_valid_default() {
        for d in catalogue().iter() {
            assert!(!d.consumer.is_empty(), "{} names no consumer", d.key);
            if d.state == SettingState::UnavailableThisPhase {
                assert!(d.layers.is_empty(), "{} is unavailable yet writable", d.key);
                continue;
            }
            let json = d.default_value().to_json();
            assert_eq!(d.parse(&json), Ok(d.default_value()), "{}: the default does not satisfy its own bounds", d.key);
            if let Some(ceiling) = d.ceiling_value() {
                let widening = d.widening.expect("a ceiling without a widening direction");
                assert!(!widening.is_wider(&d.default_value(), &ceiling), "{}: the default is above the build ceiling", d.key);
            }
        }
    }

    #[test]
    fn a_security_bearing_setting_can_be_clamped_and_a_plain_one_cannot() {
        for d in catalogue().iter() {
            if d.layers.contains(&Layer::Security) {
                assert!(d.security_bearing(), "{} accepts a clamp but declares no widening direction", d.key);
            }
            if d.layers.contains(&Layer::Mission) || d.layers.contains(&Layer::Project) {
                // كل ما يقبل تجاوزًا من مشروع أو مهمّة ويحمل أمنًا يحمل طبقة أمان أيضًا.
                if d.security_bearing() {
                    assert!(d.layers.contains(&Layer::Security), "{} lets a project widen what no clamp bounds", d.key);
                }
            }
        }
    }

    #[test]
    fn the_privacy_section_carries_the_six_privacy_controls_and_no_local_remote_switch() {
        let keys: Vec<&str> = catalogue().iter().filter(|d| d.section == Section::Privacy).map(|d| d.key).collect();
        for expected in [
            "privacy.allow_connector_egress",
            "privacy.allow_browser_internet",
            "privacy.persist_browser_history",
            "privacy.persist_computer_observations",
            "privacy.persist_memory",
            "privacy.diagnostics_level",
        ] {
            assert!(keys.contains(&expected), "{expected} is missing");
        }
        assert_eq!(keys.len(), 6, "an unexpected privacy control: {keys:?}");
        for removed in ["privacy.local_only", "privacy.allow_remote_models"] {
            assert!(find(removed).is_none(), "{removed} is back");
        }
    }
}
