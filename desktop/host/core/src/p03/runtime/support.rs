// مساعدات زمن التشغيل الحرّة (E1: نُقلت من runtime.rs بلا تغيير سلوك).

use super::*;

/// معاينة محدودة لنصّ بلا كسر محرف.
pub(super) fn bounded_preview(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

/// حجج الأداة كما يعرضها سطر الفعل في المحادثة: الحقول التي يقرأ بها المستخدم ما فُعل (المسار، الرابط، الأمر…) أولًا
/// وحدها، كل منها سطره الأول. قِيس 2026-10-06: الحجج كاملةً مرتّبةً أبجديًّا قُصّت عند 200 حرف داخل «content» قبل
/// «path»، فظهر «كتب ملفًّا» بلا اسم الملف. حجج بلا حقل منها تُختصر كما كانت.
pub(super) fn action_preview(args: &serde_json::Value) -> String {
    const SALIENT: [&str; 9] = ["path", "url", "command", "file_name", "title", "query", "name", "script", "code"];
    if let Some(map) = args.as_object() {
        let mut picked = serde_json::Map::new();
        for key in SALIENT {
            if let Some(text) = map.get(key).and_then(serde_json::Value::as_str) {
                let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
                if !first.is_empty() {
                    picked.insert(key.to_string(), serde_json::Value::String(bounded_preview(first, 160)));
                }
            }
        }
        if !picked.is_empty() {
            return serde_json::Value::Object(picked).to_string();
        }
    }
    bounded_preview(&args.to_string(), 200)
}

#[cfg(test)]
mod action_preview_tests {
    use super::action_preview;

    #[test]
    fn the_path_survives_a_long_content_argument() {
        let args = serde_json::json!({ "content": "x".repeat(5_000), "path": "outputs/dashboard.html" });
        let shown = action_preview(&args);
        let parsed: serde_json::Value = serde_json::from_str(&shown).unwrap();
        assert_eq!(parsed["path"], "outputs/dashboard.html");
        assert!(shown.len() < 300, "the content leaked into the action line");
    }

    #[test]
    fn a_multi_line_command_keeps_its_first_line_and_unknown_shapes_fall_back() {
        let shown = action_preview(&serde_json::json!({ "command": "
  Get-ChildItem outputs
exit 0" }));
        assert!(shown.contains("Get-ChildItem outputs") && !shown.contains("exit 0"));
        assert_eq!(action_preview(&serde_json::json!({ "n": 3 })), "{\"n\":3}");
    }
}

/// أقصى طول للردّ المحفوظ في `result_summary` (حدّ العمود).
pub(super) const ANSWER_LIMIT: usize = 4000;

pub(super) fn bounded_answer(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if text.chars().count() <= ANSWER_LIMIT {
        return Some(text.to_string());
    }
    let mut cut: String = text.chars().take(ANSWER_LIMIT - 1).collect();
    cut.push('…');
    Some(cut)
}

/// الأدلّة الموثوقة مقسومة بموقفها من الادّعاء.
#[derive(Default)]
pub(super) struct TrustedSplit {
    pub(super) supports: Vec<String>,
    pub(super) counters: Vec<String>,
    /// ملاحظات مقيسة (Phase-05): معرّف الدليل ونصّ ما لوحظ. تؤيّد ادّعاءً مهيكلًا
    /// واحدًا حين تظهر قيمته فيها، ولا تؤيّد غيره.
    pub(super) observed: Vec<(String, String)>,
}

/// هل يُظهر نصُّ ملاحظةٍ قيمةَ ادّعاء مهيكل؟ مقارنة حرفية بعد توحيد المسافات وحالة
/// الأحرف، بلا تفسير: الملاحظة تؤيّد ما قالته الصفحة أو الشاشة حرفيًّا، لا ما يُستنتج منه.
pub(super) fn observation_shows(observed: &str, value: &str) -> bool {
    let normalise = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let value = normalise(value);
    // قيمة قصيرة جدًّا تطابق أي نصّ تقريبًا، فلا تُعدّ ظهورًا.
    value.chars().count() >= 3 && normalise(observed).contains(&value)
}

/// أدوات تعيد ما يحتاج الوكيل أن يراه قبل أن يُنهي: قراءة، وسرد، ومتصفّح، وتشغيل.
/// أدوات تكتب مخرَجًا في المساحة (ملفًّا أو مستندًا).
pub(super) fn is_write_tool(tool_id: &str) -> bool {
    tool_id == "polaris.workspace.write" || tool_id == "polaris.workspace.edit" || tool_id == "polaris.workspace.export" || tool_id.starts_with("polaris.artifact.")
}

/// آخر كتابة في العقدة إن رُفضت أو فشلت: الأداة وسبب البوابة. كتابة لاحقة نجحت تمحو رفضًا سابقًا.
pub(super) fn refused_write(decisions: &[ToolDecision]) -> Option<String> {
    let last = decisions.iter().rev().find(|d| is_write_tool(&d.tool_id))?;
    matches!(last.status.as_str(), "DENIED" | "FAILED" | "TIMED_OUT").then(|| format!("{} {}", last.tool_id, last.denial_reason.clone().unwrap_or_else(|| last.status.clone())))
}

/// سبب فشل محاولة كما يُعرض على محاولتها التالية: ما قاسه المضيف أولًا (كل أداة لم تنجح في هذه المحاولة بحالتها وسببها
/// وملخّصها الموثوق)، ثم ملخّص الوكيل موسومًا غير محقَّق. بسقف.
pub(super) fn attempt_failure_reason(cause: &str, agent_summary: &str, decisions: &[ToolDecision]) -> String {
    let mut out = format!("{cause}.");
    let unsuccessful: Vec<&ToolDecision> = decisions.iter().filter(|d| d.status != "SUCCEEDED").collect();
    let failed: Vec<String> = unsuccessful[unsuccessful.len().saturating_sub(4)..]
        .iter()
        .map(|d| format!("{} {}{}: {}", d.tool_id, d.status, d.denial_reason.as_deref().map(|r| format!(" {r}")).unwrap_or_default(), bounded_preview(&d.summary, 300)))
        .collect();
    if !failed.is_empty() {
        out.push_str(&format!(" Tool calls that did not succeed (measured): {}.", failed.join("; ")));
    }
    if !agent_summary.trim().is_empty() {
        out.push_str(&format!(" The agent's own summary (unverified): {}", bounded_preview(agent_summary.trim(), 400)));
    }
    bounded_preview(&out, 1_600)
}

/// أقصى عدد أسطر في قائمة «ما أُنجز».
pub(super) const MAX_DONE_ACTIONS: usize = 20;

/// أداة يُعدّ نجاحها إنجازًا لا يُعاد: كل ما ليس قراءة أو سردًا أو ملاحظة صفحة أو شاشة.
pub(super) fn is_effectful(tool_id: &str) -> bool {
    const READS: [&str; 7] = [
        "polaris.workspace.list",
        "polaris.workspace.read",
        "polaris.tool.context.read",
        "polaris.browser.read",
        "polaris.browser.screenshot",
        "polaris.browser.history",
        "polaris.browser.tabs",
    ];
    !READS.contains(&tool_id)
}

/// يميّز كل هدف مكرّر في الخطة بموضع خطوته وعنوانها، فلا تتقاسم خطوتان حالة واحدة عند المنفذ. الهدف الأول بنصّه كما هو.
pub(super) fn distinguish_objectives(nodes: &mut [TaskNode]) {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (i, node) in nodes.iter_mut().enumerate() {
        if !seen.insert(node.objective.clone()) {
            node.objective = format!("{} (step {} of the plan: {})", node.objective, i + 1, node.title);
            seen.insert(node.objective.clone());
        }
    }
}

pub(super) fn is_observational(tool_id: &str) -> bool {
    const PREFIXES: [&str; 6] = ["polaris.workspace.list", "polaris.workspace.read", "polaris.browser.", "polaris.web.", "polaris.execution.", "polaris.tool.context.read"];
    PREFIXES.iter().any(|p| tool_id.starts_with(p))
}

/// رمز ثابت لقرار تفويض مرفوض. من مفردات مغلقة، بلا تفصيل داخلي.
pub(super) fn delegation_code(decision: &DelegationDecision) -> &'static str {
    match decision {
        DelegationDecision::Approved { .. } => "APPROVED",
        DelegationDecision::DepthExceeded { .. } => "DEPTH_EXCEEDED",
        DelegationDecision::DuplicateRequest(_) => "DUPLICATE",
        DelegationDecision::RoleDisabled(_) => "ROLE_DISABLED",
    }
}

/// سبب الفشل أو الحجب كما يُحفظ مع المهمّة: رمز ثابت وتفصيل قصير بلا محتوى خام.
pub(super) fn failure_text(stop: &StopReason) -> String {
    let detail = match stop {
        StopReason::ModelOutputInvalid(d)
        | StopReason::NoModelRouted(d)
        | StopReason::GraphInvalid(d)
        | StopReason::ProviderUnavailable(d)
        | StopReason::ProviderCreditExhausted(d)
        | StopReason::DeliverablesIncomplete(d)
        | StopReason::TasksBlocked(d)
        | StopReason::TasksFailed(d)
        | StopReason::RepeatedDenials(d)
        | StopReason::TamperDetected(d)
        | StopReason::StorageFailure(d) => d.clone(),
        StopReason::BudgetExhausted(b) => format!("{b:?}"),
        _ => String::new(),
    };
    let text = if detail.is_empty() { stop_code(stop).to_string() } else { format!("{}: {detail}", stop_code(stop)) };
    // حدّ عقد العرض (MissionDetailV1.failure_reason ≤ 256): سبب أطول يُسقط قائمة المهامّ كلها عند التحقّق
    // (قِيس في انحدار Phase-03 بعد أن صار سبب المخرجات المشوّهة يحمل مقتطفًا).
    text.chars().take(FAILURE_REASON_MAX_CHARS).collect()
}

/// رمز ثابت لسبب التوقّف، يدخل الحاجز دون تفصيل داخلي.
pub(super) fn stop_code(stop: &StopReason) -> &'static str {
    match stop {
        StopReason::NoProgress => "NO_PROGRESS",
        StopReason::BudgetExhausted(_) => "BUDGET_EXHAUSTED",
        StopReason::ModelOutputInvalid(_) => "MODEL_OUTPUT_INVALID",
        StopReason::NoModelRouted(_) => "NO_MODEL_ROUTED",
        StopReason::GraphInvalid(_) => "TASK_GRAPH_INVALID",
        StopReason::Cancelled => "MISSION_CANCELLED",
        StopReason::DeadlineExceeded => "DEADLINE_EXCEEDED",
        StopReason::ProviderUnavailable(_) => "PROVIDER_UNAVAILABLE",
        StopReason::ProviderCreditExhausted(_) => "PROVIDER_CREDIT_EXHAUSTED",
        StopReason::DeliverablesIncomplete(_) => "DELIVERABLES_INCOMPLETE",
        StopReason::TasksBlocked(_) => "TASKS_BLOCKED",
        StopReason::TasksFailed(_) => "TASKS_FAILED",
        StopReason::RepeatedDenials(_) => "REPEATED_DENIALS",
        StopReason::TamperDetected(_) => "TAMPER_DETECTED",
        StopReason::StorageFailure(_) => "STORAGE_FAILURE",
    }
}

/// قاعدة التحقق بحسب نوع الادّعاء. ادّعاء الإنجاز يحتاج أثر اختبار حقيقيًّا.
pub(super) fn rule_for(claim_type: ClaimType) -> VerificationRule {
    match claim_type {
        ClaimType::Completion => VerificationRule::requires_tests("p03.rule.completion"),
        _ => VerificationRule::strict_fact("p03.rule.fact"),
    }
}
