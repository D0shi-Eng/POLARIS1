// تعريف وكيل واحد: هويته وإصداره ومسؤوليته وحدوده وعقد مدخلاته ومخرجاته وأدواته وذاكرته وميزانيته.
//
// التعريف بيانات ثابتة يبنيها الدليل من الكتالوج وملفّ المجال، ويُبصم محتواه: تغيير منهج المتخصّص أو قائمة تحقّقه أو أدواته أو
// عقده يغيّر الإصدار، فلا يُنسب قبول قيس على تعريف قديم إلى تعريف جديد.

use serde::Serialize;

use crate::p03::specialist::Specialist;
use crate::p03::task::TaskType;

use super::profile::{base_reason, clause_needs, common_boundaries, DomainProfile};

/// رقم صيغة التعريف. يتغيّر حين يتغيّر شكل التعريف نفسه.
pub const DEFINITION_SCHEMA: &str = "1.0.0";

/// عقد المدخلات: ما يقبله الوكيل حين يُفوَّض أو يُثبَّت.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InputContract {
    /// أنواع العُقد التي يقبلها (من الكتالوج).
    pub accepts: Vec<TaskType>,
    /// حقول التفويض: `objective` إلزامي، والباقي اختياري. لا حقل يحمل سلطة أو أداة.
    pub required: Vec<&'static str>,
    pub optional: Vec<&'static str>,
}

/// عقد المخرجات: تقرير في مسار ثابت بأقسام تقابل قائمة تحقّق المتخصّص، يقيسه مصحِّح كود.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OutputContract {
    pub report_path: String,
    /// عنوان قسم الخلاصة، ثم عنوان لكل بند تحقّق بترتيبه.
    pub summary_heading: &'static str,
    pub check_headings: Vec<String>,
    /// أقلّ عدد محارف غير فارغة تحت كل عنوان.
    pub min_section_chars: usize,
}

/// G1 (2026-10-14): منحة أداة واحدة وسببها. `basis` موضع السبب في التعريف («output contract»، «input contract»، «responsibility»،
/// «method»، «check N»)، و`clause` النصّ نفسه مقتبسًا من ذلك الموضع حرفيًّا.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolGrant {
    pub tool_id: &'static str,
    pub basis: String,
    pub clause: String,
}

/// ميزانية الوكيل فوق ميزانية المهمّة: تقيّده هو، ولا تزيد ما تبقّى للمهمّة.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AgentBudget {
    pub max_turns: u32,
    pub max_tool_calls: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AgentDefinition {
    pub agent_id: String,
    /// `1.0.0+<بصمة 12 محرفًا>`.
    pub version: String,
    pub specialist_id: String,
    pub domain_id: String,
    pub profile_id: &'static str,
    pub name_ar: String,
    pub name_en: String,
    pub responsibility: String,
    pub boundaries: Vec<String>,
    pub input: InputContract,
    pub output: OutputContract,
    pub tools: Vec<&'static str>,
    /// سبب كل أداة في `tools`، بترتيبها.
    pub tool_grants: Vec<ToolGrant>,
    /// نطاق الذاكرة المفروض بالهوية: لا يقرأ الوكيل غيره إلا بمنحة صريحة.
    pub memory_namespace: String,
    pub budget: AgentBudget,
    /// بنود التحقّق كما في الكتالوج (للتعليمات والمصحِّح).
    #[serde(skip_serializing)]
    pub checks: Vec<String>,
}

/// G1: قائمة أدوات الوكيل بأقل امتياز. أدوات ملف مجاله سقف: المشتركة تُمنح بعقدَي المدخلات والمخرجات اللذين يحملهما كل وكيل،
/// والإضافية لا تُمنح إلا إن دلّ نصّ الوكيل نفسه (مسؤوليته، ثم منهجه جملةً جملة، ثم بنود تحقّقه) على حاجته إليها، ويُقتبس
/// أوّل موضع دلّ عليها سببًا. وكيلان بالحاجة نفسها يتشاركان القائمة نفسها.
fn grants(specialist: &Specialist, profile: &DomainProfile) -> Vec<ToolGrant> {
    let mut places: Vec<(String, String)> = vec![("responsibility".into(), specialist.summary_en.clone())];
    places.extend(sentences(&specialist.expertise).into_iter().map(|s| ("method".to_string(), s)));
    places.extend(specialist.checks.iter().enumerate().map(|(i, c)| (format!("check {}", i + 1), c.clone())));
    // ترتيب ثابت بمعرّف الأداة: وكيلان بالحاجة نفسها يحملان القائمة نفسها حرفيًّا، أيًّا كان ملف مجالهما.
    let mut tools = profile.tools();
    tools.sort_unstable();
    tools
        .into_iter()
        .filter_map(|tool_id| {
            if let Some(reason) = base_reason(tool_id) {
                let basis = if tool_id == "polaris.workspace.write" { "output contract" } else { "input contract" };
                return Some(ToolGrant { tool_id, basis: basis.into(), clause: reason.into() });
            }
            places.iter().find(|(_, text)| clause_needs(tool_id, text)).map(|(basis, clause)| ToolGrant { tool_id, basis: basis.clone(), clause: clause.clone() })
        })
        .collect()
}

