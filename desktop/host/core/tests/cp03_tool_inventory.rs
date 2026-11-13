// CP-03-a — جرد الأدوات المعروضة على النموذج وكلفتها في نافذته (تكليف المالك 2026-10-20، PHASE-03-TOOLS).
//
// القائمة تُبنى كما يبنيها `loop_tools` للمنسّق: أدوات المهارة الافتراضية من السجلّ، بوصفها من دليل الأدوات ومخطّطها من المحوّل،
// ثم أدوات زمن التشغيل (الخطة، التفويض، العمل المباشر). الكلفة بالصيغة نفسها التي يحسب بها توجيه Phase-02 تعريفات الأدوات الأصيلة
// (`p02/invocation/service.rs`): (الاسم + الوصف + المخطط + 32) بايت، مقسومة على أربعة. تقدير، ويُوسم كذلك.
//
// `CP03_TOOLS_REPORT=<path>` يكتب الجدول JSON (يُحفظ تحت `_local`، لا يُرفع).

mod p08_support;

use polaris_host_core::p03::agent_loop::{self as al, LoopTool};
use polaris_host_core::p08::service::SKILL_AGENTIC_WORK;

/// كلفة أداة كما يحسبها التوجيه.
fn tool_bytes(t: &LoopTool) -> usize {
    t.name.len() + t.description.len() + t.parameters.to_string().len() + 32
}

/// قائمة المنسّق كما يبنيها `loop_tools`: أدوات زمن التشغيل ثم أدوات السجلّ بأسمائها القصيرة.
fn coordinator_tools(h: &p08_support::Harness) -> (Vec<LoopTool>, Vec<String>) {
    let p04 = h.host().phase04().expect("phase-04");
    let mut tools = vec![al::plan_tool(), al::delegate_tool(), al::direct_tool()];
    let mut missing = Vec::new();
    for tool_id in p04.tools_for_skill(SKILL_AGENTIC_WORK) {
        let name = al::loop_tool_name(&tool_id);
        if tools.iter().any(|t| t.name == name) {
            continue;
        }
        let guide = p04.tool_guide_entry(&tool_id);
        let schema = p04.tool_input_schema(&tool_id);
        if guide.is_none() || schema.is_none() {
            missing.push(format!("{tool_id} guide={} schema={}", guide.is_some(), schema.is_some()));
        }
        tools.push(LoopTool {
            name,
            description: guide.unwrap_or_else(|| tool_id.clone()),
            parameters: schema.unwrap_or_else(|| serde_json::json!({ "type": "object" })),
            tool_id: Some(tool_id),
        });
    }
    (tools, missing)
}

#[test]
fn cp03_every_offered_tool_has_a_guide_and_a_schema_and_its_cost_is_measured() {
    let h = p08_support::build(None);
    let (tools, missing) = coordinator_tools(&h);
    let rows: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "tool_id": t.tool_id,
                "description_bytes": t.description.len(),
                "schema_bytes": t.parameters.to_string().len(),
                "estimated_tokens": tool_bytes(t).div_ceil(4),
            })
        })
        .collect();
    let total_bytes: usize = tools.iter().map(tool_bytes).sum();
    let total_tokens = total_bytes.div_ceil(4);
    let report = serde_json::json!({
        "skill": SKILL_AGENTIC_WORK,
        "tools": rows.len(),
        "total_bytes": total_bytes,
        "estimated_tokens": { "value": total_tokens, "provenance": "ESTIMATED", "method": "UTF8_BYTES_DIV_4" },
        "without_schema": missing,
        "rows": rows,
    });
    if let Ok(path) = std::env::var("CP03_TOOLS_REPORT") {
        std::fs::write(&path, serde_json::to_string_pretty(&report).expect("json")).expect("write the report");
    }
    println!("CP03 offered tools: {} | estimated tokens: {total_tokens} | without schema: {}", tools.len(), missing.len());
    // CP-03-1: أداة بلا وصف أو بلا مخطّط تُعرض باسمها و`{"type":"object"}`: في الاستدعاء الأصيل لا يعرف النموذج أسماء وسائطها.
    assert!(missing.is_empty(), "offered tools without a guide entry or an input schema: {missing:?}");
}

