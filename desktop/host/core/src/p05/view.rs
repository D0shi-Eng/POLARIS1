// ما يعبر حدّ IPC من Phase-05: معرّفات وحالات وأصناف وبصمات ونصوص محدودة.
//
// لا تفكير مخفي، ولا جسم صفحة، ولا بكسلات، ولا حجج خام. محتوى الذاكرة يُعرض في
// عرض المدخل الواحد مع وسمه، لأن المستخدم يملك ذاكرته ويجب أن يرى ما حُفظ عنه.

use serde::Serialize;

use crate::p04::adapter::bounded;

use super::browser::store::{BrowserActionRecord, BrowserSessionRecord, DownloadRecord};
use super::computer::runtime::InventoryWindow;
use super::computer::store::{ComputerActionRecord, ComputerSessionRecord, ObservationRecord, TargetGrant};
use super::memory::context::MEMORY_LABEL;
use super::memory::model::MemoryEntry;
use super::memory::store::MemoryConflict;

#[derive(Debug, Clone, Serialize)]
pub struct MemoryView {
    pub memory_id: String,
    pub memory_type: &'static str,
    pub scope: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub subject: String,
    pub summary: String,
    pub trust_class: &'static str,
    pub verification: &'static str,
    pub taint: Vec<&'static str>,
    pub confidence_source: &'static str,
    pub importance: u8,
    pub status: &'static str,
    pub version: u32,
    pub source: String,
    pub source_ref_count: u32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_accessed_at: Option<String>,
}

