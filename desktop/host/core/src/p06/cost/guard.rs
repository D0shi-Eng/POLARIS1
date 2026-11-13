// حارس استدعاء النماذج: الخصوصية، وحدّ الإدخال، والميزانية قبل النداء؛ والاستعمال
// والصحّة بعده.
//
// يُركَّب في خدمة الاستدعاء في Phase-02 عبر منفذها، فيمرّ به كل نداء نموذج: من شاشة
// النماذج ومن وكيل المهمّة معًا. لا نداء يلتفّ عليه لأن لا مسار نداء غير هذا.

use std::sync::{Arc, OnceLock};

use polaris_host_providers::domain::facts::Provenance as FactProvenance;
use polaris_host_providers::domain::Locality;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p02::invocation::result::{InvokeStatus, OutcomeCode};
use crate::p02::invocation::{GuardVerdict, InvocationAdmission, InvocationGuard, InvokeResult};
use crate::p03::cancel::MissionCancellation;
use crate::p06::config::{ConfigScope, ConfigService};
use crate::p06::observe::alerts::{AlertKind, AlertSeverity};
use crate::p06::observe::event::{Category, Component, EventDraft, Severity};
use crate::p06::observe::health::{HealthState, HealthSubject};
use crate::p06::observe::metrics::Counter;
use crate::p06::observe::ObservabilityService;

use super::budget::{BudgetDecision, CallContext, Planned};
use super::model::{Provenance, UsageCategory, UsageRecord};
use super::CostBooks;

pub struct ModelCallGuard {
    config: Arc<ConfigService>,
    books: Arc<CostBooks>,
    observe: Arc<ObservabilityService>,
    audit: Arc<AuditLedger>,
    /// تشغيلات Phase-03 القائمة. تُربط بعد بناء Phase-03 لأن الحارس يُركَّب قبله.
    missions: OnceLock<Arc<MissionCancellation>>,
}

impl ModelCallGuard {
    pub fn new(config: Arc<ConfigService>, books: Arc<CostBooks>, observe: Arc<ObservabilityService>, audit: Arc<AuditLedger>) -> Self {
        Self { config, books, observe, audit, missions: OnceLock::new() }
    }

    pub fn bind_missions(&self, missions: Arc<MissionCancellation>) {
        let _ = self.missions.set(missions);
    }

    fn mission_of(&self, invocation_id: &str) -> Option<String> {
        self.missions.get()?.mission_of_invocation(invocation_id)
    }

    fn step_of(&self, invocation_id: &str) -> Option<String> {
        self.missions.get()?.step_of_invocation(invocation_id)
    }

    fn context(&self, admission: &InvocationAdmission<'_>) -> (Option<String>, ConfigScope, CallContext) {
        let mission = self.mission_of(admission.invocation_id);
        let project = admission.project_id.map(str::to_string);
        let scope = match &mission {
            Some(m) => ConfigScope::mission(m.clone(), project.clone()),
            None => ConfigScope { project_id: project.clone(), mission_id: None },
        };
        let ctx = CallContext {
            day: self.observe.clock().now().chars().take(10).collect(),
            mission_id: mission.clone(),
            project_id: project,
            provider_id: Some(admission.provider_id.to_string()),
            connector_id: None,
        };
        (mission, scope, ctx)
    }

    fn denial_event(&self, mission: Option<&str>, reason: &str) {
        self.observe.emit(EventDraft::new(Component::Model, Category::Policy, Severity::Warning, "model.invoke", "DENIED").mission(mission, None, None).reason(reason));
    }

    fn alert_budgets(&self, uses: &[super::budget::BudgetUse]) {
        if !self.config.bool("observability.budget_alerts", &ConfigScope::global()) {
            return;
        }
        for usage in uses {
            let subject = format!("budget:{}", usage.budget_id);
            match usage.state {
                "EXCEEDED" | "AT_LIMIT" => self.observe.raise(AlertKind::BudgetExceeded, AlertSeverity::Error, &subject, usage.state),
                "NEAR_LIMIT" => self.observe.raise(AlertKind::BudgetNearLimit, AlertSeverity::Warning, &subject, "NEAR_LIMIT"),
                _ => {}
            }
        }
    }
}

