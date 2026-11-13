// اختيار الأدوات بحسب المهمّة (PHASE-03، فجوة G-02-1، 2026-10-20).
//
// قِيس (`tests/cp03_tool_inventory.rs`): المنسّق كان يتلقّى كل أدوات المهارة الافتراضية — 35 أداة، نحو 5114 رمزًا مقدَّرًا — في كل
// نداء، أي قرابة 62% من نافذة 8192 قبل تعليمة النظام والمحادثة. هذه الوحدة تقسم القائمة: أدوات أساسية تُعرض دائمًا، ومجموعات
// تُعرض حين يدلّ عليها الطلب، والباقي مؤجَّل يُذكر باسمه في أداة `load_tools` المختصرة.
//
// الحدود:
//   ١ — تُضيّق ولا توسّع: لا تعرض أداة لم تكن في القائمة التي بناها السجلّ والمهارة. البوابة تقرّر عند الاستدعاء كما كانت.
//   ٢ — لا تُخفي قدرة: المؤجَّل يبقى قابلًا للاستدعاء باسمه، فاستدعاؤه يحمّل مجموعته ثم يمرّ بالبوابة.
//   ٣ — الإشارات من نصّ الطلب ومن عقده المشتقّ حتميًّا؛ تقدير يرجّح العرض، لا حكم. الخطأ فيه يكلّف دورًا (`load_tools`) لا قدرة.

use serde_json::{json, Value};

use super::agent_loop::LoopTool;
use super::contract::{urls_in, DeliverableFormat, MissionExecutionContract, RequirementKind};

/// اسم أداة التحميل كما يراه النموذج.
pub const LOAD_TOOLS: &str = "load_tools";

/// مجموعة أدوات. مغلقة: أداة لا تنتمي إلى مجموعة معروفة أساسية.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolGroup {
    Core,
    Documents,
    Code,
    Web,
    GitHub,
    Connectors,
    Other,
}

impl ToolGroup {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Core => "core",
            Self::Documents => "documents",
            Self::Code => "code",
            Self::Web => "web",
            Self::GitHub => "github",
            Self::Connectors => "connectors",
            Self::Other => "other",
        }
    }

    fn parse(name: &str) -> Option<Self> {
        DEFERRABLE.iter().copied().find(|g| g.as_str() == name.trim())
    }

    /// سطر واحد في وصف `load_tools`.
    fn summary(self) -> &'static str {
        match self {
            Self::Documents => "Word, PowerPoint, Excel and ZIP files",
            Self::Code => "run Python or PowerShell in the sandbox",
            Self::Web => "search the web and use the real browser",
            Self::GitHub => "read the user's GitHub repositories and issues",
            Self::Connectors => "the user's registered service connectors",
            Self::Other => "audit and other tools",
            Self::Core => "",
        }
    }
}

/// المجموعات القابلة للتأجيل، بترتيب ثابت.
const DEFERRABLE: [ToolGroup; 6] = [ToolGroup::Documents, ToolGroup::Code, ToolGroup::Web, ToolGroup::GitHub, ToolGroup::Connectors, ToolGroup::Other];

/// مجموعة أداة من معرّفها المسجَّل. أداة زمن التشغيل (بلا معرّف) أساسية.
pub fn group_of(tool: &LoopTool) -> ToolGroup {
    tool.tool_id.as_deref().map(group_of_id).unwrap_or(ToolGroup::Core)
}

/// مسار الرسم (المهامّ غير المحادثية، ومنها الأتمتة): لا تحميل أثناء الخطوة، فالمعروض هو الأساسي وما يدلّ عليه الطلب. أداة
/// خارجه لا تُعرض في هذا المسار؛ قيد معلن في PHASE-03.
pub fn offered_ids(ids: Vec<String>, objective: &str) -> Vec<String> {
    let wanted = wanted_groups(objective);
    ids.into_iter()
        .filter(|id| {
            let group = group_of_id(id);
            group == ToolGroup::Core || wanted.contains(&group)
        })
        .collect()
}

