// سجلّ الجلسة (خطة 2026-10-07، ADR-041 §3.2): append-only، وهو مصدر الحقيقة للمحادثة.
//
// العيب الذي يغلقه (مقيس): محادثة الحلقة لم تكن تُحفظ؛ الانتظار لموافقة أو إعادة التشغيل يبدأ محادثة جديدة بالطلب وقائمة
// «ما أُنجز»، والمتابعة تلصق الأدوار السابقة نصًّا في هدف المهمّة. النمط من Anthropic «Scaling Managed Agents» (2026-04-08):
// السجلّ خارج الحلقة، والحلقة عديمة الحالة تُستأنف منه كما هو.
//
// كل حدث يحمل صنف سلطته ومنشأه، وسلسلة تجزئة لكل جلسة تكشف تعديل صفّ أو حذفه أو إدراجه. الملخّص حدث له مداه، والأصل لا
// يُحذف أبدًا.

use std::sync::Arc;

use polaris_host_providers::domain::{ChatMessage, ProposedToolCall, Role};
use rusqlite::params;
use serde_json::{json, Value};

use crate::digest::sha256_hex;
use crate::p03::trust::AuthorityClass;
use crate::storage::Database;

pub const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

/// نوع حدث في السجلّ. مغلق.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionKind {
    UserMessage,
    AssistantMessage,
    ToolResult,
    HostNote,
    Summary,
    Approval,
    InjectionFlagged,
    MonitorDecision,
    SecurityEvent,
}

impl SessionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UserMessage => "USER_MESSAGE",
            Self::AssistantMessage => "ASSISTANT_MESSAGE",
            Self::ToolResult => "TOOL_RESULT",
            Self::HostNote => "HOST_NOTE",
            Self::Summary => "SUMMARY",
            Self::Approval => "APPROVAL",
            Self::InjectionFlagged => "INJECTION_FLAGGED",
            Self::MonitorDecision => "MONITOR_DECISION",
            Self::SecurityEvent => "SECURITY_EVENT",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        [
            Self::UserMessage,
            Self::AssistantMessage,
            Self::ToolResult,
            Self::HostNote,
            Self::Summary,
            Self::Approval,
            Self::InjectionFlagged,
            Self::MonitorDecision,
            Self::SecurityEvent,
        ]
        .into_iter()
        .find(|k| k.as_str() == value)
    }
}

/// حدث قبل أن يُلحق: المضيف يصدر رقمه ووقته وتجزئته.
#[derive(Debug, Clone)]
pub struct SessionDraft {
    pub session_id: String,
    pub mission_id: String,
    pub kind: SessionKind,
    pub authority: AuthorityClass,
    pub payload: Value,
    pub parent_seq: Option<i64>,
}

/// حدث كما حُفظ.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionEvent {
    pub session_id: String,
    pub seq: i64,
    pub mission_id: String,
    pub kind: SessionKind,
    pub authority: String,
    pub parent_seq: Option<i64>,
    pub payload: Value,
    pub created_at: String,
}

/// نتيجة فحص السلسلة.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChainCheck {
    Intact { events: u64 },
    Broken { at_seq: i64, reason: String },
}

/// المنفذ: إلحاق وقراءة وفحص. لا تعديل ولا حذف.
pub trait SessionLog: Send + Sync {
    fn append(&self, draft: SessionDraft) -> Result<i64, String>;
    fn events(&self, session_id: &str) -> Vec<SessionEvent>;
    fn verify(&self, session_id: &str) -> ChainCheck;
    /// كل الجلسات (للفحص عند الإقلاع).
    fn sessions(&self) -> Vec<String> {
        Vec::new()
    }
}

