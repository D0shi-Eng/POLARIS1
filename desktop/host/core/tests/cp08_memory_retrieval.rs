// PHASE-08 — جودة الاسترجاع بأرقام (تكليف المالك 2026-10-20): دقّة، واستدعاء، وإصابة الأوائل، وعدد تسريبات النطاق، ونجاح كشف
// التعارض، وزمن الاسترجاع، ورموز السياق. TEST FIXTURE: المجموعة والأسئلة والإجابات الصحيحة مكتوبة هنا قبل أي تشغيل.
//
// الأسئلة ثلاثة أصناف: معجمية (تشارك المدخل كلمة)، وإعادة صياغة (لا كلمة مشتركة بعد التطبيع، ومنها عربي↔إنجليزي)، وتسريب
// (الجواب في نطاق آخر، فالصحيح ألّا يُسترجع شيء منه). التفضيلات تدخل كل طلب عمدًا، فتُستبعد من الدقّة وتُحسب في الرموز.
//
// المعجمي يجري دائمًا. الهجين يحتاج خادم تضمين: `CP08_EMBEDDINGS=http://127.0.0.1:<port>` و`CP08_EMBEDDING_MODEL=<id>`،
// وبادئتان اختياريتان `CP08_QUERY_PREFIX`/`CP08_DOCUMENT_PREFIX`. `CP08_REPORT=<path>` يكتب الأرقام JSON (تحت `_local`).

mod memory_bench_support;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use memory_bench_support::dev::{self, ALPHA, BETA};
use memory_bench_support::{run, write_report, Case};
use polaris_host_core::p05::memory::embedding::{cosine, EmbedPurpose, EmbeddingPort, OpenAiCompatibleEmbeddings};
use polaris_host_core::p05::memory::model::*;
use polaris_host_core::p05::memory::retriever::{MemoryQuery, SemanticScores};
use polaris_host_providers::net::HttpClient;

#[test]
fn cp08_lexical_retrieval_quality_is_measured_and_never_leaks_a_scope() {
    let (rows, total) = run(&dev::dataset(), "lexical", &|_| (None, 0));
    write_report("cp08-lexical.json", &rows);
    assert_eq!(total.leaks, 0, "a memory from another project or another conversation was retrieved");
    assert_eq!(total.conflicts_ok, 1, "the English launch-date question must surface both dates as a conflict; the Arabic one cannot match lexically");
}

/// الهجين على خادم تضمين حقيقي. يُكتب بجانبه مسح للحدّ الأدنى للتشابه حتى لا يُختار حدّ على المجموعة نفسها دون أن يُرى أثره.
#[test]
#[ignore = "needs a local embedding server: CP08_EMBEDDINGS and CP08_EMBEDDING_MODEL"]
fn cp08_hybrid_retrieval_quality_on_a_real_embedding_model() {
    let endpoint = std::env::var("CP08_EMBEDDINGS").expect("CP08_EMBEDDINGS");
    let model = std::env::var("CP08_EMBEDDING_MODEL").expect("CP08_EMBEDDING_MODEL");
    let port = OpenAiCompatibleEmbeddings::new(Arc::new(HttpClient::new()), &endpoint, model)
        .expect("a loopback endpoint")
        .with_prefixes(std::env::var("CP08_QUERY_PREFIX").unwrap_or_default(), std::env::var("CP08_DOCUMENT_PREFIX").unwrap_or_default());
    let data = dev::dataset();
    let entries = &data.corpus;
    let began = Instant::now();
    let docs: Vec<String> = entries.iter().map(|e| format!("{}: {}", e.subject, e.content)).collect();
    let vectors = port.embed(EmbedPurpose::Document, &docs).expect("embed the corpus");
    let index_micros = began.elapsed().as_micros();
    let by_id: HashMap<String, Vec<f32>> = entries.iter().map(|e| e.memory_id.clone()).zip(vectors).collect();
    let mut queries: HashMap<&'static str, (Vec<f32>, u128)> = HashMap::new();
    for case in &data.cases {
        let began = Instant::now();
        let v = port.embed(EmbedPurpose::Query, &[case.text.to_string()]).expect("embed a query").remove(0);
        queries.insert(case.label, (v, began.elapsed().as_micros()));
    }
    let mut all_rows = vec![serde_json::json!({ "model": port.model_id(), "documents": docs.len(), "index_micros": index_micros, "dim": by_id.values().next().map(Vec::len) })];
    let (lexical, _) = run(&data, "lexical", &|_| (None, 0));
    all_rows.extend(lexical);
    for min in [0.5f32, 0.55, 0.6, 0.65, 0.7, 0.75] {
        let (rows, total) = run(&data, &format!("hybrid@{min}"), &|case: &Case| {
            let (q, micros) = &queries[case.label];
            let similarity = by_id.iter().map(|(id, v)| (id.clone(), cosine(q, v))).collect();
            (Some(SemanticScores { similarity, min_similarity: min }), *micros)
        });
        assert_eq!(total.leaks, 0, "hybrid@{min}: semantic similarity carried a memory across a scope");
        all_rows.extend(rows);
    }
    write_report("cp08-hybrid.json", &all_rows);
}

