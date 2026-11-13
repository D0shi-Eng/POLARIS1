// الامتدادات (خطة 2026-10-07، ADR-041 §3.2): شجرة لكل مهمّة بأسماء OpenTelemetry GenAI — `invoke_agent` لكل وكيل، و`chat`
// لكل نداء نموذج (ومنها المحاولات الفاشلة)، و`execute_tool` لكل أداة بقرار بوابتها.
//
// المواصفة ما زالت Development، فتُثبَّت نسخة الحقول في `SEMCONV` وفي كل صفّ؛ تغييرها قرار يُكتب في ADR-041. لا تصدير آلي:
// `to_otlp_json` يعيد صيغة OTLP/JSON لمهمّة واحدة حين يطلبها المستخدم، ولا يرسلها إلى أيّ مكان.

use std::sync::{Arc, Mutex};

use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};

use crate::storage::Database;

/// نسخة الحقول المثبَّتة.
pub const SEMCONV: &str = "gen_ai/1.37-development";

/// CP-10-1: صفحة التتبّع. قِيس أن مهمّة بستة آلاف امتداد كانت تعطي `INTERNAL_ERROR` (النتيجة تتجاوز حدّ العقد 5000)، فتختفي
/// شاشة التتبّع كلها. الصفحة الافتراضية والحدّ الأعلى هنا، والمجاميع تُحسب على كل الامتدادات في الاستعلام نفسه.
pub const TRACE_PAGE_DEFAULT: usize = 500;
pub const TRACE_PAGE_MAX: usize = 1000;

/// صفحة امتدادات مهمّة، وعددها كلها، وموضع الصفحة التالية إن بقي شيء.
#[derive(Debug, Clone, PartialEq)]
pub struct TracePage {
    pub spans: Vec<Value>,
    pub total: u64,
    pub next_after: Option<u64>,
}

/// امتداد واحد كما يُحفظ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SpanRecord {
    pub span_id: String,
    pub trace_id: String,
    pub parent_span_id: Option<String>,
    pub mission_id: String,
    /// `invoke_agent` أو `chat` أو `execute_tool`.
    pub name: &'static str,
    pub agent_id: Option<String>,
    pub task_id: Option<String>,
    pub model_id: Option<String>,
    pub provider_id: Option<String>,
    pub tool_id: Option<String>,
    pub invocation_id: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub latency_ms: Option<u64>,
    pub cost_micros: Option<u64>,
    /// OK أو ERROR أو DENIED أو AWAITING_APPROVAL أو CANCELLED.
    pub status: &'static str,
    /// قرار البوابة للأداة (السبب إن رُفضت)، أو سبب الإخفاق للنموذج.
    pub gate_decision: Option<String>,
    pub started_at: String,
}

/// منفذ الكتابة. زمن التشغيل يكتب، ولا يقرأ.
///
/// R-06 (2026-10-12): الكتابة تعيد نتيجتها. سياسة التتبّع: فشلها لا يوقف المهمّة (الامتدادات رصد لا استعادة)، لكنه يُعدّ في حالة
/// التشغيل ويُبلَّغ حدثَ أمن مرّة، فلا يمرّ صامتًا كما كان.
pub trait SpanSink: Send + Sync {
    fn record(&self, span: &SpanRecord) -> Result<(), String>;
}

/// معرّف التتبّع من معرّف المهمّة: 32 حرفًا ست عشريًّا (المهمّة UUID).
pub fn trace_id_of(mission_id: &str) -> String {
    let hex: String = mission_id.chars().filter(char::is_ascii_hexdigit).map(|c| c.to_ascii_lowercase()).collect();
    if hex.len() >= 32 {
        hex[..32].to_string()
    } else {
        crate::digest::sha256_hex(mission_id.as_bytes())[..32].to_string()
    }
}

/// معرّف امتداد جديد: 16 حرفًا ست عشريًّا.
pub fn new_span_id() -> String {
    crate::ids::new_uuid_v4().chars().filter(char::is_ascii_hexdigit).take(16).collect()
}

/// للاختبار وللقراءة في الذاكرة.
#[derive(Default)]
pub struct MemorySpans {
    spans: Mutex<Vec<SpanRecord>>,
}

impl MemorySpans {
    pub fn spans(&self) -> Vec<SpanRecord> {
        self.spans.lock().map(|s| s.clone()).unwrap_or_default()
    }
}

impl SpanSink for MemorySpans {
    fn record(&self, span: &SpanRecord) -> Result<(), String> {
        let mut spans = self.spans.lock().map_err(|_| "the span list is poisoned".to_string())?;
        match spans.iter_mut().find(|s| s.span_id == span.span_id) {
            Some(existing) => *existing = span.clone(),
            None => spans.push(span.clone()),
        }
        Ok(())
    }
}

/// الامتدادات على المخزن نفسه (جدول `spans`، v17). امتداد الوكيل يُكتب عند بدئه ثم يُحدَّث بزمنه عند نهايته.
pub struct SqliteSpans {
    db: Arc<Database>,
}

