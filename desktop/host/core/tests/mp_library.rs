// MP-LIBRARY — «المكتبة» في قائمة «+»: مخرَج من مهمّة سابقة يُرفق بالرسالة الجديدة (مكافأة Manus، 2026-10-20).
//
// في Manus تحمل قائمة «+» المهارات والمهام الأخيرة والمكتبة والإنشاءات. POLARIS كان يُدرج نصّ مهمّة سابقة فقط، ولا يرفق ملفًّا
// أنتجته. العملية `attachment.artifact.stage` تنسخ ملف المخرَج من مساحة مهمّته إلى منطقة التجهيز كأيّ مرفق: العارض يسمّي المخرَج
// بمعرّفه، والمضيف وحده يعرف مساره. المجلد (موقع أو مشروع شيفرة) يُرفض، وما يحذفه الوكيل لاحقًا لا يُرفق.

mod p08_support;

use p08_support::{build, uuid};
use serde_json::json;

const OP: &str = "attachment.artifact.stage";

fn produce(h: &p08_support::Harness, mission: &str, rel: &str, bytes: &[u8], title: &str) -> String {
    let p08 = h.host().phase08().expect("phase-08");
    p08.workspaces.for_mission(mission).unwrap().write(rel, bytes).unwrap();
    p08.artifacts.register_existing(mission, rel, title, None, None).unwrap().descriptor.artifact_id
}

#[test]
fn mp_library_an_earlier_artifact_is_staged_and_bound_as_an_attachment() {
    let h = build(None);
    let earlier = uuid();
    let bytes = "# Plan\n\nخطة الربع الأول\n".as_bytes();
    let id = produce(&h, &earlier, "outputs/plan.md", bytes, "Quarter plan");
    let staged = h.ok(OP, json!({ "artifact_id": id }));
    let attachment = &staged["attachment"];
    assert_eq!(attachment["file_name"], "plan.md");
    assert_eq!(attachment["size_bytes"], bytes.len());
    assert_eq!(attachment["sha256"], polaris_host_core::digest::sha256_hex(bytes));
    assert!(attachment["mission_id"].is_null(), "a staged attachment belongs to no mission yet");

    let next = uuid();
    let attachment_id = attachment["attachment_id"].as_str().unwrap().to_string();
    let bound = h.ok("attachment.bind", json!({ "mission_id": next, "attachment_ids": [attachment_id] }));
    let workspace_ref = bound["attachments"][0]["workspace_ref"].as_str().unwrap().to_string();
    assert!(workspace_ref.starts_with("inputs/"), "{workspace_ref}");
    let p08 = h.host().phase08().unwrap();
    assert_eq!(p08.workspaces.for_mission(&next).unwrap().read(&workspace_ref, 1 << 20).unwrap(), bytes);
    assert_eq!(p08.workspaces.for_mission(&earlier).unwrap().read("outputs/plan.md", 1 << 20).unwrap(), bytes, "the earlier task's file must stay as it was");
}

#[test]
fn mp_library_a_folder_a_missing_file_and_an_unknown_id_are_refused() {
    let h = build(None);
    let earlier = uuid();
    let p08 = h.host().phase08().unwrap();
    let ws = p08.workspaces.for_mission(&earlier).unwrap();
    ws.write("outputs/site/index.html", b"<!doctype html><title>t</title>").unwrap();
    let site = p08.artifacts.register_existing(&earlier, "outputs/site", "Site", None, None).unwrap().descriptor.artifact_id;
    h.err(OP, json!({ "artifact_id": site }));

    let gone = produce(&h, &earlier, "outputs/old.md", b"old", "old.md");
    std::fs::remove_file(ws.root().join("outputs/old.md")).unwrap();
    h.err(OP, json!({ "artifact_id": gone }));

    h.err(OP, json!({ "artifact_id": uuid() }));
}

#[test]
fn mp_library_the_renderer_cannot_name_a_path() {
    let h = build(None);
    let error = h.err(OP, json!({ "artifact_id": uuid(), "path": "inputs/.polaris-credentials.txt" }));
    // الحمولة مغلقة في المخطط: حقل مسار لا يصل إلى المعالج أصلًا.
    assert_eq!(error["code"], "MALFORMED_MESSAGE", "{error}");
}