impl MemoryView {
    pub fn of(e: &MemoryEntry) -> Self {
        Self {
            memory_id: e.memory_id.clone(),
            memory_type: e.memory_type.as_str(),
            scope: e.scope.as_str(),
            mission_id: e.mission_id.clone(),
            project_id: e.project_id.clone(),
            subject: e.subject.clone(),
            summary: e.summary.clone(),
            trust_class: e.trust_class.as_str(),
            verification: e.verification.as_str(),
            taint: e.taint.flags().iter().map(|f| f.as_str()).collect(),
            confidence_source: e.confidence_source.as_str(),
            importance: e.importance,
            status: e.status.as_str(),
            version: e.version,
            // مدخل محذوف مُحيت أصوله، والعقد لا يقبل مصدرًا فارغًا: يُسمّى المحو باسمه.
            source: if e.provenance.producer.trim().is_empty() { "erased".to_string() } else { bounded(&e.provenance.producer, 120) },
            source_ref_count: e.source_refs.len() as u32,
            created_at: e.created_at.clone(),
            updated_at: e.updated_at.clone(),
            last_accessed_at: e.last_accessed_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceRefView {
    pub kind: &'static str,
    pub reference: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryDetailView {
    #[serde(flatten)]
    pub entry: MemoryView,
    pub content: String,
    pub label: &'static str,
    pub source_refs: Vec<SourceRefView>,
    pub lineage: Vec<String>,
}

impl MemoryDetailView {
    pub fn of(e: &MemoryEntry) -> Self {
        Self {
            entry: MemoryView::of(e),
            content: e.content.clone(),
            label: MEMORY_LABEL,
            source_refs: e
                .source_refs
                .iter()
                .filter(|r| !r.reference.trim().is_empty())
                .take(24)
                .map(|r| SourceRefView { kind: r.kind.as_str(), reference: bounded(&r.reference, 200) })
                .collect(),
            lineage: e.provenance.lineage.iter().filter(|l| !l.trim().is_empty()).take(24).map(|l| bounded(l, 200)).collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryConflictView {
    pub conflict_id: String,
    pub memory_a: String,
    pub memory_b: String,
    pub subject: String,
    pub state: &'static str,
    pub detected_at: String,
}

impl MemoryConflictView {
    pub fn of(c: &MemoryConflict) -> Self {
        Self {
            conflict_id: c.conflict_id.clone(),
            memory_a: c.memory_a.clone(),
            memory_b: c.memory_b.clone(),
            subject: c.subject.clone(),
            state: c.state.as_str(),
            detected_at: c.detected_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserSessionView {
    pub session_id: String,
    pub mission_id: String,
    pub owner_agent_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_title: Option<String>,
    pub navigation_count: u32,
    pub action_count: u32,
    pub download_count: u32,
    pub upload_count: u32,
    pub trust: &'static str,
    pub created_at: String,
    pub last_activity_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_reason: Option<String>,
}

impl BrowserSessionView {
    pub fn of(r: &BrowserSessionRecord) -> Self {
        Self {
            session_id: r.session_id.clone(),
            mission_id: r.mission_id.clone(),
            owner_agent_id: r.owner_agent_id.clone(),
            state: r.state.clone(),
            current_origin: r.current_origin.clone(),
            current_url: r.current_url.as_deref().map(|u| bounded(u, 600)),
            current_title: r.current_title.clone(),
            navigation_count: r.navigation_count,
            action_count: r.action_count,
            download_count: r.download_count,
            upload_count: r.upload_count,
            trust: "WEB_UNTRUSTED",
            created_at: r.created_at.clone(),
            last_activity_at: r.last_activity_at.clone(),
            closed_reason: r.closed_reason.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BrowserActionView {
    pub action_id: String,
    pub task_id: String,
    pub action: String,
    pub target: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_digest: Option<String>,
    pub outcome: String,
    pub occurred_at: String,
    pub duration_ms: u64,
}

impl BrowserActionView {
    pub fn of(a: &BrowserActionRecord) -> Self {
        Self {
            action_id: a.action_id.clone(),
            task_id: a.task_id.clone(),
            action: a.action.clone(),
            target: bounded(&a.target, 300),
            status: a.status.clone(),
            reason_code: a.reason_code.clone(),
            url: a.url.as_deref().map(|u| bounded(u, 600)),
            http_status: a.http_status,
            content_digest: a.content_digest.clone(),
            outcome: a.outcome.clone(),
            occurred_at: a.occurred_at.clone(),
            duration_ms: a.duration_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadView {
    pub download_id: String,
    pub file_name: String,
    pub byte_count: u64,
    pub sha256: String,
    pub content_type: String,
    pub executable: bool,
    pub trust: String,
    pub downloaded_at: String,
}

impl DownloadView {
    pub fn of(d: &DownloadRecord) -> Self {
        Self {
            download_id: d.download_id.clone(),
            file_name: d.file_name.clone(),
            byte_count: d.byte_count,
            sha256: d.sha256.clone(),
            content_type: d.content_type.clone(),
            executable: d.executable,
            trust: d.trust.clone(),
            downloaded_at: d.downloaded_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetView {
    pub grant_id: String,
    pub mission_id: String,
    pub title: String,
    pub executable: String,
    pub pid: u32,
    pub hwnd: String,
    pub process_created_at: String,
    pub granted_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
}

impl TargetView {
    pub fn of(g: &TargetGrant) -> Self {
        Self {
            grant_id: g.grant_id.clone(),
            mission_id: g.mission_id.clone(),
            title: bounded(&g.title, 200),
            executable: g.identity.executable_name(),
            pid: g.identity.pid,
            hwnd: format!("{:#x}", g.identity.hwnd),
            process_created_at: g.identity.process_created_at.to_string(),
            granted_at: g.granted_at.clone(),
            revoked_at: g.revoked_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservationView {
    pub observation_id: String,
    pub observed_at: String,
    pub width: u32,
    pub height: u32,
    pub frame_digest: String,
    pub layout_digest: String,
    pub element_count: u32,
    pub capture_scope: &'static str,
    pub trust: &'static str,
}

impl ObservationView {
    pub fn of(o: &ObservationRecord) -> Self {
        Self {
            observation_id: o.observation_id.clone(),
            observed_at: o.observed_at.clone(),
            width: o.width,
            height: o.height,
            frame_digest: o.frame_digest.clone(),
            layout_digest: o.layout_digest.clone(),
            element_count: o.element_count,
            capture_scope: "WINDOW",
            trust: "UNTRUSTED_CONTENT",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputerSessionView {
    pub session_id: String,
    pub mission_id: String,
    pub agent_id: String,
    pub state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<TargetView>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_action_at: Option<String>,
    pub action_count: u32,
    pub click_count: u32,
    pub keyboard_count: u32,
    pub capture_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_observation: Option<ObservationView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_action: Option<ComputerActionView>,
}

impl ComputerSessionView {
    pub fn of(r: &ComputerSessionRecord, last_observation: Option<&ObservationRecord>, last_action: Option<&ComputerActionRecord>) -> Self {
        Self {
            session_id: r.session_id.clone(),
            mission_id: r.mission_id.clone(),
            agent_id: r.agent_id.clone(),
            state: r.state.clone(),
            target: r.target.as_ref().map(TargetView::of),
            created_at: r.created_at.clone(),
            last_action_at: r.last_action_at.clone(),
            action_count: r.action_count,
            click_count: r.click_count,
            keyboard_count: r.keyboard_count,
            capture_count: r.capture_count,
            closed_reason: r.closed_reason.clone(),
            last_observation: last_observation.map(ObservationView::of),
            last_action: last_action.map(ComputerActionView::of),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ComputerActionView {
    pub action_id: String,
    pub task_id: String,
    pub action: String,
    pub target: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation_digest: Option<String>,
    pub occurred_at: String,
    pub duration_ms: u64,
}

impl ComputerActionView {
    pub fn of(a: &ComputerActionRecord) -> Self {
        Self {
            action_id: a.action_id.clone(),
            task_id: a.task_id.clone(),
            action: a.action.clone(),
            target: bounded(&a.target, 300),
            status: a.status.clone(),
            reason_code: a.reason_code.clone(),
            observation_digest: a.observation_digest.clone(),
            occurred_at: a.occurred_at.clone(),
            duration_ms: a.duration_ms,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DesktopWindowView {
    pub hwnd: String,
    pub title: String,
    pub executable: String,
    pub pid: u32,
    pub grantable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

impl DesktopWindowView {
    pub fn of(w: &InventoryWindow) -> Self {
        Self { hwnd: w.hwnd.clone(), title: w.title.clone(), executable: w.executable.clone(), pid: w.pid, grantable: w.grantable, reason: w.reason }
    }
}
