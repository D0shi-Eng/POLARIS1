// أساس التوجيه: قرار حتمي، بلا احتمال ولا «توجيه ذكي».
//
// ثلاثة أنماط فقط: يدوي، والنموذج الافتراضي، ومطابقة القدرة. القدرة المجهولة
// ليست مدعومة. والنموذج الافتراضي يتبع سلسلة مُعلنة: افتراضي المشروع، ثم افتراضي
// المستخدم، ثم «لا نموذج» — ولا يُختار أول نموذج عشوائيًا، ولا يُستبدل افتراضي
// غير صالح بغيره بصمت.
//
// لا تفضيل «محلي/بعيد» يقيّد الاختيار أو يرتّبه (قرار المالك 2026-10-07، ADR-040). موقع النموذج يُذكر في القرار وصفًا.

use serde::{Deserialize, Serialize};

use polaris_host_providers::domain::facts::Support;
use polaris_host_providers::domain::{Locality, ModelCapability, ModelKind};

use crate::p02::models::view::{selectable, ModelView};
use crate::p02::models::ModelAvailability;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RoutingMode {
    Manual,
    DefaultModel,
    CapabilityMatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RoutingReason {
    ManualSelection,
    ProjectDefault,
    UserDefault,
    /// لا افتراضي مضبوط، والمفعَّل الصالح للمحادثة نموذج واحد فقط (محليًّا كان أو عبر API): يُستعمل هو، ويُسمّى السبب.
    SoleEnabledModel,
    CapabilityMatch,
    NoModelConfigured,
    ModelNotFound,
    ModelDisabled,
    ModelUnavailable,
    ModelNotChat,
    ProviderDisabled,
    ProviderUnhealthy,
    CapabilityMissing,
    CapabilityUnknown,
    NoCandidate,
    ContextTooLarge,
    ProjectNotFound,
    ProjectArchived,
    SourceNotInProject,
    /// أُلغي الاستدعاء قبل أن يبدأ، فلم يُقيَّم التوجيه.
    CancelledBeforeStart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Decision {
    Selected,
    Denied,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoutingDecision {
    pub mode: RoutingMode,
    pub decision: Decision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locality: Option<Locality>,
    pub reason_codes: Vec<RoutingReason>,
    pub candidates_considered: u64,
}

impl RoutingDecision {
    pub fn denied(mode: RoutingMode, reason: RoutingReason, considered: u64) -> Self {
        Self { mode, decision: Decision::Denied, model_id: None, provider_id: None, locality: None, reason_codes: vec![reason], candidates_considered: considered }
    }

    fn selected(mode: RoutingMode, view: &ModelView, reasons: Vec<RoutingReason>, considered: u64) -> Self {
        Self {
            mode,
            decision: Decision::Selected,
            model_id: Some(view.model_id.clone()),
            provider_id: Some(view.provider_id.clone()),
            locality: Some(view.locality),
            reason_codes: reasons,
            candidates_considered: considered,
        }
    }

    pub fn is_selected(&self) -> bool {
        self.decision == Decision::Selected
    }
}

pub struct RoutingRequest<'a> {
    pub mode: RoutingMode,
    pub requested_model: Option<&'a str>,
    pub project_default: Option<&'a str>,
    pub user_default: Option<&'a str>,
    pub required: &'a [ModelCapability],
}

/// لماذا لا يصلح هذا النموذج؟ أول سبب بترتيب ثابت.
fn unusable_reason(view: &ModelView) -> Option<RoutingReason> {
    if !view.provider_enabled {
        return Some(RoutingReason::ProviderDisabled);
    }
    if !view.enabled {
        return Some(RoutingReason::ModelDisabled);
    }
    if view.availability != ModelAvailability::Available {
        return Some(RoutingReason::ModelUnavailable);
    }
    if !view.provider_health.is_routable() {
        return Some(RoutingReason::ProviderUnhealthy);
    }
    if view.kind == ModelKind::Embedding {
        return Some(RoutingReason::ModelNotChat);
    }
    debug_assert!(selectable(view));
    None
}

/// القدرات المطلوبة: كل واحدة يجب أن تكون مدعومة ومُثبتة المصدر.
fn capability_reason(view: &ModelView, required: &[ModelCapability]) -> Option<RoutingReason> {
    for capability in required {
        let entry = view.capabilities.iter().find(|c| c.capability == *capability);
        match entry {
            Some(e) if e.support == Support::Supported && e.provenance != polaris_host_providers::domain::Provenance::Unknown => {}
            Some(e) if e.support == Support::Unsupported => return Some(RoutingReason::CapabilityMissing),
            _ => return Some(RoutingReason::CapabilityUnknown),
        }
    }
    None
}

fn check_named(mode: RoutingMode, id: &str, origin: RoutingReason, request: &RoutingRequest<'_>, models: &[ModelView]) -> RoutingDecision {
    let considered = models.len() as u64;
    let Some(view) = models.iter().find(|m| m.model_id == id) else {
        return RoutingDecision::denied(mode, RoutingReason::ModelNotFound, considered);
    };
    if let Some(reason) = unusable_reason(view) {
        return RoutingDecision::denied(mode, reason, considered);
    }
    if let Some(reason) = capability_reason(view, request.required) {
        return RoutingDecision::denied(mode, reason, considered);
    }
    RoutingDecision::selected(mode, view, vec![origin], considered)
}

pub fn decide(request: &RoutingRequest<'_>, models: &[ModelView]) -> RoutingDecision {
    match request.mode {
        RoutingMode::Manual => match request.requested_model {
            Some(id) => check_named(RoutingMode::Manual, id, RoutingReason::ManualSelection, request, models),
            None => RoutingDecision::denied(RoutingMode::Manual, RoutingReason::ModelNotFound, models.len() as u64),
        },
        RoutingMode::DefaultModel => {
            if let Some(id) = request.project_default {
                check_named(RoutingMode::DefaultModel, id, RoutingReason::ProjectDefault, request, models)
            } else if let Some(id) = request.user_default {
                check_named(RoutingMode::DefaultModel, id, RoutingReason::UserDefault, request, models)
            } else {
                // لا افتراضي مضبوط. قِيس على جهاز المالك (2026-09-30): كل مهمّة بلا اختيار صريح رُفضت
                // NO_MODEL_CONFIGURED مع وجود نموذج واحد جاهز. حين يكون المرشّح الصالح المفعَّل واحدًا لا غير —
                // محليًّا كان أو عبر API — فلا اختيار يُخمَّن: يُستعمل هو. أكثر من واحد يبقى رفضًا يطلب من المستخدم الاختيار.
                let usable: Vec<&ModelView> = models
                    .iter()
                    .filter(|m| unusable_reason(m).is_none())
                    .filter(|m| capability_reason(m, request.required).is_none())
                    .collect();
                match usable.as_slice() {
                    [only] => RoutingDecision::selected(RoutingMode::DefaultModel, only, vec![RoutingReason::SoleEnabledModel], models.len() as u64),
                    _ => RoutingDecision::denied(RoutingMode::DefaultModel, RoutingReason::NoModelConfigured, models.len() as u64),
                }
            }
        }
        RoutingMode::CapabilityMatch => {
            // ترتيب حتمي بالمعرّف وحده.
            let candidate = models
                .iter()
                .filter(|m| unusable_reason(m).is_none())
                .filter(|m| capability_reason(m, request.required).is_none())
                .min_by(|a, b| a.model_id.cmp(&b.model_id));
            match candidate {
                Some(view) => RoutingDecision::selected(RoutingMode::CapabilityMatch, view, vec![RoutingReason::CapabilityMatch], models.len() as u64),
                None => RoutingDecision::denied(RoutingMode::CapabilityMatch, RoutingReason::NoCandidate, models.len() as u64),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use polaris_host_providers::domain::facts::{Fact, Provenance};
    use polaris_host_providers::domain::model::{CapabilityEntry, LoadedState};
    use polaris_host_providers::domain::HealthState;
    use crate::p02::models::view::LoadedFact;

    fn model(id: &str, locality: Locality) -> ModelView {
        ModelView {
            model_id: id.into(),
            provider_id: id.split(':').next().unwrap().into(),
            provider_model_id: id.split(':').nth(1).unwrap().into(),
            display_name: Fact::unknown(),
            kind: ModelKind::Chat,
            family: Fact::unknown(),
            vendor: Fact::unknown(),
            architecture: Fact::unknown(),
            quantization: Fact::unknown(),
            parameter_count: Fact::unknown(),
            context_window: Fact::unknown(),
            max_output_tokens: Fact::unknown(),
            loaded_state: LoadedFact { value: LoadedState::Unknown, provenance: Provenance::Unknown },
            capabilities: ModelCapability::ALL
                .iter()
                .map(|c| CapabilityEntry { capability: *c, support: Support::Unknown, provenance: Provenance::Unknown })
                .collect(),
            pricing: None,
            locality,
            enabled: true,
            availability: ModelAvailability::Available,
            stale: false,
            is_default: false,
            provider_enabled: true,
            provider_health: HealthState::Healthy,
            first_seen_at: "t".into(),
            last_seen_at: "t".into(),
        }
    }

    fn with_vision(mut m: ModelView, support: Support) -> ModelView {
        for c in &mut m.capabilities {
            if c.capability == ModelCapability::VisionInput {
                c.support = support;
                c.provenance = if support == Support::Unknown { Provenance::Unknown } else { Provenance::ProviderReported };
            }
        }
        m
    }

    fn request<'a>(mode: RoutingMode, requested: Option<&'a str>, required: &'a [ModelCapability]) -> RoutingRequest<'a> {
        RoutingRequest { mode, requested_model: requested, project_default: None, user_default: None, required }
    }

    #[test]
    fn manual_selection_picks_exactly_the_named_model() {
        let models = vec![model("ollama:a", Locality::Local), model("ollama:b", Locality::Local)];
        let d = decide(&request(RoutingMode::Manual, Some("ollama:b"), &[]), &models);
        assert_eq!(d.model_id.as_deref(), Some("ollama:b"));
        assert_eq!(d.reason_codes, vec![RoutingReason::ManualSelection]);
        let d = decide(&request(RoutingMode::Manual, Some("ollama:none"), &[]), &models);
        assert_eq!(d.reason_codes, vec![RoutingReason::ModelNotFound]);
    }

    #[test]
    fn the_default_chain_is_project_then_user_then_nothing() {
        let models = vec![model("ollama:a", Locality::Local), model("ollama:b", Locality::Local)];
        let mut r = request(RoutingMode::DefaultModel, None, &[]);
        assert_eq!(decide(&r, &models).reason_codes, vec![RoutingReason::NoModelConfigured]);
        r.user_default = Some("ollama:a");
        assert_eq!(decide(&r, &models).model_id.as_deref(), Some("ollama:a"));
        r.project_default = Some("ollama:b");
        let d = decide(&r, &models);
        assert_eq!(d.model_id.as_deref(), Some("ollama:b"));
        assert_eq!(d.reason_codes, vec![RoutingReason::ProjectDefault]);
    }

    #[test]
    fn without_any_default_the_only_usable_enabled_model_is_used_whatever_its_locality() {
        let mut embed = model("ollama:embed", Locality::Local);
        embed.kind = ModelKind::Embedding;
        let mut disabled = model("ollama:off", Locality::Local);
        disabled.enabled = false;
        let r = request(RoutingMode::DefaultModel, None, &[]);
        let local = vec![model("lm-studio:local-chat", Locality::Local), embed.clone(), disabled.clone()];
        let d = decide(&r, &local);
        assert_eq!(d.model_id.as_deref(), Some("lm-studio:local-chat"));
        assert_eq!(d.reason_codes, vec![RoutingReason::SoleEnabledModel]);
        let api = vec![model("groq:x/api-chat", Locality::Remote), embed.clone(), disabled.clone()];
        let d = decide(&r, &api);
        assert_eq!(d.model_id.as_deref(), Some("groq:x/api-chat"));
        assert_eq!(d.reason_codes, vec![RoutingReason::SoleEnabledModel]);
        // نموذجان صالحان، من أيّ صنف: لا تخمين، بل رفض يطلب من المستخدم أن يختار.
        let two = vec![model("lm-studio:local-chat", Locality::Local), model("groq:x/api-chat", Locality::Remote), embed, disabled];
        assert_eq!(decide(&r, &two).reason_codes, vec![RoutingReason::NoModelConfigured]);
    }

    #[test]
    fn an_unusable_project_default_is_denied_not_silently_replaced() {
        let mut b = model("ollama:b", Locality::Local);
        b.enabled = false;
        let models = vec![model("ollama:a", Locality::Local), b];
        let mut r = request(RoutingMode::DefaultModel, None, &[]);
        r.project_default = Some("ollama:b");
        r.user_default = Some("ollama:a");
        let d = decide(&r, &models);
        assert!(!d.is_selected());
        assert_eq!(d.reason_codes, vec![RoutingReason::ModelDisabled]);
    }

    #[test]
    fn a_required_capability_must_be_proven() {
        let models = vec![
            with_vision(model("ollama:unknown", Locality::Local), Support::Unknown),
            with_vision(model("ollama:no", Locality::Local), Support::Unsupported),
            with_vision(model("ollama:yes", Locality::Local), Support::Supported),
        ];
        let need = [ModelCapability::VisionInput];
        let r = |id| request(RoutingMode::Manual, Some(id), &need);
        assert_eq!(decide(&r("ollama:unknown"), &models).reason_codes, vec![RoutingReason::CapabilityUnknown]);
        assert_eq!(decide(&r("ollama:no"), &models).reason_codes, vec![RoutingReason::CapabilityMissing]);
        assert!(decide(&r("ollama:yes"), &models).is_selected());
        let d = decide(&request(RoutingMode::CapabilityMatch, None, &need), &models);
        assert_eq!(d.model_id.as_deref(), Some("ollama:yes"));
    }

    #[test]
    fn locality_neither_blocks_nor_ranks_a_model() {
        let models = vec![model("openrouter:x/remote", Locality::Remote), model("ollama:local", Locality::Local)];
        let remote = decide(&request(RoutingMode::Manual, Some("openrouter:x/remote"), &[]), &models);
        assert!(remote.is_selected());
        assert_eq!(remote.locality, Some(Locality::Remote), "the locality is still reported as a fact");
        assert!(decide(&request(RoutingMode::Manual, Some("ollama:local"), &[]), &models).is_selected());
        let matched = decide(&request(RoutingMode::CapabilityMatch, None, &[]), &models);
        assert_eq!(matched.model_id.as_deref(), Some("ollama:local"), "capability match ranks by id only");
        assert_eq!(matched.reason_codes, vec![RoutingReason::CapabilityMatch]);
    }

    #[test]
    fn disabled_unhealthy_and_embedding_candidates_are_excluded() {
        let mut disabled = model("ollama:a", Locality::Local);
        disabled.enabled = false;
        let mut unhealthy = model("lm-studio:b", Locality::Local);
        unhealthy.provider_health = HealthState::Unreachable;
        let mut embed = model("lm-studio:c", Locality::Local);
        embed.kind = ModelKind::Embedding;
        let models = vec![disabled, unhealthy, embed];
        let d = decide(&request(RoutingMode::CapabilityMatch, None, &[]), &models);
        assert_eq!(d.reason_codes, vec![RoutingReason::NoCandidate]);
        assert_eq!(decide(&request(RoutingMode::Manual, Some("lm-studio:b"), &[]), &models).reason_codes, vec![RoutingReason::ProviderUnhealthy]);
        assert_eq!(decide(&request(RoutingMode::Manual, Some("lm-studio:c"), &[]), &models).reason_codes, vec![RoutingReason::ModelNotChat]);
    }

    #[test]
    fn the_decision_is_deterministic() {
        let models = vec![model("ollama:b", Locality::Local), model("ollama:a", Locality::Local)];
        let first = decide(&request(RoutingMode::CapabilityMatch, None, &[]), &models);
        for _ in 0..20 {
            let again = decide(&request(RoutingMode::CapabilityMatch, None, &[]), &models);
            assert_eq!(again.model_id, first.model_id);
        }
        assert_eq!(first.model_id.as_deref(), Some("ollama:a"));
    }
}