pub fn group_of_id(id: &str) -> ToolGroup {
    if matches!(id, "polaris.artifact.document" | "polaris.artifact.presentation" | "polaris.artifact.spreadsheet" | "polaris.package.zip") {
        ToolGroup::Documents
    } else if id.starts_with("polaris.execution.") {
        ToolGroup::Code
    } else if id.starts_with("polaris.web.") || id.starts_with("polaris.browser.") {
        ToolGroup::Web
    } else if id.starts_with("polaris.github.") {
        ToolGroup::GitHub
    } else if id.starts_with(crate::p06::connector::tool::TOOL_PREFIX) {
        ToolGroup::Connectors
    } else if id.starts_with("mcp:") || id.starts_with("polaris.desktop.") || id == crate::p04::builtin::TOOL_AUDIT_CHAIN {
        ToolGroup::Other
    } else {
        ToolGroup::Core
    }
}

const DOCUMENT_WORDS: [&str; 22] = ["document", "report", "docx", "word file", "pdf", "slide", "slides", "deck", "presentation", "pptx", "powerpoint", "excel", "spreadsheet", "xlsx", "sheet", "workbook", "zip", "archive", "invoice", "letter", "resume", "cv"];
const DOCUMENT_AR: [&str; 15] = ["مستند", "تقرير", "وثيقة", "وورد", "عرض تقديمي", "شرائح", "بوربوينت", "باوربوينت", "إكسل", "اكسل", "جدول", "مضغوط", "أرشيف", "خطاب", "فاتورة"];
const CODE_WORDS: [&str; 22] = ["python", "script", "code", "program", "run", "execute", "test", "tests", "compute", "calculate", "analyze", "analyse", "analysis", "data", "csv", "chart", "plot", "graph", "debug", "bug", "powershell", "terminal"];
const CODE_AR: [&str; 14] = ["بايثون", "كود", "برمج", "سكربت", "شغّل", "شغل", "نفّذ", "اختبار", "احسب", "حساب", "تحليل", "بيانات", "رسم بياني", "مخطط"];
const WEB_WORDS: [&str; 15] = ["search", "web", "internet", "online", "browse", "browser", "url", "link", "latest", "news", "current", "price", "prices", "weather", "google"];
const WEB_AR: [&str; 14] = ["ابحث", "بحث", "الإنترنت", "الانترنت", "الويب", "متصفح", "المتصفح", "رابط", "أحدث", "أخبار", "سعر", "أسعار", "الطقس", "موقع"];
const GITHUB_WORDS: [&str; 6] = ["github", "repo", "repos", "repository", "pull request", "issues"];
const GITHUB_AR: [&str; 2] = ["مستودع", "جيت هب"];

/// المجموعات التي يدلّ عليها الطلب وعقده.
pub fn wanted_groups(objective: &str) -> Vec<ToolGroup> {
    let lower = objective.to_lowercase();
    let contract = MissionExecutionContract::derive(objective);
    let any = |words: &[&str], arabic: &[&str]| words.iter().any(|w| super::contract::mentions_word(&lower, w)) || arabic.iter().any(|w| lower.contains(w));
    let formats: Vec<DeliverableFormat> = contract
        .requirements
        .iter()
        .filter_map(|r| match &r.kind {
            RequirementKind::Artifact { format, .. } => Some(*format),
            _ => None,
        })
        .collect();
    let mut groups = Vec::new();
    if formats.iter().any(|f| matches!(f, DeliverableFormat::Docx | DeliverableFormat::Pptx | DeliverableFormat::Xlsx | DeliverableFormat::Pdf | DeliverableFormat::Zip)) || any(&DOCUMENT_WORDS, &DOCUMENT_AR) {
        groups.push(ToolGroup::Documents);
    }
    let needs_code = contract.requirements.iter().any(|r| matches!(r.kind, RequirementKind::ExecutedCode { .. } | RequirementKind::TestsPassing | RequirementKind::ChartIn { .. }));
    if needs_code || formats.iter().any(|f| matches!(f, DeliverableFormat::Python | DeliverableFormat::Csv)) || any(&CODE_WORDS, &CODE_AR) {
        groups.push(ToolGroup::Code);
    }
    let needs_web = contract.requirements.iter().any(|r| matches!(r.kind, RequirementKind::NetworkProposal | RequirementKind::BrowserVisit { .. }));
    if needs_web || !urls_in(objective).is_empty() || any(&WEB_WORDS, &WEB_AR) {
        groups.push(ToolGroup::Web);
    }
    if any(&GITHUB_WORDS, &GITHUB_AR) {
        groups.push(ToolGroup::GitHub);
    }
    groups
}

