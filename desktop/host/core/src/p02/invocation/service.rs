// خدمة الاستدعاء.
//
// الترتيب قاعدة أمان لا تفضيل:
//   ١ تسجيل الاستدعاء (وإلغاء سابق يُحترم)،
//   ٢ المشروع (موجود ونشط)،
//   ٣ التوجيه — قبل قراءة أي محتوى، فلا يؤثر محتوى ملف في اختيار النموذج،
//   ٤ السياق من مصادر المشروع فقط، بميزانية النموذج،
//   ٥ قرار الخروج،
//   ٦ التدقيق، ثم النداء بمهلة وإلغاء فعلي،
//   ٧ الناتج ملوّث بلا سلطة، وناتج وصل بعد الإلغاء يُسقط.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;

use polaris_host_providers::adapters::{adapter_for, CallContext};
use polaris_host_providers::domain::facts::Fact;
use polaris_host_providers::domain::{ChatMessage, FinishReason, HealthReason, HealthState, InvocationSpec, Locality, ModelCapability, ResponseFormat, Role};
use polaris_host_providers::error::ProviderErrorCode;
use polaris_host_providers::net::HttpClient;

use super::inflight::{CancelOutcome, Inflight, Registration};
use super::result::{ContextSummary, InvokeResult, InvokeStatus, OutcomeCode, OutcomeView, OutputView, TimingView, UsageView};
use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p02::context::assembler::{estimate_tokens, BundleRequest};
use crate::p02::context::{prompt, Assembler, SourceService};
use crate::p02::egress::{self, EgressDecision};
use crate::p02::errors::P02Error;
use crate::p02::models::listing::list_views;
use crate::p02::models::{ModelRegistry, Preferences};
use crate::p02::projects::{ProjectService, ProjectStatus};
use crate::p02::providers::health::MeasuredMs;
use crate::p02::providers::{ModelDiscovery, ProviderRegistry, SecretBroker};
use crate::p02::routing::{self, Decision, RoutingDecision, RoutingMode, RoutingReason, RoutingRequest};
use crate::p02::LiveFacts;

pub const DEFAULT_TIMEOUT_MS: u64 = 120_000;
/// حجز الإخراج حين لا يحدّده الطلب، لحساب الميزانية فقط.
const DEFAULT_OUTPUT_RESERVE: u64 = 1024;

pub struct InvocationDeps {
    pub providers: Arc<ProviderRegistry>,
    pub secrets: Arc<SecretBroker>,
    pub models: Arc<ModelRegistry>,
    pub preferences: Arc<Preferences>,
    pub projects: Arc<ProjectService>,
    pub sources: Arc<SourceService>,
    pub assembler: Arc<Assembler>,
    pub http: Arc<HttpClient>,
    pub audit: Arc<AuditLedger>,
    pub live: Arc<LiveFacts>,
}

#[derive(Debug, Clone)]
pub struct InvokeInput {
    pub invocation_id: String,
    pub routing_mode: RoutingMode,
    pub model_id: Option<String>,
    pub required_capabilities: Vec<ModelCapability>,
    pub project_id: Option<String>,
    pub context_source_ids: Vec<String>,
    /// الرسائل بترتيبها. رسالة المساعد قد تحمل استدعاءات أدوات سابقة، ورسالة الأداة نتيجتها (سجلّ المحادثة، C2).
    pub messages: Vec<ChatMessage>,
    pub system_instruction: Option<String>,
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u32>,
    pub response_format: ResponseFormat,
    pub timeout_ms: Option<u64>,
    /// مهلة الخمول للبثّ (Phase-08). حين تُعطى يصير `timeout_ms` سقفًا مطلقًا (حتى 15 دقيقة) لبثّ
    /// يتقدّم، ويُقطع البثّ متى صمت أطول منها. غيابها يُبقي سلوك Phase-02 كما أُغلق.
    pub idle_timeout_ms: Option<u64>,
    /// Phase-08: سقف المخرجات يُقصّ ليتّسع في نافذة النموذج المُعلنة بدل رفض النداء؛ يُرفض فقط إن
    /// بقي أقلّ من حدّ أدنى معلن. غيابه يُبقي رفض Phase-02 كما أُغلق.
    pub fit_output_to_window: bool,
    /// DEF-10: سقف المخرجات المطلوب حدّ أدنى يُرفع بحسب نافذة النموذج وحدّه المعلن (`scaled_output_tokens`)،
    /// وتُمدّ المهلة المطلقة بالنسبة نفسها. غيابه يُبقي السقف كما طُلب.
    pub scale_output_to_model: bool,
    /// Phase-08: جهد الاستدلال المخفي المطلوب من المزوّد (حقل بروتوكول).
    pub reasoning_effort: Option<polaris_host_providers::domain::messages::ReasoningEffort>,
    /// Phase-08: مخرجات مهيكلة عند المزوّد حين يُعلن النموذج الموجَّه إليه القدرة `Json`؛ وإلا يبقى
    /// العقد في المُوجِّه. لا يُطلب من نموذج لم يُعلنها، فلا يُرفض نداء بسببها. غيابه سلوك Phase-02.
    pub prefer_structured_output: bool,
    /// أدوات تُعرض بصيغة الاستدعاء الأصيل (خطة 2026-10-05، B2). تصل المزوّد فقط إن كان محوّله ينقلها؛
    /// وإلا تُسقط هنا، والنتيجة تقول ذلك (`native_tools_offered`). فارغة = سلوك ما قبلها.
    pub native_tools: Vec<polaris_host_providers::domain::ToolOffer>,
}