/// الحقول بالترتيب الثابت: السابق، والجلسة، والرقم، والمهمّة، والنوع، والسلطة، والأب، والحمولة، والوقت.
/// تسعة معاملات عمدًا: هي حقول السلسلة نفسها بترتيبها، وتجميعها في بنية لا يغيّر ما يُبصم ويخفي ترتيبه.
#[allow(clippy::too_many_arguments)]
fn event_hash(prev: &str, session_id: &str, seq: i64, mission_id: &str, kind: &str, authority: &str, parent: Option<i64>, payload: &str, created_at: &str) -> String {
    let parent = parent.map(|p| p.to_string()).unwrap_or_default();
    let seq = seq.to_string();
    sha256_hex([prev, session_id, &seq, mission_id, kind, authority, &parent, payload, created_at].join("\u{1f}").as_bytes())
}

/// السجلّ على المخزن نفسه (جدول `session_events`، v17).
pub struct SqliteSessionLog {
    db: Arc<Database>,
}

impl SqliteSessionLog {
    pub fn new(db: Arc<Database>) -> Self {
        Self { db }
    }
}

/// أقصى حجم لحمولة حدث بالبايت (قيد الجدول).
const MAX_PAYLOAD: usize = 250_000;

/// مفاتيح لا تُقصّ أبدًا: المعرّفات والحالة والربط الذي تحتاجه الاستعادة (R-09، 2026-10-12).
const STRUCTURAL_KEYS: [&str; 11] = ["id", "call_id", "name", "tool_id", "task_id", "status", "kind", "request", "text_protocol", "mission_id", "agent_id"];

/// يقصّ حمولة أكبر من `max` بايت دون أن يمسّ بنيتها: كل مفتاح ومصفوفة يبقيان، والمعرّفات والحالات كما هي، وتُختصر السلاسل
/// الطويلة وحدها (بمحارف كاملة، فلا يُكسر نصّ عربي) حتى تتّسع الحمولة. يُضاف وصف القصّ: بصمة الأصل وحجمه والحقول المختصرة،
/// فيُعرف ما فُقد بدل أن يُخفى. لا تُنقل نسخة كاملة إلى مخزن آخر: البصمة تكفي لكشف عدم التطابق، والأصل الكبير لا يُحفظ.
pub fn clip_payload(payload: &Value, max: usize) -> Value {
    let full = payload.to_string();
    if full.len() <= max {
        return payload.clone();
    }
    let mut limit: usize = 65_536;
    loop {
        let mut clipped = payload.clone();
        let mut fields: Vec<String> = Vec::new();
        shorten_strings(&mut clipped, limit, "", &mut fields);
        let note = json!({ "original_sha256": sha256_hex(full.as_bytes()), "original_bytes": full.len(), "char_limit": limit, "fields": fields });
        if let Value::Object(map) = &mut clipped {
            map.insert("clipped".into(), note);
        } else {
            clipped = json!({ "value": clipped, "clipped": note });
        }
        if clipped.to_string().len() <= max || limit <= 64 {
            return clipped;
        }
        limit /= 2;
    }
}

fn shorten_strings(value: &mut Value, limit: usize, path: &str, fields: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if text.chars().count() > limit {
                let kept: String = text.chars().take(limit).collect();
                *text = format!("{kept}\n…(clipped by POLARIS)");
                fields.push(path.to_string());
            }
        }
        Value::Array(items) => {
            for (i, item) in items.iter_mut().enumerate() {
                shorten_strings(item, limit, &format!("{path}/{i}"), fields);
            }
        }
        Value::Object(map) => {
            for (key, item) in map.iter_mut() {
                if STRUCTURAL_KEYS.contains(&key.as_str()) && !item.is_object() && !item.is_array() {
                    continue;
                }
                shorten_strings(item, limit, &format!("{path}/{key}"), fields);
            }
        }
        _ => {}
    }
}

/// هل قُصّت وسائط استدعاء بعينه في هذا الحدث؟ وسائط مقصوصة لا يُعاد تنفيذها: ليست ما اقترحه الوكيل.
fn arguments_clipped(payload: &Value, index: usize) -> bool {
    let wanted = format!("/tool_calls/{index}/arguments");
    payload.get("clipped").and_then(|c| c.get("fields")).and_then(Value::as_array).is_some_and(|f| f.iter().any(|p| p.as_str() == Some(wanted.as_str())))
}