impl InvocationGuard for ModelCallGuard {
    fn admit(&self, admission: &InvocationAdmission<'_>) -> GuardVerdict {
        let (mission, scope, ctx) = self.context(admission);

        // ٢ — حدّ الإدخال التقديري لنداء واحد.
        let limit = self.config.uint("models.max_input_tokens_per_call", &scope);
        if admission.estimated_input_tokens > limit {
            self.denial_event(mission.as_deref(), "MODEL_INPUT_LIMIT");
            return GuardVerdict::Deny(format!("MODEL_INPUT_LIMIT: an estimated {} input tokens exceed the limit of {limit}", admission.estimated_input_tokens));
        }

        // ٣ — الميزانية: حجز قبل الإنفاق.
        let planned = Planned {
            cost: self.books.pricing.model_estimate(admission.model_id, admission.estimated_input_tokens, admission.reserved_output_tokens),
            tokens: admission.estimated_input_tokens + admission.reserved_output_tokens,
            external_calls: u64::from(admission.locality == Locality::Remote),
        };
        match self.books.budgets.reserve(&ctx, &planned, admission.invocation_id) {
            Ok(BudgetDecision::Allow) => GuardVerdict::Admit,
            Ok(BudgetDecision::Warn(uses)) => {
                self.alert_budgets(&uses);
                self.observe.emit(
                    EventDraft::new(Component::Budget, Category::Budget, Severity::Warning, "model.invoke", "WARNED").mission(mission.as_deref(), None, None).reason("SOFT_BUDGET"),
                );
                GuardVerdict::Admit
            }
            Ok(BudgetDecision::Block(usage, reason)) => {
                self.alert_budgets(&[super::budget::BudgetUse { state: "EXCEEDED", ..usage.clone() }]);
                let _ = self.audit.append(&AuditRecord::new(
                    AuditEventType::BudgetExceeded,
                    "budget",
                    &usage.budget_id,
                    AuditOutcome::Denied,
                    serde_json::json!({ "dimension": usage.dimension.as_str(), "limit": usage.limit, "used": usage.used, "reason": reason, "subject": "MODEL_CALL" }),
                ));
                self.denial_event(mission.as_deref(), reason);
                GuardVerdict::Deny(format!("{reason}: the hard budget {} ({}) is at {} of {}", usage.budget_id, usage.dimension.as_str(), usage.used, usage.limit))
            }
            // الميزانية غير مقروءة: لا يُفترض أنها تسمح.
            Err(_) => {
                self.denial_event(mission.as_deref(), "BUDGET_UNREADABLE");
                GuardVerdict::Deny("BUDGET_UNREADABLE: the budgets could not be read, so the call is not admitted".into())
            }
        }
    }

