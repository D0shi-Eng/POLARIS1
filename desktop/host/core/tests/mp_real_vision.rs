// MP-REAL-VISION — صورة ملصوقة يقرؤها نموذج رؤية حقيقي عبر البوابة الحقيقية (تكليف مكافأة Manus، 2026-10-19، بإذن المالك).
//
// لا يعمل إلا بـ`--ignored` ومع `POLARIS_MP_PROVIDER` و`POLARIS_MP_MODEL` (معرّف POLARIS الكامل) و`POLARIS_MP_ENDPOINT` اختياريًّا على
// الحلقة المحلية، و`POLARIS_MP_IMAGE` (مسار صورة الاختبار). البيانات في مجلد معزول ومخزن الاعتماد في الذاكرة. الصورة تحمل نصًّا
// معروفًا («POLARIS TEST 4721») وأشكالًا ملوّنة؛ ما يُسجَّل هو ردّ النموذج كما هو، والنجاح أن يذكر الرقم المكتوب في الصورة.

mod p08_support;

use std::time::Instant;

use serde_json::json;

use p08_support::build;

fn env(name: &str) -> String {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| panic!("{name} is required"))
}

#[test]
#[ignore]
fn mp_real_vision_a_pasted_image_is_read_by_a_real_vision_model() {
    use base64::Engine;
    let h = build(None);
    let provider = env("POLARIS_MP_PROVIDER");
    let model = env("POLARIS_MP_MODEL");
    match std::env::var("POLARIS_MP_ENDPOINT").ok().filter(|v| !v.is_empty()) {
        Some(endpoint) => h.ok("provider.configure", json!({ "provider_id": provider, "endpoint": endpoint })),
        None => h.ok("provider.configure", json!({ "provider_id": provider, "enabled": true })),
    };
    let refresh = h.ok("provider.refresh", json!({ "provider_ids": [provider] }));
    assert_eq!(refresh["results"][0]["health"]["state"], "HEALTHY", "{}", refresh["results"][0]["health"]);
    h.ok("model.configure", json!({ "model_id": model, "enabled": true }));
    let listed = h.ok("model.list", json!({}));
    let view = listed["models"].as_array().unwrap().iter().find(|m| m["model_id"] == model.as_str()).cloned().unwrap_or_default();
    let vision = view["capabilities"].as_array().into_iter().flatten().find(|c| c["capability"] == "VISION_INPUT").cloned().unwrap_or_default();
    println!("MP-REAL-VISION model={model} vision_claim={vision}");

    let bytes = std::fs::read(env("POLARIS_MP_IMAGE")).unwrap();
    let staged = h.ok("attachment.stage", json!({ "file_name": "pasted-image-20261019-230357.png", "content_base64": base64::engine::general_purpose::STANDARD.encode(&bytes) }));
    let id = h.ok("mission.create", json!({ "title": "vision", "objective": "What text is written in the attached image, and which shapes and colours does it show? Answer in two short lines.", "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("attachment.bind", json!({ "mission_id": id, "attachment_ids": [staged["attachment"]["attachment_id"]] }));
    h.ok("mission.model.set", json!({ "mission_id": id, "model_id": model }));
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let started = Instant::now();
    let run = h.call("mission.start", json!({ "mission_id": id }));
    let seconds = started.elapsed().as_secs_f64();
    let got = h.ok("mission.get", json!({ "mission_id": id }));
    let answer = got["mission"]["result_summary"].as_str().unwrap_or_default().to_string();
    let state = got["mission"]["state"].as_str().unwrap_or_default().to_string();
    println!("MP-REAL-VISION state={state} seconds={seconds:.1} answer={answer:?} run={run}");
    assert_eq!(vision["support"], "SUPPORTED", "the model does not declare vision, so no image was sent");
    assert!(answer.contains("4721"), "the model did not read the text in the image: {answer:?}");
}