impl SessionLog for SqliteSessionLog {
    fn append(&self, draft: SessionDraft) -> Result<i64, String> {
        let payload = serde_json::to_string(&clip_payload(&draft.payload, MAX_PAYLOAD)).map_err(|e| e.to_string())?;
        let created_at = crate::time::now_rfc3339_utc();
        let kind = draft.kind.as_str();
        let authority = draft.authority.as_str();
        self.db
            .with(|conn| {
                let tx = conn.transaction()?;
                let (prev, last): (String, i64) = tx
                    .query_row("SELECT hash, seq FROM session_events WHERE session_id = ?1 ORDER BY seq DESC LIMIT 1", params![draft.session_id], |r| Ok((r.get(0)?, r.get(1)?)))
                    .unwrap_or_else(|_| (GENESIS.to_string(), 0));
                let seq = last + 1;
                let hash = event_hash(&prev, &draft.session_id, seq, &draft.mission_id, kind, authority, draft.parent_seq, &payload, &created_at);
                tx.execute(
                    "INSERT INTO session_events (session_id, seq, mission_id, kind, authority, parent_seq, payload_json, created_at, prev_hash, hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![draft.session_id, seq, draft.mission_id, kind, authority, draft.parent_seq, payload, created_at, prev, hash],
                )?;
                // مرساة النهاية في المعاملة نفسها (v18): حذف آخر الأحداث يُكشف بمقارنتها.
                tx.execute(
                    "INSERT INTO session_heads (session_id, last_seq, last_hash, updated_at) VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT (session_id) DO UPDATE SET last_seq = excluded.last_seq, last_hash = excluded.last_hash, updated_at = excluded.updated_at",
                    params![draft.session_id, seq, hash, created_at],
                )?;
                tx.commit()?;
                Ok(seq)
            })
            .map_err(|e| e.to_string())
    }

    fn events(&self, session_id: &str) -> Vec<SessionEvent> {
        self.db
            .with(|conn| {
                let mut stmt = conn.prepare("SELECT seq, mission_id, kind, authority, parent_seq, payload_json, created_at FROM session_events WHERE session_id = ?1 ORDER BY seq")?;
                let rows = stmt
                    .query_map(params![session_id], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<i64>>(4)?, r.get::<_, String>(5)?, r.get::<_, String>(6)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows
                    .into_iter()
                    .filter_map(|(seq, mission_id, kind, authority, parent_seq, payload, created_at)| {
                        Some(SessionEvent {
                            session_id: session_id.to_string(),
                            seq,
                            mission_id,
                            kind: SessionKind::parse(&kind)?,
                            authority,
                            parent_seq,
                            payload: serde_json::from_str(&payload).unwrap_or(Value::Null),
                            created_at,
                        })
                    })
                    .collect())
            })
            .unwrap_or_default()
    }

