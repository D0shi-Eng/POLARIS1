// فهرس القدرات التي تعرفها القشرة، وحالة كل واحدة في هذه المرحلة.
//
// المضيف هو السلطة. العارض لا يحسب الإتاحة من ثابت وقت البناء، لأن ثابتًا وقت
// البناء لا يمكن أن يعرف أن النواة غير موصولة. ولهذا يعيش الفهرس هنا لا هناك.

use crate::model::availability::{
    Availability, AvailabilityReason, AvailabilityState, CapabilityAvailability,
};

/// قدرة واحدة: معرّفها، وكيف تُقرَّر حالتها في Phase-01.
pub struct CapabilityEntry {
    pub id: &'static str,
    kind: PhaseKind,
}

enum PhaseKind {
    /// مبنيّة فعلًا في هذه المرحلة وتعمل.
    Built,
    /// تحتاج نموذجًا قابلًا للاختيار.
    NeedsProvider,
    /// مبنيّة في Phase-02 وتعتمد على مخزن المنتج.
    Phase02Store,
    /// مبنيّة في Phase-03 وتعيش في المخزن نفسه، فحالتها حالته.
    Phase03Store,
    /// مبنيّة في Phase-04 وتعيش في المخزن نفسه كذلك.
    Phase04Store,
    /// مبنيّة في Phase-05 (الذاكرة، والمتصفّح والحاسوب) وتعيش في المخزن نفسه.
    Phase05Store,
}

/// حالة Phase-02 كما يعرفها المضيف الآن.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase02State {
    /// بناء Phase-01: لا مخزن ولا مزوّدات.
    NotBuilt,
    Ready,
    /// المخزن لم يُفتح (مخطط أحدث، أو قرص غير متاح).
    StoreUnavailable,
}

/// الحقائق الحيّة التي تُحسب منها الإتاحة.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityFacts {
    pub phase02: Phase02State,
    pub selectable_models: u64,
}

impl CapabilityFacts {
    /// حقائق Phase-01: لا شيء بعد القشرة.
    pub const fn phase_01() -> Self {
        Self { phase02: Phase02State::NotBuilt, selectable_models: 0 }
    }
}

/// الفهرس الكامل. الوجهات العشر في الشريط الجانبي كلها هنا، فلا وجهة بلا حالة.
pub const CATALOGUE: &[CapabilityEntry] = &[
    CapabilityEntry { id: "polaris.desktop.home", kind: PhaseKind::Built },
    CapabilityEntry { id: "polaris.desktop.settings", kind: PhaseKind::Built },
    CapabilityEntry { id: "polaris.desktop.projects", kind: PhaseKind::Phase02Store },
    CapabilityEntry { id: "polaris.desktop.missions", kind: PhaseKind::Phase03Store },
    CapabilityEntry { id: "polaris.desktop.agents", kind: PhaseKind::Phase03Store },
    CapabilityEntry { id: "polaris.desktop.skills", kind: PhaseKind::Phase04Store },
    CapabilityEntry { id: "polaris.desktop.browser-computer", kind: PhaseKind::Phase05Store },
    CapabilityEntry { id: "polaris.desktop.memory", kind: PhaseKind::Phase05Store },
    CapabilityEntry { id: "polaris.desktop.connectors", kind: PhaseKind::Phase04Store },
    CapabilityEntry { id: "polaris.desktop.activity", kind: PhaseKind::Phase04Store },
    CapabilityEntry { id: "polaris.desktop.models", kind: PhaseKind::NeedsProvider },
    CapabilityEntry { id: "polaris.desktop.providers", kind: PhaseKind::Phase02Store },
];

impl CapabilityEntry {
    pub fn availability(&self) -> Availability {
        self.availability_with(&CapabilityFacts::phase_01())
    }

    pub fn availability_with(&self, facts: &CapabilityFacts) -> Availability {
        let store = |facts: &CapabilityFacts| match facts.phase02 {
            Phase02State::NotBuilt => Availability::phase_not_implemented(),
            Phase02State::Ready => Availability::available(),
            Phase02State::StoreUnavailable => {
                Availability::with_reason(AvailabilityState::Unavailable, AvailabilityReason::RuntimeUnavailable)
            }
        };
        match self.kind {
            PhaseKind::Built => Availability::available(),
            PhaseKind::Phase02Store | PhaseKind::Phase03Store | PhaseKind::Phase04Store | PhaseKind::Phase05Store => store(facts),
            PhaseKind::NeedsProvider => match facts.phase02 {
                Phase02State::Ready if facts.selectable_models > 0 => Availability::available(),
                Phase02State::StoreUnavailable => store(facts),
                _ => Availability::with_reason(AvailabilityState::Unavailable, AvailabilityReason::ProviderNotConfigured),
            },
        }
    }
}

/// بحث عن قدرة بالمعرّف.
pub fn find(id: &str) -> Option<&'static CapabilityEntry> {
    CATALOGUE.iter().find(|entry| entry.id == id)
}

/// حالة قدرة طلبها العارض. قدرة لا يعرفها المضيف تُجاب UNAVAILABLE بسبب مصنَّف،
/// ولا تُحذف من الرد بصمت: الحذف يجعل العارض يخمّن.
pub fn resolve(id: &str) -> CapabilityAvailability {
    resolve_with(id, &CapabilityFacts::phase_01())
}

