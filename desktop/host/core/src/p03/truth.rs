// طبقة الحقيقة (خطة 2026-10-07، ADR-041 §3.3): مصحِّحات النتائج بالكود، وثوابت الحالة.
//
// «مكتملة» ليست «مُثبَتة». الإثبات من القياس وحده: ما قاسه المضيف في المساحة وسجلّ البوابة، وما حكم به مصحِّح كود على المحتوى.
// حكم النموذج على المعنى يبقى صنفه ظاهرًا (MODEL_JUDGMENT) ولا يُخلط بالقياس.

use crate::p03::contract::RequirementKind;
use crate::p03::graph::TaskGraph;
use crate::p03::mission::MissionState;
use crate::p03::task::TaskState;
use crate::p03::trust::probe::normalize;

/// كلمات تسمّي نصًّا مطلوبًا حرفيًّا قبل اقتباسه: «titled 'X'»، «بعنوان "X"».
const NAMING: [&str; 12] = ["titled", "title", "heading", "named", "called", "caption", "بعنوان", "عنوانه", "عنوانها", "العنوان", "اسمه", "باسم"];

/// النصوص المطلوبة حرفيًّا في المخرَج: ما وضعه المستخدم بين علامتي اقتباس وسمّاه عنوانًا أو اسمًا قبله بثلاث كلمات على
/// الأكثر. قالب فيه حرف واحد كبير متغيّر («count: N») ليس نصًّا مطلوبًا. حتمي.
pub fn required_texts(objective: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let chars: Vec<char> = objective.chars().collect();
    let pairs = [('\'', '\''), ('"', '"'), ('«', '»'), ('“', '”'), ('‘', '’')];
    let mut i = 0;
    while i < chars.len() {
        let Some((_, close)) = pairs.iter().find(|(open, _)| *open == chars[i]) else {
            i += 1;
            continue;
        };
        // فاصلة عليا داخل كلمة (user's) ليست اقتباسًا.
        if chars[i] == '\'' && i > 0 && chars[i - 1].is_alphanumeric() {
            i += 1;
            continue;
        }
        let Some(len) = chars[i + 1..].iter().position(|c| c == close) else { break };
        let quoted: String = chars[i + 1..i + 1 + len].iter().collect();
        let before: String = chars[..i].iter().collect();
        let words: Vec<String> = before.split_whitespace().rev().take(3).map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()).collect();
        let named = words.iter().any(|w| NAMING.contains(&w.as_str()));
        let template = quoted.split_whitespace().any(|w| w.len() == 1 && w.chars().all(|c| c.is_ascii_uppercase())) || quoted.contains('<') || quoted.contains('{');
        let quoted = quoted.trim().to_string();
        if named && !template && quoted.chars().count() >= 3 && quoted.chars().count() <= 120 && !out.contains(&quoted) {
            out.push(quoted);
        }
        i += len + 2;
    }
    out
}

/// هل يحوي النصّ المستخرج من المخرَج النصَّ المطلوب؟ بلا حالة ولا تشكيل ولا مسافات زائدة.
pub fn contains_text(haystack: &str, needle: &str) -> bool {
    let needle = normalize(needle);
    !needle.is_empty() && normalize(haystack).contains(&needle)
}

/// مصحِّح الويب: اقتباس في الردّ مربوط بصفحة جُلبت فعلًا يوجد فيها حرفيًّا (بعد التطبيع). نمط CitationAgent عند Anthropic.
pub fn citation_grounded(quote: &str, fetched: &[String]) -> bool {
    quote.chars().count() >= 8 && fetched.iter().any(|page| contains_text(page, quote))
}

/// الاقتباسات في ردّ الوكيل: ما بين «» أو "" بطول ثماني أحرف فأكثر.
pub fn quotes_in(answer: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (open, close) in [('«', '»'), ('"', '"'), ('“', '”')] {
        let mut rest = answer;
        while let Some(start) = rest.find(open) {
            let after = &rest[start + open.len_utf8()..];
            let Some(end) = after.find(close) else { break };
            let quote = after[..end].trim();
            if quote.chars().count() >= 8 {
                out.push(quote.to_string());
            }
            rest = &after[end + close.len_utf8()..];
        }
    }
    out
}

