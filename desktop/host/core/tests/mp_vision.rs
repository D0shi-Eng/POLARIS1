// MP-VISION — صورة أرفقها المستخدم تصل النموذج صورةً حين يعلن الرؤية، ولا تصل غيره (تكليف مكافأة Manus، 2026-10-19).
//
// ما قِيس قبل الإصلاح (الشيفرة على 644eeff): رسالة المزوّد نصّ فقط، فلا طريق لصورة إلى أيّ نموذج؛ وأداة القراءة تردّ على
// صورة بـ«ليست صيغة يقرؤها هذا البناء». ما تثبته هذه الاختبارات عبر البوابة الحقيقية وخادم نموذج مُبرمَج (TEST FIXTURE):
//   ١ — نموذج يعلن الرؤية (`vlm` في LM Studio) يتلقّى الصورة جزءَ `image_url` بعنوان data في رسالة الطلب، مع سطر يسمّيها.
//   ٢ — نموذج نصّي (`llm`) لا يتلقّى صورة، ويتلقّى سطر `VISION_UNSUPPORTED_BY_SELECTED_MODEL` يمنعه من التخمين.
//   ٣ — ملف PDF باسم صورة يُرفض عند الاستقبال بسبب يسمّي الصيغتين.

mod p08_support;

use std::time::Duration;

use p08_support::build;
use p08_support::support::{handler, MockServer, Recorded, Reply};
use serde_json::json;

fn fixture() -> MockServer {
    MockServer::start(handler(|r: &Recorded| match r.path.as_str() {
        "/api/v0/models" => Reply::Json(
            200,
            json!({ "data": [
                { "id": "fixture-chat", "type": "llm", "state": "loaded", "max_context_length": 32768 },
                { "id": "fixture-vision", "type": "vlm", "state": "loaded", "max_context_length": 32768 }
            ] })
            .to_string(),
        ),
        "/v1/models" => Reply::Json(200, json!({ "data": [ { "id": "fixture-chat" }, { "id": "fixture-vision" } ] }).to_string()),
        "/v1/chat/completions" => Reply::Stream {
            content_type: "text/event-stream",
            parts: vec![
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": { "content": "The image shows shapes." } } ] })),
                format!("data: {}\n\n", json!({ "id": "c", "choices": [ { "delta": {}, "finish_reason": "stop" } ], "usage": { "prompt_tokens": 20, "completion_tokens": 4 } })),
                "data: [DONE]\n\n".to_string(),
            ],
            gap: Duration::ZERO,
        },
        _ => Reply::Json(404, "{}".into()),
    }))
}

/// صورة PNG حقيقية صغيرة (1×1، بكسل أحمر) كما تلصقها لقطة شاشة.
const PNG_1X1: &[u8] = &[
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
    0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x18, 0xDD, 0x8D, 0xB0, 0x00, 0x00, 0x00,
    0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
];