/// ما يتلقّاه المنسّق بعد الاختيار بحسب المهمّة (CP-03-b)، لطلبات ممثِّلة. `CP03_SELECTION_REPORT=<path>` يكتب الجدول.
#[test]
fn cp03_selection_cuts_the_tool_cost_for_requests_that_do_not_need_every_group() {
    use polaris_host_core::p03::tool_selection as ts;
    let h = p08_support::build(None);
    let (all, _) = coordinator_tools(&h);
    let full: usize = all.iter().map(tool_bytes).sum::<usize>().div_ceil(4);
    let requests = [
        ("greeting_ar", "هلا"),
        ("question_en", "What is the difference between TCP and UDP?"),
        ("document_ar", "اكتب تقريرًا في ملف وورد عن خطة الانتقال إلى المكتب الجديد"),
        ("spreadsheet_en", "Create outputs/budget.xlsx with a monthly budget and a chart"),
        ("web_research_ar", "ابحث عن أحدث أسعار الذهب اليوم ولخّصها"),
        ("research_pdf_en", "Search the web for recent EU AI Act news and write a PDF report"),
        ("code_en", "Run a python script that parses data.csv and prints the totals"),
        ("everything", "ابحث في الويب وشغّل بايثون واكتب تقرير docx عن مستودع GitHub"),
    ];
    let mut rows = Vec::new();
    for (label, objective) in requests {
        let (mut offered, deferred) = ts::select(all.clone(), objective, &[]);
        offered.extend(ts::load_tool(&deferred));
        // كل أداة مؤجَّلة يسمّيها `load_tools`، فلا قدرة تختفي عن النموذج.
        let index = offered.iter().find(|t| t.name == ts::LOAD_TOOLS);
        for t in &deferred {
            assert!(index.is_some_and(|i| i.description.contains(&t.name)), "{label}: {} is deferred but not named in load_tools", t.name);
        }
        let tokens = offered.iter().map(tool_bytes).sum::<usize>().div_ceil(4);
        assert!(tokens <= full + 200, "{label}: the selection costs more than the full list");
        rows.push(serde_json::json!({ "request": label, "offered": offered.len(), "deferred": deferred.len(), "estimated_tokens": tokens, "groups": ts::wanted_groups(objective).iter().map(|g| g.as_str()).collect::<Vec<_>>() }));
        println!("CP03 {label:16} offered {:2} deferred {:2} tokens {tokens:5} (full {full})", offered.len(), deferred.len());
    }
    if let Ok(path) = std::env::var("CP03_SELECTION_REPORT") {
        std::fs::write(&path, serde_json::to_string_pretty(&serde_json::json!({ "full_tokens": full, "method": "UTF8_BYTES_DIV_4", "rows": rows })).expect("json")).expect("write the report");
    }
    // التحية لا تحمل أدوات المستندات ولا التشغيل ولا الويب.
    let greeting = rows[0]["estimated_tokens"].as_u64().unwrap_or(u64::MAX) as usize;
    assert!(greeting * 2 < full, "a greeting still carries more than half of the full tool cost: {greeting} of {full}");
}