/// هل يُعلن النموذج وضع JSON عند مزوّده (ادعاء مدعوم، أيًّا كان مصدره)؟
fn declares_json(view: &crate::p02::models::view::ModelView) -> bool {
    view.capabilities.iter().any(|c| c.capability == ModelCapability::Json && c.support == polaris_host_providers::domain::facts::Support::Supported)
}

/// أقلّ سقف مخرجات يُقبل بعد القصّ على النافذة.
pub const MIN_FITTED_OUTPUT_TOKENS: u64 = 512;

/// أعلى سقف مخرجات يُرفع إليه نداء يطلب التكييف مع النموذج (DEF-10).
pub const MAX_SCALED_OUTPUT_TOKENS: u64 = 16_384;

/// سقف المخرجات بعد تكييفه مع قدرة النموذج. لا ينزل عن المطلوب أبدًا.
pub fn scaled_output_tokens(requested: u64, window: Option<u64>, model_max: Option<u64>) -> u64 {
    // نافذة مجهولة: لا أساس للرفع.
    let Some(window) = window else { return requested };
    // ثُمن النافذة: يترك للمُوجِّه وسجلّ المحادثة سبعة أثمانها.
    let mut target = (window / 8).min(MAX_SCALED_OUTPUT_TOKENS);
    if let Some(limit) = model_max {
        target = target.min(limit);
    }
    target.max(requested)
}

#[cfg(test)]
mod scaled_output_tests {
    use super::{scaled_output_tokens, MAX_SCALED_OUTPUT_TOKENS};

    // DEF-10 (قِيس 2026-10-29، B2): سقف 4096 ثابت على نافذة 262k قطع `write_file` لملف ≈ 9 KB مرتين.
    #[test]
    fn large_window_raises_the_cap() {
        assert_eq!(scaled_output_tokens(4_096, Some(262_144), None), MAX_SCALED_OUTPUT_TOKENS);
        assert_eq!(scaled_output_tokens(4_096, Some(65_536), None), 8_192);
    }

    #[test]
    fn small_or_unknown_window_keeps_the_request() {
        assert_eq!(scaled_output_tokens(4_096, Some(16_384), None), 4_096);
        assert_eq!(scaled_output_tokens(4_096, None, None), 4_096);
    }

    #[test]
    fn declared_model_limit_bounds_the_raise() {
        assert_eq!(scaled_output_tokens(4_096, Some(262_144), Some(8_000)), 8_000);
        // حدّ معلن أدنى من المطلوب لا يُنزل المطلوب: السلوك السابق كما هو.
        assert_eq!(scaled_output_tokens(4_096, Some(262_144), Some(2_000)), 4_096);
    }
}

/// السقف المطلق لنداء بمهلة خمول. محدود دائمًا.
pub const MAX_STREAMING_CEILING_MS: u64 = 900_000;

/// عمر الصحّة غير الصالحة للتوجيه الذي يُعاد بعده فحص المزوّد قبل رفض النداء (E-4).
pub const RECHECK_AFTER_SECONDS: i64 = 30;

pub struct InvocationService {
    deps: InvocationDeps,
    inflight: Inflight,
    /// حارس اختياري يُركَّب مرّة واحدة (Phase-06: الخصوصية والميزانية والاستعمال).
    /// غيابه يعني سلوك Phase-02 كما أُغلق، بايتًا ببايت.
    guard: std::sync::OnceLock<Arc<dyn InvocationGuard>>,
}

/// ما يعرفه الحارس عن نداء بعد التوجيه وقرار الخروج وقبل أي بايت إلى المزوّد.
/// لا يحمل نصّ رسالة ولا سياقًا ولا سرًّا: معرّفات وأعداد فقط.
pub struct InvocationAdmission<'a> {
    pub invocation_id: &'a str,
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub locality: Locality,
    pub project_id: Option<&'a str>,
    /// تقدير محلي لرموز الإدخال (السياق والتعليمة). تقدير، لا تقرير مزوّد.
    pub estimated_input_tokens: u64,
    pub reserved_output_tokens: u64,
}

/// حكم الحارس. يستطيع أن يمنع ولا يستطيع أن يوسّع: لا فرع «اسمح رغم رفض التوجيه».
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuardVerdict {
    Admit,
    /// رفض بسبب مُسمّى (ميزانية صلبة، حدّ إدخال). يُعاد خطأً مُصنَّفًا قبل النداء.
    Deny(String),
}