/// القسمة: المعروض الآن، والمؤجَّل. `used` أسماء أدوات ظهرت في المحادثة (استئناف): مجموعاتها تُعرض، فلا تحمل المحادثة
/// استدعاءً لأداة بلا تعريف (بعض المزوّدين يرفض ذلك).
pub fn select(tools: Vec<LoopTool>, objective: &str, used: &[String]) -> (Vec<LoopTool>, Vec<LoopTool>) {
    let mut wanted = wanted_groups(objective);
    for tool in &tools {
        let group = group_of(tool);
        if used.iter().any(|n| n == &tool.name) && !wanted.contains(&group) {
            wanted.push(group);
        }
    }
    tools.into_iter().partition(|t| {
        let group = group_of(t);
        group == ToolGroup::Core || wanted.contains(&group)
    })
}

/// أداة التحميل: فهرس مختصر بالمؤجَّل، مجموعةً مجموعة بأسماء أدواتها. لا شيء حين لا مؤجَّل.
pub fn load_tool(deferred: &[LoopTool]) -> Option<LoopTool> {
    let groups: Vec<ToolGroup> = DEFERRABLE.iter().copied().filter(|g| deferred.iter().any(|t| group_of(t) == *g)).collect();
    if groups.is_empty() {
        return None;
    }
    let index: Vec<String> = groups
        .iter()
        .map(|g| {
            let names: Vec<&str> = deferred.iter().filter(|t| group_of(t) == *g).map(|t| t.name.as_str()).collect();
            format!("{} ({}): {}", g.as_str(), g.summary(), names.join(", "))
        })
        .collect();
    Some(LoopTool {
        name: LOAD_TOOLS.into(),
        tool_id: None,
        description: format!("More tools exist but are not loaded, to keep room for the work. Load the groups the task needs; their tools are offered from your next step. {}", index.join("; ")),
        parameters: json!({
            "type": "object",
            "properties": { "groups": { "type": "array", "items": { "type": "string", "enum": groups.iter().map(|g| g.as_str()).collect::<Vec<_>>() } } },
            "required": ["groups"],
        }),
    })
}

/// المجموعات التي يطلبها استدعاء: `load_tools` بوسائطه، أو أداة مؤجَّلة باسمها.
pub fn requested_groups(name: &str, arguments: &str, deferred: &[LoopTool]) -> Vec<ToolGroup> {
    if name == LOAD_TOOLS {
        let parsed: Value = serde_json::from_str(arguments).unwrap_or(Value::Null);
        return parsed.get("groups").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).filter_map(ToolGroup::parse).collect()).unwrap_or_default();
    }
    deferred.iter().find(|t| t.name == name).map(|t| vec![group_of(t)]).unwrap_or_default()
}

