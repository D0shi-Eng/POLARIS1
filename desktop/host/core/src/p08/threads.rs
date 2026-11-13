// إدارة المحادثات والمشاريع من قائمة «⋯» (Phase-08، ADR-031): إعادة التسمية، والتثبيت، والمفضّلة،
// والأرشفة، والنقل إلى مشروع، والحذف.
//
// المحادثة هنا هي المهمّة الأولى وأدوار متابعتها معًا: ما يُقرَّر لها يُطبَّق على كل أدوارها. الحذف حقيقي
// (`purge`)، ويُرفض ما دام دورٌ منها يعمل أو ينتظر قرارًا، فلا تُحذف مهمّة من تحت زمن تشغيلها. لا شيء هنا
// يشغّل أداة أو يكتب في مساحة مهمّة؛ الحذف يزيل مجلّد المساحة كلّه بعد نجاح حذف السجلّات.

use std::sync::Arc;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::audit::{AuditEventType, AuditLedger, AuditOutcome, AuditRecord};
use crate::p03::clock::RuntimeClock;
use crate::storage::Database;

use super::conversation::ConversationService;
use super::purge;
use super::workspace::WorkspaceRoot;

/// أقصى طول لعنوان يسمّيه المستخدم (عمود المهمّة يقبل 200).
pub const MAX_TITLE_CHARS: usize = 120;

/// حالات يعمل فيها دورٌ أو ينتظر قرارًا: لا حذف فيها.
const ACTIVE_STATES: [&str; 6] = ["PLANNING", "READY", "RUNNING", "VERIFYING", "WAITING_FOR_APPROVAL", "WAITING_FOR_USER"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ThreadError {
    InvalidId,
    UnknownThread,
    InvalidTitle,
    UnknownProject,
    StillRunning,
    Storage(String),
}

impl std::fmt::Display for ThreadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidId => write!(f, "the identifier is not one this host issues"),
            Self::UnknownThread => write!(f, "no such conversation"),
            Self::InvalidTitle => write!(f, "the title must be 1..{MAX_TITLE_CHARS} characters on one line"),
            Self::UnknownProject => write!(f, "no such project"),
            Self::StillRunning => write!(f, "a turn of this conversation is still working or waiting for a decision"),
            Self::Storage(e) => write!(f, "storage: {e}"),
        }
    }
}

fn storage(e: crate::storage::StorageError) -> ThreadError {
    ThreadError::Storage(e.to_string())
}

/// حالة محادثة كما تعبر إلى العارض.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ThreadState {
    pub thread_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub pinned: bool,
    pub favorite: bool,
    pub archived: bool,
}

/// ما يغيّره طلب واحد. الحقل الغائب لا يتغيّر؛ `project` بقيمة `Some(None)` يخرج المحادثة من مشروعها.
#[derive(Debug, Clone, Default)]
pub struct ThreadChanges {
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub favorite: Option<bool>,
    pub archived: Option<bool>,
    pub project: Option<Option<String>>,
}

/// نتيجة بحث: المحادثة، ومقطع حول المطابقة من نصّها الأصلي، ووقت آخر دور فيها.
#[derive(Debug, Clone, Serialize)]
pub struct SearchHit {
    pub thread_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub snippet: String,
    pub updated_at: String,
}

