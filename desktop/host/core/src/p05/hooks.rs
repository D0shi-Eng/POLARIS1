// ربط Phase-05 بزمن تشغيل Phase-03 عبر منفذيه: مزوّد السياق ومراقب دورة الحياة.
//
// مزوّد السياق يعطي الوكيل ذاكرة مسترجَعة وملاحظة المتصفّح والشاشة الأخيرة لمهمّته،
// كلها بيانات موسومة غير موثوقة داخل حدّ الميزانية. والمراقب يبني ذاكرة الحلقة من
// نهاية المهمّة، ويغلق جلسات المتصفّح وسطح المكتب مع المهمّة أو يلغيها معها.

use std::sync::Arc;

use crate::p03::port::{AgentContextBlock, AgentContextKind, AgentContextProvider, AgentContextRequest, MissionObserver, MissionOutcomeNote, TaskOutcomeNote};

use super::browser::runtime::BrowserRuntime;
use super::computer::runtime::ComputerRuntime;
use super::memory::context::MemoryContextBudget;
use super::memory::retriever::MemoryQuery;
use super::memory::MemoryService;

pub struct Phase05Hooks {
    pub memory: Arc<MemoryService>,
    pub browser: Arc<BrowserRuntime>,
    pub computer: Arc<ComputerRuntime>,
    pub memory_budget: MemoryContextBudget,
}

impl AgentContextProvider for Phase05Hooks {
    fn blocks_for(&self, request: &AgentContextRequest<'_>) -> Vec<AgentContextBlock> {
        let mut blocks = Vec::new();
        let mut query = MemoryQuery::for_mission(request.mission_id, request.project_id.map(str::to_string));
        query.text = Some(request.task_objective.to_string());
        let memory = self.memory.context_block(&query, self.memory_budget);
        if !memory.text.is_empty() {
            blocks.push(AgentContextBlock { kind: AgentContextKind::Memory, text: memory.text });
        }
        if let Some(observation) = self.browser.latest_observation(request.mission_id) {
            blocks.push(AgentContextBlock { kind: AgentContextKind::Observation, text: observation.context_text() });
        }
        if let Some(observation) = self.computer.latest_observation(request.mission_id) {
            blocks.push(AgentContextBlock { kind: AgentContextKind::Observation, text: observation.context_text() });
        }
        blocks
    }
}

impl MissionObserver for Phase05Hooks {
    fn task_finished(&self, note: &TaskOutcomeNote) {
        self.memory.task_finished(note);
    }

    fn mission_finished(&self, note: &MissionOutcomeNote) {
        self.memory.mission_finished(note);
        let failed = note.state == "FAILED";
        self.browser.mission_finished(&note.mission_id, note.terminal, failed);
        self.computer.mission_finished(&note.mission_id, note.terminal, failed);
    }

    fn mission_cancelled(&self, mission_id: &str) {
        self.browser.mission_cancelled(mission_id);
        self.computer.mission_cancelled(mission_id);
    }
}