    fn settle(&self, admission: &InvocationAdmission<'_>, result: &InvokeResult) {
        let (mission, _, ctx) = self.context(admission);
        self.books.budgets.release(admission.invocation_id);
        let sent = !matches!(result.status, InvokeStatus::Denied);
        let now = self.observe.clock().now();
        let elapsed = result.timing.total.value;
        if sent {
            let (input, output, cached, provenance) = match &result.usage {
                Some(usage) if usage.input_tokens.provenance == FactProvenance::ProviderReported && usage.output_tokens.provenance == FactProvenance::ProviderReported => {
                    (usage.input_tokens.value, usage.output_tokens.value, usage.cached_input_tokens, Provenance::ProviderReported)
                }
                // T-8 (تدقيق 2026-10-19): نداء بلغ المزوّد ولم يبلّغ استعماله. كان يُسجَّل بلا رموز، فلا تُلزم ميزانية رموز صلبة
                // أبدًا مع مزوّد كهذا (202 من 314 سجلًّا في قاعدة المالك). لا مُرمِّز موثوقًا لكل نموذج، فالمسجَّل هو الحجز نفسه:
                // تقدير المدخلات المحلي وسقف المخرجات المحجوز — حدّ أعلى محافظ موسوم ESTIMATED، لا يُعرض رموزًا مُبلَّغًا عنها.
                _ if reached_provider(result) => (Some(admission.estimated_input_tokens), Some(admission.reserved_output_tokens), None, Provenance::Estimated),
                _ => (None, None, None, Provenance::Unknown),
            };
            let cost = self.books.pricing.model_cost(admission.model_id, input, output);
            let record = UsageRecord {
                record_id: self.observe.clock().id(),
                recorded_at: now.clone(),
                category: UsageCategory::Model,
                subject_id: admission.invocation_id.to_string(),
                mission_id: mission.clone(),
                project_id: admission.project_id.map(str::to_string),
                provider_id: Some(admission.provider_id.to_string()),
                model_id: Some(admission.model_id.to_string()),
                connector_id: None,
                tool_id: None,
                input_tokens: input,
                output_tokens: output,
                cached_tokens: cached,
                tokens_provenance: provenance,
                wall_ms: elapsed,
                external_requests: u64::from(admission.locality == Locality::Remote),
                cost,
            };
            if self.books.ledger.record(&record).is_err() {
                self.observe.raise(AlertKind::StorageIssue, AlertSeverity::Error, "usage_records", "USAGE_WRITE_FAILED");
            }
            self.observe.metrics.increment(Counter::ModelCalls);
            self.observe.metrics.latency(Component::Model, elapsed);
            // A2: حدث لكل نداء نموذج بمهمّته وخطوته وزمنه، كما لكل نداء أداة: الشجرة مهمّة ← خطوة ← نداء نموذج وأداة
            // تُقرأ من الأحداث. الرموز في سجلّ الاستهلاك بمعرّف الاستدعاء نفسه، لا هنا.
            let step = self.step_of(admission.invocation_id);
            // رفض عرض الأدوات الأصيل الذي يكمل بعده الوكيل بالصيغة النصّية (خطة 2026-10-07، ADR-041 §1 #15): رجوعٌ مقصود لا
            // إخفاق. قِيس على LM Studio (qwythos-9b بنافذة 8192): أول نداء في كل مهمّة. التدقيق يحفظ الرفض كما وقع.
            let fallback = is_native_tools_fallback(result);
            let status = match result.status {
                InvokeStatus::Completed => "COMPLETED",
                InvokeStatus::Failed if fallback => "FALLBACK",
                InvokeStatus::Failed => "FAILED",
                InvokeStatus::TimedOut => "TIMED_OUT",
                InvokeStatus::Cancelled => "CANCELLED",
                InvokeStatus::Denied => "DENIED",
            };
            let provenance_reason = if fallback { "NATIVE_TOOLS_REFUSED" } else if provenance == Provenance::ProviderReported { "TOKENS_PROVIDER_REPORTED" } else if provenance == Provenance::Estimated { "TOKENS_ESTIMATED_UPPER_BOUND" } else { "TOKENS_UNKNOWN" };
            self.observe.emit(
                EventDraft::new(Component::Model, Category::Invocation, Severity::Info, "model.invoke", status)
                    .mission(mission.as_deref(), step.as_deref(), None)
                    .duration(elapsed)
                    .reason(provenance_reason),
            );
        }

        // الصحّة من نتيجة النداء نفسه: قياس حاضر، لا ذكرى من إقلاع سابق.
        let (state, reason) = match (result.status, result.error.as_ref().map(|e| e.code)) {
            (InvokeStatus::Completed, _) => (Some(HealthState::Healthy), "CALL_COMPLETED"),
            // الرجوع المقصود إلى الصيغة النصّية لا يُخفض صحّة المزوّد: المزوّد أجاب، ورفض صيغةً بعينها.
            _ if is_native_tools_fallback(result) => (None, ""),
            (_, Some(OutcomeCode::ProviderUnreachable)) => (Some(HealthState::Unhealthy), "PROVIDER_UNREACHABLE"),
            (_, Some(OutcomeCode::ProviderTimeout)) => (Some(HealthState::Unhealthy), "PROVIDER_TIMEOUT"),
            (InvokeStatus::Failed, _) => (Some(HealthState::Degraded), "CALL_FAILED"),
            _ => (None, ""),
        };
        if let Some(state) = state {
            self.observe.health.record(HealthSubject::Provider, admission.provider_id, state, reason, now, Some(elapsed));
            let subject = format!("provider:{}", admission.provider_id);
            if state == HealthState::Unhealthy {
                if self.config.bool("providers.unhealthy_alert", &ConfigScope::global()) {
                    self.observe.raise(AlertKind::ProviderUnhealthy, AlertSeverity::Error, &subject, reason);
                }
                self.observe.emit(EventDraft::new(Component::Model, Category::Health, Severity::Error, "model.invoke", "FAILED").mission(mission.as_deref(), None, None).reason(reason));
            } else if state == HealthState::Healthy {
                self.observe.resolve(AlertKind::ProviderUnhealthy, &subject);
            }
        }
        if sent {
            if let Ok(over) = self.books.budgets.exceeded(&ctx) {
                self.alert_budgets(&over);
            }
        }
    }
}