fn b64(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// يرسل طلبًا مع صورة ملصوقة بالنموذج المختار، ويعيد أجسام نداءات المحادثة التي حملت هذا الطلب.
fn ask_with_image(h: &p08_support::Harness, model_id: &str, marker: &str) -> Vec<serde_json::Value> {
    let staged = h.ok("attachment.stage", json!({ "file_name": "pasted-image-20261019-190507.png", "content_base64": b64(PNG_1X1) }));
    let attachment = &staged["attachment"];
    assert_eq!(attachment["family"], "IMAGE", "{staged}");
    assert_eq!(attachment["mime_type"], "image/png");
    assert_eq!(attachment["content_check"], "MATCHED");
    assert_eq!(attachment["model_access"], "IMAGE_INPUT");
    let id = h.ok("mission.create", json!({ "title": "image", "objective": format!("{marker} What is in this image?") }))["mission_id"].as_str().unwrap().to_string();
    h.ok("attachment.bind", json!({ "mission_id": id, "attachment_ids": [attachment["attachment_id"]] }));
    h.ok("mission.model.set", json!({ "mission_id": id, "model_id": model_id }));
    h.ok("conversation.begin", json!({ "mission_id": id }));
    let _ = h.call("mission.start", json!({ "mission_id": id }));
    h.model
        .as_ref()
        .unwrap()
        .recorded()
        .into_iter()
        .filter(|r| r.path.ends_with("/chat/completions") && r.body.contains(marker))
        .map(|r| serde_json::from_str(&r.body).unwrap())
        .collect()
}

/// رسالة الطلب في نداء: آخر رسالة مستخدم يبدأ نصّها (أو جزؤها النصّي) بـ`[USER_REQUEST]`.
fn request_message(body: &serde_json::Value) -> serde_json::Value {
    body["messages"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .find(|m| {
            m["role"] == "user" && (m["content"].as_str().is_some_and(|t| t.starts_with("[USER_REQUEST]")) || m["content"][0]["text"].as_str().is_some_and(|t| t.starts_with("[USER_REQUEST]")))
        })
        .cloned()
        .unwrap_or_else(|| panic!("no request message in {body}"))
}

#[test]
fn mp_vision_a_vision_model_receives_the_pasted_image_as_an_image_part() {
    let h = build(Some(fixture()));
    h.ok("model.configure", json!({ "model_id": "lm-studio:fixture-vision", "enabled": true }));
    let bodies = ask_with_image(&h, "lm-studio:fixture-vision", "[[MP:VISION]]");
    assert!(!bodies.is_empty(), "the model was never called");
    let request = request_message(&bodies[0]);
    let parts = request["content"].as_array().unwrap_or_else(|| panic!("the request is text only: {request}"));
    assert!(parts[0]["text"].as_str().unwrap().contains("[ATTACHED_IMAGES"), "{request}");
    assert_eq!(parts[1]["type"], "image_url");
    assert_eq!(parts[1]["image_url"]["url"], format!("data:image/png;base64,{}", b64(PNG_1X1)));
}

#[test]
fn mp_vision_a_text_model_gets_no_image_and_is_told_it_cannot_see_it() {
    let h = build(Some(fixture()));
    let bodies = ask_with_image(&h, "lm-studio:fixture-chat", "[[MP:TEXT]]");
    assert!(!bodies.is_empty(), "the model was never called");
    for body in &bodies {
        assert!(!body.to_string().contains("image_url"), "an image reached a text-only model: {body}");
    }
    let request = request_message(&bodies[0]);
    let text = request["content"].as_str().unwrap();
    assert!(text.contains("VISION_UNSUPPORTED_BY_SELECTED_MODEL"), "{text}");
    assert!(text.contains("inputs/pasted-image-20261019-190507.png"), "{text}");
}

#[test]
fn mp_vision_a_pdf_renamed_to_an_image_is_refused_at_intake() {
    let h = build(None);
    let refused = h.err("attachment.stage", json!({ "file_name": "photo.png", "content_base64": b64(b"%PDF-1.7\n%fixture") }));
    // الحدّ لا يحمل نصًّا حرًّا: رفض مصنَّف، ولا شيء يُحفظ في الانتظار.
    assert_eq!(refused["code"], "VALIDATION_ERROR", "{refused}");
    let waiting = h.ok("attachment.list", json!({}));
    assert_eq!(waiting["attachments"].as_array().map(Vec::len), Some(0), "a spoofed file was staged: {waiting}");
}

/// قِيس 2026-10-19 في النسخة التنفيذية: عنوان طلب «ما المكتوب في هذه الصورة؟» صار «Text and shapes not visible in the provided image»
/// لأن نداء التسمية لا يرى الصورة. نداء التسمية يعرف الآن أسماء الصور المرفقة.
#[test]
fn mp_vision_the_title_call_knows_which_images_were_attached() {
    let h = build(Some(fixture()));
    let _ = ask_with_image(&h, "lm-studio:fixture-chat", "[[MP:TITLE]] (a request long enough to be titled)");
    let titles: Vec<String> = h.model.as_ref().unwrap().recorded().into_iter().filter(|r| r.path.ends_with("/chat/completions") && r.body.contains("You name conversations") && r.body.contains("[[MP:TITLE]]")).map(|r| r.body).collect();
    assert!(!titles.is_empty(), "no title call was made");
    assert!(titles[0].contains("pasted-image-20261019-190507.png"), "the title call does not know an image was attached: {}", titles[0]);
}
