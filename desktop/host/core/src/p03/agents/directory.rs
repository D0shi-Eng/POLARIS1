// دليل الوكلاء: 300 تعريف يُبنى من الكتالوج المضمَّن وملفّات المجالات، ويُتحقَّق منه كاملًا عند البناء وفي الاختبارات.

use std::collections::BTreeSet;
use std::sync::OnceLock;

use crate::p03::specialist::SpecialistCatalog;

use super::definition::AgentDefinition;
use super::profile::{profile_for, NEVER_DELEGATED};

/// العدد الذي يشترطه التكليف. الدليل يرفض أي عدد آخر بدل أن يعمل ناقصًا بصمت.
pub const REQUIRED_AGENTS: usize = 300;

pub struct AgentDirectory {
    definitions: Vec<AgentDefinition>,
}

impl AgentDirectory {
    /// الدليل المضمَّن. خطأ في بنائه عيب بناء تكشفه الاختبارات؛ وقت التشغيل يعمل بلا وكلاء معرَّفين بدل أن ينهار.
    pub fn builtin() -> &'static AgentDirectory {
        static DIRECTORY: OnceLock<AgentDirectory> = OnceLock::new();
        DIRECTORY.get_or_init(|| Self::build(SpecialistCatalog::builtin()).unwrap_or(Self { definitions: Vec::new() }))
    }

    /// يبني الدليل ويتحقّق منه: لكل متخصّص تعريف بملفّ مجال معروف، ومعرّفات وإصدارات ومسارات تقارير ونطاقات ذاكرة فريدة،
    /// وأدوات من القائمة المسموحة لا يدخلها ما لا يُفوَّض أبدًا، وعقد مخرجات بعنوان لكل بند تحقّق.
    pub fn build(catalog: &SpecialistCatalog) -> Result<Self, String> {
        let mut definitions = Vec::new();
        // مهارات المكتبة تعليمات داخل الموجّه لا وكلاء مفوَّضون: لا تدخل الدليل (300 وكيل بتجهيزات تقييم مجمّدة).
        for specialist in catalog.specialists().iter().filter(|s| s.domain_id != crate::p03::specialist::SKILLS_DOMAIN) {
            let profile = profile_for(&specialist.domain_id).ok_or_else(|| format!("{}: domain {} has no profile", specialist.specialist_id, specialist.domain_id))?;
            definitions.push(AgentDefinition::build(specialist, profile));
        }
        let directory = Self { definitions };
        directory.validate()?;
        Ok(directory)
    }

    fn validate(&self) -> Result<(), String> {
        if self.definitions.len() != REQUIRED_AGENTS {
            return Err(format!("the directory holds {} agents, {REQUIRED_AGENTS} are required", self.definitions.len()));
        }
        let mut ids = BTreeSet::new();
        let mut reports = BTreeSet::new();
        let mut namespaces = BTreeSet::new();
        for d in &self.definitions {
            if !ids.insert(d.agent_id.clone()) || !reports.insert(d.output.report_path.clone()) || !namespaces.insert(d.memory_namespace.clone()) {
                return Err(format!("{}: id, report path or memory namespace is not unique", d.agent_id));
            }
            if d.version.len() != "1.0.0+".len() + 12 {
                return Err(format!("{}: version {} is malformed", d.agent_id, d.version));
            }
            if let Some(tool) = d.tools.iter().find(|t| NEVER_DELEGATED.contains(t)) {
                return Err(format!("{}: holds {tool}, which no specialist agent may hold", d.agent_id));
            }
            if d.output.check_headings.len() != d.checks.len() || d.checks.is_empty() {
                return Err(format!("{}: the output contract does not cover its checks", d.agent_id));
            }
        }
        Ok(())
    }

    pub fn definitions(&self) -> &[AgentDefinition] {
        &self.definitions
    }

    pub fn get(&self, agent_id: &str) -> Option<&AgentDefinition> {
        self.definitions.iter().find(|d| d.agent_id == agent_id)
    }

    /// تعريف المتخصّص: المعرّف `agent.<specialist_id>` يقابل متخصّصًا واحدًا.
    pub fn for_specialist(&self, specialist_id: &str) -> Option<&AgentDefinition> {
        self.definitions.iter().find(|d| d.specialist_id == specialist_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_builtin_directory_holds_exactly_three_hundred_valid_agents() {
        let directory = AgentDirectory::build(SpecialistCatalog::builtin()).expect("the directory builds");
        assert_eq!(directory.definitions().len(), REQUIRED_AGENTS);
        assert_eq!(AgentDirectory::builtin().definitions().len(), REQUIRED_AGENTS);
        for d in directory.definitions() {
            assert!(d.agent_id.starts_with("agent.") && d.version.starts_with("1.0.0+"));
            assert!(!d.tools.is_empty() && d.allows("polaris.workspace.write"));
            assert!(!d.allows("polaris.execution.command"), "{} holds a host command", d.agent_id);
        }
    }

    #[test]
    fn profiles_give_measurably_different_tool_sets() {
        let directory = AgentDirectory::builtin();
        let tools = |id: &str| directory.get(id).map(|d| d.tools.clone()).unwrap_or_default();
        let writing = directory.definitions().iter().find(|d| d.domain_id == "writing").unwrap();
        let research = directory.definitions().iter().find(|d| d.domain_id == "research").unwrap();
        let data = directory.definitions().iter().find(|d| d.domain_id == "data-ai").unwrap();
        assert!(!writing.allows("polaris.execution.python") && !writing.allows("polaris.web.search"));
        assert!(research.allows("polaris.web.search") && !research.allows("polaris.execution.python"));
        assert!(data.allows("polaris.execution.python") && !data.allows("polaris.web.search"));
        assert_ne!(tools(&writing.agent_id), tools(&data.agent_id));
    }

    /// G1 (تكليف 2026-10-14): الأدوات لكل وكيل لا لكل ملف مجال. لكل منحة أساس من تعريف الوكيل ونصّ مقتبس منه حرفيًّا يحوي
    /// جذرًا من جذور الأداة، والقائمة لا تتجاوز ملف المجال (السقف).
    #[test]
    fn every_tool_grant_cites_a_clause_of_the_agent_that_needs_it() {
        let directory = AgentDirectory::builtin();
        let catalog = SpecialistCatalog::builtin();
        let mut bad = Vec::new();
        for d in directory.definitions() {
            let s = catalog.get(&d.specialist_id).unwrap();
            let profile = profile_for(&d.domain_id).unwrap();
            let granted: Vec<&str> = d.tool_grants.iter().map(|g| g.tool_id).collect();
            if granted != d.tools {
                bad.push(format!("{}: tools and grants disagree", d.agent_id));
            }
            for g in &d.tool_grants {
                if !profile.tools().contains(&g.tool_id) {
                    bad.push(format!("{}: {} is outside its domain profile", d.agent_id, g.tool_id));
                }
                let field: Option<String> = match g.basis.as_str() {
                    "output contract" | "input contract" => crate::p03::agents::profile::base_reason(g.tool_id).map(str::to_string),
                    "responsibility" => Some(s.summary_en.clone()),
                    "method" => Some(s.expertise.clone()),
                    other => other.strip_prefix("check ").and_then(|n| n.parse::<usize>().ok()).and_then(|n| s.checks.get(n.wrapping_sub(1)).cloned()),
                };
                let Some(field) = field else {
                    bad.push(format!("{}: {} cites an unknown basis {}", d.agent_id, g.tool_id, g.basis));
                    continue;
                };
                if g.clause.trim().is_empty() || !field.contains(&g.clause) {
                    bad.push(format!("{}: {} quotes a clause that is not in its {}", d.agent_id, g.tool_id, g.basis));
                }
                if !g.basis.ends_with("contract") && !crate::p03::agents::profile::clause_needs(g.tool_id, &g.clause) {
                    bad.push(format!("{}: {} — the quoted clause names no need for it: {}", d.agent_id, g.tool_id, g.clause));
                }
            }
        }
        assert!(bad.is_empty(), "{} bad grants:\n{}", bad.len(), bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n"));
    }

    /// G1: القوائم تختلف بحاجة الوكيل داخل ملف المجال نفسه، لا بملفه وحده (كانت 7 قوائم لـ300 وكيل).
    #[test]
    fn tool_lists_follow_each_agents_needs_not_only_its_domain_profile() {
        let directory = AgentDirectory::builtin();
        let lists: BTreeSet<Vec<&str>> = directory.definitions().iter().map(|d| d.tools.clone()).collect();
        assert!(lists.len() > 7, "only {} distinct tool lists for 300 agents", lists.len());
        let narrowed = directory.definitions().iter().filter(|d| d.tools.len() < profile_for(&d.domain_id).unwrap().tools().len()).count();
        assert!(narrowed > 0, "no agent holds fewer tools than its domain profile");
    }

    /// DEF-33 (تدقيق 2026-10-29): `spreadsheet-expert` لم يملك أداة الجداول، و`research-analyst` ملك قراءة الصفحة دون فتحها، ففشل
    /// M03 وM06 أصليًّا. كل وكيل يملك أداة مخرجه الأساسي، ومن يقرأ صفحة يستطيع فتحها.
    #[test]
    fn every_specialist_holds_the_tool_its_own_output_needs() {
        let directory = AgentDirectory::builtin();
        assert!(directory.get("agent.data-ai.spreadsheet-expert").unwrap().allows("polaris.artifact.spreadsheet"));
        assert!(directory.get("agent.research.research-analyst").unwrap().allows("polaris.web.navigate"));
        let stranded: Vec<&str> = directory.definitions().iter().filter(|d| d.allows("polaris.web.read_page") && !d.allows("polaris.web.navigate")).map(|d| d.agent_id.as_str()).collect();
        assert!(stranded.is_empty(), "these agents can read a page but never open one: {stranded:?}");
    }

    #[test]
    fn a_changed_check_changes_the_version() {
        let catalog = SpecialistCatalog::builtin();
        let mut specialist = catalog.specialists()[0].clone();
        let profile = profile_for(&specialist.domain_id).unwrap();
        let before = AgentDefinition::build(&specialist, profile).version;
        specialist.checks[0].push_str(" (changed)");
        assert_ne!(AgentDefinition::build(&specialist, profile).version, before);
    }
}