/// جمل منهج العمل: نقطة يليها فراغ تنهي الجملة.
fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        current.push(c);
        if c == '.' && chars.peek().is_none_or(|n| n.is_whitespace()) {
            out.push(current.trim().to_string());
            current.clear();
        }
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out
}

impl AgentDefinition {
    /// يبني التعريف من متخصّص وملفّ مجاله، ويبصمه.
    pub fn build(specialist: &Specialist, profile: &'static DomainProfile) -> Self {
        let slug = specialist.specialist_id.split_once('.').map(|(_, s)| s).unwrap_or(&specialist.specialist_id).to_string();
        let agent_id = format!("agent.{}", specialist.specialist_id);
        let check_headings = specialist.checks.iter().enumerate().map(|(i, _)| format!("Check {}", i + 1)).collect();
        let mut boundaries: Vec<String> = common_boundaries().iter().map(|b| b.to_string()).collect();
        boundaries.extend(profile.boundaries.iter().map(|b| b.to_string()));
        let mut definition = Self {
            agent_id: agent_id.clone(),
            version: String::new(),
            specialist_id: specialist.specialist_id.clone(),
            domain_id: specialist.domain_id.clone(),
            profile_id: profile.profile_id,
            name_ar: specialist.name_ar.clone(),
            name_en: specialist.name_en.clone(),
            responsibility: specialist.summary_en.clone(),
            boundaries,
            input: InputContract { accepts: specialist.task_types.clone(), required: vec!["objective"], optional: vec!["context", "expected_output"] },
            output: OutputContract {
                report_path: format!("outputs/agents/{}/{}/report.md", specialist.domain_id, slug),
                summary_heading: "Summary",
                check_headings,
                min_section_chars: 20,
            },
            tools: Vec::new(),
            tool_grants: Vec::new(),
            memory_namespace: format!("agent:{agent_id}"),
            budget: AgentBudget { max_turns: profile.max_turns, max_tool_calls: profile.max_tool_calls },
            checks: specialist.checks.clone(),
        };
        definition.tool_grants = grants(specialist, profile);
        definition.tools = definition.tool_grants.iter().map(|g| g.tool_id).collect();
        let digest = definition.content_digest(specialist);
        definition.version = format!("{DEFINITION_SCHEMA}+{}", &digest[..12]);
        definition
    }

    /// بصمة المحتوى: التعريف كما يُعرض، ومعه منهج المتخصّص وبنود تحقّقه وكلماته (ما يغيّر سلوكه).
    fn content_digest(&self, specialist: &Specialist) -> String {
        let canonical = serde_json::json!({
            "definition": self,
            "expertise": specialist.expertise,
            "checks": specialist.checks,
            "keywords": specialist.keywords,
        });
        crate::digest::sha256_hex(canonical.to_string().as_bytes())
    }

    /// هل الأداة ضمن ما يملكه هذا الوكيل؟ الأدوات المحلية للحلقة (الخطة) ليست أدوات سجلّ ولا تمرّ بهذا الفحص.
    pub fn allows(&self, tool_id: &str) -> bool {
        self.tools.contains(&tool_id)
    }

    /// تعليمات العقد والحدود كما تدخل موجّه الوكيل، بعد تعليمات المتخصّص. نصّ مضيف موثوق، لا يمنح سلطة.
    pub fn contract_brief(&self) -> String {
        let mut out = format!(
            "[AGENT {} v{} — identity, tools and memory are enforced by POLARIS, not by this text]\nResponsibility: {}\nBoundaries:\n",
            self.agent_id, self.version, self.responsibility
        );
        for b in &self.boundaries {
            out.push_str(&format!("- {b}\n"));
        }
        out.push_str(&format!("Tools you may use: {}\n", self.tools.join(", ")));
        out.push_str(&format!(
            "Deliverable: write {} in Markdown with a heading \"## {}\" and then one heading per check, in order:\n",
            self.output.report_path, self.output.summary_heading
        ));
        for (heading, check) in self.output.check_headings.iter().zip(&self.checks) {
            out.push_str(&format!("- \"## {heading}\" — {check}\n"));
        }
        out.push_str("Under each heading write what you found or did for that check (at least one full sentence). An automatic grader reads this file; your final message alone does not satisfy the contract.\n");
        out
    }
}
