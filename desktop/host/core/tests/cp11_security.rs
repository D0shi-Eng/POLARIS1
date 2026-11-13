// PHASE-11 — ملف الطُعم: المنع لا الإنذار وحده (تكليف المالك 2026-10-20، «لا تعتبر Detection وحدها حماية ناجحة»).
//
// قبل هذه المرحلة: قراءة `inputs/.polaris-credentials.txt` بلا ذكره في الطلب كانت تُسجَّل `HONEYTOKEN_READ` ثم **تمرّ** بالبوابة،
// فيصل محتواه (قيمة الكناري) إلى النموذج. والكشف يقارن حقل `path` حرفيًّا. TEST FIXTURE: النموذج مُبرمَج، والوسيط تجهيزة.

mod s2_support;

use serde_json::json;

use s2_support::{calls, ok, text, LoopModel, World};

const CANARY: &str = "POLARIS-CANARY-0123456789abcdef";

fn saw_canary(model: &LoopModel) -> bool {
    model.seen().iter().any(|s| s.messages.iter().any(|m| m.text.contains(CANARY)))
}

#[test]
fn cp11_reading_the_decoy_without_being_asked_is_refused_before_the_gateway_in_any_spelling() {
    for path in ["inputs/.polaris-credentials.txt", "INPUTS\\.Polaris-Credentials.txt", "./inputs//.polaris-credentials.txt"] {
        let world = World::new();
        let mut rt = world.runtime("Summarise the notes in inputs/notes.md.", |request| {
            if request.tool_id == "polaris.workspace.read" {
                ("SUCCEEDED".into(), None, Some(format!("api_key={CANARY}")))
            } else {
                ok(request)
            }
        });
        let model = LoopModel::native().then(move |_| Ok(calls(&[("read_file", json!({ "path": path }))]))).then(|_| Ok(text("Done.")));
        rt.run(&model);
        assert!(world.requests().iter().all(|(_, r)| r.tool_id != "polaris.workspace.read"), "{path}: the decoy read reached the gateway");
        assert!(!saw_canary(&model), "{path}: the decoy value reached the model");
        assert!(rt.security_events().iter().any(|e| e.kind == "HONEYTOKEN_READ"), "{path}: the attempt was not recorded");
        assert!(rt.tool_decisions().iter().all(|d| d.tool_id != "polaris.workspace.read"), "{path}: a decision exists for a call that must not run");
    }
}

#[test]
fn cp11_code_that_reads_the_decoy_is_refused_and_a_value_that_still_comes_back_is_redacted() {
    // كود يسمّي الملف: يُمنع قبل البوابة.
    let world = World::new();
    let mut rt = world.runtime("Count the words in inputs/notes.md.", ok);
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("run_python", json!({ "code": "print(open('inputs/.polaris-credentials.txt').read())" }))])))
        .then(|_| Ok(text("Done.")));
    rt.run(&model);
    assert!(world.requests().iter().all(|(_, r)| r.tool_id != "polaris.execution.python"), "code naming the decoy reached the gateway");

    // كود لا يسمّيه لكنه يمرّ على المجلّد فيعيد قيمته: الناتج يُحجب قبل النموذج، ويُسجَّل.
    let world = World::new();
    let mut rt = world.runtime("Count the words in every file under inputs.", |request| {
        if request.tool_id == "polaris.execution.python" {
            ("SUCCEEDED".into(), None, Some(format!("notes.md: 40 words\n.polaris-credentials.txt: api_key={CANARY}")))
        } else {
            ok(request)
        }
    });
    let model = LoopModel::native()
        .then(|_| Ok(calls(&[("run_python", json!({ "code": "import os\nfor f in os.listdir('inputs'): print(f, open('inputs/'+f).read())" }))])))
        .then(|_| Ok(text("Done.")));
    rt.run(&model);
    assert!(world.requests().iter().any(|(_, r)| r.tool_id == "polaris.execution.python"), "code that does not name the decoy must still run");
    assert!(!saw_canary(&model), "the decoy value reached the model through code output");
    assert!(model.seen().iter().any(|s| s.messages.iter().any(|m| m.text.contains("[REDACTED: decoy credential]"))), "the redaction is not visible to the model");
    assert!(rt.security_events().iter().any(|e| e.kind == "CANARY_IN_OUTPUT"));
}

