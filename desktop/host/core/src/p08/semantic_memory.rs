// إعداد الاسترجاع الدلالي للذاكرة (PHASE-08، فُعِّل من الواجهة في PHASE-12 بقرار المالك).
//
// المستخدم يختار خادم تضمين على هذا الجهاز ونموذجه، فيُرتَّب استرجاع الذاكرة هجينًا (معجمي + تشابه). بلا اختيار صريح لا شيء
// يتغيّر: الاسترجاع معجمي، ولا نصّ ذاكرة يُرسل إلى أي نموذج. العنوان على الحلقة المحلية وحدها، يُفحص عند الحفظ وعند كل استعمال
// (`OpenAiCompatibleEmbeddings::new`). الحدّ الأدنى للتشابه يختلف بين النماذج، فهو إعداد لا ثابت (قِيس 0.6 لـnomic-embed-text-v1.5
// على مجموعة PHASE-08، وهي المجموعة نفسها التي اختير عليها).

use std::sync::Arc;
use std::time::Instant;

use serde::Serialize;
use serde_json::Value;

use polaris_host_providers::net::HttpClient;

use super::integrations::settings::Phase08Settings;
use crate::p05::memory::embedding::{EmbedPurpose, EmbeddingPort, OpenAiCompatibleEmbeddings};
use crate::p05::memory::service::{MemoryService, SemanticSetup};

pub const ENABLED: &str = "memory.semantic.enabled";
pub const ENDPOINT: &str = "memory.semantic.endpoint";
pub const MODEL: &str = "memory.semantic.model";
pub const MIN_SIMILARITY: &str = "memory.semantic.min_similarity";
pub const QUERY_PREFIX: &str = "memory.semantic.query_prefix";
pub const DOCUMENT_PREFIX: &str = "memory.semantic.document_prefix";

pub const MIN_SIMILARITY_DEFAULT: f64 = 0.6;
pub const MIN_SIMILARITY_RANGE: (f64, f64) = (0.3, 0.95);
const MAX_MODEL_CHARS: usize = 200;
const MAX_PREFIX_CHARS: usize = 40;
const TEST_TEXT: &str = "POLARIS memory embedding check";

/// ما يُعرض للمستخدم. `active`: المضيف يرتّب بالتشابه الآن (لا يكفي أن يكون الإعداد محفوظًا). العدّادان منذ بدء هذه الجلسة.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SemanticStatus {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub min_similarity: f64,
    pub query_prefix: String,
    pub document_prefix: String,
    pub active: bool,
    pub retrievals: u64,
    pub failures: u64,
}

/// نتيجة فحص الخادم: تضمين نصّ ثابت لا يأتي من الذاكرة. الرموز مغلقة ومطابقة لعقد `MemorySemanticTestResultV1`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SemanticTest {
    pub outcome: &'static str,
    pub dimensions: Option<u32>,
    pub duration_ms: u64,
}

/// ما يحفظه المستخدم. ما لم يُرسل يبقى كما كان.
#[derive(Debug, Clone, Default)]
pub struct SemanticInput {
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub min_similarity: Option<f64>,
    pub query_prefix: Option<String>,
    pub document_prefix: Option<String>,
}

fn read_f64(settings: &Phase08Settings, key: &str) -> Option<f64> {
    settings.get(key).and_then(|v| v.as_f64())
}

fn prefix(settings: &Phase08Settings, key: &str) -> String {
    settings.get(key).and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
}

pub fn status(settings: &Phase08Settings, memory: Option<&Arc<MemoryService>>) -> SemanticStatus {
    let timings = memory.map(|m| m.timings()).unwrap_or_default();
    SemanticStatus {
        enabled: settings.get(ENABLED).and_then(|v| v.as_bool()).unwrap_or(false),
        endpoint: settings.get_str(ENDPOINT),
        model: settings.get_str(MODEL),
        min_similarity: read_f64(settings, MIN_SIMILARITY).unwrap_or(MIN_SIMILARITY_DEFAULT),
        query_prefix: prefix(settings, QUERY_PREFIX),
        document_prefix: prefix(settings, DOCUMENT_PREFIX),
        active: memory.is_some_and(|m| m.semantic_model().is_some()),
        retrievals: timings.semantic_retrievals,
        failures: timings.semantic_failures,
    }
}

