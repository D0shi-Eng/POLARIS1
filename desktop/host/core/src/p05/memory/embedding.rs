// التضمين للاسترجاع الدلالي (PHASE-08): منفذ، وعميل `/v1/embeddings` متوافق مع OpenAI على الحلقة المحلية، وتشابه جيب التمام.
//
// المتجه أداة ترتيب، لا حقيقة ولا ثقة: تشابه مدخل مع الطلب يقرّبه في الترتيب ولا يرفع صنف ثقته ولا تحقّقه، ولا يتجاوز النطاق
// (المرشّحون يأتون مرئيّين أصلًا). بلا منفذ، أو إن فشل المنفذ، يبقى الاسترجاع معجميًا كما كان، ويُسجَّل ذلك.
//
// بادئات المهمة (بعض النماذج تريد «search_query:» و«search_document:») تأتي من الإعداد مع النموذج، لا من الشيفرة.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use polaris_host_providers::net::endpoint;
use polaris_host_providers::net::http::HttpRequest;
use polaris_host_providers::net::{CancelToken, HttpClient, ResolvedEndpoint};

/// أقصى عدد نصوص في طلب واحد، وأقصى طول نصّ يُرسل (محارف).
pub const MAX_BATCH: usize = 32;
pub const MAX_TEXT_CHARS: usize = 2_000;
/// أقصى حجم ردّ يُقرأ.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmbeddingError {
    Unreachable(String),
    Malformed(String),
    Refused(String),
}

impl std::fmt::Display for EmbeddingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreachable(d) => write!(f, "the embedding server is unreachable: {d}"),
            Self::Malformed(d) => write!(f, "the embedding server answered in an unexpected shape: {d}"),
            Self::Refused(d) => write!(f, "the embedding request was refused: {d}"),
        }
    }
}

/// غرض النصّ: طلب يُبحث به، أو مستند يُبحث فيه.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedPurpose {
    Query,
    Document,
}

pub trait EmbeddingPort: Send + Sync {
    /// معرّف النموذج كما يُخزَّن مع المتجه: متجهان من نموذجين لا يُقارنان.
    fn model_id(&self) -> String;
    fn embed(&self, purpose: EmbedPurpose, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError>;
}

/// عميل خادم تضمين محلي (llama-server، LM Studio، Ollama بواجهة OpenAI).
pub struct OpenAiCompatibleEmbeddings {
    http: Arc<HttpClient>,
    endpoint: ResolvedEndpoint,
    model: String,
    query_prefix: String,
    document_prefix: String,
    timeout: Duration,
}

impl OpenAiCompatibleEmbeddings {
    /// العنوان على الحلقة المحلية وحدها: نصّ الذاكرة لا يغادر الجهاز إلى طرف ثالث من هذا المسار.
    pub fn new(http: Arc<HttpClient>, raw_endpoint: &str, model: impl Into<String>) -> Result<Self, EmbeddingError> {
        let endpoint = endpoint::loopback(raw_endpoint).map_err(|e| EmbeddingError::Refused(format!("{e:?}")))?;
        Ok(Self { http, endpoint, model: model.into(), query_prefix: String::new(), document_prefix: String::new(), timeout: Duration::from_secs(20) })
    }

    pub fn with_prefixes(mut self, query: impl Into<String>, document: impl Into<String>) -> Self {
        self.query_prefix = query.into();
        self.document_prefix = document.into();
        self
    }

    /// عنوان يُكتب بـ`/v1` أو بدونه (LM Studio وOllama يُعرضان عادةً بـ`/v1`): المسار `/v1/embeddings` مرّة واحدة.
    fn path(&self) -> String {
        let base = self.endpoint.base_path.trim_end_matches('/');
        format!("{}/v1/embeddings", base.strip_suffix("/v1").unwrap_or(base))
    }
}

impl EmbeddingPort for OpenAiCompatibleEmbeddings {
    fn model_id(&self) -> String {
        self.model.clone()
    }

