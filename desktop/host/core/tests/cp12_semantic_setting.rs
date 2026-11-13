// إعداد الاسترجاع الدلالي للذاكرة من الواجهة (PHASE-12 بقرار المالك): الحالة، والحفظ، والفحص، والاستمرار بعد إعادة التشغيل.
// TEST FIXTURE: خادم تضمين تجهيزة على الحلقة المحلية يعيد متجهًا ثابتًا بثلاثة أبعاد.

mod p08_support;

use serde_json::json;

use p08_support::support::{handler, MockServer, Recorded, Reply};

fn embedding_server() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/v1/embeddings" => {
            let body: serde_json::Value = serde_json::from_str(&r.body).unwrap_or_default();
            let n = body["input"].as_array().map(Vec::len).unwrap_or(1);
            let data: Vec<_> = (0..n).map(|i| json!({ "index": i, "embedding": [0.1, 0.2, 0.3] })).collect();
            Reply::Json(200, json!({ "data": data }).to_string())
        }
        _ => Reply::Json(404, "{}".into()),
    }))
}

#[test]
fn cp12_semantic_memory_is_off_until_the_user_chooses_a_local_server_and_a_model() {
    let h = p08_support::build(None);
    let status = h.ok("memory.semantic.status", json!({}));
    assert_eq!(status["enabled"], false);
    assert_eq!(status["active"], false, "semantic ranking was on before the user chose it");
    assert_eq!(status["min_similarity"], 0.6);
    // التفعيل بلا خادم ولا نموذج يُرفض، ولا يُحفظ.
    let refused = h.err("memory.semantic.set", json!({ "enabled": true }));
    assert_eq!(refused["display_message"], "desktop.error.feature_not_available", "{refused}");
    assert_eq!(h.ok("memory.semantic.status", json!({}))["enabled"], false);
    // خادم خارج هذا الجهاز يُرفض: نصّ الذاكرة لا يغادره من هذا المسار.
    let remote = h.err("memory.semantic.set", json!({ "enabled": true, "endpoint": "https://api.example.com", "model": "m" }));
    // العقد يرفضه قبل المضيف (والمضيف يفحصه مرّة ثانية عند الحفظ وعند كل استعمال).
    assert_eq!(remote["code"], "MALFORMED_MESSAGE", "{remote}");
    assert_eq!(h.ok("memory.semantic.test", json!({}))["outcome"], "NOT_CONFIGURED");
}

#[test]
fn cp12_a_chosen_local_server_turns_semantic_ranking_on_and_survives_a_restart() {
    let server = embedding_server();
    let dir = polaris_host_core::test_scratch::root().join(format!("cp12-semantic-{}", polaris_host_core::ids::new_uuid_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    {
        let h = p08_support::build_in(dir.clone());
        // عنوان بـ`/v1` كما تعرضه LM Studio وOllama: المسار `/v1/embeddings` مرّة واحدة.
        let saved = h.ok("memory.semantic.set", json!({ "enabled": true, "endpoint": format!("{}/v1", server.url()), "model": "fixture-embed", "min_similarity": 0.55, "query_prefix": "search_query: " }));
        assert_eq!(saved["enabled"], true);
        assert_eq!(saved["active"], true, "{saved}");
        assert_eq!(saved["min_similarity"], 0.55);
        // الإعداد لا يظهر في الطريق العامّ ولا يُضبط منه (له طريق واحد مفحوص).
        let general = h.ok("execution.status", json!({}));
        assert!(general["settings"].get("memory.semantic.endpoint").is_none(), "{general}");
        assert!(h.call("integration.settings.set", json!({ "key": "memory.semantic.endpoint", "value": "https://api.example.com" })).get("error").is_some(), "the generic path set a semantic key");
        let test = h.ok("memory.semantic.test", json!({}));
        assert_eq!(test["outcome"], "OK", "{test}");
        assert_eq!(test["dimensions"], 3);
        // الفحص يضمّن نصًّا ثابتًا بالبادئة المحفوظة، لا شيئًا من الذاكرة.
        let sent = server.recorded().into_iter().rfind(|r| r.path == "/v1/embeddings").expect("the server was called");
        assert!(sent.body.contains("search_query: POLARIS memory embedding check"));
    }
    {
        let h = p08_support::build_in(dir.clone());
        let status = h.ok("memory.semantic.status", json!({}));
        assert_eq!(status["active"], true, "the setting did not survive a restart: {status}");
        // التعطيل يُحفظ ويعيد الاسترجاع معجميًا فورًا.
        let off = h.ok("memory.semantic.set", json!({ "enabled": false }));
        assert_eq!(off["active"], false);
        assert_eq!(off["model"], "fixture-embed", "turning it off forgot the chosen model");
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn cp12_a_server_that_does_not_answer_is_reported_unreachable_not_ok() {
    let h = p08_support::build(None);
    // منفذ محلي لا يستمع عليه أحد.
    h.ok("memory.semantic.set", json!({ "enabled": true, "endpoint": "http://127.0.0.1:9", "model": "m" }));
    assert_eq!(h.ok("memory.semantic.test", json!({}))["outcome"], "UNREACHABLE");
}