/// صفّ دور واحد كما يقرؤه البحث: محادثته وعنوانها ومشروعها، ووقته ورسالته وجوابه.
struct TurnRow {
    thread: String,
    title: String,
    project: Option<String>,
    at: String,
    message: String,
    answer: Option<String>,
    failure: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeleteReport {
    pub thread_id: String,
    pub missions: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectDeleteReport {
    pub project_id: String,
    /// محادثات المشروع التي خرجت منه إلى قائمة المهامّ العامّة (لا تُحذف).
    pub detached_missions: usize,
}

pub struct ThreadService {
    db: Arc<Database>,
    clock: RuntimeClock,
    workspaces: WorkspaceRoot,
    audit: Arc<AuditLedger>,
    conversations: Arc<ConversationService>,
}

/// عنوان من سطر واحد بلا محارف تحكّم، مقصوص الأطراف.
pub fn clean_title(raw: &str) -> Option<String> {
    let title = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let n = title.chars().count();
    ((1..=MAX_TITLE_CHARS).contains(&n) && !title.chars().any(char::is_control)).then_some(title)
}

impl ThreadService {
    pub fn new(db: Arc<Database>, clock: RuntimeClock, workspaces: WorkspaceRoot, audit: Arc<AuditLedger>, conversations: Arc<ConversationService>) -> Self {
        Self { db, clock, workspaces, audit, conversations }
    }

    /// البحث في المحادثات كما في مانوس: العنوان ورسائل المستخدم وأجوبة POLARIS، بلا اعتبار لفروق الإملاء العربي.
    /// طلب فارغ يعيد أحدث المحادثات ومقطعًا من آخر جواب. الأحدث أولًا، حتى `limit`.
    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        let query = query.split_whitespace().collect::<Vec<_>>().join(" ");
        let rows: Vec<TurnRow> = self
            .db
            .with(|c| {
                // كل دور (أو مهمّة ليست محادثة) مع محادثته: رسالته، وجوابه، ووقته.
                let mut stmt = c.prepare(
                    "SELECT COALESCE(t.thread_id, m.mission_id), root.title, root.project_id, m.created_at, COALESCE(t.message, m.objective), m.result_summary, m.failure_reason
                     FROM missions m
                     LEFT JOIN p08_conversation_turns t ON t.mission_id = m.mission_id
                     JOIN missions root ON root.mission_id = COALESCE(t.thread_id, m.mission_id)
                     ORDER BY m.created_at DESC",
                )?;
                let rows = stmt
                    .query_map([], |r| Ok(TurnRow { thread: r.get(0)?, title: r.get(1)?, project: r.get(2)?, at: r.get(3)?, message: r.get(4)?, answer: r.get(5)?, failure: r.get(6)? }))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default();
        let mut hits: Vec<SearchHit> = Vec::new();
        for TurnRow { thread, title, project, at, message, answer, failure } in rows {
            if hits.iter().any(|h| h.thread_id == thread) {
                continue;
            }
            let answer = answer.or(failure).unwrap_or_default();
            // بلا طلب، أو طابق العنوان: مقطع من أوّل الجواب. وإلا فمن موضع المطابقة في الرسالة أو الجواب.
            let snippet = if query.is_empty() || crate::text::find_folded(&title, &query).is_some() {
                Some(crate::text::snippet_around(&answer, 0, 120))
            } else if let Some(at) = crate::text::find_folded(&message, &query) {
                Some(crate::text::snippet_around(&message, at, 120))
            } else {
                crate::text::find_folded(&answer, &query).map(|at| crate::text::snippet_around(&answer, at, 120))
            };
            // محادثة لا يطابق دورُها الأحدث تبقى مرشّحة بأدوارها الأقدم: لا تُستبعد إلا بعد آخر دور فيها.
            if let Some(snippet) = snippet {
                hits.push(SearchHit { thread_id: thread, title, project_id: project, snippet, updated_at: at });
                if hits.len() >= limit.clamp(1, 50) {
                    break;
                }
            }
        }
        hits
    }

    /// هل المشروع موجود ونشط؟ (ذاكرة مشروع لا تُكتب لمشروع محذوف أو مؤرشف.)
    pub fn project_is_active(&self, project_id: &str) -> bool {
        crate::ids::is_uuid_v4(project_id)
            && self
                .db
                .with(|c| Ok(c.query_row("SELECT 1 FROM projects WHERE project_id = ?1 AND status = 'ACTIVE'", params![project_id], |_| Ok(())).optional()?.is_some()))
                .unwrap_or(false)
    }

    /// المحادثة التي تنتمي إليها مهمّة، ومهامّها (الأولى ثم المتابعات). مهمّة لا وجود لها: خطأ.
    fn resolve(&self, id: &str) -> Result<(String, Vec<String>), ThreadError> {
        if !crate::ids::is_uuid_v4(id) {
            return Err(ThreadError::InvalidId);
        }
        let thread = self.conversations.thread_of(id);
        let exists: bool = self.db.with(|c| Ok(c.query_row("SELECT 1 FROM missions WHERE mission_id = ?1", params![thread], |_| Ok(())).optional()?.is_some())).map_err(storage)?;
        if !exists {
            return Err(ThreadError::UnknownThread);
        }
        let mut missions = self.conversations.thread_missions(&thread);
        if missions.is_empty() {
            missions.push(thread.clone());
        }
        Ok((thread, missions))
    }

    /// حالة المحادثات التي قرّر المستخدم فيها شيئًا. المحادثة بلا صفّ: غير مثبّتة ولا مفضّلة ولا مؤرشفة.
    pub fn states(&self) -> Vec<ThreadState> {
        self.db
            .with(|c| {
                let mut stmt = c.prepare(
                    "SELECT s.thread_id, m.title, m.project_id, s.pinned, s.favorite, s.archived_at IS NOT NULL
                     FROM p08_conversation_state s JOIN missions m ON m.mission_id = s.thread_id ORDER BY s.thread_id",
                )?;
                let rows = stmt
                    .query_map([], |r| Ok(ThreadState { thread_id: r.get(0)?, title: r.get(1)?, project_id: r.get(2)?, pinned: r.get::<_, i64>(3)? == 1, favorite: r.get::<_, i64>(4)? == 1, archived: r.get(5)? }))?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
    }

    fn state_of(&self, thread: &str) -> Result<ThreadState, ThreadError> {
        self.db
            .with(|c| {
                Ok(c.query_row(
                    "SELECT m.mission_id, m.title, m.project_id, COALESCE(s.pinned, 0), COALESCE(s.favorite, 0), s.archived_at IS NOT NULL
                     FROM missions m LEFT JOIN p08_conversation_state s ON s.thread_id = m.mission_id WHERE m.mission_id = ?1",
                    params![thread],
                    |r| Ok(ThreadState { thread_id: r.get(0)?, title: r.get(1)?, project_id: r.get(2)?, pinned: r.get::<_, i64>(3)? == 1, favorite: r.get::<_, i64>(4)? == 1, archived: r.get(5)? }),
                )?)
            })
            .map_err(storage)
    }

    /// يطبّق تغييرات قائمة «⋯» على المحادثة كلّها في معاملة واحدة. الطلب بلا تغيير يعيد الحالة كما هي.
    pub fn update(&self, id: &str, changes: ThreadChanges) -> Result<ThreadState, ThreadError> {
        let (thread, missions) = self.resolve(id)?;
        let title = match &changes.title {
            Some(raw) => Some(clean_title(raw).ok_or(ThreadError::InvalidTitle)?),
            None => None,
        };
        if let Some(Some(project)) = &changes.project {
            if !crate::ids::is_uuid_v4(project) {
                return Err(ThreadError::UnknownProject);
            }
            let active: bool = self
                .db
                .with(|c| Ok(c.query_row("SELECT 1 FROM projects WHERE project_id = ?1 AND status = 'ACTIVE'", params![project], |_| Ok(())).optional()?.is_some()))
                .map_err(storage)?;
            if !active {
                return Err(ThreadError::UnknownProject);
            }
        }
        let now = self.clock.now();
        self.db
            .with(|c| {
                let tx = c.transaction().map_err(|e| crate::storage::StorageError::Query(e.to_string()))?;
                tx.execute("INSERT OR IGNORE INTO p08_conversation_state (thread_id, updated_at) VALUES (?1, ?2)", params![thread, now])?;
                if let Some(title) = &title {
                    for m in &missions {
                        tx.execute("UPDATE missions SET title = ?2 WHERE mission_id = ?1", params![m, title])?;
                    }
                    tx.execute("UPDATE p08_conversation_state SET renamed_at = ?2 WHERE thread_id = ?1", params![thread, now])?;
                }
                if let Some(pinned) = changes.pinned {
                    tx.execute("UPDATE p08_conversation_state SET pinned = ?2 WHERE thread_id = ?1", params![thread, i64::from(pinned)])?;
                }
                if let Some(favorite) = changes.favorite {
                    tx.execute("UPDATE p08_conversation_state SET favorite = ?2 WHERE thread_id = ?1", params![thread, i64::from(favorite)])?;
                }
                if let Some(archived) = changes.archived {
                    let at = archived.then(|| now.clone());
                    tx.execute("UPDATE p08_conversation_state SET archived_at = ?2 WHERE thread_id = ?1", params![thread, at])?;
                }
                if let Some(project) = &changes.project {
                    for m in &missions {
                        tx.execute("UPDATE missions SET project_id = ?2 WHERE mission_id = ?1", params![m, project])?;
                    }
                }
                tx.execute("UPDATE p08_conversation_state SET updated_at = ?2 WHERE thread_id = ?1", params![thread, now])?;
                tx.commit().map_err(|e| crate::storage::StorageError::Query(e.to_string()))?;
                Ok(())
            })
            .map_err(storage)?;
        let fields: Vec<&str> = [
            (title.is_some(), "title"),
            (changes.pinned.is_some(), "pinned"),
            (changes.favorite.is_some(), "favorite"),
            (changes.archived.is_some(), "archived"),
            (changes.project.is_some(), "project"),
        ]
        .into_iter()
        .filter_map(|(set, name)| set.then_some(name))
        .collect();
        let _ = self.audit.append(&AuditRecord::new(AuditEventType::ConversationChanged, "conversation", &thread, AuditOutcome::Success, json!({ "fields": fields, "turns": missions.len() })));
        self.state_of(&thread)
    }

    fn any_active(&self, missions: &[String]) -> Result<bool, ThreadError> {
        if let Ok(p03) = self.conversations.runtime() {
            if missions.iter().any(|m| p03.cancellation.is_running(m)) {
                return Ok(true);
            }
        }
        self.db
            .with(|c| {
                let mut stmt = c.prepare("SELECT state FROM missions WHERE mission_id = ?1")?;
                for m in missions {
                    let state: Option<String> = stmt.query_row(params![m], |r| r.get(0)).optional()?;
                    if state.is_some_and(|s| ACTIVE_STATES.contains(&s.as_str())) {
                        return Ok(true);
                    }
                }
                Ok(false)
            })
            .map_err(storage)
    }

    /// يحذف المحادثة حذفًا حقيقيًّا: أدوارها وسردها ومهامّها وأدلّتها ومخرجاتها وذاكرتها الخاصّة، ثم مجلّد
    /// مساحتها. يُرفض ما دام دورٌ منها يعمل أو ينتظر قرارًا: يُوقف أولًا.
    pub fn delete(&self, id: &str) -> Result<DeleteReport, ThreadError> {
        let (thread, missions) = self.resolve(id)?;
        if self.any_active(&missions)? {
            return Err(ThreadError::StillRunning);
        }
        // مجلّدات المساحة تُحسب قبل الحذف: المتابعات تشارك مجلّد المهمّة الأولى.
        let mut dirs: Vec<std::path::PathBuf> = missions.iter().map(|m| self.workspaces.dir_of(m)).collect();
        dirs.sort();
        dirs.dedup();
        self.db.with(|c| purge::purge_missions(c, &missions)).map_err(storage)?;
        let base = self.workspaces.base().to_path_buf();
        let mut removed_dirs = 0usize;
        for dir in dirs {
            // لا يُحذف إلا مجلّد مباشر تحت جذر المساحات باسم معرّف أصدره المضيف.
            let named = dir.file_name().and_then(|n| n.to_str()).is_some_and(crate::ids::is_uuid_v4);
            if named && dir.parent() == Some(base.as_path()) && dir.is_dir() && std::fs::remove_dir_all(&dir).is_ok() {
                removed_dirs += 1;
            }
        }
        let _ = self.audit.append(&AuditRecord::new(
            AuditEventType::ConversationDeleted,
            "conversation",
            &thread,
            AuditOutcome::Success,
            json!({ "turns": missions.len(), "workspace_folders": removed_dirs }),
        ));
        Ok(DeleteReport { thread_id: thread, missions: missions.len() })
    }

    /// يحذف مشروعًا: تعليماته ومصادره وذاكرته وإعداداته. محادثاته لا تُحذف، بل تخرج منه. يُرفض ما دامت
    /// مهمّة فيه تعمل.
    pub fn delete_project(&self, project_id: &str) -> Result<ProjectDeleteReport, ThreadError> {
        if !crate::ids::is_uuid_v4(project_id) {
            return Err(ThreadError::UnknownProject);
        }
        let missions: Option<Vec<String>> = self
            .db
            .with(|c| {
                if c.query_row("SELECT 1 FROM projects WHERE project_id = ?1", params![project_id], |_| Ok(())).optional()?.is_none() {
                    return Ok(None);
                }
                let mut stmt = c.prepare("SELECT mission_id FROM missions WHERE project_id = ?1")?;
                let rows = stmt.query_map(params![project_id], |r| r.get(0))?.collect::<Result<Vec<String>, _>>()?;
                Ok(Some(rows))
            })
            .map_err(storage)?;
        let missions = missions.ok_or(ThreadError::UnknownProject)?;
        if self.any_active(&missions)? {
            return Err(ThreadError::StillRunning);
        }
        self.db.with(|c| purge::purge_project(c, project_id)).map_err(storage)?;
        let _ = self.audit.append(&AuditRecord::new(AuditEventType::ProjectDeleted, "project", project_id, AuditOutcome::Success, json!({ "detached_missions": missions.len() })));
        Ok(ProjectDeleteReport { project_id: project_id.to_string(), detached_missions: missions.len() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_is_one_trimmed_line_within_bounds() {
        assert_eq!(clean_title("  تحية   قصيرة \n"), Some("تحية قصيرة".into()));
        assert_eq!(clean_title("   "), None);
        assert_eq!(clean_title(&"x".repeat(MAX_TITLE_CHARS + 1)), None);
        assert_eq!(clean_title(&"x".repeat(MAX_TITLE_CHARS)).map(|t| t.chars().count()), Some(MAX_TITLE_CHARS));
    }
}
