// الوكلاء المعرَّفون في زمن التشغيل (القسم 6): ربط مثيل الوكيل بتعريفه، وفرض أدواته وميزانيته، وذاكرته، ومصحِّح عقده.
//
// كل ما هنا يفرضه زمن التشغيل (المضيف) قبل البوابة: أداة خارج قائمة الوكيل تُرفض قبل أن تبلغها، ولا يُترك الحدّ لنصّ التعليمات.
// والبوابة بعده تفرض ضوابطها كما هي (المهارة، والقدرة، والسياسة، والموافقة)، فقائمة الوكيل تضييق فوقها لا بديل عنها.

use serde_json::json;

use super::support::*;
use super::*;
use crate::p03::agents::grader::{grade, AgentGrade};
use crate::p03::agents::memory::{context_block, AgentMemoryRecord};
use crate::p03::agents::AgentDefinition;
use crate::p03::claim::ClaimSubject;
use crate::p03::mission::MissionRequirement;

/// أقصى سجلّات ذاكرة تدخل سياق وكيل.
const MEMORY_LIMIT: usize = 8;
/// بادئة متطلَّب عقد الوكيل المفوَّض إليه: يضيفه المضيف، فلا يُعدّ متطلَّبًا أعلنه المستخدم (CP-09-1).
pub(super) const AGENT_REQUIREMENT_PREFIX: &str = "AGENT-";

/// G2: طول قائمة المرشحين المعروضة على المنسّق. قائمة أطول تُضيّع نموذجًا محليًّا (انظر `specialist::SHORTLIST`).
pub const CANDIDATE_AGENTS: usize = 5;