/// الخدمة نفسها (لا الترتيب وحده) على خادم تضمين حقيقي: «تذكّر هذا» بثلاث حقائق مشروع، وسؤال بصياغة أخرى، والمتجهات تُحفظ.
#[test]
#[ignore = "needs a local embedding server: CP08_EMBEDDINGS and CP08_EMBEDDING_MODEL"]
fn cp08_the_memory_service_ranks_a_paraphrase_first_on_a_real_embedding_model() {
    use polaris_host_core::audit::AuditLedger;
    use polaris_host_core::p03::clock::RuntimeClock;
    use polaris_host_core::p05::memory::service::{MemoryService, SemanticSetup};
    use polaris_host_core::storage::Database;
    let port = OpenAiCompatibleEmbeddings::new(Arc::new(HttpClient::new()), &std::env::var("CP08_EMBEDDINGS").expect("CP08_EMBEDDINGS"), std::env::var("CP08_EMBEDDING_MODEL").expect("CP08_EMBEDDING_MODEL"))
        .expect("a loopback endpoint")
        .with_prefixes(std::env::var("CP08_QUERY_PREFIX").unwrap_or_default(), std::env::var("CP08_DOCUMENT_PREFIX").unwrap_or_default());
    let db = Arc::new(Database::in_memory().expect("db"));
    let svc = MemoryService::new(db.clone(), Arc::new(AuditLedger::new(db)), RuntimeClock::deterministic());
    let backend = svc.remember("The Falcon backend runs on PostgreSQL 16", Some("falcon backend"), MemoryScope::Project, Some(ALPHA), None).unwrap().memory_id().unwrap().to_string();
    svc.remember("Sara is the lead designer of Falcon", Some("falcon designer"), MemoryScope::Project, Some(ALPHA), None).unwrap();
    svc.remember("The Oasis site keeps its records in MySQL 8", Some("oasis backend"), MemoryScope::Project, Some(BETA), None).unwrap();
    svc.set_semantic(Some(SemanticSetup { port: Arc::new(port), min_similarity: 0.6 }));
    let query = MemoryQuery { text: Some("which SQL engine stores our data".into()), ..MemoryQuery::for_mission("m-real", Some(ALPHA.into())) };
    let out = svc.retrieve(&query).expect("retrieve");
    let ids: Vec<String> = out.items.iter().map(|r| r.entry.memory_id.clone()).collect();
    println!("CP08 service: {ids:?} timings {:?}", svc.timings());
    assert_eq!(ids.first(), Some(&backend), "the paraphrase did not rank first");
    assert!(out.items.iter().all(|r| r.entry.project_id.as_deref() != Some(BETA)), "another project's memory was retrieved");
    assert_eq!(svc.store().vector_count(&backend).unwrap(), 1);
    assert_eq!(svc.timings().semantic_failures, 0);
}