pub fn resolve_with(id: &str, facts: &CapabilityFacts) -> CapabilityAvailability {
    let availability = match find(id) {
        Some(entry) => entry.availability_with(facts),
        None => Availability::with_reason(
            AvailabilityState::Unavailable,
            AvailabilityReason::PhaseNotImplemented,
        ),
    };
    CapabilityAvailability { capability_id: id.to_string(), availability }
}

/// القدرات التي يجيب عنها المضيف الآن فعلًا.
pub fn enabled_ids() -> Vec<String> {
    enabled_ids_with(&CapabilityFacts::phase_01())
}

pub fn enabled_ids_with(facts: &CapabilityFacts) -> Vec<String> {
    CATALOGUE
        .iter()
        .filter(|e| e.availability_with(facts).is_available())
        .map(|e| e.id.to_string())
        .collect()
}

/// كل ما تستطيع القشرة تسميته ولا تستطيع استعماله، ومعه حالة وسبب.
pub fn unavailable() -> Vec<CapabilityAvailability> {
    unavailable_with(&CapabilityFacts::phase_01())
}

pub fn unavailable_with(facts: &CapabilityFacts) -> Vec<CapabilityAvailability> {
    CATALOGUE
        .iter()
        .filter(|e| !e.availability_with(facts).is_available())
        .map(|e| CapabilityAvailability {
            capability_id: e.id.to_string(),
            availability: e.availability_with(facts),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enabled_and_unavailable_partition_the_catalogue() {
        assert_eq!(enabled_ids().len() + unavailable().len(), CATALOGUE.len());
    }

    #[test]
    fn every_unavailable_capability_carries_a_reason() {
        for entry in unavailable() {
            assert!(
                entry.availability.reason.is_some(),
                "{} is unavailable with no reason",
                entry.capability_id
            );
        }
    }

    #[test]
    fn an_unknown_capability_is_answered_not_omitted() {
        let answer = resolve("polaris.desktop.nonexistent");
        assert_eq!(answer.availability.state, AvailabilityState::Unavailable);
        assert!(answer.availability.reason.is_some());
    }

    #[test]
    fn the_store_enables_projects_providers_missions_and_agents_and_models_need_a_selectable_model() {
        let ready = CapabilityFacts { phase02: Phase02State::Ready, selectable_models: 0 };
        let mut enabled = enabled_ids_with(&ready);
        enabled.sort();
        // Phase-03 أضاف المهام والوكلاء، وPhase-04 أضاف المهارات والموصّلات والنشاط،
        // وPhase-05 أضاف الذاكرة والمتصفّح والحاسوب. كلها تتبع المخزن نفسه، فلا مسار
        // حياة ثانٍ.
        assert_eq!(
            enabled,
            vec![
                "polaris.desktop.activity",
                "polaris.desktop.agents",
                "polaris.desktop.browser-computer",
                "polaris.desktop.connectors",
                "polaris.desktop.home",
                "polaris.desktop.memory",
                "polaris.desktop.missions",
                "polaris.desktop.projects",
                "polaris.desktop.providers",
                "polaris.desktop.settings",
                "polaris.desktop.skills"
            ]
        );
        let with_model = CapabilityFacts { selectable_models: 1, ..ready };
        assert!(enabled_ids_with(&with_model).contains(&"polaris.desktop.models".to_string()));
        let broken = CapabilityFacts { phase02: Phase02State::StoreUnavailable, selectable_models: 3 };
        let answer = resolve_with("polaris.desktop.projects", &broken);
        assert_eq!(answer.availability.reason, Some(AvailabilityReason::RuntimeUnavailable));
        assert!(!resolve_with("polaris.desktop.models", &broken).availability.is_available());
        // مخزن معطّل يُعطّل قدرات Phase-03 كذلك: لا مسار حياة ثانٍ.
        assert_eq!(resolve_with("polaris.desktop.missions", &broken).availability.reason, Some(AvailabilityReason::RuntimeUnavailable));
        // ومخزن معطّل يُعطّل قدرات Phase-04 كذلك.
        assert_eq!(resolve_with("polaris.desktop.skills", &broken).availability.reason, Some(AvailabilityReason::RuntimeUnavailable));
        // ومخزن معطّل يُعطّل قدرات Phase-05 كذلك.
        assert_eq!(resolve_with("polaris.desktop.memory", &broken).availability.reason, Some(AvailabilityReason::RuntimeUnavailable));
        assert_eq!(
            resolve_with("polaris.desktop.browser-computer", &broken).availability.reason,
            Some(AvailabilityReason::RuntimeUnavailable)
        );
        // وما لم يُبنَ أصلًا يبقى «لم يُبنَ في هذه المرحلة» لا «متاحًا» ولا محذوفًا.
        assert_eq!(resolve_with("polaris.desktop.not-built-yet", &with_model).availability.reason, Some(AvailabilityReason::PhaseNotImplemented));
    }

    #[test]
    fn phase_01_builds_only_the_shell_capabilities() {
        let mut enabled = enabled_ids();
        enabled.sort();
        assert_eq!(enabled, vec!["polaris.desktop.home", "polaris.desktop.settings"]);
    }
}