/// هل بلغ النداء المزوّد فأنفق عنده شيئًا؟ ردّ اكتمل، أو بثّ بدأ ثم انقطع أو أُلغي. الرفض قبل الإرسال، وتعذّر الوصول، والرفض
/// بحالة HTTP قبل أي بايت من الناتج (تحديد معدّل، مفتاح مرفوض، طلب غير صالح) لا تُحسب.
fn reached_provider(result: &InvokeResult) -> bool {
    result.status == InvokeStatus::Completed || (matches!(result.status, InvokeStatus::Failed | InvokeStatus::TimedOut | InvokeStatus::Cancelled) && result.timing.first_byte.is_some())
}

/// هل هذا رفضٌ لعرض الأدوات الأصيل يكمل بعده الوكيل بالصيغة النصّية؟ الشرط نفسه الذي يطفئ به محوّل الوكيل الأدوات الأصيلة
/// (`p03/model_adapter.rs`): رفض 400 أو 422 قبل البثّ، يسمّي الأدوات أو الدوالّ، والأدوات عُرضت فعلًا.
pub fn is_native_tools_fallback(result: &InvokeResult) -> bool {
    let names_tools = result.diagnostic.as_deref().is_some_and(|d| {
        let d = d.to_ascii_lowercase();
        d.contains("tool") || d.contains("function")
    });
    result.status == InvokeStatus::Failed
        && result.native_tools_offered
        && match result.error.as_ref().map(|e| e.code) {
            Some(OutcomeCode::UnsupportedCapability) => true,
            Some(OutcomeCode::InvalidRequest) => matches!(result.http_status, Some(400 | 422)) && names_tools,
            _ => false,
        }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::p06::config::Layer;
    use crate::storage::Database;

    fn guard() -> (Arc<ConfigService>, ModelCallGuard) {
        let db = Arc::new(Database::in_memory().unwrap());
        let audit = Arc::new(AuditLedger::new(db.clone()));
        let clock = crate::p03::clock::RuntimeClock::deterministic();
        let config = Arc::new(ConfigService::new(db.clone(), audit.clone(), clock.clone()));
        let observe = Arc::new(ObservabilityService::new(Some(db.clone()), config.clone(), clock));
        let books = Arc::new(CostBooks::new(db));
        (config.clone(), ModelCallGuard::new(config, books, observe, audit))
    }

    fn admission(locality: Locality, tokens: u64) -> InvocationAdmission<'static> {
        InvocationAdmission {
            invocation_id: "11111111-1111-4111-8111-111111111111",
            provider_id: "openai",
            model_id: "openai:gpt",
            locality,
            project_id: None,
            estimated_input_tokens: tokens,
            reserved_output_tokens: 10,
        }
    }

    #[test]
    fn a_model_call_is_never_refused_for_its_locality() {
        let (_config, guard) = guard();
        assert_eq!(guard.admit(&admission(Locality::Remote, 10)), GuardVerdict::Admit, "a remote model the user chose was refused");
        assert_eq!(guard.admit(&admission(Locality::Local, 10)), GuardVerdict::Admit, "a local model the user chose was refused");
    }

    #[test]
    fn an_input_above_the_configured_limit_is_refused_before_the_call() {
        let (config, guard) = guard();
        config.set(Layer::User, None, "models.max_input_tokens_per_call", &serde_json::json!(1000), &ConfigScope::global()).unwrap();
        assert!(matches!(guard.admit(&admission(Locality::Local, 5000)), GuardVerdict::Deny(reason) if reason.starts_with("MODEL_INPUT_LIMIT")));
        assert_eq!(guard.admit(&admission(Locality::Local, 500)), GuardVerdict::Admit);
    }
}