impl MissionRuntime {
    /// تعريف المتخصّص الذي ثبّته المستخدم للمهمّة، إن رُبط الدليل.
    pub(super) fn pinned_definition(&self) -> Option<&'static AgentDefinition> {
        let directory = self.agent_directory?;
        directory.for_specialist(self.pinned_specialist.as_deref()?)
    }

    /// يربط مثيل وكيل بتعريفه: الهوية التنفيذية (المثيل + التعريف + الإصدار) تُحفظ مع المثيل.
    pub(super) fn bind_definition(&mut self, instance_id: &str, definition: &'static AgentDefinition) {
        self.instance_definitions.insert(instance_id.to_string(), definition);
        if let Some(agent) = self.agents.iter_mut().find(|a| a.agent_id == instance_id) {
            agent.definition = Some((definition.agent_id.clone(), definition.version.clone()));
        }
    }

    /// فرض أدوات الوكيل وميزانية أدواته قبل البوابة. يعيد نتيجة الرفض إن خالف الاستدعاءُ تعريفه.
    pub(super) fn agent_policy_denial(&mut self, instance_id: &str, tool_id: &str, task: &str) -> Option<String> {
        let definition = *self.instance_definitions.get(instance_id)?;
        if !definition.allows(tool_id) {
            *self.denial_counts.entry(format!("{tool_id}:AGENT_TOOL_NOT_ALLOWED")).or_insert(0) += 1;
            self.security("AGENT_TOOL_NOT_ALLOWED", Some(task), format!("{} v{} proposed {tool_id}, which is outside its tools", definition.agent_id, definition.version));
            return Some(crate::p03::agent_loop::render_result(
                "DENIED",
                Some("AGENT_TOOL_NOT_ALLOWED"),
                &format!("{tool_id} is not one of this agent's tools ({}). POLARIS enforces this; ask the user or the coordinating agent instead.", definition.tools.join(", ")),
                None,
            ));
        }
        let used = self.agent_tool_calls.entry(instance_id.to_string()).or_insert(0);
        if *used >= definition.budget.max_tool_calls {
            return Some(crate::p03::agent_loop::render_result("DENIED", Some("AGENT_TOOL_BUDGET"), &format!("this agent has used its {} tool calls", definition.budget.max_tool_calls), None));
        }
        *used += 1;
        None
    }

    /// كتلة الذاكرة التي يراها الوكيل: سجلّاته وما مُنح له وحده، تمرّ بمسبار الحقن ككل محتوى غير موثوق.
    pub(super) fn agent_memory_block(&mut self, definition: &AgentDefinition) -> Option<String> {
        let memory = self.agent_memory.clone()?;
        let records = memory.read_for(&definition.agent_id, MEMORY_LIMIT);
        let block = context_block(&records)?;
        self.rule_of_two.untrusted_input = true;
        Some(match self.probe_untrusted(&block, "agent_memory", None) {
            Some(warning) => format!("{warning}\n{block}"),
            None => block,
        })
    }

    /// يصحّح عقد مخرجات الوكيل بما قاسه المضيف من المساحة، ويسجّل الحكم دليلًا مقيسًا ومتطلَّبًا إلزاميًّا، ويكتب حلقة في ذاكرة
    /// الوكيل. بلا منفذ قياس لا تصحيح: المصحِّح يقرأ ملفًا لا نثرًا.
    pub(super) fn settle_agent_contract(&mut self, instance_id: &str, definition: &'static AgentDefinition, objective: &str) -> Option<AgentGrade> {
        let probe = self.probe.clone()?;
        let mission_id = self.mission.mission_id.clone();
        let text = probe.file_text(&mission_id, &definition.output.report_path);
        let outcome = grade(definition, text.as_deref());
        let summary = outcome.summary();
        let evidence = self.agent_grader_evidence(&summary, &definition.agent_id);
        let requirement_id = format!("{AGENT_REQUIREMENT_PREFIX}{}", self.agent_grades.len() + 1);
        let statement = format!("{} v{} delivered its output contract at {}", definition.agent_id, definition.version, definition.output.report_path);
        let mut claim = Claim::from_agent(self.clock.id(), &mission_id, "polaris.runtime", &statement, ClaimType::RequirementSatisfaction, Taint::clean(), self.clock.now());
        claim.subject = Some(ClaimSubject { subject: requirement_id.clone(), property: "agent_contract".into(), value: if outcome.passed { "PASSED".into() } else { "FAILED".into() } });
        if outcome.passed {
            claim.evidence_refs = vec![evidence];
        } else {
            claim.counterevidence_refs = vec![evidence];
        }
        let mut requirement = MissionRequirement::new(requirement_id, bounded_preview(&statement, 400), "p03.rule.fact", true);
        requirement.claim_ref = Some(claim.claim_id.clone());
        self.claims.push(claim);
        self.mission.requirements.push(requirement);
        self.verify_new_claims();
        self.settle_requirements();
        if let Some(memory) = self.agent_memory.clone() {
            let record = AgentMemoryRecord {
                memory_id: self.clock.id(),
                agent_id: definition.agent_id.clone(),
                mission_id: Some(mission_id.clone()),
                kind: "EPISODE",
                text: format!("asked: {}; contract {}; instance {instance_id}", bounded_preview(objective, 300), if outcome.passed { "PASSED" } else { "FAILED" }),
                provenance: "HOST_MEASURED",
                shared_from: None,
                created_at: self.clock.now(),
            };
            if let Err(detail) = memory.write(&record) {
                self.security("AGENT_MEMORY_WRITE_FAILED", None, detail);
            }
        }
        self.log_event(None, crate::p03::watch::session::SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, json!({ "text": summary.clone(), "agent_grade": true }));
        self.agent_grades.push(outcome.clone());
        Some(outcome)
    }

    fn agent_grader_evidence(&mut self, summary: &str, agent_id: &str) -> String {
        let evidence_id = self.clock.id();
        self.evidence.push(EvidenceItem {
            evidence_id: evidence_id.clone(),
            mission_id: self.mission.mission_id.clone(),
            evidence_type: crate::p03::evidence::EvidenceType::GraderResult,
            created_at: self.clock.now(),
            digest: crate::digest::sha256_hex(summary.as_bytes()),
            provenance: Provenance {
                producer: "polaris.agents/contract_grader".into(),
                authority: AuthorityClass::TrustedRuntimeFact,
                source_ref: format!("agent:{agent_id}"),
                lineage: vec![format!("agent:{agent_id}")],
                measurement_kind: MeasurementKind::Measured,
            },
            taint: Taint::clean(),
            summary: bounded_preview(summary, 1_000),
        });
        evidence_id
    }

    /// G2: المرشحون الذين يُعرضون على المنسّق لهذا الطلب (حتى `CANDIDATE_AGENTS`)، من الدليل عبر الكتالوج. لا شيء حين ثبّت
    /// المستخدم وكيلًا، أو لا دليل.
    pub(super) fn candidate_agents(&self) -> Vec<&'static AgentDefinition> {
        if self.pinned_specialist.is_some() {
            return Vec::new();
        }
        let (Some(directory), Some(catalog)) = (self.agent_directory, self.specialists) else { return Vec::new() };
        catalog.candidates(&self.mission.objective, CANDIDATE_AGENTS).into_iter().filter_map(|s| directory.for_specialist(&s.specialist_id)).collect()
    }

    /// G2: يسجّل اختيار وكيل بمعرّفه ويعيد هل هو من القائمة المعروضة.
    pub(super) fn record_agent_selection(&mut self, chosen: &str) -> bool {
        let accepted = self.offered_agents.iter().any(|o| o == chosen);
        self.agent_selections.push(super::AgentSelection { offered: self.offered_agents.clone(), chosen: Some(chosen.to_string()), accepted });
        self.log_event(None, crate::p03::watch::session::SessionKind::HostNote, AuthorityClass::TrustedRuntimeFact, json!({ "text": format!("[POLARIS] agent selection: {chosen} ({})", if accepted { "from the shortlist" } else { "not offered, refused" }), "agent_selected": chosen, "offered": self.offered_agents, "accepted": accepted, "record_only": true }));
        accepted
    }

    /// G2: اختيارات الوكلاء في هذا التشغيل، بترتيبها.
    pub fn agent_selections(&self) -> &[super::AgentSelection] {
        &self.agent_selections
    }

    /// أحكام مصحِّح العقد في هذا التشغيل، بترتيبها.
    pub fn agent_grades(&self) -> &[AgentGrade] {
        &self.agent_grades
    }
}
