// عمليات النماذج: القائمة، والتفعيل، والتفضيلات، والاستدعاء، والإلغاء.

use serde_json::{json, Value};

use polaris_host_providers::domain::{ChatMessage, ModelCapability, ResponseFormat, Role};

use super::input::{code, opt_bool, opt_string, opt_u64, string, strings, tri_string};
use super::to_value;
use crate::audit::{AuditEventType, AuditOutcome, AuditRecord};
use crate::ipc::errors::HostError;
use crate::p02::invocation::inflight::CancelOutcome;
use crate::p02::invocation::InvokeInput;
use crate::p02::models::listing::list_views;
use crate::p02::models::view::selectable;
use crate::p02::routing::RoutingMode;
use crate::p02::Phase02;

pub fn list(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let provider = opt_string(payload, "provider_id");
    if let Some(id) = &provider {
        p02.providers.descriptor(id)?;
    }
    let mut views = list_views(&p02.providers, &p02.secrets, &p02.models, &p02.preferences, provider.as_deref())?;
    if opt_bool(payload, "only_selectable") == Some(true) {
        views.retain(selectable);
    }
    views.truncate(4000);
    Ok(json!({ "models": to_value(&views)?, "preferences": to_value(&p02.preferences.view()?)? }))
}

pub fn configure(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    let model_id = string(payload, "model_id")?;
    let enabled = opt_bool(payload, "enabled").ok_or_else(|| HostError::validation("enabled is absent").at("/payload/enabled"))?;
    let record = p02.models.set_enabled(&model_id, enabled)?;
    p02.audit.append(&AuditRecord::new(
        if enabled { AuditEventType::ModelEnabled } else { AuditEventType::ModelDisabled },
        "model",
        record.model_id.chars().take(256).collect::<String>(),
        AuditOutcome::Success,
        json!({ "provider_id": record.provider_id }),
    ))?;
    let view = list_views(&p02.providers, &p02.secrets, &p02.models, &p02.preferences, Some(&record.provider_id))?
        .into_iter()
        .find(|v| v.model_id == model_id)
        .ok_or_else(|| HostError::internal("configured model vanished"))?;
    Ok(json!({ "model": to_value(&view)? }))
}

pub fn set_preferences(p02: &Phase02, payload: &Value) -> Result<Value, HostError> {
    if let Some(default) = tri_string(payload, "default_model_id") {
        if let Some(id) = &default {
            // الافتراضي يجب أن يسمّي نموذجًا مكتشفًا؛ لا اسم مخترع.
            if p02.models.get(id)?.is_none() {
                return Err(HostError::validation("unknown model").at("/payload/default_model_id"));
            }
        }
        p02.preferences.set_default_model(default.as_deref())?;
        p02.audit.append(&AuditRecord::new(
            AuditEventType::DefaultModelChanged,
            "preferences",
            "default_model_id",
            AuditOutcome::Success,
            json!({ "cleared": default.is_none() }),
        ))?;
    }
    // نموذج المراجِع: يختاره المستخدم صراحةً من أيّ صنف (ADR-040)، ولا يُستدعى مراجِع لم يُختَر. قيد العتاد «نموذج محلي واحد
    // في وقت واحد» تُنبّه إليه الواجهة حين يكون المراجِع نموذجًا محليًّا غير نموذج التنفيذ؛ المراجعة تأتي بعد انتهاء التنفيذ لا معه.
    if let Some(review) = tri_string(payload, "review_model_id") {
        if let Some(id) = &review {
            if p02.models.get(id)?.is_none() {
                return Err(HostError::validation("unknown model").at("/payload/review_model_id"));
            }
        }
        p02.preferences.set_review_model(review.as_deref())?;
        p02.audit.append(&AuditRecord::new(
            AuditEventType::RoutingPreferenceChanged,
            "preferences",
            "review_model_id",
            AuditOutcome::Success,
            json!({ "cleared": review.is_none() }),
        ))?;
    }
    // نموذج المراقب الأعمى (خطة 2026-10-07، ADR-041 §3.2): يختاره المستخدم صراحةً من أيّ صنف. بلا اختيار تبقى الموافقة البشرية.
    if let Some(monitor) = tri_string(payload, "monitor_model_id") {
        if let Some(id) = &monitor {
            if p02.models.get(id)?.is_none() {
                return Err(HostError::validation("unknown model").at("/payload/monitor_model_id"));
            }
        }
        p02.preferences.set_monitor_model(monitor.as_deref())?;
        p02.audit.append(&AuditRecord::new(
            AuditEventType::RoutingPreferenceChanged,
            "preferences",
            "monitor_model_id",
            AuditOutcome::Success,
            json!({ "cleared": monitor.is_none() }),
        ))?;
    }
    // جهد الاستدلال لكل المزوّدين والنماذج (2026-11-12): قيمة من قائمة مغلقة، أو null للافتراضي.
    if let Some(effort) = tri_string(payload, "reasoning_effort") {
        if let Some(level) = &effort {
            if polaris_host_providers::domain::messages::ReasoningEffort::from_preference(level).is_none() {
                return Err(HostError::validation("unknown reasoning effort").at("/payload/reasoning_effort"));
            }
        }
        p02.preferences.set_reasoning_effort(effort.as_deref())?;
        p02.audit.append(&AuditRecord::new(
            AuditEventType::RoutingPreferenceChanged,
            "preferences",
            "reasoning_effort",
            AuditOutcome::Success,
            json!({ "level": effort }),
        ))?;
    }
    Ok(json!({ "preferences": to_value(&p02.preferences.view()?)? }))
}