/// يتحقّق ويحفظ. التفعيل يحتاج عنوانًا على هذا الجهاز ونموذجًا؛ والتعطيل يُحفظ دائمًا.
pub fn save(settings: &Phase08Settings, input: &SemanticInput, now: &str) -> Result<(), String> {
    if let Some(endpoint) = input.endpoint.as_deref().filter(|e| !e.trim().is_empty()) {
        polaris_host_providers::net::endpoint::loopback(endpoint.trim()).map_err(|_| "POLICY: the embedding server must be on this computer".to_string())?;
    }
    if let Some(model) = &input.model {
        if model.chars().count() > MAX_MODEL_CHARS || model.chars().any(char::is_control) {
            return Err("the model id is not valid".into());
        }
    }
    if let Some(min) = input.min_similarity {
        if !(MIN_SIMILARITY_RANGE.0..=MIN_SIMILARITY_RANGE.1).contains(&min) {
            return Err(format!("the similarity threshold must be between {} and {}", MIN_SIMILARITY_RANGE.0, MIN_SIMILARITY_RANGE.1));
        }
    }
    for p in [&input.query_prefix, &input.document_prefix].into_iter().flatten() {
        if p.chars().count() > MAX_PREFIX_CHARS || p.chars().any(|c| c.is_control()) {
            return Err("a task prefix is not valid".into());
        }
    }
    let endpoint = input.endpoint.clone().map(|e| e.trim().to_string()).or_else(|| settings.get_str(ENDPOINT));
    let model = input.model.clone().map(|m| m.trim().to_string()).or_else(|| settings.get_str(MODEL));
    if input.enabled && (endpoint.as_deref().unwrap_or("").is_empty() || model.as_deref().unwrap_or("").is_empty()) {
        return Err("not configured: choose an embedding server on this computer and its model first".into());
    }
    settings.set(ENABLED, &Value::Bool(input.enabled), now)?;
    if let Some(e) = &input.endpoint {
        settings.set(ENDPOINT, &Value::String(e.trim().to_string()), now)?;
    }
    if let Some(m) = &input.model {
        settings.set(MODEL, &Value::String(m.trim().to_string()), now)?;
    }
    if let Some(min) = input.min_similarity {
        settings.set(MIN_SIMILARITY, &serde_json::json!(min), now)?;
    }
    if let Some(p) = &input.query_prefix {
        settings.set(QUERY_PREFIX, &Value::String(p.clone()), now)?;
    }
    if let Some(p) = &input.document_prefix {
        settings.set(DOCUMENT_PREFIX, &Value::String(p.clone()), now)?;
    }
    Ok(())
}

fn port(settings: &Phase08Settings, http: &Arc<HttpClient>) -> Option<OpenAiCompatibleEmbeddings> {
    let endpoint = settings.get_str(ENDPOINT)?;
    let model = settings.get_str(MODEL)?;
    OpenAiCompatibleEmbeddings::new(http.clone(), &endpoint, model).ok().map(|p| p.with_prefixes(prefix(settings, QUERY_PREFIX), prefix(settings, DOCUMENT_PREFIX)))
}

/// يضع على الذاكرة ما يقوله الإعداد المحفوظ: نموذج التضمين إن كان مفعّلًا وصالحًا، وإلا لا شيء (معجمي).
pub fn apply(settings: &Phase08Settings, memory: &MemoryService, http: &Arc<HttpClient>) {
    let on = settings.get(ENABLED).and_then(|v| v.as_bool()).unwrap_or(false);
    let setup = if on {
        port(settings, http).map(|p| SemanticSetup { port: Arc::new(p) as Arc<dyn EmbeddingPort>, min_similarity: read_f64(settings, MIN_SIMILARITY).unwrap_or(MIN_SIMILARITY_DEFAULT) as f32 })
    } else {
        None
    };
    memory.set_semantic(setup);
}

/// يضمّن نصًّا ثابتًا بالخادم المحفوظ، ولا يمسّ الذاكرة.
pub fn test(settings: &Phase08Settings, http: &Arc<HttpClient>) -> SemanticTest {
    let Some(port) = port(settings, http) else {
        return SemanticTest { outcome: "NOT_CONFIGURED", dimensions: None, duration_ms: 0 };
    };
    let started = Instant::now();
    let result = port.embed(EmbedPurpose::Query, &[TEST_TEXT.to_string()]);
    let duration_ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(vectors) => SemanticTest { outcome: "OK", dimensions: vectors.first().map(|v| v.len() as u32), duration_ms },
        Err(crate::p05::memory::embedding::EmbeddingError::Unreachable(_)) => SemanticTest { outcome: "UNREACHABLE", dimensions: None, duration_ms },
        Err(crate::p05::memory::embedding::EmbeddingError::Malformed(_)) => SemanticTest { outcome: "MALFORMED_RESPONSE", dimensions: None, duration_ms },
        Err(crate::p05::memory::embedding::EmbeddingError::Refused(_)) => SemanticTest { outcome: "REFUSED", dimensions: None, duration_ms },
    }
}