/// منفذ الحارس. يملؤه Phase-06؛ Phase-02 لا يعرف ميزانية ولا إعدادًا.
pub trait InvocationGuard: Send + Sync {
    fn admit(&self, admission: &InvocationAdmission<'_>) -> GuardVerdict;
    /// بعد النداء، نجح أو فشل. الاستعمال المقيس يُسجَّل هنا.
    fn settle(&self, admission: &InvocationAdmission<'_>, result: &InvokeResult);
}

struct Early {
    routing: RoutingDecision,
    egress: EgressDecision,
}

fn elapsed(started: Instant) -> TimingView {
    TimingView { total: MeasuredMs::new(started.elapsed().as_millis() as u64), first_byte: None, streamed: false }
}

impl InvocationService {
    pub fn new(deps: InvocationDeps) -> Self {
        Self { deps, inflight: Inflight::default(), guard: std::sync::OnceLock::new() }
    }

    /// يركّب الحارس مرّة واحدة لعمر العملية. تركيب ثانٍ يُرفض ولا يستبدل الأول.
    pub fn install_guard(&self, guard: Arc<dyn InvocationGuard>) -> bool {
        self.guard.set(guard).is_ok()
    }

    pub fn cancel(&self, invocation_id: &str, session: &str) -> Result<CancelOutcome, P02Error> {
        let outcome = self.inflight.cancel(invocation_id, session);
        if outcome == CancelOutcome::ForeignSession {
            return Err(P02Error::denied("/invocation_id", "the invocation belongs to another session"));
        }
        Ok(outcome)
    }

    fn finish(&self, id: &str, event: AuditEventType, outcome: AuditOutcome, detail: serde_json::Value, result: InvokeResult) -> Result<InvokeResult, P02Error> {
        self.inflight.finish(id);
        self.deps.audit.append(&AuditRecord::new(event, "invocation", id, outcome, detail))?;
        Ok(result)
    }

    fn denied(&self, input: &InvokeInput, started: Instant, early: Early) -> Result<InvokeResult, P02Error> {
        let reasons: Vec<String> = early
            .routing
            .reason_codes
            .iter()
            .map(|r| serde_json::to_value(r).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default())
            .collect();
        let egress_reason = serde_json::to_value(early.egress.reason).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default();
        let result = InvokeResult {
            invocation_id: input.invocation_id.clone(),
            status: InvokeStatus::Denied,
            routing: early.routing,
            egress: early.egress,
            output: None,
            finish_reason: None,
            usage: None,
            timing: elapsed(started),
            context: None,
            error: None,
            provider_request_id: None,
            tool_calls: Vec::new(),
            native_tools_offered: false,
            reasoning: None,
            diagnostic: None,
            http_status: None,
            retry_after_ms: None,
        };
        self.finish(
            &input.invocation_id,
            AuditEventType::InvocationDenied,
            AuditOutcome::Denied,
            json!({ "routing_reasons": reasons, "egress_reason": egress_reason }),
            result,
        )
    }

    pub fn invoke(&self, input: InvokeInput, session: &str) -> Result<InvokeResult, P02Error> {
        let started = Instant::now();
        let context_attached = !input.context_source_ids.is_empty();

        // ١ — التسجيل.
        let (registration, cancel) = self.inflight.register(&input.invocation_id, session);
        match registration {
            Registration::Duplicate => return Err(P02Error::Conflict("the invocation identifier was already used".into())),
            Registration::PreCancelled => {
                let result = InvokeResult {
                    invocation_id: input.invocation_id.clone(),
                    status: InvokeStatus::Cancelled,
                    routing: RoutingDecision::denied(input.routing_mode, RoutingReason::CancelledBeforeStart, 0),
                    egress: EgressDecision::not_evaluated(context_attached),
                    output: None,
                    finish_reason: None,
                    usage: None,
                    timing: elapsed(started),
                    context: None,
                    error: Some(OutcomeView::of(OutcomeCode::Cancelled)),
                    provider_request_id: None,
                    tool_calls: Vec::new(),
                    native_tools_offered: false,
            reasoning: None,
            diagnostic: None,
            http_status: None,
            retry_after_ms: None,
                };
                self.deps.audit.append(&AuditRecord::new(
                    AuditEventType::InvocationCancelled,
                    "invocation",
                    &input.invocation_id,
                    AuditOutcome::Cancelled,
                    json!({ "stage": "BEFORE_START" }),
                ))?;
                return Ok(result);
            }
            Registration::Started => {}
        }

        match self.run(&input, session, started, &cancel) {
            Ok(result) => Ok(result),
            Err(error) => {
                self.inflight.finish(&input.invocation_id);
                Err(error)
            }
        }
    }

    fn run(&self, input: &InvokeInput, _session: &str, started: Instant, cancel: &polaris_host_providers::net::CancelToken) -> Result<InvokeResult, P02Error> {
        let d = &self.deps;
        let context_attached = !input.context_source_ids.is_empty();

        // ٢ — المشروع.
        let project = match &input.project_id {
            Some(id) => match d.projects.find(id)? {
                Some(p) if p.status == ProjectStatus::Active => Some(p),
                Some(_) => {
                    let early = Early { routing: RoutingDecision::denied(input.routing_mode, RoutingReason::ProjectArchived, 0), egress: EgressDecision::not_evaluated(context_attached) };
                    return self.denied(input, started, early);
                }
                None => {
                    let early = Early { routing: RoutingDecision::denied(input.routing_mode, RoutingReason::ProjectNotFound, 0), egress: EgressDecision::not_evaluated(context_attached) };
                    return self.denied(input, started, early);
                }
            },
            None => None,
        };

        // ٣ — التوجيه، قبل أي محتوى.
        let mut views = list_views(&d.providers, &d.secrets, &d.models, &d.preferences, None)?;
        let user_default = d.preferences.default_model()?;
        let request = RoutingRequest {
            mode: input.routing_mode,
            requested_model: input.model_id.as_deref(),
            project_default: project.as_ref().and_then(|p| p.default_model_id.as_deref()),
            user_default: user_default.as_deref(),
            required: &input.required_capabilities,
        };
        let mut routing = routing::decide(&request, &views);
        // E-4: صحّة غير صالحة للتوجيه قيست قبل أكثر من نصف دقيقة لا تمنع وحدها: يُعاد فحص مزوّد النموذج المطلوب مرة واحدة،
        // فالخادم المحلي الذي عاد للعمل لا يبقى مرفوضًا حتى «تحديث» يدوي. الفحص إلى المزوّد نفسه الذي طُلب النداء إليه.
        if routing.decision == Decision::Denied && routing.reason_codes.iter().any(|r| matches!(r, RoutingReason::ProviderUnhealthy | RoutingReason::ModelUnavailable)) {
            let target = request.requested_model.or(request.project_default).or(request.user_default);
            let provider = target.and_then(|m| views.iter().find(|v| v.model_id == m)).map(|v| v.provider_id.clone());
            if let Some(provider) = provider.filter(|p| d.providers.health_checked_before(p, RECHECK_AFTER_SECONDS)) {
                let discovery = ModelDiscovery::new(d.providers.clone(), d.secrets.clone(), d.models.clone(), d.http.clone(), d.audit.clone(), d.live.clone());
                if discovery.refresh(&[provider]).is_ok() {
                    views = list_views(&d.providers, &d.secrets, &d.models, &d.preferences, None)?;
                    routing = routing::decide(&request, &views);
                }
            }
        }
        if routing.decision == Decision::Denied {
            return self.denied(input, started, Early { routing, egress: EgressDecision::not_evaluated(context_attached) });
        }
        let model_id = routing.model_id.clone().unwrap_or_default();
        let view = views.iter().find(|v| v.model_id == model_id).cloned().ok_or_else(|| P02Error::Unavailable("routed model vanished".into()))?;
        let locality = view.locality;

        // ٤ — السياق: مصادر هذا المشروع وحده.
        let mut context_summary = None;
        let mut context_message = None;
        let window = view.context_window.value;
        // DEF-10: السقف المطلوب يُكيَّف مع النموذج الموجَّه إليه قبل حساب الحجز والنافذة.
        let requested_output = input.max_output_tokens.map(u64::from).map(|requested| {
            if input.scale_output_to_model {
                scaled_output_tokens(requested, window, view.max_output_tokens.value)
            } else {
                requested
            }
        });
        let reserve = requested_output.unwrap_or(DEFAULT_OUTPUT_RESERVE);
        let context_tokens;
        if context_attached {
            let project_ref = project.as_ref().ok_or_else(|| P02Error::invalid("/project_id", "context requires a project"))?;
            for id in &input.context_source_ids {
                if d.sources.get(&project_ref.project_id, id)?.is_none() {
                    let mut routing = routing.clone();
                    routing.decision = Decision::Denied;
                    routing.model_id = None;
                    routing.provider_id = None;
                    routing.locality = None;
                    routing.reason_codes = vec![RoutingReason::SourceNotInProject];
                    return self.denied(input, started, Early { routing, egress: EgressDecision::not_evaluated(true) });
                }
            }
            let instruction: String = input.messages.iter().map(|m| m.text.as_str()).collect::<Vec<_>>().join("\n");
            let bundle = d.assembler.assemble(&BundleRequest {
                project: project_ref,
                source_ids: &input.context_source_ids,
                instruction: &instruction,
                context_window: window,
                reserved_output_tokens: reserve,
                max_tokens: None,
                max_files: None,
            })?;
            context_tokens = bundle.view.estimated_tokens.value;
            context_summary = Some(ContextSummary {
                items: bundle.view.items.len() as u64,
                omitted: bundle.view.omitted.len() as u64,
                estimated_tokens: bundle.view.estimated_tokens.clone(),
                truncated: bundle.view.truncated,
                bundle_digest: bundle.view.bundle_digest.clone(),
            });
            context_message = prompt::render(&bundle);
        } else {
            // الاستدعاءات السابقة في سجلّ المحادثة تُرسل كذلك، فتُحسب بطول وسائطها واسمها.
            let text: usize = input.messages.iter().map(|m| m.text.len() + m.tool_calls.iter().map(|c| c.name.len() + c.arguments.len() + 24).sum::<usize>()).sum();
            context_tokens = estimate_tokens(text).value;
        }
        // تعريفات الأدوات الأصيلة تدخل نافذة النموذج كالمُوجِّه (B2): تُحسب معه، وإلا لا يُقصّ سقف المخرجات وهي
        // تزاحمه (قيس في اختبار النافذة المحمّلة 6000). تُحسب بحجمها كما ستُرسل، قبل معرفة هل ينقلها المحوّل: تقدير أعلى أسلم.
        let tools_text: usize = input.native_tools.iter().map(|t| t.name.len() + t.description.len() + t.parameters.to_string().len() + 32).sum();
        let system_tokens = input.system_instruction.as_ref().map(|s| estimate_tokens(s.len()).value).unwrap_or(0) + if tools_text > 0 { estimate_tokens(tools_text).value } else { 0 };
        // Phase-08: المُوجِّه مع سقف المخرجات يجب أن يتّسع في النافذة التي يخدم بها النموذج فعلًا.
        let mut effective_output = requested_output;
        let mut reserve = reserve;
        if let (true, Some(window)) = (input.fit_output_to_window, window) {
            let room = window.saturating_sub(context_tokens + system_tokens + 64);
            if room >= MIN_FITTED_OUTPUT_TOKENS && room < reserve {
                reserve = room;
                effective_output = Some(room);
            }
        }
        if let Some(window) = window {
            if context_tokens + system_tokens + reserve > window {
                let mut routing = routing.clone();
                routing.decision = Decision::Denied;
                routing.model_id = None;
                routing.provider_id = None;
                routing.locality = None;
                routing.reason_codes = vec![RoutingReason::ContextTooLarge];
                return self.denied(input, started, Early { routing, egress: EgressDecision::not_evaluated(context_attached) });
            }
        }

        // ٥ — الخروج.
        let egress = egress::decide(locality, context_attached);

        // ٥ب — الحارس المركَّب (Phase-06): الميزانية وحدّ الإدخال، قبل أي بايت.
        // يستطيع أن يمنع فقط؛ غيابه يُبقي الترتيب أعلاه كما أُغلق.
        let guard_provider = routing.provider_id.clone().unwrap_or_default();
        let admission = InvocationAdmission {
            invocation_id: &input.invocation_id,
            provider_id: &guard_provider,
            model_id: &model_id,
            locality,
            project_id: input.project_id.as_deref(),
            estimated_input_tokens: context_tokens + system_tokens,
            reserved_output_tokens: reserve,
        };
        let guard = self.guard.get().cloned();
        if let Some(guard) = &guard {
            match guard.admit(&admission) {
                GuardVerdict::Admit => {}
                GuardVerdict::Deny(reason) => {
                    let reason: String = reason.chars().take(200).collect();
                    d.audit.append(&AuditRecord::new(
                        AuditEventType::InvocationDenied,
                        "invocation",
                        &input.invocation_id,
                        AuditOutcome::Denied,
                        json!({ "guard": reason }),
                    ))?;
                    return Err(P02Error::denied("/invocation", reason));
                }
            }
        }

        // ٦ — التدقيق ثم النداء.
        let provider_id = routing.provider_id.clone().unwrap_or_default();
        let state = d.providers.state(&provider_id)?;
        let endpoint = d
            .providers
            .resolve_endpoint(&state)
            .map_err(|_| P02Error::Unavailable("the provider endpoint is not usable".into()))?;
        let credential = d.secrets.resolve(&state.descriptor);
        let initiated = if locality == Locality::Remote { AuditEventType::RemoteInvocationInitiated } else { AuditEventType::InvocationInitiated };
        d.audit.append(&AuditRecord::new(
            initiated,
            "invocation",
            &input.invocation_id,
            AuditOutcome::Started,
            json!({
                "model_id": model_id.chars().take(200).collect::<String>(),
                "provider_id": provider_id,
                "network_class": if locality == Locality::Remote { "REMOTE_EGRESS" } else { "LOOPBACK_PROVIDER_ACCESS" },
                "message_count": input.messages.len(),
                "message_chars": input.messages.iter().map(|m| m.text.chars().count()).sum::<usize>(),
                "image_count": input.messages.iter().map(|m| m.images.len()).sum::<usize>(),
                "context_items": context_summary.as_ref().map(|c| c.items).unwrap_or(0),
                "project_id": input.project_id,
            }),
        ))?;

        let mut messages = Vec::new();
        if let Some(block) = context_message {
            messages.push(ChatMessage::text(Role::User, block));
        }
        messages.extend(input.messages.iter().cloned());
        let adapter = adapter_for(state.descriptor.kind);
        // حاجز أخير (مكافأة Manus 2026-10-19): صورة لا تصل نموذجًا لا يعلن الرؤية، ولا محوّلًا لا ينقلها. القرار يُتّخذ قبل
        // هذا في حلقة الوكيل (`image_route`) فيُقال للنموذج والمستخدم؛ هنا يُحجب ما فات ويُسجَّل، ولا يُرسل نصًّا بدلها.
        let image_capable = adapter.supports_image_input() && declares(&view, ModelCapability::VisionInput);
        let withheld: usize = if image_capable { 0 } else { messages.iter().map(|m| m.images.len()).sum() };
        if withheld > 0 {
            for m in &mut messages {
                m.images.clear();
            }
            d.audit.append(&AuditRecord::new(AuditEventType::InvocationInitiated, "invocation", &input.invocation_id, AuditOutcome::Denied, json!({ "images_withheld": withheld, "reason": "VISION_UNSUPPORTED_BY_SELECTED_MODEL" })))?;
        }
        // العرض الأصيل يصل المزوّد فقط إن كان محوّله ينقله، ولا يُعرض على نموذج يوثّق الفهرس أنه لا يستدعي أدوات (قِيس
        // 2026-10-06 على Groq: نموذج كهذا رفض الطلب كله برمز 400). يُسقط هنا صراحةً ويُسجَّل، ولا يُرفض النداء.
        let native_tools_offered = !input.native_tools.is_empty() && adapter.supports_native_tools() && !refuses_tools(&view);
        // جهد الاستدلال الذي اختاره المستخدم من مربع الجهد (2026-11-12)؛ غيابه = افتراضي المزوّد والوكيل.
        let user_effort = d.preferences.reasoning_effort()?;
        let spec = InvocationSpec {
            provider_model_id: view.provider_model_id.clone(),
            system: input.system_instruction.clone(),
            messages,
            temperature: input.temperature,
            max_output_tokens: effective_output.map(|t| t.min(u64::from(u32::MAX)) as u32),
            response_format: if input.prefer_structured_output && input.response_format == ResponseFormat::Text && declares_json(&view) {
                ResponseFormat::Json
            } else {
                input.response_format
            },
            // اختيار المستخدم يعلو جهد الوكيل الداخلي، إلا حين يُطفئ الوكيل الاستدلال صراحةً (إصلاح ردّ فارغ بطول).
            reasoning_effort: match (input.reasoning_effort, user_effort) {
                (Some(polaris_host_providers::domain::messages::ReasoningEffort::None), _) => Some(polaris_host_providers::domain::messages::ReasoningEffort::None),
                (_, Some(chosen)) => Some(chosen),
                (agent, None) => agent,
            },
            user_effort,
            tools: if native_tools_offered { input.native_tools.clone() } else { Vec::new() },
            context_window: view.context_window.value,
            wire: state.descriptor.wire,
            model_reasons: declares(&view, ModelCapability::Reasoning),
        };
        let structured_output = spec.response_format == ResponseFormat::Json;
        let ceiling = if input.idle_timeout_ms.is_some() { MAX_STREAMING_CEILING_MS } else { 300_000 };
        // DEF-10: سقف مخرجات مرفوع يحتاج مهلة مطلقة بالنسبة نفسها، وإلا قُطع البثّ قبل اكتمال ما سُمح به. السقف `ceiling` باقٍ.
        let stretch = match (input.max_output_tokens, effective_output) {
            (Some(requested), Some(effective)) if u64::from(requested) > 0 && effective > u64::from(requested) => effective as f64 / f64::from(requested),
            _ => 1.0,
        };
        let base_timeout = input.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
        let timeout = Duration::from_millis(((base_timeout as f64 * stretch) as u64).clamp(1000, ceiling));
        let deadline = Instant::now() + timeout;
        let idle = input.idle_timeout_ms.map(|ms| Duration::from_millis(ms.clamp(5_000, timeout.as_millis() as u64)));
        d.live.mark_network_contact();
        let ctx = CallContext { http: &d.http, endpoint: &endpoint, credential: credential.as_ref(), cancel, deadline, idle };
        let outcome = adapter.invoke(&spec, &ctx);
        drop(credential);

        // ٧ — الناتج.
        let mut timing = elapsed(started);
        let base = InvokeResult {
            invocation_id: input.invocation_id.clone(),
            status: InvokeStatus::Failed,
            routing,
            egress,
            output: None,
            finish_reason: None,
            usage: None,
            timing: timing.clone(),
            context: context_summary,
            error: None,
            provider_request_id: None,
            tool_calls: Vec::new(),
            native_tools_offered,
            reasoning: None,
            diagnostic: None,
            http_status: None,
            retry_after_ms: None,
        };
        if cancel.is_cancelled() {
            // ناتج وصل بعد الإلغاء لا يُقدَّم: الإلغاء هو الحقيقة الأخيرة.
            let result = InvokeResult { status: InvokeStatus::Cancelled, error: Some(OutcomeView::of(OutcomeCode::Cancelled)), ..base };
            let finished = self.finish(&input.invocation_id, AuditEventType::InvocationCancelled, AuditOutcome::Cancelled, json!({ "stage": "IN_FLIGHT" }), result);
            if let (Some(guard), Ok(done)) = (&guard, &finished) {
                guard.settle(&admission, done);
            }
            return finished;
        }
        let finished = match outcome {
            Ok(output) => {
                timing.first_byte = output.first_byte_ms.map(MeasuredMs::new);
                timing.streamed = output.streamed;
                let finish = output.finish_reason;
                let result = InvokeResult {
                    status: InvokeStatus::Completed,
                    output: Some(OutputView::tainted(output.text.clone())),
                    finish_reason: Some(finish),
                    usage: Some(UsageView {
                        input_tokens: Fact::reported_opt(output.usage.input_tokens),
                        output_tokens: Fact::reported_opt(output.usage.output_tokens),
                        cached_input_tokens: output.usage.cached_input_tokens,
                    }),
                    timing,
                    provider_request_id: output.provider_request_id.clone(),
                    tool_calls: output.tool_calls.clone(),
                    reasoning: output.reasoning.clone(),
                    ..base
                };
                self.finish(
                    &input.invocation_id,
                    AuditEventType::InvocationCompleted,
                    AuditOutcome::Success,
                    json!({
                        "output_chars": output.text.chars().count(),
                        "finish_reason": serde_json::to_value(finish).ok(),
                        "input_tokens_reported": output.usage.input_tokens,
                        "output_tokens_reported": output.usage.output_tokens,
                        "cached_tokens_reported": output.usage.cached_input_tokens,
                        "total_ms": result.timing.total.value,
                        "max_output_tokens": effective_output,
                        "reasoning_effort": input.reasoning_effort.map(|e| e.as_str()),
                        "structured_output": structured_output,
                        "native_tools_offered": native_tools_offered,
                        "native_tool_calls": output.tool_calls.len(),
                    }),
                    result,
                )
            }
            Err(error) => {
                let timed_out = error.code == ProviderErrorCode::ProviderTimeout || Instant::now() >= deadline;
                let status = if error.code == ProviderErrorCode::Cancelled {
                    InvokeStatus::Cancelled
                } else if timed_out {
                    InvokeStatus::TimedOut
                } else {
                    InvokeStatus::Failed
                };
                let code = if timed_out && error.code != ProviderErrorCode::Cancelled { OutcomeCode::ProviderTimeout } else { OutcomeCode::from_provider(error.code) };
                // التشخيص المنقّح يبقى داخل المضيف: يُريه الوكيلَ سببَ ردّ رفضه المزوّد (اسم أداة خاطئ مثلًا)، ولا يعبر IPC.
                let diagnostic = Some(error.diagnostic().chars().take(600).collect::<String>());
                let result = InvokeResult { status, error: Some(OutcomeView::of(code)), diagnostic, http_status: error.http_status, retry_after_ms: error.retry_after_ms, ..base };
                let (event, audit_outcome) = if status == InvokeStatus::Cancelled {
                    (AuditEventType::InvocationCancelled, AuditOutcome::Cancelled)
                } else {
                    (AuditEventType::InvocationFailed, AuditOutcome::Failure)
                };
                self.finish(
                    &input.invocation_id,
                    event,
                    audit_outcome,
                    // لا تشخيص نصّي هنا: سجلّ التدقيق يرفض النصّ الحرّ (قِيس 2026-10-06: إضافته أوقفت كل نداء فاشل). التشخيص المنقّح
                    // يصل الوكيلَ وسببَ إخفاق المهمّة من `InvokeResult.diagnostic`.
                    json!({ "code": serde_json::to_value(code).ok(), "http_status": error.http_status }),
                    result,
                )
            }
        };
        // التسوية بعد النداء: ما قاسه المزوّد يُسجَّل، ولا يغيّر النتيجة شيئًا.
        if let (Some(guard), Ok(done)) = (&guard, &finished) {
            guard.settle(&admission, done);
        }
        // صحّة المزوّد من النداء نفسه (E-4): ما يراه المستخدم في صفحة المزوّدين وما يقرؤه التوجيه هو آخر قياس، لا تحديثًا قديمًا.
        if let Ok(done) = &finished {
            if let Some((state, reason)) = observed_health(done) {
                let _ = d.providers.record_call_health(&provider_id, state, reason, done.timing.total.value);
            }
        }
        finished
    }

    /// هل سيُنقل عرض أدوات أصيل لهذا الطلب؟ يحسب التوجيه نفسه الذي يحسبه `invoke` بلا أثر: لا تدقيق ولا نداء.
    /// يسأله الوكيل مرة لكل مهمّة ليصوغ مُوجِّهه بصيغة واحدة متّسقة. خطأ القراءة يعني «لا»، فيبقى المسار النصّي.
    pub fn carries_native_tools(&self, input: &InvokeInput) -> bool {
        let d = &self.deps;
        let project = match &input.project_id {
            Some(id) => match d.projects.find(id) {
                Ok(Some(p)) if p.status == ProjectStatus::Active => Some(p),
                _ => return false,
            },
            None => None,
        };
        let (Ok(views), Ok(user_default)) = (list_views(&d.providers, &d.secrets, &d.models, &d.preferences, None), d.preferences.default_model()) else {
            return false;
        };
        let request = RoutingRequest {
            mode: input.routing_mode,
            requested_model: input.model_id.as_deref(),
            project_default: project.as_ref().and_then(|p| p.default_model_id.as_deref()),
            user_default: user_default.as_deref(),
            required: &input.required_capabilities,
        };
        let routing = routing::decide(&request, &views);
        if routing.decision == Decision::Denied {
            return false;
        }
        let Some(provider_id) = routing.provider_id else { return false };
        if views.iter().find(|v| Some(&v.model_id) == routing.model_id.as_ref()).is_some_and(refuses_tools) {
            return false;
        }
        match d.providers.state(&provider_id) {
            Ok(state) => adapter_for(state.descriptor.kind).supports_native_tools(),
            Err(_) => false,
        }
    }

    /// أين ستذهب صور هذا الطلب لو أُرسل الآن: التوجيه نفسه الذي يسلكه النداء، ثم هل يعلن النموذج المختار الرؤية بمصدر
    /// معروف وهل ينقل محوّل مزوّده الصور. لا يغيّر التوجيه ولا يختار نموذجًا آخر من أجل الصور (لا توجيه خفيّ).
    pub fn image_route(&self, input: &InvokeInput) -> ImageRoute {
        let d = &self.deps;
        let project = match &input.project_id {
            Some(id) => match d.projects.find(id) {
                Ok(Some(p)) if p.status == ProjectStatus::Active => Some(p),
                _ => return ImageRoute::NoRoute,
            },
            None => None,
        };
        let (Ok(views), Ok(user_default)) = (list_views(&d.providers, &d.secrets, &d.models, &d.preferences, None), d.preferences.default_model()) else {
            return ImageRoute::NoRoute;
        };
        let request = RoutingRequest {
            mode: input.routing_mode,
            requested_model: input.model_id.as_deref(),
            project_default: project.as_ref().and_then(|p| p.default_model_id.as_deref()),
            user_default: user_default.as_deref(),
            required: &input.required_capabilities,
        };
        let routing = routing::decide(&request, &views);
        let (Decision::Selected, Some(model_id), Some(provider_id)) = (routing.decision, routing.model_id.clone(), routing.provider_id.clone()) else {
            return ImageRoute::NoRoute;
        };
        let Some(view) = views.iter().find(|v| v.model_id == model_id) else { return ImageRoute::NoRoute };
        let carried = d.providers.state(&provider_id).map(|state| adapter_for(state.descriptor.kind).supports_image_input()).unwrap_or(false);
        if carried && declares(view, ModelCapability::VisionInput) {
            ImageRoute::Vision { model_id }
        } else {
            ImageRoute::NoVision { model_id }
        }
    }

    /// W-2 (2026-10-27): نافذة سياق النموذج الذي سيختاره التوجيه لهذا الطلب لو أُرسل الآن، بالأسلوب نفسه الذي يسلكه
    /// `image_route` (لا تدقيق ولا نداء). `None` حين لا يُعرف (نموذج بلا نافذة معلنة، أو لا توجيه).
    pub fn context_window(&self, input: &InvokeInput) -> Option<u64> {
        let d = &self.deps;
        let project = match &input.project_id {
            Some(id) => match d.projects.find(id) {
                Ok(Some(p)) if p.status == ProjectStatus::Active => Some(p),
                _ => return None,
            },
            None => None,
        };
        let (Ok(views), Ok(user_default)) = (list_views(&d.providers, &d.secrets, &d.models, &d.preferences, None), d.preferences.default_model()) else {
            return None;
        };
        let request = RoutingRequest {
            mode: input.routing_mode,
            requested_model: input.model_id.as_deref(),
            project_default: project.as_ref().and_then(|p| p.default_model_id.as_deref()),
            user_default: user_default.as_deref(),
            required: &input.required_capabilities,
        };
        let routing = routing::decide(&request, &views);
        let model_id = routing.model_id.filter(|_| routing.decision == Decision::Selected)?;
        views.iter().find(|v| v.model_id == model_id).and_then(|v| v.context_window.value)
    }

    pub fn running_count(&self) -> usize {
        self.inflight.running_count()
    }
}

/// قرار الصور لطلب واحد (`InvocationService::image_route`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageRoute {
    /// النموذج المختار يعلن الرؤية، ومحوّله ينقل الصور.
    Vision { model_id: String },
    /// النموذج المختار لا يعلن الرؤية (أو قدرته مجهولة)، أو محوّله لا ينقل الصور: الصور لا تُرسل إليه.
    NoVision { model_id: String },
    /// لا توجيه الآن (لا نموذج، أو رُفض التوجيه).
    NoRoute,
}

/// هل تُعلن حقيقة النموذج هذه القدرة مدعومةً بمصدر معروف؟
fn declares(view: &crate::p02::models::view::ModelView, capability: ModelCapability) -> bool {
    use polaris_host_providers::domain::facts::{Provenance, Support};
    view.capabilities.iter().any(|c| c.capability == capability && c.support == Support::Supported && c.provenance != Provenance::Unknown)
}

/// هل يوثّق مصدر معروف أن النموذج لا يستدعي أدوات؟ المجهول لا يُعدّ رفضًا: يُعرض عليه، ورفض الخادم يعيد المهمّة إلى العقد النصّي.
fn refuses_tools(view: &crate::p02::models::view::ModelView) -> bool {
    use polaris_host_providers::domain::facts::{Provenance, Support};
    view.capabilities.iter().any(|c| c.capability == ModelCapability::Tools && c.support == Support::Unsupported && c.provenance != Provenance::Unknown)
}

/// نهاية الناتج كما تُعرض، للتدقيق والاختبار.
pub fn finish_code(reason: FinishReason) -> &'static str {
    match reason {
        FinishReason::Stop => "STOP",
        FinishReason::Length => "LENGTH",
        FinishReason::ContentFilter => "CONTENT_FILTER",
        FinishReason::ToolCall => "TOOL_CALL",
        FinishReason::Cancelled => "CANCELLED",
        FinishReason::Unknown => "UNKNOWN",
    }
}

