// منفذ المُحلِّل الموثوق، ومُحقِّقه المحلي لهذه المرحلة.
//
// الواجهة عميل للمحلِّل الموثوق ولا تصير محلِّلًا ثانيًا، والمضيف كذلك: `SettingsFacade`
// لا يحسب قيمة، بل يسأل ما وراء هذا المنفذ. في Phase-02 يُستبدل `HostLocalSettingsResolver`
// بمحوّلٍ إلى مُحلِّل `runtime` الموجود دون أن يتغيّر أي مستدعٍ — هذا هو غرض المنفذ.

use crate::model::bootstrap::{Appearance, Locale};
use crate::model::settings::{DisplaySafeValue, SettingValueKind};

/// نتيجة محاولة حلّ إعداد واحد.
pub enum ResolvedValue {
    /// قيمة آمنة للعرض.
    Value(DisplaySafeValue),
    /// المضيف يملك قيمة ولن يفصح عنها.
    Withheld,
    /// لا قيمة في هذه المرحلة. الغياب هو الجواب الصادق، والحشو ليس كذلك.
    Absent,
}

/// حقائق حيّة يملكها Phase-02. غيابها يعني قيم Phase-01 الثابتة.
pub trait LiveSettingFacts: Send + Sync {
    fn enabled_model_count(&self) -> Option<i32>;
    fn default_model_id(&self) -> Option<String>;
    fn usable_provider_count(&self) -> Option<i32>;
    fn network_contacted(&self) -> bool;
}

pub trait SettingsResolver: Send + Sync {
    fn resolve(&self, section_id: &str, setting_id: &str) -> ResolvedValue;
}

/// حقائق القشرة التي يملكها المضيف فعلًا في Phase-01.
#[derive(Debug, Clone)]
pub struct HostFacts {
    pub locale: Locale,
    pub appearance: Appearance,
    /// هل أجرى المضيف أي اتصال شبكي؟ في Phase-01 الجواب الحقيقي: لا.
    pub network_egress_performed: bool,
    /// هل قشرة سطح المكتب محصورة؟ Phase-00 يحصر العمليةَ المنفِّذة لا القشرة،
    /// وADR-018 ينصّ على أن لا ادعاء حصرٍ للقشرة. الجواب الصادق: لا.
    pub desktop_host_confined: bool,
    pub telemetry_enabled: bool,
    pub host_diagnostics_retained: bool,
    /// عدد النماذج المضبوطة. صفر، ولا اسم نموذج يُخترَع.
    pub configured_model_count: i32,
}

impl HostFacts {
    pub fn phase_01(locale: Locale, appearance: Appearance) -> Self {
        Self {
            locale,
            appearance,
            network_egress_performed: false,
            desktop_host_confined: false,
            telemetry_enabled: false,
            host_diagnostics_retained: true,
            configured_model_count: 0,
        }
    }
}

pub struct HostLocalSettingsResolver {
    facts: HostFacts,
    live: Option<std::sync::Arc<dyn LiveSettingFacts>>,
}

impl HostLocalSettingsResolver {
    pub fn new(facts: HostFacts) -> Self {
        Self { facts, live: None }
    }

    pub fn with_live(facts: HostFacts, live: std::sync::Arc<dyn LiveSettingFacts>) -> Self {
        Self { facts, live: Some(live) }
    }

    pub fn facts(&self) -> &HostFacts {
        &self.facts
    }
}

impl SettingsResolver for HostLocalSettingsResolver {
    fn resolve(&self, section_id: &str, setting_id: &str) -> ResolvedValue {
        match (section_id, setting_id) {
            ("general.appearance", "appearance") => ResolvedValue::Value(DisplaySafeValue::code(
                SettingValueKind::Appearance,
                appearance_code(self.facts.appearance),
            )),
            ("general.language-region", "locale") => ResolvedValue::Value(DisplaySafeValue::code(
                SettingValueKind::Locale,
                self.facts.locale.code(),
            )),
            ("general.language-region", "direction") => {
                ResolvedValue::Value(DisplaySafeValue::text(match self.facts.locale.direction() {
                    crate::model::bootstrap::Direction::Rtl => "RTL",
                    crate::model::bootstrap::Direction::Ltr => "LTR",
                }))
            }
            ("security.privacy", "telemetry-enabled") => {
                ResolvedValue::Value(DisplaySafeValue::boolean(self.facts.telemetry_enabled))
            }
            ("security.data-egress", "network-egress-performed") => {
                // منذ Phase-02 يتصل المضيف بمزوّدين عند الطلب؛ الجواب يُقاس لا يُفترض.
                let contacted = self.facts.network_egress_performed || self.live.as_ref().is_some_and(|l| l.network_contacted());
                ResolvedValue::Value(DisplaySafeValue::boolean(contacted))
            }
            ("security.sandboxing", "desktop-host-confined") => {
                ResolvedValue::Value(DisplaySafeValue::boolean(self.facts.desktop_host_confined))
            }
            ("advanced.diagnostics", "host-diagnostics-retained") => {
                ResolvedValue::Value(DisplaySafeValue::boolean(self.facts.host_diagnostics_retained))
            }
            ("ai.models", "configured-model-count") => {
                let live = self.live.as_ref().and_then(|l| l.enabled_model_count());
                ResolvedValue::Value(DisplaySafeValue::integer(live.unwrap_or(self.facts.configured_model_count)))
            }
            ("ai.models", "default-model") => match self.live.as_ref().and_then(|l| l.default_model_id()) {
                Some(id) => ResolvedValue::Value(DisplaySafeValue::text(id.chars().take(256).collect::<String>())),
                None => ResolvedValue::Absent,
            },
            ("ai.providers", "provider-count") => match self.live.as_ref().and_then(|l| l.usable_provider_count()) {
                Some(n) => ResolvedValue::Value(DisplaySafeValue::integer(n)),
                None => ResolvedValue::Absent,
            },
            _ => ResolvedValue::Absent,
        }
    }
}

pub fn appearance_code(appearance: Appearance) -> &'static str {
    match appearance {
        Appearance::Light => "LIGHT",
        Appearance::Dark => "DARK",
        Appearance::System => "SYSTEM",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_settings_resolve_to_absent_not_to_a_placeholder() {
        let resolver = HostLocalSettingsResolver::new(HostFacts::phase_01(Locale::En, Appearance::System));
        assert!(matches!(resolver.resolve("data.memory", "memory-store"), ResolvedValue::Absent));
    }

    #[test]
    fn the_model_count_is_zero_and_no_model_is_named() {
        let resolver = HostLocalSettingsResolver::new(HostFacts::phase_01(Locale::Ar, Appearance::Dark));
        match resolver.resolve("ai.models", "configured-model-count") {
            ResolvedValue::Value(v) => assert_eq!(v.integer_value, Some(0)),
            _ => panic!("the model count is a real host fact"),
        }
    }
}
