// PHASE-09 — صدق الوكيل: ما يقول الردّ إنه فعله يقابله حدث تنفيذ حقيقي، أو لا تُثبَت المهمّة (تكليف المالك 2026-10-20).
// TEST FIXTURE: النموذج مُبرمَج، والوسيط تجهيزة `s2_support`.

mod s2_support;

use serde_json::json;

use polaris_host_core::p03::mission::{CompletionProofStatus, RequirementStatus};
use s2_support::{calls, ok, text, LoopModel, World};

fn action_requirement(rt: &polaris_host_core::p03::runtime::MissionRuntime) -> Option<RequirementStatus> {
    rt.mission().requirements.iter().find(|r| r.requirement_id.starts_with('A') && !r.requirement_id.starts_with("AGENT-")).map(|r| r.status)
}

#[test]
fn cp09_a_reply_that_says_it_searched_the_web_without_a_search_is_not_proven() {
    let world = World::new();
    let mut rt = world.runtime("Write outputs/notes.md with what you know about the Riyadh metro.", ok);
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/notes.md", "content": "The Riyadh metro has six lines." }))])))
        .then(|_| Ok(text("I searched the web and saved the notes in outputs/notes.md.")));
    let report = rt.run(&model);
    assert_eq!(action_requirement(&rt), Some(RequirementStatus::Unsatisfied), "{:?}", rt.mission().requirements);
    assert_ne!(report.completion_proof.status, CompletionProofStatus::Proven);
    assert!(rt.security_events().iter().any(|e| e.kind == "ACTION_UNBACKED" && e.detail.contains("searched the web")), "{:?}", rt.security_events());
}

#[test]
fn cp09_a_reported_web_search_backed_by_a_fetched_page_is_satisfied() {
    let world = World::new();
    let mut rt = world.runtime("Read https://example.org/metro and summarise it.", |request| {
        if request.tool_id == "polaris.web.read_page" {
            ("SUCCEEDED".into(), None, Some("The Riyadh metro opened in December 2024.".to_string()))
        } else {
            ok(request)
        }
    });
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("read_web_page", json!({ "url": "https://example.org/metro" }))])))
        .then(|_| Ok(text("I searched the web: the metro opened in December 2024.")));
    rt.run(&model);
    assert_eq!(action_requirement(&rt), Some(RequirementStatus::Satisfied), "{:?}", rt.mission().requirements);
    assert!(!rt.security_events().iter().any(|e| e.kind == "ACTION_UNBACKED"));
}

#[test]
fn cp09_a_reply_that_reports_no_action_adds_no_action_requirement() {
    let world = World::new();
    let mut rt = world.runtime("Write outputs/notes.md with a greeting.", ok);
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("write_file", json!({ "path": "outputs/notes.md", "content": "hello" }))])))
        .then(|_| Ok(text("The greeting is in outputs/notes.md.")));
    rt.run(&model);
    assert_eq!(action_requirement(&rt), None);
}

#[test]
fn cp09_a_denied_search_does_not_back_a_reported_search() {
    let world = World::new();
    let mut rt = world.runtime("Read https://example.org/metro and summarise it.", |request| {
        if request.tool_id == "polaris.web.read_page" {
            ("DENIED".into(), Some("NETWORK_POLICY_DENIED".into()), None)
        } else {
            ok(request)
        }
    });
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("read_web_page", json!({ "url": "https://example.org/metro" }))])))
        .then(|_| Ok(text("I searched the web and the metro opened in 2024.")));
    rt.run(&model);
    // TOOL_DECLARED (طُلبت الأداة) ليست TOOL_EXECUTED: نداء مرفوض لا يسند قول «بحثت».
    assert_eq!(action_requirement(&rt), Some(RequirementStatus::Unsatisfied), "{:?}", rt.mission().requirements);
}