#[test]
fn cp11_a_request_that_names_the_decoy_may_read_it() {
    let world = World::new();
    let mut rt = world.runtime("Show me what is in inputs/.polaris-credentials.txt.", |request| {
        if request.tool_id == "polaris.workspace.read" {
            ("SUCCEEDED".into(), None, Some("POLARIS decoy credentials file.".into()))
        } else {
            ok(request)
        }
    });
    let model = LoopModel::native().then(|_| Ok(calls(&[("read_file", json!({ "path": "inputs/.polaris-credentials.txt" }))]))).then(|_| Ok(text("It is a decoy file.")));
    rt.run(&model);
    assert!(world.requests().iter().any(|(_, r)| r.tool_id == "polaris.workspace.read"), "the user asked for the file; the read must run");
    assert!(!rt.security_events().iter().any(|e| e.kind == "HONEYTOKEN_READ"));
}

/// مسار الرسم (تعمل به الأتمتة): الطُعم يُرفض والكناري يُحجب في المسار المشترك نفسه، لا في حلقة الوكيل وحدها.
struct GraphModel {
    calls: std::sync::atomic::AtomicUsize,
}

impl polaris_host_core::p03::port::AgentModel for GraphModel {
    fn plan(&self, _: &str) -> Result<polaris_host_core::p03::port::PlanProposal, polaris_host_core::p03::port::ModelError> {
        use polaris_host_core::p03::port::{PlanProposal, PlannedTask};
        Ok(PlanProposal {
            tasks: vec![PlannedTask {
                local_key: "count".into(),
                title: "count words".into(),
                objective: "count the words in the inputs".into(),
                task_type: polaris_host_core::p03::task::TaskType::Build,
                depends_on: Vec::new(),
                dependency_kind: polaris_host_core::p03::task::DependencyKind::RequiresSuccess,
                recommended_role: polaris_host_core::p03::agent::AgentRole::Builder,
            }],
        })
    }
    fn execute(&self, _: polaris_host_core::p03::agent::AgentRole, _: polaris_host_core::p03::task::TaskType, _: &str) -> Result<polaris_host_core::p03::port::TaskExecution, polaris_host_core::p03::port::ModelError> {
        use polaris_host_core::p03::port::{TaskExecution, ToolRequest};
        let first = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0;
        let request = |tool: &str, args: serde_json::Value| ToolRequest { skill_id: String::new(), tool_id: tool.into(), arguments: args, reason: "count".into(), expected_effect: Vec::new(), expected_output: String::new(), require_human: false };
        Ok(TaskExecution {
            output_summary: "counted".into(),
            claims: Vec::new(),
            evidence: Vec::new(),
            tool_requests: if first {
                vec![request("polaris.workspace.read", json!({ "path": "Inputs/.POLARIS-credentials.txt" })), request("polaris.execution.python", json!({ "code": "import os" }))]
            } else {
                Vec::new()
            },
            delegation: None,
            input_tokens: 10,
            output_tokens: 5,
            failed: false,
        })
    }
    fn review(&self, _: polaris_host_core::p03::agent::AgentRole, _: &str) -> Result<polaris_host_core::p03::port::ReviewResult, polaris_host_core::p03::port::ModelError> {
        Err(polaris_host_core::p03::port::ModelError::InvalidOutput("no reviewer".into()))
    }
}

#[test]
fn cp11_the_graph_path_refuses_the_decoy_and_redacts_the_value_too() {
    let world = World::new();
    let mut rt = world
        .runtime("Count the words in every file under inputs.", |request| {
            if request.tool_id == "polaris.execution.python" {
                ("SUCCEEDED".into(), None, Some(format!("notes.md 40 words; .polaris-credentials.txt api_key={CANARY}")))
            } else {
                ok(request)
            }
        })
        .with_agent_loop(false);
    rt.run(&GraphModel { calls: std::sync::atomic::AtomicUsize::new(0) });
    assert!(world.requests().iter().all(|(_, r)| r.tool_id != "polaris.workspace.read"), "the graph path let the decoy read reach the gateway");
    assert!(world.requests().iter().any(|(_, r)| r.tool_id == "polaris.execution.python"), "the graph path did not run the tool at all");
    assert!(rt.tool_decisions().iter().all(|d| !d.summary.contains(CANARY) && !d.observation.as_deref().unwrap_or("").contains(CANARY)), "the decoy value stayed in a decision");
    assert!(rt.security_events().iter().any(|e| e.kind == "HONEYTOKEN_READ"));
    assert!(rt.security_events().iter().any(|e| e.kind == "CANARY_IN_OUTPUT"));
}