/// خاصية الادّعاء البنيوي وقيمته لمتطلَّب من العقد. المفردات من `verification::STRUCTURAL_PROPERTIES`.
pub fn requirement_property(kind: &RequirementKind) -> (&'static str, String) {
    match kind {
        RequirementKind::Artifact { format, .. } => ("format", format.as_str().to_string()),
        RequirementKind::ChartIn { .. } => ("charts", "chart part present".into()),
        RequirementKind::ExecutedCode { tool_id } => ("observed", format!("{tool_id} ran")),
        RequirementKind::TestsPassing => ("tests_passed", "latest test run passed".into()),
        RequirementKind::NetworkProposal => ("observed", "network step reached the approval path".into()),
        RequirementKind::BrowserVisit { .. } => ("observed", "page opened in the real browser".into()),
    }
}

/// PHASE-09 (صدق الوكيل): فعلٌ يقول الردّ إنه جرى، ويجب أن يقابله حدث تنفيذ حقيقي في المهمّة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ActionClaim {
    SearchedWeb,
    OpenedPage,
    ReadEmail,
    RanTestsPassing,
    RanCode,
    UsedConnector,
    WorkedInParallel,
}

impl ActionClaim {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SearchedWeb => "searched the web",
            Self::OpenedPage => "opened a page",
            Self::ReadEmail => "read email",
            Self::RanTestsPassing => "ran tests that passed",
            Self::RanCode => "ran code",
            Self::UsedConnector => "used a connector",
            Self::WorkedInParallel => "worked in parallel",
        }
    }
}

/// العبارات بعد التطبيع (`normalize`: حروف صغيرة، بلا تشكيل، همزات موحّدة). قائمة مغلقة صغيرة: ما لا تلتقطه لا يُدّعى عليه
/// شيء، وما تلتقطه بلا حدث يُبقي المهمّة غير مُثبَتة (خطأ في اتجاه التحفّظ).
const ACTION_PHRASES: [(ActionClaim, &[&str]); 7] = [
    (ActionClaim::SearchedWeb, &["searched the web", "searched online", "searched the internet", "web search", "بحثت في الويب", "بحثت في الانترنت", "بحثت على الانترنت", "بحثت عبر الانترنت", "بحث في الويب"]),
    (ActionClaim::OpenedPage, &["opened the page", "visited the page", "visited the site", "browsed to", "فتحت الصفحه", "فتحت الموقع", "زرت الموقع", "زرت الصفحه"]),
    (ActionClaim::ReadEmail, &["read your email", "read your emails", "checked your inbox", "read the email", "قرات بريدك", "راجعت بريدك", "قرات الرساله الالكترونيه", "اطلعت على بريدك"]),
    (ActionClaim::RanTestsPassing, &["all tests pass", "tests passed", "tests pass", "the tests are passing", "نجحت الاختبارات", "نجحت جميع الاختبارات", "الاختبارات ناجحه", "اجتازت الاختبارات"]),
    (ActionClaim::RanCode, &["ran the script", "ran the code", "executed the code", "executed the script", "شغلت السكربت", "شغلت الكود", "نفذت الكود", "نفذت السكربت"]),
    (ActionClaim::UsedConnector, &["connected to slack", "connected to notion", "connected to gmail", "connected to outlook", "via the slack connector", "via the notion connector", "اتصلت بسلاك", "اتصلت بنوشن", "عبر موصل"]),
    (ActionClaim::WorkedInParallel, &["in parallel", "simultaneously", "at the same time", "بالتوازي", "في نفس الوقت", "في الوقت نفسه", "بشكل متواز"]),
];

/// نفيٌ قبل العبارة بقليل يُسقطها: «لم أبحث في الويب»، «I did not search».
const NEGATIONS: [&str; 8] = ["not ", "n't ", "never ", "without ", "لم ", "لا ", "دون ", "بدون "];

/// الأفعال التي يدّعيها الردّ، مرتّبة بلا تكرار. حتمي.
pub fn action_claims(answer: &str) -> Vec<ActionClaim> {
    let text = normalize(answer);
    let mut out = Vec::new();
    for (claim, phrases) in ACTION_PHRASES {
        let found = phrases.iter().any(|phrase| {
            let phrase = normalize(phrase);
            text.match_indices(phrase.as_str()).any(|(at, _)| {
                let before: String = text[..at].chars().rev().take(14).collect::<Vec<_>>().into_iter().rev().collect();
                !NEGATIONS.iter().any(|n| before.contains(n))
            })
        });
        if found {
            out.push(claim);
        }
    }
    out
}

/// ما نُفّذ فعلًا في المهمّة، كما سجّلته البوابة: أدوات نجحت، وهل نجح تشغيل اختبارات، وهل جرت تفويضات معًا.
#[derive(Debug, Clone, Default)]
pub struct ExecutedActions {
    pub succeeded_tools: Vec<String>,
    pub tests_passed: bool,
    pub parallel_rounds: usize,
}

