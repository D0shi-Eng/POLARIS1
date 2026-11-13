// المحادثة (Phase-08): رسائل المستخدم أدوارٌ في مهمّة واحدة كما يراها، وسرد المهمّة الحيّ.
//
// كل دور مهمّة Phase-03 عادية بإثباتها وحالتها ومسار نموذجها وبوابة أدواتها؛ لا تُعاد مهمّة منتهية
// إلى التشغيل ولا تُكسر آلة الحالة. المتابعة تنشئ الدور التالي: يرث مشروع المحادثة ونموذجها ومساحة
// ملفاتها، ويحمل هدفُه الرسالةَ الجديدة مع سياق محدود من الأدوار السابقة. الواجهة تعرض الرسالة كما
// كتبها المستخدم (من هذا الجدول)، لا الهدف المركّب.
//
// السرد يبلّغه زمن التشغيل عبر مراقب المهمّة فيُحفظ هنا بترتيبه ووقته، و«يفكّر» حالة في الذاكرة
// ما دام نداء نموذج جاريًا. لا شيء هنا يشغّل أداة أو يكتب في مساحة مهمّة.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use crate::p03::clock::RuntimeClock;
use crate::p03::mission::{ExecutionMode, MissionBudget, MissionPriority, MissionState};
use crate::p03::port::{ConversationPolicy, MissionObserver, NarrationNote};
use crate::p03::service::{CreateMissionInput, Phase03};
use crate::storage::Database;

use super::missions::MissionPreferences;
use super::workspace::WorkspaceRoot;

/// أقصى طول لرسالة متابعة. الهدف المركّب كلّه محدود بعمود المهمّة (8000 محرف).
pub const MAX_MESSAGE_CHARS: usize = 6_000;
/// أدوار سابقة تدخل سياق المتابعة، الأحدث أولًا في الاختيار.
const ENTRY_LIMIT: usize = 2_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversationError {
    InvalidMission,
    UnknownMission,
    EmptyMessage,
    MessageTooLong,
    StillRunning,
    AwaitingDecision,
    RuntimeGone,
    Storage(String),
    Create(String),
}

impl std::fmt::Display for ConversationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidMission => write!(f, "mission_id is not valid"),
            Self::UnknownMission => write!(f, "no such mission"),
            Self::EmptyMessage => write!(f, "the message is empty"),
            Self::MessageTooLong => write!(f, "the message is longer than {MAX_MESSAGE_CHARS} characters"),
            Self::StillRunning => write!(f, "the conversation is still working on the previous message"),
            Self::AwaitingDecision => write!(f, "the conversation is waiting for an approval decision"),
            Self::RuntimeGone => write!(f, "the mission runtime is gone"),
            Self::Storage(e) => write!(f, "storage: {e}"),
            Self::Create(e) => write!(f, "{e}"),
        }
    }
}

/// دور واحد كما يعبر إلى العارض.
#[derive(Debug, Clone, Serialize)]
pub struct TurnView {
    pub mission_id: String,
    pub seq: i64,
    pub message: String,
    pub created_at: String,
    pub state: &'static str,
    pub completion_proof_status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    /// النموذج المختار لهذا الدور، إن اختير (غيابه: التوجيه الافتراضي).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// متخصّص ثبّته المستخدم لهذا الدور، إن ثُبّت (غيابه: يختار زمن التشغيل لكل خطوة).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub specialist_id: Option<String>,
    /// تقييم المستخدم لهذا الدور، إن قيّمه (E-5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<u8>,
    /// رسائل كتبها المستخدم والدور يعمل، بحالتها (ADR-042).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<NoteView>,
}