/// PHASE-07: قائمة المساعد المفوَّض (أدوات السجلّ بلا الخطة والتفويض، كما يبنيها `loop_tools` للمساعد) قبل الاختيار وبعده،
/// على أهداف فوّضها Bonsai 2 فعلًا في تشغيل 2026-10-20 (مختصرة). `CP07_HELPER_REPORT=<path>` يكتب الجدول.
#[test]
fn cp07_a_delegated_helper_pays_only_for_the_tools_its_objective_needs() {
    use polaris_host_core::p03::tool_selection as ts;
    let h = p08_support::build(None);
    let (all, _) = coordinator_tools(&h);
    let helper: Vec<LoopTool> = all.into_iter().filter(|t| t.tool_id.is_some()).collect();
    let full: usize = helper.iter().map(tool_bytes).sum::<usize>().div_ceil(4);
    let objectives = [
        ("walking_docx_ar", "اكتب ملخصًا من صفحة واحدة باللغة العربية عن فوائد المشي، ثم احفظه كملف Microsoft Word (.docx)"),
        ("security_pptx_ar", "أنشئ عرضًا تقديميًا (PowerPoint) من 5 شرائح عن الأمن السيبراني للمبتدئين باللغة العربية"),
        ("falcon_create_en", "Create a short PowerPoint deck named falcon-plan.pptx with exactly 3 slides: a title slide, the three phases, the two features"),
        ("falcon_edit_en", "Add exactly one new slide to the existing deck at outputs/falcon-plan.pptx, making it slide 4, titled Next steps"),
    ];
    let mut rows = Vec::new();
    for (label, objective) in objectives {
        let (mut offered, deferred) = ts::select(helper.clone(), objective, &[]);
        offered.extend(ts::load_tool(&deferred));
        let tokens = offered.iter().map(tool_bytes).sum::<usize>().div_ceil(4);
        rows.push(serde_json::json!({ "objective": label, "offered": offered.len(), "deferred": deferred.len(), "estimated_tokens": tokens, "full_tokens": full }));
        println!("CP07 {label:18} offered {:2} deferred {:2} tokens {tokens:5} (helper full {full})", offered.len(), deferred.len());
        // مستند يُطلب ⇒ أدوات المستندات معروضة، والقائمة أرخص من كاملها.
        assert!(offered.iter().any(|t| t.tool_id.as_deref().is_some_and(|id| ts::group_of_id(id) == ts::ToolGroup::Documents)), "{label}: no document tool offered");
        assert!(tokens < full, "{label}: the helper selection is not cheaper than its full list ({tokens} of {full})");
    }
    if let Ok(path) = std::env::var("CP07_HELPER_REPORT") {
        std::fs::write(&path, serde_json::to_string_pretty(&serde_json::json!({ "method": "UTF8_BYTES_DIV_4", "rows": rows })).expect("json")).expect("write the report");
    }
}

/// PHASE-07: في تشغيل Bonsai 2 (2026-10-21، النسخة db8b84ac) فوّض المنسّق أربع مرات، وكل مساعد كان وكيلًا من الدليل. قائمة هذا
/// الوكيل (`loop_tools` يرشّحها بـ`allows`) قبل الاختيار بهدفه المفوَّض وبعده، بالأهداف كما أرسلها النموذج (مختصرة).
#[test]
fn cp07_catalog_agents_from_the_real_run_before_and_after_selection() {
    use polaris_host_core::p03::agents::AgentDirectory;
    use polaris_host_core::p03::tool_selection as ts;
    let h = p08_support::build(None);
    let (all, _) = coordinator_tools(&h);
    let directory = AgentDirectory::builtin();
    let runs = [
        ("agent.writing.summarizer", "اكتب ملخصًا من صفحة واحدة عن فوائد النوم المبكر واحفظه في ملف وورد outputs/sleep.docx"),
        ("agent.design-media.presentation-designer", "أنشئ عرضًا تقديميًا من 3 شرائح outputs/sleep.pptx عن فوائد النوم المبكر"),
        ("agent.data-ai.data-analyst", "أنشئ ملف CSV في المسار outputs/expenses.csv يحتوي على مصروفات أسرة لستة أشهر، واحسب المجموع والمتوسط لكل بند"),
        ("agent.writing.report-writer", "اكتب تقرير وورد احترافي بالعربية في المسار outputs/expenses.docx بعنوان تقرير مصروفات الأسرة"),
    ];
    for (agent, objective) in runs {
        let definition = directory.get(agent).expect("the agent exists");
        let allowed: Vec<LoopTool> = all.iter().filter(|t| t.tool_id.as_deref().is_some_and(|id| definition.allows(id))).cloned().collect();
        let before = allowed.iter().map(tool_bytes).sum::<usize>().div_ceil(4);
        let (mut offered, deferred) = ts::select(allowed.clone(), objective, &[]);
        offered.extend(ts::load_tool(&deferred));
        let after = offered.iter().map(tool_bytes).sum::<usize>().div_ceil(4);
        println!("CP07 {agent:42} allowed {:2} offered {:2} deferred {:2} tokens {before:5} -> {after:5}", allowed.len(), offered.len(), deferred.len());
        assert!(after <= before + 200, "{agent}: the selection costs more than the allowlist");
    }
}