/// هل يسند حدثٌ حقيقي هذا الادّعاء؟
pub fn action_backed(claim: ActionClaim, done: &ExecutedActions) -> bool {
    let any = |f: &dyn Fn(&str) -> bool| done.succeeded_tools.iter().any(|t| f(t));
    match claim {
        ActionClaim::SearchedWeb => any(&|t| t == "polaris.web.search" || t == "polaris.web.read_page" || t.starts_with("polaris.browser.")),
        ActionClaim::OpenedPage => any(&|t| t == "polaris.web.read_page" || t.starts_with("polaris.browser.")),
        ActionClaim::ReadEmail => any(&|t| (t.starts_with(crate::p06::connector::tool::TOOL_PREFIX) || t.starts_with("mcp:")) && (t.contains("mail") || t.contains("outlook") || t.contains("inbox"))),
        ActionClaim::RanTestsPassing => done.tests_passed,
        ActionClaim::RanCode => any(&|t| t.starts_with("polaris.execution.")),
        ActionClaim::UsedConnector => any(&|t| t.starts_with(crate::p06::connector::tool::TOOL_PREFIX) || t.starts_with("mcp:")),
        ActionClaim::WorkedInParallel => done.parallel_rounds > 0,
    }
}

/// ثابت الحالة: مهمّة نهائية لا تبقى لها خطوة مفتوحة. يغلق المفتوح `CANCELLED` بسبب مكتوب، ويعيد ما أغلقه.
/// قِيس في قاعدة المالك (2026-10-07): مهمّة COMPLETED بخطوتين PENDING، ومهمّة ملغاة جذرها PENDING.
pub fn close_open_steps(state: MissionState, graph: &mut TaskGraph) -> Vec<(String, TaskState)> {
    if !state.is_terminal() {
        return Vec::new();
    }
    let open: Vec<(String, TaskState)> = graph.nodes().filter(|n| n.state.is_open()).map(|n| (n.task_id.clone(), n.state)).collect();
    for (id, from) in &open {
        let _ = graph.set_state(id, TaskState::Cancelled);
        graph.note_failure(id, &format!("closed by the state invariant: the mission ended {} while this step was {}", state.as_str(), from.as_str()));
    }
    open
}