/// سطر سرد كما يعبر إلى العارض.
#[derive(Debug, Clone, Serialize)]
pub struct EntryView {
    pub entry_id: i64,
    pub mission_id: String,
    pub kind: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConversationView {
    pub thread_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub turns: Vec<TurnView>,
    pub entries: Vec<EntryView>,
    /// نداء نموذج جارٍ للدور الأخير الآن.
    pub thinking: bool,
}

/// متابعة: الدور الجديد في المحادثة.
#[derive(Debug, Clone, Serialize)]
pub struct ContinueResult {
    pub thread_id: String,
    pub mission_id: String,
    pub seq: i64,
}

pub struct ConversationService {
    db: Arc<Database>,
    clock: RuntimeClock,
    workspaces: WorkspaceRoot,
    preferences: Arc<MissionPreferences>,
    phase03: OnceLock<Weak<Phase03>>,
    /// نداءات النموذج الجارية لكل مهمّة.
    thinking: Mutex<HashMap<String, u32>>,
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max.saturating_sub(1)).collect::<String>())
    }
}

impl ConversationService {
    pub fn new(db: Arc<Database>, clock: RuntimeClock, workspaces: WorkspaceRoot, preferences: Arc<MissionPreferences>) -> Self {
        let service = Self { db, clock, workspaces, preferences, phase03: OnceLock::new(), thinking: Mutex::new(HashMap::new()) };
        // المشاركة في المساحة تُستعاد من الجدول بعد كل إقلاع.
        for (mission, thread) in service.follow_ups() {
            let _ = service.workspaces.share(&mission, &thread);
        }
        service
    }

    /// يربط زمن تشغيل المهامّ (مرجع ضعيف: المحادثة لا تُبقيه حيًّا). مرة واحدة.
    pub fn bind(&self, phase03: Weak<Phase03>) {
        let _ = self.phase03.set(phase03);
    }

    pub(crate) fn runtime(&self) -> Result<Arc<Phase03>, ConversationError> {
        self.phase03.get().and_then(Weak::upgrade).ok_or(ConversationError::RuntimeGone)
    }

    fn storage<T>(r: Result<T, crate::storage::StorageError>) -> Result<T, ConversationError> {
        r.map_err(|e| ConversationError::Storage(e.to_string()))
    }

