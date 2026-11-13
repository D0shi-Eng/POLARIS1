// نقل agentmemory (2026-10-24): قياس الاسترجاع على مجموعتَي التطوير والمحجوزة معًا، بالعربية والإنجليزية. المعجمي يجري دائمًا،
// والهجين يحتاج خادم تضمين محليًّا: `CP08_EMBEDDINGS` و`CP08_EMBEDDING_MODEL` وبادئتاهما الاختياريتان كما في PHASE-08.
// `MEMBENCH_REPORT=<dir>` يكتب الأرقام JSON (تحت `_local`).

mod memory_bench_support;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use memory_bench_support::{dev, heldout, run, write_report, Case, Dataset};
use polaris_host_core::p05::memory::embedding::{cosine, EmbedPurpose, EmbeddingPort, OpenAiCompatibleEmbeddings};
use polaris_host_core::p05::memory::retriever::SemanticScores;
use polaris_host_providers::net::HttpClient;

/// حدّ التشابه المعتمد في التطبيق (PHASE-08، اختير على مجموعة التطوير).
const APP_MIN_SIMILARITY: f32 = 0.6;

#[test]
fn mt01_lexical_retrieval_on_both_sets_never_leaks_a_scope() {
    let mut rows = Vec::new();
    for data in [dev::dataset(), heldout::dataset()] {
        let (r, total) = run(&data, "lexical", &|_| (None, 0));
        assert_eq!(total.leaks, 0, "{}: a memory from another project or conversation was retrieved", data.name);
        rows.extend(r);
    }
    write_report("mt01-lexical.json", &rows);
}

fn embeddings() -> OpenAiCompatibleEmbeddings {
    OpenAiCompatibleEmbeddings::new(Arc::new(HttpClient::new()), &std::env::var("CP08_EMBEDDINGS").expect("CP08_EMBEDDINGS"), std::env::var("CP08_EMBEDDING_MODEL").expect("CP08_EMBEDDING_MODEL"))
        .expect("a loopback endpoint")
        .with_prefixes(std::env::var("CP08_QUERY_PREFIX").unwrap_or_default(), std::env::var("CP08_DOCUMENT_PREFIX").unwrap_or_default())
}

/// تضمين المدخلات والأسئلة مرّة واحدة، ثم الترتيب الهجين بحدّ التطبيق.
fn hybrid_rows(port: &OpenAiCompatibleEmbeddings, data: &Dataset) -> Vec<serde_json::Value> {
    let docs: Vec<String> = data.corpus.iter().map(|e| format!("{}: {}", e.subject, e.content)).collect();
    let vectors = port.embed(EmbedPurpose::Document, &docs).expect("embed the corpus");
    let by_id: HashMap<String, Vec<f32>> = data.corpus.iter().map(|e| e.memory_id.clone()).zip(vectors).collect();
    let mut queries: HashMap<&'static str, (Vec<f32>, u128)> = HashMap::new();
    for case in &data.cases {
        let began = Instant::now();
        let v = port.embed(EmbedPurpose::Query, &[case.text.to_string()]).expect("embed a query").remove(0);
        queries.insert(case.label, (v, began.elapsed().as_micros()));
    }
    let (rows, total) = run(data, &format!("hybrid@{APP_MIN_SIMILARITY}"), &|case: &Case| {
        let (q, micros) = &queries[case.label];
        let similarity = by_id.iter().map(|(id, v)| (id.clone(), cosine(q, v))).collect();
        (Some(SemanticScores { similarity, min_similarity: APP_MIN_SIMILARITY }), *micros)
    });
    assert_eq!(total.leaks, 0, "{}: semantic similarity carried a memory across a scope", data.name);
    rows
}

#[test]
#[ignore = "needs a local embedding server: CP08_EMBEDDINGS and CP08_EMBEDDING_MODEL"]
fn mt01_hybrid_retrieval_on_both_sets_on_a_real_embedding_model() {
    let port = embeddings();
    let mut rows = vec![serde_json::json!({ "model": port.model_id() })];
    for data in [dev::dataset(), heldout::dataset()] {
        rows.extend(hybrid_rows(&port, &data));
    }
    write_report("mt01-hybrid.json", &rows);
}