impl SqliteSpans {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }

    /// امتدادات مهمّة بترتيب بدئها، كلها (للتصدير وللاختبارات). العرض يأخذ `page_for_mission`.
    pub fn for_mission(&self, mission_id: &str) -> Vec<Value> {
        self.rows(mission_id, 0, i64::MAX)
    }

    /// صفحة بترتيب البدء: `after` امتدادًا تُتخطّى، ثم `limit` على الأكثر (يُقصّ إلى `TRACE_PAGE_MAX`).
    pub fn page_for_mission(&self, mission_id: &str, after: u64, limit: usize) -> TracePage {
        let limit = limit.clamp(1, TRACE_PAGE_MAX);
        let total: u64 = self.db.with(|conn| Ok(conn.query_row("SELECT COUNT(*) FROM spans WHERE mission_id = ?1", [mission_id], |r| r.get::<_, i64>(0))? as u64)).unwrap_or(0);
        let spans = self.rows(mission_id, after.min(i64::MAX as u64) as i64, limit as i64);
        let end = after + spans.len() as u64;
        TracePage { spans, total, next_after: (end < total).then_some(end) }
    }

    /// مجاميع مقيسة على كل امتدادات المهمّة. نداء نموذج تمّ ولم يبلّغ رموزه يُعدّ في `unreported` ولا يُجمع صفرًا (T-8).
    pub fn totals_for_mission(&self, mission_id: &str) -> Value {
        self.db
            .with(|conn| {
                Ok(conn.query_row(
                    "SELECT
                        COALESCE(SUM(name = 'invoke_agent'), 0),
                        COALESCE(SUM(name = 'chat'), 0),
                        COALESCE(SUM(name = 'execute_tool'), 0),
                        COALESCE(SUM(CASE WHEN name = 'chat' THEN input_tokens END), 0),
                        COALESCE(SUM(CASE WHEN name = 'chat' THEN output_tokens END), 0),
                        COALESCE(SUM(name = 'chat' AND status = 'OK' AND (input_tokens IS NULL OR output_tokens IS NULL)), 0),
                        COALESCE(SUM(status = 'DENIED'), 0)
                     FROM spans WHERE mission_id = ?1",
                    [mission_id],
                    |r| {
                        Ok(json!({
                            "agents": r.get::<_, i64>(0)?,
                            "model_calls": r.get::<_, i64>(1)?,
                            "tool_calls": r.get::<_, i64>(2)?,
                            "input_tokens": r.get::<_, i64>(3)?,
                            "output_tokens": r.get::<_, i64>(4)?,
                            "unreported": r.get::<_, i64>(5)?,
                            "denied": r.get::<_, i64>(6)?,
                        }))
                    },
                )?)
            })
            .unwrap_or_else(|_| json!({ "agents": 0, "model_calls": 0, "tool_calls": 0, "input_tokens": 0, "output_tokens": 0, "unreported": 0, "denied": 0 }))
    }

    fn rows(&self, mission_id: &str, offset: i64, limit: i64) -> Vec<Value> {
        self.db
            .with(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT span_id, trace_id, parent_span_id, name, agent_id, task_id, model_id, provider_id, tool_id, input_tokens, output_tokens, latency_ms, cost_micros, status, gate_decision, started_at, semconv FROM spans WHERE mission_id = ?1 ORDER BY started_at, rowid LIMIT ?2 OFFSET ?3",
                )?;
                let rows = stmt
                    .query_map(params![mission_id, limit, offset], |r| {
                        Ok(json!({
                            "span_id": r.get::<_, String>(0)?,
                            "trace_id": r.get::<_, String>(1)?,
                            "parent_span_id": r.get::<_, Option<String>>(2)?,
                            "name": r.get::<_, String>(3)?,
                            "agent_id": r.get::<_, Option<String>>(4)?,
                            "task_id": r.get::<_, Option<String>>(5)?,
                            "model_id": r.get::<_, Option<String>>(6)?,
                            "provider_id": r.get::<_, Option<String>>(7)?,
                            "tool_id": r.get::<_, Option<String>>(8)?,
                            "input_tokens": r.get::<_, Option<i64>>(9)?,
                            "output_tokens": r.get::<_, Option<i64>>(10)?,
                            "latency_ms": r.get::<_, Option<i64>>(11)?,
                            "cost_micros": r.get::<_, Option<i64>>(12)?,
                            "status": r.get::<_, String>(13)?,
                            "gate_decision": r.get::<_, Option<String>>(14)?,
                            "started_at": r.get::<_, String>(15)?,
                            "semconv": r.get::<_, String>(16)?,
                        }))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
    }
}

impl SpanSink for SqliteSpans {
    fn record(&self, s: &SpanRecord) -> Result<(), String> {
        let to_i = |v: Option<u64>| v.map(|n| n.min(i64::MAX as u64) as i64);
        self.db.with(|conn| {
            conn.execute(
                "INSERT INTO spans (span_id, trace_id, parent_span_id, mission_id, name, agent_id, task_id, model_id, provider_id, tool_id, invocation_id, input_tokens, output_tokens, latency_ms, cost_micros, status, gate_decision, started_at, semconv)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                 ON CONFLICT (span_id) DO UPDATE SET latency_ms = excluded.latency_ms, status = excluded.status, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, gate_decision = excluded.gate_decision",
                params![
                    s.span_id,
                    s.trace_id,
                    s.parent_span_id,
                    s.mission_id,
                    s.name,
                    s.agent_id,
                    s.task_id,
                    s.model_id.as_deref().map(|m| m.chars().take(200).collect::<String>()),
                    s.provider_id,
                    s.tool_id,
                    s.invocation_id,
                    to_i(s.input_tokens),
                    to_i(s.output_tokens),
                    to_i(s.latency_ms),
                    to_i(s.cost_micros),
                    s.status,
                    s.gate_decision.as_deref().map(|g| g.chars().take(80).collect::<String>()),
                    s.started_at,
                    SEMCONV,
                ],
            )?;
            Ok(())
        })
        .map_err(|e| e.to_string())
    }
}

/// صيغة OTLP/JSON (ResourceSpans) لامتدادات مهمّة واحدة، بأسماء سمات GenAI. لا تُرسل: يحفظها المستخدم إن أراد.
pub fn to_otlp_json(spans: &[Value]) -> Value {
    let attr = |key: &str, value: Value| -> Option<Value> {
        match value {
            Value::Null => None,
            Value::Number(n) => Some(json!({ "key": key, "value": { "intValue": n.to_string() } })),
            Value::String(s) => Some(json!({ "key": key, "value": { "stringValue": s } })),
            other => Some(json!({ "key": key, "value": { "stringValue": other.to_string() } })),
        }
    };
    let otlp: Vec<Value> = spans
        .iter()
        .map(|s| {
            let name = s["name"].as_str().unwrap_or_default();
            let attributes: Vec<Value> = [
                attr("gen_ai.operation.name", s["name"].clone()),
                attr("gen_ai.agent.id", s["agent_id"].clone()),
                attr("gen_ai.request.model", s["model_id"].clone()),
                attr("gen_ai.provider.name", s["provider_id"].clone()),
                attr("gen_ai.tool.name", s["tool_id"].clone()),
                attr("gen_ai.usage.input_tokens", s["input_tokens"].clone()),
                attr("gen_ai.usage.output_tokens", s["output_tokens"].clone()),
                attr("polaris.task.id", s["task_id"].clone()),
                attr("polaris.gate.decision", s["gate_decision"].clone()),
                attr("polaris.latency_ms", s["latency_ms"].clone()),
                attr("polaris.semconv", s["semconv"].clone()),
            ]
            .into_iter()
            .flatten()
            .collect();
            json!({
                "traceId": s["trace_id"],
                "spanId": s["span_id"],
                "parentSpanId": s["parent_span_id"].as_str().unwrap_or(""),
                "name": format!("{name} {}", s["model_id"].as_str().or(s["tool_id"].as_str()).unwrap_or("")).trim().to_string(),
                "kind": if name == "invoke_agent" { 1 } else { 3 },
                "attributes": attributes,
                "status": { "code": if s["status"] == "OK" { 1 } else { 2 }, "message": s["status"] },
            })
        })
        .collect();
    json!({ "resourceSpans": [ { "resource": { "attributes": [ { "key": "service.name", "value": { "stringValue": "polaris-desktop" } } ] }, "scopeSpans": [ { "scope": { "name": "polaris.watch", "version": SEMCONV }, "spans": otlp } ] } ] })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trace_id_is_32_hex_and_a_span_id_16_hex() {
        let t = trace_id_of("1bfc553a-4cdd-47ea-b0d9-c2190667826d");
        assert_eq!(t, "1bfc553a4cdd47eab0d9c2190667826d");
        let s = new_span_id();
        assert_eq!(s.len(), 16);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(trace_id_of("m-loop").len(), 32);
    }

    #[test]
    fn the_otlp_export_names_genai_attributes_and_drops_empty_ones() {
        let spans = vec![json!({ "trace_id": "a", "span_id": "b", "parent_span_id": null, "name": "chat", "agent_id": "ag", "model_id": "groq:x", "provider_id": "groq", "tool_id": null, "input_tokens": 10, "output_tokens": 5, "task_id": null, "gate_decision": null, "latency_ms": 7, "semconv": SEMCONV, "status": "OK" })];
        let out = to_otlp_json(&spans);
        let span = &out["resourceSpans"][0]["scopeSpans"][0]["spans"][0];
        assert_eq!(span["name"], "chat groq:x");
        let keys: Vec<&str> = span["attributes"].as_array().unwrap().iter().map(|a| a["key"].as_str().unwrap()).collect();
        assert!(keys.contains(&"gen_ai.usage.input_tokens") && !keys.contains(&"gen_ai.tool.name"));
    }
}