    fn verify(&self, session_id: &str) -> ChainCheck {
        let rows = self.db.with(|conn| {
            let mut stmt = conn.prepare("SELECT seq, mission_id, kind, authority, parent_seq, payload_json, created_at, prev_hash, hash FROM session_events WHERE session_id = ?1 ORDER BY seq")?;
            let rows = stmt
                .query_map(params![session_id], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, Option<i64>>(4)?,
                        r.get::<_, String>(5)?,
                        r.get::<_, String>(6)?,
                        r.get::<_, String>(7)?,
                        r.get::<_, String>(8)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        });
        let Ok(rows) = rows else { return ChainCheck::Broken { at_seq: 0, reason: "the session log could not be read".into() } };
        let head: Result<Option<(i64, String)>, _> = self.db.with(|conn| {
            match conn.query_row("SELECT last_seq, last_hash FROM session_heads WHERE session_id = ?1", params![session_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))) {
                Ok(found) => Ok(Some(found)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(e.into()),
            }
        });
        let Ok(head) = head else { return ChainCheck::Broken { at_seq: 0, reason: "the session head could not be read".into() } };
        let mut prev = GENESIS.to_string();
        for (i, (seq, mission_id, kind, authority, parent, payload, created_at, stored_prev, stored_hash)) in rows.iter().enumerate() {
            if *seq != i as i64 + 1 {
                return ChainCheck::Broken { at_seq: *seq, reason: format!("expected event {} and found {seq}", i + 1) };
            }
            if stored_prev != &prev {
                return ChainCheck::Broken { at_seq: *seq, reason: "the previous hash does not match".into() };
            }
            let hash = event_hash(&prev, session_id, *seq, mission_id, kind, authority, *parent, payload, created_at);
            if &hash != stored_hash {
                return ChainCheck::Broken { at_seq: *seq, reason: "the event does not match its hash".into() };
            }
            prev = hash;
        }
        // السلسلة سليمة حتى آخر صفّ؛ المرساة تقول أين يجب أن تنتهي. صفوف أُزيلت من آخرها تظهر هنا.
        if let Some((last_seq, last_hash)) = head {
            let tail = rows.last().map(|r| r.0).unwrap_or(0);
            if tail != last_seq || prev != last_hash {
                return ChainCheck::Broken { at_seq: tail + 1, reason: format!("the log ends at event {tail} and its recorded head is event {last_seq}") };
            }
        }
        ChainCheck::Intact { events: rows.len() as u64 }
    }

    fn sessions(&self) -> Vec<String> {
        self.db
            .with(|conn| {
                let mut stmt = conn.prepare("SELECT DISTINCT session_id FROM session_events")?;
                let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .unwrap_or_default()
    }
}

/// استدعاء في السجلّ لم تُعرف نتيجته النهائية: ينتظر قرارًا، أو قطعه توقّف التطبيق.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenCall {
    pub call_id: String,
    /// المهمّة التي اقترح فيها الوكيل الاستدعاء.
    pub mission_id: String,
    pub name: String,
    pub arguments: String,
    pub tool_id: Option<String>,
    pub task_id: Option<String>,
    /// AWAITING_APPROVAL، أو لا شيء (لا نتيجة أصلًا).
    pub status: Option<String>,
}

/// المحادثة كما يُعاد بناؤها من السجلّ.
#[derive(Debug, Clone, Default)]
pub struct Rebuilt {
    pub messages: Vec<ChatMessage>,
    pub open_calls: Vec<OpenCall>,
    /// رقم آخر حدث دخل البناء.
    pub last_seq: i64,
}

/// يعيد بناء المحادثة من أحداث جلسة بترتيبها: رسائل المستخدم والمضيف، وردود الوكيل باستدعاءاتها، ونتائجها (الأحدث لكل
/// استدعاء يحلّ محلّ ما قبله: «ينتظر» ثم النتيجة الحقيقية)، والملخّص بدل ما يغطيه.
///
/// R-08 (2026-10-12): حالة كل استدعاء تُحفظ في خريطة مستقلّة عن الرسائل المعروضة، فلا يمحوها ملخّص يُخرج رسائلها من المحادثة.
/// استدعاء اكتمل قبل الملخّص يبقى مكتملًا؛ والذي ينتظر قرارًا أو لا نتيجة له يبقى مفتوحًا. ونتيجة أداة بقيت بعد ملخّص غطّى
/// استدعاءها تُعرض نصًّا لا رسالة `tool` يتيمة (المزوّدون يرفضون نتيجة بلا استدعاء يسبقها).
/// استدعاء كما يُعاد بناؤه: المعرّف، والمهمّة، والاستدعاء، ومعرّف الأداة، والعقدة، وهل قُصّت وسائطه.
type CallRow = (String, String, ProposedToolCall, Option<String>, Option<String>, bool);

pub fn rebuild(events: &[SessionEvent]) -> Rebuilt {
    // كل رسالة مع رقم الحدث الذي صنعها، ليُحذف ما يغطيه ملخّص لاحق.
    let mut built: Vec<(i64, ChatMessage)> = Vec::new();
    // الاستدعاءات بترتيبها: المعرّف، والمهمّة، والاستدعاء، ومعرّف الأداة، والعقدة، وهل قُصّت وسائطه.
    let mut calls: Vec<CallRow> = Vec::new();
    // آخر حالة لكل استدعاء: مصدر الحقيقة لـ«مفتوح أو لا»، ولا يمسّه الملخّص.
    let mut call_status: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // موضع رسالة نتيجة كل استدعاء في المحادثة المعروضة (يُعاد حسابه بعد الملخّص).
    let mut result_index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    // العقدة التي نُسب إليها آخر نتيجة لكل استدعاء: الموافقة مربوطة بها.
    let mut result_tasks: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut last_seq = 0;
    for event in events {
        last_seq = event.seq;
        let text = event.payload.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
        match event.kind {
            // G2 (2026-10-14): سجلّ للقياس وحده (قائمة المرشحين واختيار الوكيل) لا يدخل المحادثة عند إعادة بنائها.
            SessionKind::HostNote if event.payload.get("record_only").and_then(Value::as_bool) == Some(true) => {}
            SessionKind::UserMessage | SessionKind::HostNote => built.push((event.seq, ChatMessage::text(Role::User, text))),
            SessionKind::AssistantMessage => {
                let text_protocol = event.payload.get("text_protocol").and_then(Value::as_bool).unwrap_or(false);
                let mut tool_calls: Vec<ProposedToolCall> = Vec::new();
                if let Some(list) = event.payload.get("tool_calls").and_then(Value::as_array) {
                    for (index, c) in list.iter().enumerate() {
                        if let (Some(id), Some(name)) = (c.get("id").and_then(Value::as_str), c.get("name").and_then(Value::as_str)) {
                            let call = ProposedToolCall { id: Some(id.to_string()), name: name.to_string(), arguments: c.get("arguments").and_then(Value::as_str).unwrap_or_default().to_string() };
                            if !text_protocol {
                                tool_calls.push(call.clone());
                            }
                            let clipped = arguments_clipped(&event.payload, index);
                            calls.push((id.to_string(), event.mission_id.clone(), call, c.get("tool_id").and_then(Value::as_str).map(str::to_string), c.get("task_id").and_then(Value::as_str).map(str::to_string), clipped));
                        }
                    }
                }
                let reasoning = event.payload.get("reasoning").and_then(Value::as_str).map(str::to_string);
                built.push((event.seq, ChatMessage { images: Vec::new(), role: Role::Assistant, text, tool_calls, tool_call_id: None, reasoning }));
            }
            SessionKind::ToolResult => {
                let call_id = event.payload.get("call_id").and_then(Value::as_str).unwrap_or_default().to_string();
                let status = event.payload.get("status").and_then(Value::as_str).unwrap_or_default().to_string();
                let text_protocol = event.payload.get("text_protocol").and_then(Value::as_bool).unwrap_or(false);
                if let Some(task) = event.payload.get("task_id").and_then(Value::as_str) {
                    result_tasks.insert(call_id.clone(), task.to_string());
                }
                call_status.insert(call_id.clone(), status);
                if let Some(index) = result_index.get(&call_id).copied() {
                    // النتيجة الأحدث للاستدعاء نفسه تحلّ محلّ السابقة في المحادثة؛ الحدثان باقيان في السجلّ.
                    if let Some((_, message)) = built.get_mut(index) {
                        message.text = if message.role == Role::Tool { text.clone() } else { orphan_text(&event.payload, &text) };
                    }
                } else {
                    // استدعاء ما زال ظاهرًا في المحادثة (لم يغطّه ملخّص) يأخذ رسالة `tool`؛ وإلا نصًّا.
                    let visible = built.iter().any(|(_, m)| m.tool_calls.iter().any(|c| c.id.as_deref() == Some(call_id.as_str())));
                    let message = if text_protocol || !visible {
                        ChatMessage::text(Role::User, orphan_text(&event.payload, &text))
                    } else {
                        ChatMessage { images: Vec::new(), role: Role::Tool, text, tool_calls: Vec::new(), tool_call_id: Some(call_id.clone()), reasoning: None }
                    };
                    built.push((event.seq, message));
                    result_index.insert(call_id, built.len() - 1);
                }
            }
            SessionKind::Summary => {
                let covers_to = event.parent_seq.unwrap_or(event.seq);
                // ما يغطيه الملخّص يخرج من المحادثة (لا من السجلّ)، والملخّص في أولها.
                let kept: Vec<(i64, ChatMessage)> = built.drain(..).filter(|(seq, _)| *seq > covers_to).collect();
                built.push((event.seq, ChatMessage::text(Role::User, format!("[SUMMARY — POLARIS summarised the earlier part of this conversation; the original events are kept in the session log]\n{text}"))));
                built.extend(kept);
                // نتيجة بقيت واستدعاؤها غُطّي: تصير نصًّا، فلا تبقى رسالة `tool` بلا استدعاء يسبقها.
                let visible: std::collections::HashSet<String> = built.iter().flat_map(|(_, m)| m.tool_calls.iter().filter_map(|c| c.id.clone())).collect();
                for (_, message) in built.iter_mut() {
                    if message.role == Role::Tool && message.tool_call_id.as_ref().is_some_and(|id| !visible.contains(id)) {
                        let name = message.tool_call_id.clone().unwrap_or_default();
                        *message = ChatMessage::text(Role::User, format!("[TOOL_RESULT {name}]\n{}", message.text));
                    }
                }
                result_index.clear();
                for (i, (_, m)) in built.iter().enumerate() {
                    if let Some(id) = &m.tool_call_id {
                        result_index.insert(id.clone(), i);
                    }
                }
            }
            SessionKind::Approval | SessionKind::InjectionFlagged | SessionKind::MonitorDecision | SessionKind::SecurityEvent => {}
        }
    }
    // استدعاءات بلا نتيجة، أو نتيجتها الأخيرة «ينتظر»: تُعاد إلى زمن التشغيل ليحسمها. حالة الاستدعاء من خريطة الحالات وحدها.
    // استدعاء ينتظر قرارًا ووسائطه قُصّت لا يُعاد تنفيذه بوسائط ليست وسائطه: يُعامل كاستدعاء انقطع.
    let open_calls = calls
        .into_iter()
        .filter_map(|(id, mission_id, call, tool_id, task_id, clipped)| {
            let status = call_status.get(&id).cloned();
            let task_id = result_tasks.get(&id).cloned().or(task_id);
            match status.as_deref() {
                None => Some(OpenCall { call_id: id, mission_id, name: call.name, arguments: call.arguments, tool_id, task_id, status: None }),
                Some("AWAITING_APPROVAL") if clipped => Some(OpenCall { call_id: id, mission_id, name: call.name, arguments: call.arguments, tool_id, task_id, status: None }),
                Some("AWAITING_APPROVAL") => Some(OpenCall { call_id: id, mission_id, name: call.name, arguments: call.arguments, tool_id, task_id, status: Some("AWAITING_APPROVAL".into()) }),
                _ => None,
            }
        })
        .collect();
    Rebuilt { messages: built.into_iter().map(|(_, m)| m).collect(), open_calls, last_seq }
}

/// نتيجة أداة تُعرض نصًّا: صيغة الأدوات النصّية، أو نتيجة غُطّي استدعاؤها بملخّص.
fn orphan_text(payload: &Value, text: &str) -> String {
    let name = payload.get("name").and_then(Value::as_str).unwrap_or("tool");
    format!("[TOOL_RESULT {name}]\n{text}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(seq: i64, kind: SessionKind, payload: Value) -> SessionEvent {
        SessionEvent { session_id: "s".into(), seq, mission_id: "m".into(), kind, authority: "MODEL_GENERATED".into(), parent_seq: None, payload, created_at: "t".into() }
    }

    #[test]
    fn a_record_only_host_note_is_kept_in_the_log_but_not_replayed_into_the_conversation() {
        let events = vec![
            event(1, SessionKind::UserMessage, json!({ "text": "help" })),
            event(2, SessionKind::HostNote, json!({ "text": "[POLARIS] candidate agents: a, b", "agent_shortlist": ["a", "b"], "record_only": true })),
            event(3, SessionKind::HostNote, json!({ "text": "a note the agent must see" })),
        ];
        let rebuilt = rebuild(&events);
        assert_eq!(rebuilt.messages.iter().map(|m| m.text.as_str()).collect::<Vec<_>>(), vec!["help", "a note the agent must see"]);
        assert_eq!(rebuilt.last_seq, 3);
    }

    #[test]
    fn the_latest_result_of_a_call_replaces_the_wait_and_a_summary_replaces_what_it_covers() {
        let events = vec![
            event(1, SessionKind::UserMessage, json!({ "text": "sum it" })),
            event(2, SessionKind::AssistantMessage, json!({ "text": "", "tool_calls": [{ "id": "c1", "name": "run_python", "arguments": "{}", "task_id": "t1", "tool_id": "polaris.execution.python" }] })),
            event(3, SessionKind::ToolResult, json!({ "call_id": "c1", "status": "AWAITING_APPROVAL", "text": "status: AWAITING_APPROVAL", "task_id": "t1" })),
        ];
        let rebuilt = rebuild(&events);
        assert_eq!(rebuilt.messages.len(), 3);
        assert_eq!(rebuilt.open_calls.len(), 1);
        assert_eq!(rebuilt.open_calls[0].task_id.as_deref(), Some("t1"));
        let mut more = events.clone();
        more.push(event(4, SessionKind::ToolResult, json!({ "call_id": "c1", "status": "SUCCEEDED", "text": "status: SUCCEEDED" })));
        let rebuilt = rebuild(&more);
        assert_eq!(rebuilt.messages.len(), 3);
        assert_eq!(rebuilt.messages[2].text, "status: SUCCEEDED");
        assert!(rebuilt.open_calls.is_empty());
        more.push(event(5, SessionKind::AssistantMessage, json!({ "text": "the total is 3" })));
        let mut summary = event(6, SessionKind::Summary, json!({ "text": "the user asked to sum; python ran" }));
        summary.parent_seq = Some(4);
        more.push(summary);
        let rebuilt = rebuild(&more);
        assert_eq!(rebuilt.messages.len(), 2);
        assert!(rebuilt.messages[0].text.starts_with("[SUMMARY"));
        assert_eq!(rebuilt.messages[1].text, "the total is 3");
    }

    #[test]
    fn a_call_without_any_result_is_open_and_nothing_else_is() {
        let events = vec![
            event(1, SessionKind::UserMessage, json!({ "text": "go" })),
            event(2, SessionKind::AssistantMessage, json!({ "text": "", "tool_calls": [{ "id": "c1", "name": "write_file", "arguments": "{}" }, { "id": "c2", "name": "read_file", "arguments": "{}" }] })),
            event(3, SessionKind::ToolResult, json!({ "call_id": "c1", "status": "SUCCEEDED", "text": "ok" })),
        ];
        let rebuilt = rebuild(&events);
        assert_eq!(rebuilt.open_calls.iter().map(|c| c.call_id.as_str()).collect::<Vec<_>>(), vec!["c2"]);
        assert_eq!(rebuilt.open_calls[0].status, None);
    }
}
