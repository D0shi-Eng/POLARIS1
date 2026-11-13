// تركيب Phase-05 وعملياته المقروءة. لا منطق إنفاذ هنا: الإنفاذ في بوابة Phase-04
// ونقطة قرار كل محوّل، والذاكرة في سياستها ومخزنها.
//
// ولا توجد في هذا الملف دالّة تنفّذ فعل متصفّح أو حاسوب استجابةً لعملية IPC. العمليات
// هنا تقرأ، وتحذف ذاكرة يملكها المستخدم، وتمنح نافذةً لمهمّة، وتوقف جلسة. الفعل نفسه
// يبدأ من زمن تشغيل المهمّة وحده، عبر البوابة.

use std::path::PathBuf;
use std::sync::Arc;

use serde::Serialize;

use polaris_host_providers::net::HttpClient;

use crate::audit::AuditLedger;
use crate::ipc::errors::{DesktopErrorCategory, HostError};
use crate::p03::clock::RuntimeClock;
use crate::p04::service::Phase04;
use crate::storage::{Database, StorageError};

use super::browser::engine::{BrowserEngine, FetchLimits};
use super::browser::runtime::BrowserRuntime;
use super::browser::store::BrowserStore;
use super::browser::tools::WebTool;
use super::browser::url_policy::NavigationPolicy;
use super::computer::port::DesktopPort;
use super::computer::runtime::{ComputerFailure, ComputerRuntime};
use super::computer::store::ComputerStore;
use super::computer::tools::DesktopTool;
use super::hooks::Phase05Hooks;
use super::memory::context::MemoryContextBudget;
use super::memory::model::{MemoryScope, MemoryStatus, MemoryType};
use super::memory::store::MemoryListFilter;
use super::memory::tool::MemoryProposeTool;
use super::memory::MemoryService;
use super::session::ActionBudget;
use super::skill::phase05_skills;
use super::view::*;

/// ما يحتاجه Phase-05 من محيطه.
pub struct Phase05Config {
    pub db: Arc<Database>,
    pub audit: Arc<AuditLedger>,
    pub clock: RuntimeClock,
    pub http: Arc<HttpClient>,
    pub phase04: Arc<Phase04>,
    /// منفذ سطح المكتب. Win32 الحقيقي على Windows، و«غير متاح» خارجه.
    pub desktop: Arc<dyn DesktopPort>,
    /// سياسة التنقّل. سياسة المنتج بلا تجهيزة، إلا في بناء القياس.
    pub navigation: NavigationPolicy,
    /// مجلّد التنزيلات المعزول. غيابه يعني أن لا تنزيل في هذا المضيف.
    pub downloads_root: Option<PathBuf>,
    pub budget: ActionBudget,
}

/// من يُغلق جلسة متصفّح بمعرّفها.
pub type SessionCloser = Arc<dyn Fn(&str) + Send + Sync>;