/// الصحّة التي يقيسها نداء واحد (E-4)، أو لا شيء حين لا يقول النداء شيئًا عن المزوّد نفسه: طلب رفضه المزوّد لصيغته، أو نموذج
/// غير موجود، أو إلغاء، أو رفض قبل الإرسال. البطء صحّة متدهورة لا انقطاع: النموذج المحلي البطيء يبقى قابلًا للتوجيه.
pub fn observed_health(result: &InvokeResult) -> Option<(HealthState, HealthReason)> {
    if result.status == InvokeStatus::Completed {
        return Some((HealthState::Healthy, HealthReason::Ok));
    }
    match result.error.as_ref().map(|e| e.code)? {
        // النداء لم يبلغ المزوّد: لا يعرف المضيف هنا أكان رفض اتصال أم شبكة، فيُقال «لم يُبلغ».
        OutcomeCode::ProviderUnreachable => Some((HealthState::Unreachable, HealthReason::NetworkUnreachable)),
        OutcomeCode::ProviderTimeout => Some((HealthState::Degraded, HealthReason::ProviderTimeout)),
        OutcomeCode::ProviderInternalError => Some((HealthState::Degraded, HealthReason::ServerError)),
        OutcomeCode::RateLimited => Some((HealthState::RateLimited, HealthReason::RateLimited)),
        OutcomeCode::AuthFailed => Some((HealthState::AuthFailed, HealthReason::CredentialRejected)),
        _ => None,
    }
}