/// ينقل المجموعات المطلوبة من المؤجَّل إلى المعروض، ويعيد أسماء ما نُقل. أداة التحميل تبقى ما بقي مؤجَّل، وتُحدَّث.
pub fn load(tools: &mut Vec<LoopTool>, deferred: &mut Vec<LoopTool>, groups: &[ToolGroup]) -> Vec<String> {
    let (moving, staying): (Vec<LoopTool>, Vec<LoopTool>) = std::mem::take(deferred).into_iter().partition(|t| groups.contains(&group_of(t)));
    *deferred = staying;
    let moved: Vec<String> = moving.iter().map(|t| t.name.clone()).collect();
    tools.retain(|t| t.name != LOAD_TOOLS);
    tools.extend(moving);
    if let Some(index) = load_tool(deferred) {
        tools.push(index);
    }
    moved
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(id: &str) -> LoopTool {
        LoopTool { name: super::super::agent_loop::loop_tool_name(id), tool_id: Some(id.into()), description: format!("{id} description"), parameters: json!({ "type": "object" }) }
    }

    fn all() -> Vec<LoopTool> {
        ["polaris.workspace.write", "polaris.artifact.document", "polaris.execution.python", "polaris.web.search", "polaris.browser.open", "polaris.github.repos", "polaris.tool.audit.chain.verify"].iter().map(|i| tool(i)).collect()
    }

    fn names(tools: &[LoopTool]) -> Vec<&str> {
        tools.iter().map(|t| t.name.as_str()).collect()
    }

    #[test]
    fn a_greeting_offers_only_the_core_tools() {
        let (offered, deferred) = select(all(), "هلا", &[]);
        assert_eq!(names(&offered), vec!["write_file"]);
        assert_eq!(deferred.len(), 6);
    }

    #[test]
    fn the_request_and_its_contract_choose_the_groups() {
        assert_eq!(wanted_groups("Write outputs/plan.docx about the move"), vec![ToolGroup::Documents]);
        assert_eq!(wanted_groups("ابحث عن أحدث أسعار الذهب واكتب تقريرًا"), vec![ToolGroup::Documents, ToolGroup::Web]);
        assert_eq!(wanted_groups("Run the tests in python and fix the bug"), vec![ToolGroup::Code]);
        assert_eq!(wanted_groups("List my GitHub repos"), vec![ToolGroup::GitHub]);
        // كلمة داخل كلمة لا تُحتسب: «testing» ليست «test»، و«website» ليست «web».
        assert!(!wanted_groups("Build me a website").contains(&ToolGroup::Web));
    }

    #[test]
    fn a_tool_used_earlier_in_the_conversation_stays_offered_on_resume() {
        let (offered, _) = select(all(), "هلا", &["browser_open".to_string()]);
        assert!(names(&offered).contains(&"browser_open"));
        assert!(names(&offered).contains(&"web_search"), "the whole group returns, not one tool");
    }

    #[test]
    fn load_tools_lists_every_deferred_tool_and_loading_moves_the_group() {
        let (mut offered, mut deferred) = select(all(), "هلا", &[]);
        offered.extend(load_tool(&deferred));
        let index = offered.iter().find(|t| t.name == LOAD_TOOLS).expect("load_tools is offered");
        for t in &deferred {
            assert!(index.description.contains(&t.name), "{} is not named in load_tools", t.name);
        }
        let groups = requested_groups(LOAD_TOOLS, r#"{"groups":["web"]}"#, &deferred);
        let moved = load(&mut offered, &mut deferred, &groups);
        assert_eq!(moved, vec!["web_search", "browser_open"]);
        assert!(names(&offered).contains(&"browser_open"));
        // calling a deferred tool by name asks for its group
        assert_eq!(requested_groups("create_document", "{}", &deferred), vec![ToolGroup::Documents]);
        assert_eq!(requested_groups(LOAD_TOOLS, r#"{"groups":["root","admin"]}"#, &deferred), Vec::<ToolGroup>::new(), "unknown group names load nothing");
    }

    #[test]
    fn the_graph_path_offers_the_core_and_the_signalled_groups_only() {
        let ids: Vec<String> = all().into_iter().filter_map(|t| t.tool_id).collect();
        assert_eq!(offered_ids(ids.clone(), "carry out the fixture scenario"), vec!["polaris.workspace.write"]);
        assert_eq!(offered_ids(ids, "every morning search the web for news"), vec!["polaris.workspace.write", "polaris.web.search", "polaris.browser.open"]);
    }

    #[test]
    fn nothing_is_offered_that_was_not_in_the_input() {
        let input = all();
        let (offered, deferred) = select(input.clone(), "ابحث في الويب وشغّل بايثون واكتب تقرير docx عن مستودع GitHub", &[]);
        assert_eq!(offered.len() + deferred.len(), input.len());
        assert!(offered.iter().chain(&deferred).all(|t| input.iter().any(|i| i.name == t.name)));
    }
}