    fn embed(&self, purpose: EmbedPurpose, texts: &[String]) -> Result<Vec<Vec<f32>>, EmbeddingError> {
        let prefix = match purpose {
            EmbedPurpose::Query => &self.query_prefix,
            EmbedPurpose::Document => &self.document_prefix,
        };
        let mut out = Vec::with_capacity(texts.len());
        for chunk in texts.chunks(MAX_BATCH) {
            let input: Vec<String> = chunk.iter().map(|t| format!("{prefix}{}", t.chars().take(MAX_TEXT_CHARS).collect::<String>())).collect();
            let body = json!({ "model": self.model, "input": input }).to_string().into_bytes();
            let request = HttpRequest {
                idle: None,
                method: "POST",
                path: self.path(),
                headers: vec![("content-type", "application/json".to_string()), ("accept", "application/json".to_string())],
                body: Some(body),
                deadline: Instant::now() + self.timeout,
            };
            let mut response = self.http.send(&self.endpoint, request, &CancelToken::new()).map_err(|e| EmbeddingError::Unreachable(e.detail))?;
            let bytes = response.body.read_all(MAX_RESPONSE_BYTES).map_err(|e| EmbeddingError::Unreachable(e.detail))?;
            if !(200..300).contains(&response.status) {
                return Err(EmbeddingError::Refused(format!("status {}", response.status)));
            }
            out.extend(parse_response(&bytes, chunk.len())?);
        }
        Ok(out)
    }
}

/// يقرأ `data[].embedding` بترتيب `index`. عدد غير مطابق، أو بُعد مختلف، أو قيمة غير منتهية = ردّ غير صالح.
pub fn parse_response(bytes: &[u8], expected: usize) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|e| EmbeddingError::Malformed(e.to_string()))?;
    let data = value.get("data").and_then(Value::as_array).ok_or_else(|| EmbeddingError::Malformed("no data array".into()))?;
    let mut rows: Vec<(usize, Vec<f32>)> = Vec::with_capacity(data.len());
    for (position, item) in data.iter().enumerate() {
        let index = item.get("index").and_then(Value::as_u64).map(|i| i as usize).unwrap_or(position);
        let vector: Vec<f32> = item
            .get("embedding")
            .and_then(Value::as_array)
            .ok_or_else(|| EmbeddingError::Malformed("an item has no embedding".into()))?
            .iter()
            .map(|x| x.as_f64().map(|f| f as f32).filter(|f| f.is_finite()))
            .collect::<Option<Vec<f32>>>()
            .ok_or_else(|| EmbeddingError::Malformed("an embedding holds a value that is not a finite number".into()))?;
        rows.push((index, vector));
    }
    rows.sort_by_key(|(i, _)| *i);
    if rows.len() != expected || rows.iter().enumerate().any(|(i, (index, _))| *index != i) {
        return Err(EmbeddingError::Malformed(format!("{} embeddings for {expected} inputs", rows.len())));
    }
    let dim = rows.first().map(|(_, v)| v.len()).unwrap_or(0);
    if dim == 0 || rows.iter().any(|(_, v)| v.len() != dim) {
        return Err(EmbeddingError::Malformed("the embeddings do not share one non-zero dimension".into()));
    }
    Ok(rows.into_iter().map(|(_, v)| v).collect())
}

/// تشابه جيب التمام في [-1, 1]؛ صفر لمتجهين مختلفي البعد أو أحدهما صفري.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let (mut dot, mut na, mut nb) = (0.0f64, 0.0f64, 0.0f64);
    for (x, y) in a.iter().zip(b) {
        dot += f64::from(*x) * f64::from(*y);
        na += f64::from(*x) * f64::from(*x);
        nb += f64::from(*y) * f64::from(*y);
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    (dot / (na.sqrt() * nb.sqrt())) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_response_is_read_by_index_and_a_mismatch_is_refused() {
        let body = br#"{"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0]}]}"#;
        assert_eq!(parse_response(body, 2).unwrap(), vec![vec![1.0, 0.0], vec![0.0, 1.0]]);
        assert!(parse_response(body, 3).is_err(), "a count that does not match the inputs was accepted");
        assert!(parse_response(br#"{"data":[{"embedding":[1,0]},{"embedding":[1]}]}"#, 2).is_err(), "two dimensions were accepted");
        assert!(parse_response(br#"{"data":[{"embedding":[]}]}"#, 1).is_err(), "an empty vector was accepted");
        assert!(parse_response(br#"{"error":"x"}"#, 1).is_err());
    }

    #[test]
    fn cosine_is_bounded_and_safe_on_bad_input() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
        assert_eq!(cosine(&[1.0], &[1.0, 0.0]), 0.0);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 0.0]), 0.0);
    }

    #[test]
    fn an_endpoint_outside_this_computer_is_refused() {
        let http = Arc::new(HttpClient::new());
        assert!(OpenAiCompatibleEmbeddings::new(http.clone(), "https://api.example.com", "m").is_err());
        assert!(OpenAiCompatibleEmbeddings::new(http, "http://127.0.0.1:8090", "m").is_ok());
    }
}