fn role(value: &Value) -> Result<Role, HostError> {
    match value.get("role").and_then(Value::as_str) {
        Some("USER") => Ok(Role::User),
        Some("ASSISTANT") => Ok(Role::Assistant),
        // العارض لا يكتب دور النظام ولا دور الأداة؛ المخطط يرفضه، وهنا رفض ثانٍ.
        _ => Err(HostError::validation("message role is not allowed").at("/payload/messages")),
    }
}

pub fn invoke(p02: &Phase02, payload: &Value, session: &str) -> Result<Value, HostError> {
    let messages = payload
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| HostError::validation("messages are absent").at("/payload/messages"))?
        .iter()
        .map(|m| Ok(ChatMessage::text(role(m)?, m.get("text").and_then(Value::as_str).unwrap_or_default())))
        .collect::<Result<Vec<_>, HostError>>()?;
    let required: Vec<ModelCapability> = code::<Vec<ModelCapability>>(payload, "required_capabilities")?.unwrap_or_default();
    let input = InvokeInput {
        native_tools: Vec::new(),
        invocation_id: string(payload, "invocation_id")?,
        routing_mode: code::<RoutingMode>(payload, "routing_mode")?.ok_or_else(|| HostError::validation("routing_mode is absent").at("/payload/routing_mode"))?,
        model_id: opt_string(payload, "model_id"),
        required_capabilities: required,
        project_id: opt_string(payload, "project_id"),
        context_source_ids: strings(payload, "context_source_ids"),
        messages,
        system_instruction: opt_string(payload, "system_instruction"),
        temperature: payload.get("temperature").and_then(Value::as_f64),
        max_output_tokens: opt_u64(payload, "max_output_tokens").map(|v| v.min(32_768) as u32),
        response_format: code::<ResponseFormat>(payload, "response_format")?.unwrap_or(ResponseFormat::Text),
        timeout_ms: opt_u64(payload, "timeout_ms"),
        idle_timeout_ms: None,
        fit_output_to_window: false,
        scale_output_to_model: false,
        reasoning_effort: None,
        prefer_structured_output: false,
    };
    let result = p02.invocations.invoke(input, session)?;
    to_value(&result)
}

pub fn cancel(p02: &Phase02, payload: &Value, session: &str) -> Result<Value, HostError> {
    let id = string(payload, "invocation_id")?;
    let outcome = match p02.invocations.cancel(&id, session)? {
        CancelOutcome::CancellationRequested => "CANCELLATION_REQUESTED",
        CancelOutcome::AlreadyFinished => "ALREADY_FINISHED",
        CancelOutcome::PreCancelled => "PRE_CANCELLED",
        CancelOutcome::ForeignSession => return Err(HostError::permission_denied("foreign session").at("/payload/invocation_id")),
    };
    Ok(json!({ "invocation_id": id, "outcome": outcome }))
}