    /// دور المهمّة في محادثتها: (المحادثة، الترتيب، الرسالة)، إن كانت دورًا.
    fn turn_of(&self, mission_id: &str) -> Option<(String, i64, String)> {
        self.db
            .with(|c| Ok(c.query_row("SELECT thread_id, seq, message FROM p08_conversation_turns WHERE mission_id = ?1", params![mission_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?))
            .ok()
            .flatten()
    }

    /// مهامّ المتابعة (الدور ≥ 1) ومحادثاتها: ما تُخفيه قائمة المهامّ لأنه يظهر داخل محادثته.
    pub fn follow_ups(&self) -> Vec<(String, String)> {
        self.db
            .with(|c| {
                let mut stmt = c.prepare("SELECT mission_id, thread_id FROM p08_conversation_turns WHERE seq > 0 ORDER BY thread_id, seq")?;
                let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
    }

    /// يجعل مهمّة أُنشئت للتوّ الدورَ الأول في محادثة جديدة. متكرّر بلا أثر ثانٍ.
    pub fn begin(&self, mission_id: &str) -> Result<String, ConversationError> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err(ConversationError::InvalidMission);
        }
        if let Some((thread, _, _)) = self.turn_of(mission_id) {
            return Ok(thread);
        }
        let p03 = self.runtime()?;
        let snapshot = p03.repository.load(mission_id).map_err(|_| ConversationError::UnknownMission)?;
        let message = clip(snapshot.mission.objective.trim(), 20_000);
        let message = if message.is_empty() { snapshot.mission.title.clone() } else { message };
        Self::storage(self.db.with(|c| {
            c.execute(
                "INSERT OR IGNORE INTO p08_conversation_turns (mission_id, thread_id, seq, message, created_at) VALUES (?1, ?1, 0, ?2, ?3)",
                params![mission_id, message, snapshot.mission.created_at],
            )?;
            Ok(())
        }))?;
        Ok(mission_id.to_string())
    }

    /// المحادثة التي تنتمي إليها مهمّة: محادثتها إن كانت دورًا، وإلا فهي نفسها.
    pub fn thread_of(&self, mission_id: &str) -> String {
        self.turn_of(mission_id).map(|(t, _, _)| t).unwrap_or_else(|| mission_id.to_string())
    }

    /// مهامّ المحادثة بترتيب أدوارها (فارغة لمهمّة ليست محادثة).
    pub(crate) fn thread_missions(&self, thread_id: &str) -> Vec<String> {
        self.turns(thread_id).into_iter().map(|(m, _, _, _)| m).collect()
    }

    /// هل سمّى المستخدم المحادثة بنفسه؟ عنوانه لا يستبدله عنوان يقترحه المخطّط.
    fn renamed_by_user(&self, thread_id: &str) -> bool {
        self.db
            .with(|c| Ok(c.query_row("SELECT renamed_at IS NOT NULL FROM p08_conversation_state WHERE thread_id = ?1", params![thread_id], |r| r.get::<_, bool>(0)).optional()?))
            .ok()
            .flatten()
            .unwrap_or(false)
    }

    fn turns(&self, thread_id: &str) -> Vec<(String, i64, String, String)> {
        self.db
            .with(|c| {
                let mut stmt = c.prepare("SELECT mission_id, seq, message, created_at FROM p08_conversation_turns WHERE thread_id = ?1 ORDER BY seq")?;
                let rows = stmt.query_map(params![thread_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
    }

    /// يضيف رسالة المستخدم دورًا تاليًا في المحادثة، وينشئ مهمّته (لا يبدؤها: البدء عملية Phase-03
    /// نفسها بجلستها وموافقاتها). المهمّة الجديدة ترث المشروع والنموذج ومساحة الملفات.
    pub fn continue_thread(&self, mission_id: &str, message: &str) -> Result<ContinueResult, ConversationError> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err(ConversationError::InvalidMission);
        }
        let message = message.trim();
        if message.is_empty() {
            return Err(ConversationError::EmptyMessage);
        }
        if message.chars().count() > MAX_MESSAGE_CHARS {
            return Err(ConversationError::MessageTooLong);
        }
        let p03 = self.runtime()?;
        // مهمّة قديمة لم تُعلَن محادثةً تصير الدور الأول في محادثتها الآن.
        let thread_id = match self.turn_of(mission_id) {
            Some((thread, _, _)) => thread,
            None => self.begin(mission_id)?,
        };
        let turns = self.turns(&thread_id);
        let (last_id, last_seq, _, _) = turns.last().cloned().ok_or(ConversationError::UnknownMission)?;
        if p03.cancellation.is_running(&last_id) {
            return Err(ConversationError::StillRunning);
        }
        let root = p03.repository.load(&thread_id).map_err(|_| ConversationError::UnknownMission)?;
        let last = p03.repository.load(&last_id).map_err(|_| ConversationError::UnknownMission)?;
        match last.mission.state {
            MissionState::WaitingForApproval => return Err(ConversationError::AwaitingDecision),
            MissionState::Planning | MissionState::Ready | MissionState::Running | MissionState::Verifying => return Err(ConversationError::StillRunning),
            _ => {}
        }

        // الهدف رسالة المستخدم وحدها (خطة 2026-10-07، ADR-041): الأدوار السابقة في سجلّ جلسة المحادثة، يقرؤها زمن التشغيل
        // محادثةً كما هي. قِيس قبلها أن لصقها هنا (بحدّ 7900 حرف) لوّث العنوان ومطابقة المتخصّص واستعلام الذاكرة والعقد.
        let objective = message.to_string();

        let created = p03
            .create(CreateMissionInput {
                title: root.mission.title.clone(),
                objective,
                project_id: root.mission.project_id.clone(),
                execution_mode: ExecutionMode::SingleAgent,
                priority: MissionPriority::Normal,
                budget: MissionBudget::extended(),
                requirements: Vec::new(),
            })
            .map_err(|e| ConversationError::Create(e.diagnostic_line()))?;
        let new_id = created.mission_id;
        // النموذج يرث اختيار الدور السابق (ثم الأول): رسالة المتابعة لا تحمل اختيارًا بنفسها.
        let inherited = self.preferences.get(&last_id).and_then(|(m, _, _)| m).or_else(|| self.preferences.get(&thread_id).and_then(|(m, _, _)| m));
        if let Some(model) = inherited.as_deref() {
            self.preferences.set(&new_id, Some(model), None).map_err(ConversationError::Create)?;
        }
        // والمتخصّص المثبَّت يُورث كذلك: من اختار «المحلل المالي» لمحادثة يبقى معه في متابعاتها.
        let pinned = self.preferences.specialist(&last_id).or_else(|| self.preferences.specialist(&thread_id));
        if let Some(specialist) = pinned.as_deref() {
            self.preferences.set_specialist(&new_id, Some(specialist)).map_err(ConversationError::Create)?;
        }
        let seq = last_seq + 1;
        let now = self.clock.now();
        Self::storage(self.db.with(|c| {
            c.execute(
                "INSERT INTO p08_conversation_turns (mission_id, thread_id, seq, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id, thread_id, seq, message, now],
            )?;
            Ok(())
        }))?;
        let _ = self.workspaces.share(&new_id, &thread_id);
        // الدور السابق إن انتهى محجوبًا صار مُتجاوَزًا: لا مسار يستأنفه بعد أن صار للمحادثة دور أحدث (E-3).
        if last.mission.state == MissionState::Blocked {
            p03.close_superseded(&last_id);
        }
        Ok(ContinueResult { thread_id, mission_id: new_id, seq })
    }

    /// إصلاح الإقلاع (E-3): كل دور محجوب يليه دور أحدث في محادثته تُغلق خطواته المفتوحة. متكرّر بلا أثر ثانٍ.
    pub fn close_superseded_turns(&self) -> u32 {
        let Ok(p03) = self.runtime() else { return 0 };
        let superseded: Vec<String> = self
            .db
            .with(|c| {
                let mut stmt = c.prepare(
                    "SELECT t.mission_id FROM p08_conversation_turns t JOIN missions m ON m.mission_id = t.mission_id
                     WHERE m.state = 'BLOCKED' AND EXISTS (SELECT 1 FROM p08_conversation_turns n WHERE n.thread_id = t.thread_id AND n.seq > t.seq)
                     ORDER BY t.thread_id, t.seq",
                )?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default();
        superseded.iter().map(|id| p03.close_superseded(id)).sum()
    }

    /// المحادثة كاملة: أدوارها بحالاتها وأجوبتها، وسرد كل دور بترتيبه.
    pub fn view(&self, mission_id: &str) -> Result<ConversationView, ConversationError> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err(ConversationError::InvalidMission);
        }
        let p03 = self.runtime()?;
        let thread_id = self.thread_of(mission_id);
        let root = p03.repository.load(&thread_id).map_err(|_| ConversationError::UnknownMission)?;
        let mut rows = self.turns(&thread_id);
        if rows.is_empty() {
            // مهمّة ليست محادثة: دور واحد رسالته هدفها.
            rows.push((thread_id.clone(), 0, root.mission.objective.clone(), root.mission.created_at.clone()));
        }
        let mut turns = Vec::new();
        for (turn_id, seq, message, created_at) in &rows {
            let Ok(snapshot) = p03.repository.load(turn_id) else { continue };
            let m = snapshot.mission;
            turns.push(TurnView {
                mission_id: turn_id.clone(),
                seq: *seq,
                message: message.clone(),
                created_at: created_at.clone(),
                state: m.state.as_str(),
                completion_proof_status: m.completion_proof_status.as_str(),
                started_at: m.started_at,
                completed_at: m.completed_at,
                answer: m.result_summary,
                failure_reason: m.failure_reason,
                model_id: self.preferences.get(turn_id).and_then(|(model, _, _)| model),
                specialist_id: self.preferences.specialist(turn_id),
                rating: self.rating_of(turn_id),
                notes: self.notes_of(turn_id),
            });
        }
        let ids: Vec<String> = turns.iter().map(|t| t.mission_id.clone()).collect();
        let entries = Self::storage(self.db.with(|c| {
            let mut out = Vec::new();
            let mut stmt = c.prepare("SELECT entry_id, mission_id, kind, body, detail, created_at FROM p08_conversation_entries WHERE mission_id = ?1 ORDER BY entry_id LIMIT 400")?;
            for id in &ids {
                let rows = stmt
                    .query_map(params![id], |r| Ok(EntryView { entry_id: r.get(0)?, mission_id: r.get(1)?, kind: r.get(2)?, text: r.get(3)?, detail: r.get(4)?, created_at: r.get(5)? }))?
                    .collect::<Result<Vec<_>, _>>()?;
                out.extend(rows);
            }
            Ok(out)
        }))?;
        let thinking = ids.last().is_some_and(|id| self.thinking.lock().map(|m| m.get(id).copied().unwrap_or(0) > 0).unwrap_or(false));
        Ok(ConversationView { thread_id, title: root.mission.title, project_id: root.mission.project_id, turns, entries, thinking })
    }
}

impl ConversationService {
    /// معرّف محادثة الدور، للقراءة (عارض التتبّع).
    pub fn thread_of_mission_id(&self, mission_id: &str) -> Option<String> {
        self.turn_of(mission_id).map(|(thread, _, _)| thread)
    }
}

impl ConversationPolicy for ConversationService {
    fn is_conversation(&self, mission_id: &str) -> bool {
        self.turn_of(mission_id).is_some()
    }

    fn thread_of_mission(&self, mission_id: &str) -> Option<String> {
        self.turn_of(mission_id).map(|(thread, _, _)| thread)
    }

    fn earlier_turns(&self, mission_id: &str) -> Vec<(String, String)> {
        let Some((thread, seq, _)) = self.turn_of(mission_id) else { return Vec::new() };
        self.turns(&thread).into_iter().filter(|(_, s, _, _)| *s < seq).map(|(id, _, message, _)| (id, message)).collect()
    }

    /// يسلّم رسائل الطابور مرّة واحدة بترتيبها ويعلّمها مسلَّمة بوقتها، في معاملة واحدة: لا رسالة تُسلَّم مرتين.
    fn take_pending_notes(&self, mission_id: &str) -> Vec<String> {
        let now = self.clock.now();
        self.db
            .with(|c| {
                let tx = c.transaction()?;
                let notes: Vec<(String, String)> = {
                    let mut stmt = tx.prepare("SELECT note_id, text FROM p08_turn_notes WHERE mission_id = ?1 AND state = 'QUEUED' ORDER BY seq")?;
                    let rows = stmt.query_map(params![mission_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<Vec<_>, _>>()?;
                    rows
                };
                for (id, _) in &notes {
                    tx.execute("UPDATE p08_turn_notes SET state = 'DELIVERED', delivered_at = ?2 WHERE note_id = ?1 AND state = 'QUEUED'", params![id, now])?;
                }
                tx.commit()?;
                Ok(notes.into_iter().map(|(_, text)| text).collect())
            })
            .unwrap_or_default()
    }
}

/// تقييم المستخدم لدور (E-5) كما يُحفظ ويعود.
#[derive(Debug, Clone, Serialize)]
pub struct RatingView {
    pub mission_id: String,
    pub rating: u8,
    pub rated_at: String,
}

/// رسالة كتبها المستخدم والمهمّة تعمل (ADR-042).
#[derive(Debug, Clone, Serialize)]
pub struct NoteView {
    pub note_id: String,
    pub mission_id: String,
    pub seq: i64,
    pub text: String,
    pub state: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivered_at: Option<String>,
}

/// حالات مهمّة يُقبل فيها طابور الرسائل: تعمل أو تنتظر قرارًا وستُستأنف.
const ACCEPTS_NOTES: [MissionState; 5] = [MissionState::Planning, MissionState::Ready, MissionState::Running, MissionState::Verifying, MissionState::WaitingForApproval];

/// أقصى ما يُقبل من رسائل أثناء دور واحد.
const MAX_NOTES_PER_TURN: i64 = 50;

impl ConversationService {
    /// يحفظ تقييم دور انتهى (E-5). كان في `localStorage` وحده فيضيع مع ملف WebView2 ولا يُقرأ. يبقى على هذا الجهاز ولا يُرسل.
    pub fn rate(&self, mission_id: &str, rating: u8) -> Result<RatingView, ConversationError> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err(ConversationError::InvalidMission);
        }
        if !(1..=5).contains(&rating) {
            return Err(ConversationError::Create("rating must be between 1 and 5".into()));
        }
        let p03 = self.runtime()?;
        let snapshot = p03.repository.load(mission_id).map_err(|_| ConversationError::UnknownMission)?;
        if !snapshot.mission.state.is_terminal() {
            return Err(ConversationError::StillRunning);
        }
        let now = self.clock.now();
        Self::storage(self.db.with(|c| {
            c.execute(
                "INSERT INTO p08_mission_ratings (mission_id, rating, rated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (mission_id) DO UPDATE SET rating = excluded.rating, rated_at = excluded.rated_at",
                params![mission_id, rating as i64, now],
            )?;
            Ok(())
        }))?;
        Ok(RatingView { mission_id: mission_id.to_string(), rating, rated_at: now })
    }

    fn rating_of(&self, mission_id: &str) -> Option<u8> {
        self.db
            .with(|c| Ok(c.query_row("SELECT rating FROM p08_mission_ratings WHERE mission_id = ?1", params![mission_id], |r| r.get::<_, i64>(0)).optional()?))
            .ok()
            .flatten()
            .map(|r| r as u8)
    }

    /// يضع رسالة في طابور دور يعمل (ADR-042). لا تقاطع التنفيذ: يقرؤها الوكيل رسالةَ مستخدم عند الحدّ الآمن التالي بين خطوتين، ولا
    /// تدخل تعليمة النظام ولا تغيّر الصلاحيات. دور انتهى يُرفض: الرسالة تصير متابعة. وبعد الإدراج يُعاد فحص الحالة، فرسالة سبقت
    /// نهاية الدور بلحظة تُعلَّم «لم تصل» ولا تبقى معلّقة.
    pub fn add_note(&self, mission_id: &str, text: &str) -> Result<NoteView, ConversationError> {
        if !crate::ids::is_uuid_v4(mission_id) {
            return Err(ConversationError::InvalidMission);
        }
        let text = text.trim();
        if text.is_empty() {
            return Err(ConversationError::EmptyMessage);
        }
        if text.chars().count() > 2_000 {
            return Err(ConversationError::MessageTooLong);
        }
        let p03 = self.runtime()?;
        let active = |p03: &Phase03| p03.repository.load(mission_id).map(|s| ACCEPTS_NOTES.contains(&s.mission.state)).unwrap_or(false);
        if !active(&p03) {
            return Err(ConversationError::Create("NOT_RUNNING: the mission is not running; send the message as a follow-up instead".into()));
        }
        let note_id = crate::ids::new_uuid_v4();
        let now = self.clock.now();
        let seq = Self::storage(self.db.with(|c| {
            let tx = c.transaction()?;
            let seq: i64 = tx.query_row("SELECT COALESCE(MAX(seq), 0) + 1 FROM p08_turn_notes WHERE mission_id = ?1", params![mission_id], |r| r.get(0))?;
            if seq > MAX_NOTES_PER_TURN {
                return Err(crate::storage::StorageError::Invalid(format!("at most {MAX_NOTES_PER_TURN} messages per running turn")));
            }
            tx.execute(
                "INSERT INTO p08_turn_notes (note_id, mission_id, seq, text, state, created_at, delivered_at) VALUES (?1, ?2, ?3, ?4, 'QUEUED', ?5, NULL)",
                params![note_id, mission_id, seq, text, now],
            )?;
            tx.commit()?;
            Ok(seq)
        }))?;
        if !active(&p03) {
            self.close_pending_notes(mission_id);
        }
        self.notes_of(mission_id).into_iter().find(|n| n.seq == seq).ok_or(ConversationError::UnknownMission)
    }

    /// يعلّم ما بقي في الطابور «لم تصل». متكرّر بلا أثر ثانٍ.
    pub fn close_pending_notes(&self, mission_id: &str) {
        let _ = self.db.with(|c| Ok(c.execute("UPDATE p08_turn_notes SET state = 'NOT_DELIVERED' WHERE mission_id = ?1 AND state = 'QUEUED'", params![mission_id])?));
    }

    fn notes_of(&self, mission_id: &str) -> Vec<NoteView> {
        self.db
            .with(|c| {
                let mut stmt = c.prepare("SELECT note_id, mission_id, seq, text, state, created_at, delivered_at FROM p08_turn_notes WHERE mission_id = ?1 ORDER BY seq")?;
                let rows = stmt
                    .query_map(params![mission_id], |r| {
                        Ok(NoteView { note_id: r.get(0)?, mission_id: r.get(1)?, seq: r.get(2)?, text: r.get(3)?, state: r.get(4)?, created_at: r.get(5)?, delivered_at: r.get(6)? })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
    }
}

impl MissionObserver for ConversationService {
    fn narrate(&self, note: &NarrationNote) {
        if !crate::ids::is_uuid_v4(&note.mission_id) {
            return;
        }
        let body = clip(note.text.trim(), ENTRY_LIMIT);
        if body.is_empty() {
            return;
        }
        let detail = note.detail.as_deref().map(|d| clip(d, 200));
        let now = self.clock.now();
        let _ = self.db.with(|c| {
            c.execute(
                "INSERT INTO p08_conversation_entries (mission_id, kind, body, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![note.mission_id, note.kind.as_str(), body, detail, now],
            )?;
            Ok(())
        });
    }

    /// عنوان المحادثة: يأخذه الدور الأول وحده (المتابعات مخفية في الشريط وعنوانها لا يُعرض).
    fn retitle(&self, mission_id: &str, title: &str) {
        let Some((thread, seq, _)) = self.turn_of(mission_id) else { return };
        if seq != 0 || self.renamed_by_user(&thread) {
            return;
        }
        if let Some(p03) = self.phase03.get().and_then(Weak::upgrade) {
            let _ = p03.repository.set_title(mission_id, &clip(title.trim(), 80));
        }
    }

    /// أسئلة المتابعة تُحفظ أسطرًا في سرد الدور بصنفها SUGGESTION (مخطط v11)؛ للعرض وحده.
    fn suggest(&self, mission_id: &str, suggestions: &[String]) {
        if self.turn_of(mission_id).is_none() {
            return;
        }
        let now = self.clock.now();
        let _ = self.db.with(|c| {
            for s in suggestions.iter().take(3) {
                c.execute(
                    "INSERT INTO p08_conversation_entries (mission_id, kind, body, detail, created_at) VALUES (?1, 'SUGGESTION', ?2, NULL, ?3)",
                    params![mission_id, clip(s.trim(), 200), now],
                )?;
            }
            Ok(())
        });
    }

    fn thinking(&self, mission_id: &str, active: bool) {
        if let Ok(mut map) = self.thinking.lock() {
            let n = map.entry(mission_id.to_string()).or_insert(0);
            if active {
                *n += 1;
            } else {
                *n = n.saturating_sub(1);
            }
            if *n == 0 {
                map.remove(mission_id);
            }
        }
    }

    fn mission_finished(&self, note: &crate::p03::port::MissionOutcomeNote) {
        if let Ok(mut map) = self.thinking.lock() {
            map.remove(&note.mission_id);
        }
        // ما بقي في طابور الرسائل لم يصل إلى الوكيل (ADR-042). الانتظار على موافقة ليس نهاية: الرسائل تصل حين يُستأنف الدور.
        if note.state != MissionState::WaitingForApproval.as_str() {
            self.close_pending_notes(&note.mission_id);
        }
    }
}