/// ثابت الصدق (E-2، تدقيق 2026-10-19): «مكتملة» لا تحوي خطوة فاشلة أو محجوبة أو منقطعة. يعيد الحالة التي تقولها الخطوات
/// وسببها المكتوب، أو لا شيء إن كانت «مكتملة» صادقة. قِيس في قاعدة المالك: مهمّة COMPLETED بخطوة مراجعة BLOCKED (2026-10-01،
/// قبل أن يحجب `finalize` المهمّة بخطوتها في 6d15191). الحفظ يطبّقه أيًّا كان الكاتب، فلا يعود العيب من مسار آخر.
pub fn unfinished_completion(state: MissionState, graph: &TaskGraph) -> Option<(MissionState, String)> {
    if state != MissionState::Completed {
        return None;
    }
    let of = |wanted: &[TaskState]| -> Vec<String> { graph.nodes().filter(|n| wanted.contains(&n.state)).map(|n| n.title.clone()).collect() };
    let failed = of(&[TaskState::Failed]);
    if !failed.is_empty() {
        return Some((MissionState::Failed, format!("TASKS_FAILED: {}", failed.join(" · "))));
    }
    let blocked = of(&[TaskState::Blocked, TaskState::Interrupted]);
    if !blocked.is_empty() {
        return Some((MissionState::Blocked, format!("TASKS_BLOCKED: {}", blocked.join(" · "))));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_completed_mission_with_a_blocked_or_failed_step_is_not_completed() {
        use crate::p03::task::{TaskNode, TaskType};
        let node = |id: &str, state: TaskState| {
            let mut n = TaskNode::new(id, "m", id, id, TaskType::Review);
            n.state = state;
            n
        };
        let blocked = TaskGraph::build("m", vec![node("a", TaskState::Succeeded), node("b", TaskState::Blocked)], 10).unwrap();
        assert_eq!(unfinished_completion(MissionState::Completed, &blocked).map(|(s, _)| s), Some(MissionState::Blocked));
        let interrupted = TaskGraph::build("m", vec![node("a", TaskState::Interrupted)], 10).unwrap();
        assert_eq!(unfinished_completion(MissionState::Completed, &interrupted).map(|(s, _)| s), Some(MissionState::Blocked));
        let failed = TaskGraph::build("m", vec![node("a", TaskState::Blocked), node("b", TaskState::Failed)], 10).unwrap();
        assert_eq!(unfinished_completion(MissionState::Completed, &failed).map(|(s, _)| s), Some(MissionState::Failed));
        let done = TaskGraph::build("m", vec![node("a", TaskState::Succeeded), node("b", TaskState::Cancelled)], 10).unwrap();
        assert_eq!(unfinished_completion(MissionState::Completed, &done), None);
        // حالة غير «مكتملة» لا يمسّها هذا الثابت: المحجوبة تبقى بخطوتها المحجوبة كما هي.
        assert_eq!(unfinished_completion(MissionState::Blocked, &blocked), None);
    }

    #[test]
    fn a_named_quote_is_required_text_and_a_template_or_a_command_is_not() {
        assert_eq!(required_texts("Write a page with the title 'Launch countdown' and a heading"), vec!["Launch countdown"]);
        assert_eq!(required_texts("a one-page PDF titled 'Remote work policy' with three sections"), vec!["Remote work policy"]);
        assert_eq!(required_texts("a fictional bakery called 'Sunrise Bakery' in outputs/site/"), vec!["Sunrise Bakery"]);
        assert!(required_texts("followed by a line 'count: N'.").is_empty());
        assert!(required_texts("run the tests there with 'python -m unittest -v' in the sandbox").is_empty());
        assert!(required_texts("the user's notes and 'quoted' words").is_empty());
        assert_eq!(required_texts("اكتب تقريرًا بعنوان «خطة العمل» في ملف"), vec!["خطة العمل"]);
    }

    #[test]
    fn a_citation_is_grounded_only_in_a_page_that_was_fetched() {
        let pages = vec!["The Alpha lamp costs 24.50 SAR and ships in two days.".to_string()];
        assert!(citation_grounded("Alpha lamp costs 24.50 SAR", &pages));
        assert!(!citation_grounded("Alpha lamp costs 19 SAR", &pages));
        assert_eq!(quotes_in("The page says «Alpha lamp costs 24.50 SAR» today."), vec!["Alpha lamp costs 24.50 SAR"]);
    }

    #[test]
    fn action_claims_are_read_from_the_reply_and_a_negation_drops_one() {
        assert_eq!(action_claims("I searched the web and all tests pass."), vec![ActionClaim::SearchedWeb, ActionClaim::RanTestsPassing]);
        assert_eq!(action_claims("تم توزيع العمل على مساعدين متخصصين بالتوازي"), vec![ActionClaim::WorkedInParallel]);
        assert_eq!(action_claims("بحثت في الإنترنت عن الأسعار"), vec![ActionClaim::SearchedWeb]);
        assert!(action_claims("I did not search the web; I used what you gave me.").is_empty());
        assert!(action_claims("لم أبحث في الويب، استعملت ملفك فقط").is_empty());
        assert!(action_claims("The report is ready in outputs/report.docx.").is_empty());
    }

    #[test]
    fn an_action_claim_is_backed_only_by_a_matching_executed_tool() {
        let none = ExecutedActions::default();
        let web = ExecutedActions { succeeded_tools: vec!["polaris.web.search".into()], ..Default::default() };
        assert!(!action_backed(ActionClaim::SearchedWeb, &none));
        assert!(action_backed(ActionClaim::SearchedWeb, &web));
        assert!(!action_backed(ActionClaim::RanCode, &web), "a web search does not back running code");
        let ran = ExecutedActions { succeeded_tools: vec!["polaris.execution.python".into()], ..Default::default() };
        assert!(action_backed(ActionClaim::RanCode, &ran));
        assert!(!action_backed(ActionClaim::RanTestsPassing, &ran), "running code is not a passing test run");
        assert!(!action_backed(ActionClaim::WorkedInParallel, &ran));
        assert!(action_backed(ActionClaim::WorkedInParallel, &ExecutedActions { parallel_rounds: 1, ..Default::default() }));
    }

    #[test]
    fn a_terminal_mission_keeps_no_open_step() {
        use crate::p03::task::{TaskNode, TaskType};
        let mut a = TaskNode::new("a", "m", "a", "a", TaskType::Build);
        a.state = TaskState::Succeeded;
        let mut b = TaskNode::new("b", "m", "b", "b", TaskType::Build);
        b.state = TaskState::Pending;
        let mut graph = TaskGraph::build("m", vec![a, b], 10).unwrap();
        assert!(close_open_steps(MissionState::Blocked, &mut graph).is_empty(), "a blocked mission may still resume");
        assert_eq!(close_open_steps(MissionState::Completed, &mut graph), vec![("b".to_string(), TaskState::Pending)]);
        assert_eq!(graph.get("b").unwrap().state, TaskState::Cancelled);
    }
}