pub struct Phase05 {
    pub memory: Arc<MemoryService>,
    pub browser: Arc<BrowserRuntime>,
    pub computer: Arc<ComputerRuntime>,
    pub hooks: Arc<Phase05Hooks>,
    /// ما رفضه سجل Phase-04 عند التسجيل. يجب أن يكون فارغًا؛ يُعرض ولا يُبتلع.
    pub refused_registrations: Vec<(String, &'static str)>,
    /// جلسات أُغلقت عند هذا الإقلاع لأن عمليتها السابقة انتهت.
    pub sessions_closed_at_start: u32,
    /// من يُغلق جلسات متصفّح لا يملكها هذا المحرّك (محرّك Chromium في Phase-08) حين يوقفها
    /// المستخدم. الإيقاف يبقى عملية Phase-05 نفسها؛ هذا يوسّع من يسمعه ولا يغيّر العقد.
    session_closers: std::sync::Mutex<Vec<SessionCloser>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryListResult {
    pub memories: Vec<MemoryView>,
    pub label: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryGetResult {
    pub memory: MemoryDetailView,
    pub conflicts: Vec<MemoryConflictView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryDeleteResult {
    pub memory_id: String,
    pub deleted: bool,
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserSessionListResult {
    pub sessions: Vec<BrowserSessionView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserSessionGetResult {
    pub session: BrowserSessionView,
    pub actions: Vec<BrowserActionView>,
    pub downloads: Vec<DownloadView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionCancelResult {
    pub session_id: String,
    pub state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputerSessionListResult {
    pub sessions: Vec<ComputerSessionView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputerSessionGetResult {
    pub session: ComputerSessionView,
    pub actions: Vec<ComputerActionView>,
    pub observations: Vec<ObservationView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputerWindowListResult {
    pub available: bool,
    pub windows: Vec<DesktopWindowView>,
    pub grants: Vec<TargetView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputerGrantResult {
    pub grant: TargetView,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputerRevokeResult {
    pub grant_id: String,
    pub revoked: bool,
}

fn storage_error(error: StorageError) -> HostError {
    HostError::internal(format!("phase-05 storage: {error}"))
}

impl Phase05 {
    /// يبني الطبقة، ويغلق ما بقي مفتوحًا من إقلاع سابق، ويسجّل أدواتها ومهاراتها
    /// في سجل Phase-04 نفسه.
    pub fn build(config: Phase05Config) -> Result<Self, StorageError> {
        let memory = Arc::new(MemoryService::new(config.db.clone(), config.audit.clone(), config.clock.clone()));
        let browser = Arc::new(BrowserRuntime::new(
            BrowserEngine::new(config.http.clone(), config.navigation, FetchLimits::default()),
            BrowserStore::new(config.db.clone()),
            config.clock.clone(),
            config.audit.clone(),
            config.budget,
            config.downloads_root,
        ));
        let computer = Arc::new(ComputerRuntime::new(
            config.desktop,
            ComputerStore::new(config.db.clone()),
            config.clock.clone(),
            config.audit.clone(),
            config.budget,
        ));
        let sessions_closed_at_start = browser.recover_after_restart() + computer.recover_after_restart();

        let mut adapters = WebTool::all(&browser);
        adapters.extend(DesktopTool::all(&computer));
        adapters.push(Arc::new(MemoryProposeTool::new(memory.clone(), config.clock.clone())));
        let refused_registrations = config.phase04.register_extension(adapters, phase05_skills())?;

        let hooks = Arc::new(Phase05Hooks {
            memory: memory.clone(),
            browser: browser.clone(),
            computer: computer.clone(),
            memory_budget: MemoryContextBudget::default(),
        });
        Ok(Self { memory, browser, computer, hooks, refused_registrations, sessions_closed_at_start, session_closers: std::sync::Mutex::new(Vec::new()) })
    }

    // ——— الذاكرة.

    pub fn memory_list(&self, filter: MemoryListFilter) -> Result<MemoryListResult, HostError> {
        let entries = self.memory.list(&filter).map_err(storage_error)?;
        Ok(MemoryListResult { memories: entries.iter().map(MemoryView::of).collect(), label: super::memory::context::MEMORY_LABEL })
    }

    pub fn memory_get(&self, memory_id: &str) -> Result<MemoryGetResult, HostError> {
        let entry = self
            .memory
            .get(memory_id)
            .map_err(storage_error)?
            .ok_or_else(|| HostError::validation("no such memory").at("/memory_id"))?;
        let conflicts = self.memory.conflicts_for(memory_id).map_err(storage_error)?;
        Ok(MemoryGetResult { memory: MemoryDetailView::of(&entry), conflicts: conflicts.iter().map(MemoryConflictView::of).collect() })
    }

    pub fn memory_delete(&self, memory_id: &str) -> Result<MemoryDeleteResult, HostError> {
        let exists = self.memory.store().get(memory_id).map_err(storage_error)?;
        if exists.is_none() {
            return Err(HostError::validation("no such memory").at("/memory_id"));
        }
        let deleted = self.memory.delete(memory_id).map_err(storage_error)?;
        Ok(MemoryDeleteResult { memory_id: memory_id.to_string(), deleted, status: MemoryStatus::Deleted.as_str() })
    }

    // ——— المتصفّح.

    pub fn browser_sessions(&self, mission_id: Option<&str>) -> Result<BrowserSessionListResult, HostError> {
        let sessions = self.browser.store().sessions(mission_id).map_err(storage_error)?;
        Ok(BrowserSessionListResult { sessions: sessions.iter().map(BrowserSessionView::of).collect() })
    }

    pub fn browser_session(&self, session_id: &str) -> Result<BrowserSessionGetResult, HostError> {
        let session = self
            .browser
            .store()
            .session(session_id)
            .map_err(storage_error)?
            .ok_or_else(|| HostError::validation("no such browser session").at("/session_id"))?;
        let actions = self.browser.store().actions(session_id).map_err(storage_error)?;
        let downloads = self.browser.store().downloads(&session.mission_id).map_err(storage_error)?;
        Ok(BrowserSessionGetResult {
            session: BrowserSessionView::of(&session),
            actions: actions.iter().map(BrowserActionView::of).collect(),
            downloads: downloads.iter().filter(|d| d.session_id == session_id).map(DownloadView::of).collect(),
        })
    }

    /// يضيف من يُغلق جلسات متصفّح محرّك آخر يسجّلها في مخزن الجلسات نفسه (Phase-08).
    pub fn add_session_closer(&self, close: SessionCloser) {
        if let Ok(mut closers) = self.session_closers.lock() {
            closers.push(close);
        }
    }

    pub fn browser_cancel(&self, session_id: &str) -> Result<SessionCancelResult, HostError> {
        let stored = self
            .browser
            .store()
            .session(session_id)
            .map_err(storage_error)?
            .ok_or_else(|| HostError::validation("no such browser session").at("/session_id"))?;
        self.browser.close_by_user(session_id);
        if let Ok(closers) = self.session_closers.lock() {
            for close in closers.iter() {
                close(session_id);
            }
        }
        let state = self.browser.store().session(session_id).map_err(storage_error)?.map(|s| s.state).unwrap_or(stored.state);
        Ok(SessionCancelResult { session_id: session_id.to_string(), state })
    }

    // ——— الحاسوب.

    fn computer_view(&self, record: &super::computer::store::ComputerSessionRecord) -> ComputerSessionView {
        let observations = self.computer.store().observations(&record.session_id).unwrap_or_default();
        let actions = self.computer.store().actions(&record.session_id).unwrap_or_default();
        ComputerSessionView::of(record, observations.first(), actions.last())
    }

    pub fn computer_sessions(&self, mission_id: Option<&str>) -> Result<ComputerSessionListResult, HostError> {
        let sessions = self.computer.store().sessions(mission_id).map_err(storage_error)?;
        Ok(ComputerSessionListResult { sessions: sessions.iter().map(|s| self.computer_view(s)).collect() })
    }

    pub fn computer_session(&self, session_id: &str) -> Result<ComputerSessionGetResult, HostError> {
        let session = self
            .computer
            .store()
            .session(session_id)
            .map_err(storage_error)?
            .ok_or_else(|| HostError::validation("no such computer session").at("/session_id"))?;
        let actions = self.computer.store().actions(session_id).map_err(storage_error)?;
        let observations = self.computer.store().observations(session_id).map_err(storage_error)?;
        Ok(ComputerSessionGetResult {
            session: self.computer_view(&session),
            actions: actions.iter().map(ComputerActionView::of).collect(),
            observations: observations.iter().take(20).map(ObservationView::of).collect(),
        })
    }

    pub fn computer_cancel(&self, session_id: &str) -> Result<SessionCancelResult, HostError> {
        let stored = self
            .computer
            .store()
            .session(session_id)
            .map_err(storage_error)?
            .ok_or_else(|| HostError::validation("no such computer session").at("/session_id"))?;
        self.computer.close_by_user(session_id);
        let state = self.computer.store().session(session_id).map_err(storage_error)?.map(|s| s.state).unwrap_or(stored.state);
        Ok(SessionCancelResult { session_id: session_id.to_string(), state })
    }

    pub fn computer_windows(&self, mission_id: Option<&str>) -> Result<ComputerWindowListResult, HostError> {
        let available = self.computer.available();
        let windows = if available { self.computer.user_inventory().unwrap_or_default() } else { Vec::new() };
        let grants = match mission_id {
            Some(id) => self.computer.grants_for(id),
            None => Vec::new(),
        };
        Ok(ComputerWindowListResult {
            available,
            windows: windows.iter().map(DesktopWindowView::of).collect(),
            grants: grants.iter().map(TargetView::of).collect(),
        })
    }

    /// يمنح نافذة لمهمّة قائمة غير منتهية. التحقّق من المهمّة يقع عند المُوجِّه.
    pub fn computer_grant(&self, mission_id: &str, hwnd: u64) -> Result<ComputerGrantResult, HostError> {
        match self.computer.grant(mission_id, hwnd) {
            Ok(grant) => Ok(ComputerGrantResult { grant: TargetView::of(&grant) }),
            Err(ComputerFailure::Desktop(super::computer::port::DesktopError::Unavailable(detail))) => {
                Err(HostError::feature_not_available(format!("desktop control is unavailable: {detail}")))
            }
            Err(ComputerFailure::Desktop(super::computer::port::DesktopError::WindowGone)) => {
                Err(HostError::validation("no such window").at("/hwnd"))
            }
            Err(other) => Err(HostError::new(DesktopErrorCategory::ConfigUnavailable, "CONFLICT", other.detail())),
        }
    }

    pub fn computer_revoke(&self, grant_id: &str) -> Result<ComputerRevokeResult, HostError> {
        Ok(ComputerRevokeResult { grant_id: grant_id.to_string(), revoked: self.computer.revoke(grant_id) })
    }
}

/// يقرأ مرشّح قائمة الذاكرة من حمولة مُتحقَّق منها.
pub fn memory_filter(payload: &serde_json::Value) -> Result<MemoryListFilter, HostError> {
    let text = |key: &str| payload.get(key).and_then(serde_json::Value::as_str).map(str::to_string);
    let scope = match text("scope") {
        Some(s) => Some(MemoryScope::parse(&s).ok_or_else(|| HostError::validation("unknown scope").at("/scope"))?),
        None => None,
    };
    let memory_type = match text("memory_type") {
        Some(t) => Some(MemoryType::parse(&t).ok_or_else(|| HostError::validation("unknown memory type").at("/memory_type"))?),
        None => None,
    };
    let status = match text("status") {
        Some(s) => Some(MemoryStatus::parse(&s).ok_or_else(|| HostError::validation("unknown status").at("/status"))?),
        None => None,
    };
    Ok(MemoryListFilter {
        scope,
        memory_type,
        status,
        mission_id: text("mission_id"),
        project_id: text("project_id"),
        text: text("text"),
        limit: payload.get("limit").and_then(serde_json::Value::as_u64).unwrap_or(200) as usize,
    })
}
