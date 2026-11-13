// سجلّ المحادثة الواحد لمهمّة (خطة 2026-10-06، البند C2): كل نداء نموذج في المهمّة يمدّ النداء الذي قبله ولا يعيد
// كتابته.
//
// لماذا سجلّ واحد لا موجّه جديد لكل عقدة:
// - Bonsai نموذج هجين (معمارية DeltaNet، قُرئت من ترويسة GGUF في 2026-10-06). خادم النموذج المحلي لا يقصّ حالته المتكرّرة جزئيًّا،
//   فيعيد استعمال ذاكرته حين يمتدّ الطلب الجديد من نقطة حفظ عند نهاية طلب سابق. قِيس في MISSION-A (2026-10-05):
//   داخل العقدة كان المخبوء = طول الطلب السابق − 4، وعند بداية كل عقدة 0، لأن موجّه العقدة يُبنى من أوله.
// - وقِيس أن العقدة الثانية أعادت قراءة المدخلات الثلاثة نفسها (البصمات نفسها) وكتبت المستند مرّتين: لم ترَ ما فعلته
//   الأولى. في السجلّ الواحد ترى كل خطوة ما قبلها كما وقع.
//
// الحدود:
// - لا رسالة تُعدَّل بعد إلحاقها. الضغط وحده يعيد السجلّ إلى افتتاحيته، ولا يقع إلا لقيد مسمّى (الحجم أو نافذة النموذج).
// - نتيجة كل استدعاء أصيل تُلحق برسالة أداة تحمل معرّفه، مباشرة بعد رسالة المساعد التي طلبته، كما يشترط البروتوكول.
//   استدعاء لم تُعرض نتيجته تُغلق رسالتُه بنصّ يقول ذلك، فلا يبقى طلب معلّق بلا جواب.
// - السجلّ لا يرفع صنف شيء: النصوص تدخله كما صاغتها خطة المُوجِّه، والمحتوى غير الموثوق مسيَّج بوسمه نفسه.

use std::collections::HashMap;

use polaris_host_providers::domain::messages::{ChatMessage, ProposedToolCall, Role};

use super::port::ToolTurn;

/// ميزانية السجلّ بالمحارف قبل الضغط: نحو 45 ألف رمز. ما فوقها يُعاد بناؤه من الافتتاحية عند بداية الخطوة التالية.
/// الرقم حدّ تصميم، لا قياس: نافذة Bonsai المعلنة 262144، والحدّ يُبقي معالجة الطلب عند فوات الذاكرة محدودة.
pub const THREAD_CHAR_BUDGET: usize = 160_000;

/// نصّ يُغلق به استدعاء لم تُعرض نتيجته قبل أن تتقدّم المحادثة.
pub const NOT_SHOWN: &str = "status: NOT SHOWN — this call's result was not returned to you before the conversation moved on; POLARIS records its real status, and AVAILABLE FILES or the ALREADY DONE list show what exists.";

/// سجلّ المحادثة لمهمّة واحدة.
#[derive(Debug, Default)]
pub struct MissionThread {
    messages: Vec<ChatMessage>,
    /// عدد رسائل الافتتاحية: هدف المهمّة وسياقها. تبقى عند الضغط.
    opener: usize,
    /// استدعاءات آخر رسالة مساعد التي لم تصلها نتائجها بعد.
    pending: Vec<ProposedToolCall>,
    /// عدّاد المعرّفات التي يصدرها السجلّ لاستدعاء أعاده خادم بلا معرّف.
    issued: u64,
    /// كم جولة أداة أُلحقت لكل خطوة (بمفتاحها)، ليُعرف الجديد مما يعيده زمن التشغيل.
    turns_seen: HashMap<String, usize>,
    /// كتل سياق مسترجَعة (ذاكرة، ملاحظات) أُلحقت من قبل: لا تُكرَّر في خطوة تالية.
    seen_blocks: std::collections::HashSet<String>,
    compactions: u32,
}

/// حالة السجلّ قبل خطوة، يعود إليها إن فشل النداء قبل أن يعود ردّ: المحاولة التالية امتداد للطلب الناجح الأخير نفسه.
#[derive(Debug, Clone)]
pub struct ThreadMark {
    len: usize,
    pending: Vec<ProposedToolCall>,
    turns_seen: HashMap<String, usize>,
    seen_blocks: std::collections::HashSet<String>,
    compactions: u32,
}

impl MissionThread {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.messages.is_empty()
    }

    /// الافتتاحية: تُلحق مرة واحدة، في سجلّ فارغ.
    pub fn open(&mut self, parts: Vec<(Role, String)>) {
        if !self.messages.is_empty() {
            return;
        }
        for (role, text) in parts {
            self.messages.push(ChatMessage::text(role, text));
        }
        self.opener = self.messages.len();
    }

    /// يُلحق رسائل خطوة (مستخدم بوسومها). يُغلق قبلها أي استدعاء معلّق.
    pub fn push_step(&mut self, parts: Vec<(Role, String)>) {
        self.close_pending();
        for (role, text) in parts {
            self.messages.push(ChatMessage::text(role, text));
        }
    }

    /// موضع العودة قبل خطوة.
    pub fn mark(&self) -> ThreadMark {
        ThreadMark {
            len: self.messages.len(),
            pending: self.pending.clone(),
            turns_seen: self.turns_seen.clone(),
            seen_blocks: self.seen_blocks.clone(),
            compactions: self.compactions,
        }
    }

    /// نداء فشل قبل أن يعود ردّ: يعود السجلّ إلى ما كان قبل الخطوة. الضغط بعد الموضع يُبطله (لا عودة إلى ما حُذف).
    pub fn rollback(&mut self, mark: ThreadMark) {
        if mark.compactions == self.compactions && mark.len <= self.messages.len() {
            self.messages.truncate(mark.len);
            self.pending = mark.pending;
            self.turns_seen = mark.turns_seen;
            self.seen_blocks = mark.seen_blocks;
        }
    }

    /// هل هذه أول مرة تُلحق فيها كتلة السياق هذه؟ تُسجَّل إن كانت.
    pub fn first_time(&mut self, block: &str) -> bool {
        self.seen_blocks.insert(block.to_string())
    }

    /// ملاحظة قصيرة من المضيف داخل الخطوة الجارية (إصلاح، تذكير، تنبيه إعادة). لا تغيّر الانتظار.
    pub fn push_note(&mut self, text: String) {
        self.close_pending();
        self.messages.push(ChatMessage::text(Role::User, text));
    }

    /// يُلحق ردّ النموذج كما عاد، باستدعاءاته. استدعاء بلا معرّف يُعطى معرّفًا من السجلّ؛ ما يُعاد هو الاستدعاءات بمعرّفاتها.
    pub fn push_assistant(&mut self, text: &str, calls: &[ProposedToolCall]) -> Vec<ProposedToolCall> {
        self.close_pending();
        let mut identified = Vec::with_capacity(calls.len());
        for call in calls {
            let mut call = call.clone();
            if call.id.as_deref().is_none_or(str::is_empty) {
                self.issued += 1;
                call.id = Some(format!("polaris_call_{}", self.issued));
            }
            identified.push(call);
        }
        self.messages.push(ChatMessage { images: Vec::new(), role: Role::Assistant, text: text.to_string(), tool_calls: identified.clone(), tool_call_id: None, reasoning: None });
        self.pending = identified.clone();
        identified
    }

    /// محاولة جديدة لخطوة: زمن التشغيل يبدأ قائمة جولاتها من الصفر.
    pub fn reset_turns(&mut self, key: &str) {
        self.turns_seen.insert(key.to_string(), 0);
    }

    /// يُلحق نتائج الجولات الجديدة لخطوة. في الوضع الأصيل: رسالة أداة لكل استدعاء معلّق بمعرّفه، بالترتيب الذي طلبه
    /// النموذج (وهو ترتيب تنفيذ البوابة). ما زاد من الجولات يُلحق رسالةً واحدة، وما نقص يُغلق بـ`NOT_SHOWN`. في الوضع
    /// النصّي: رسالة واحدة بكل الجولات الجديدة. `render` يصوغ الجولة مرة واحدة بسقف ثابت، فلا تُعاد صياغتها لاحقًا.
    pub fn push_results(&mut self, key: &str, turns: &[ToolTurn], native: bool, render: impl Fn(usize, &ToolTurn) -> String) -> usize {
        let seen = self.turns_seen.get(key).copied().unwrap_or(0).min(turns.len());
        let fresh = &turns[seen..];
        self.turns_seen.insert(key.to_string(), turns.len());
        if fresh.is_empty() {
            return 0;
        }
        let mut leftover = String::new();
        if native {
            let pending = std::mem::take(&mut self.pending);
            for (i, turn) in fresh.iter().enumerate() {
                let text = render(seen + i + 1, turn);
                match pending.get(i).and_then(|c| c.id.clone()) {
                    Some(id) => self.messages.push(ChatMessage { images: Vec::new(), role: Role::Tool, text, tool_calls: Vec::new(), tool_call_id: Some(id), reasoning: None }),
                    None => {
                        leftover.push_str(&text);
                        leftover.push_str("\n\n");
                    }
                }
            }
            for call in pending.iter().skip(fresh.len()) {
                if let Some(id) = call.id.clone() {
                    self.messages.push(ChatMessage { images: Vec::new(), role: Role::Tool, text: NOT_SHOWN.to_string(), tool_calls: Vec::new(), tool_call_id: Some(id), reasoning: None });
                }
            }
        } else {
            self.close_pending();
            for (i, turn) in fresh.iter().enumerate() {
                leftover.push_str(&render(seen + i + 1, turn));
                leftover.push_str("\n\n");
            }
        }
        if !leftover.is_empty() {
            self.messages.push(ChatMessage::text(Role::User, leftover.trim_end().to_string()));
        }
        fresh.len()
    }

    /// يُغلق كل استدعاء معلّق برسالة تقول إن نتيجته لم تُعرض.
    pub fn close_pending(&mut self) {
        for call in std::mem::take(&mut self.pending) {
            if let Some(id) = call.id {
                self.messages.push(ChatMessage { images: Vec::new(), role: Role::Tool, text: NOT_SHOWN.to_string(), tool_calls: Vec::new(), tool_call_id: Some(id), reasoning: None });
            }
        }
    }

    /// الرسائل كما تُرسل.
    pub fn messages(&self) -> Vec<ChatMessage> {
        self.messages.clone()
    }

    /// حجم السجلّ بالمحارف: النصوص ووسائط الاستدعاءات.
    pub fn chars(&self) -> usize {
        self.messages.iter().map(|m| m.text.chars().count() + m.tool_calls.iter().map(|c| c.name.len() + c.arguments.chars().count()).sum::<usize>()).sum()
    }

    /// هل تجاوز السجلّ ميزانيته؟
    pub fn over_budget(&self) -> bool {
        self.chars() > THREAD_CHAR_BUDGET
    }

    /// الضغط: يعود السجلّ إلى افتتاحيته. ما قبله يصل الخطوة التالية من أقسام سياقها المقيسة (الخطة بحالاتها، والتقارير،
    /// والملفات، وما أُنجز)، كما في الموجّه لكل عقدة. يقع لقيد مسمّى فقط، ويُعدّ.
    pub fn compact(&mut self) {
        self.messages.truncate(self.opener);
        self.pending.clear();
        self.seen_blocks.clear();
        self.compactions += 1;
    }

    pub fn compactions(&self) -> u32 {
        self.compactions
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(tool: &str, status: &str) -> ToolTurn {
        ToolTurn { tool_id: tool.into(), arguments_preview: "{}".into(), status: status.into(), denial_reason: None, summary: "s".into(), observation: Some("out".into()) }
    }

    fn call(id: Option<&str>, name: &str) -> ProposedToolCall {
        ProposedToolCall { id: id.map(str::to_string), name: name.into(), arguments: "{}".into() }
    }

    fn is_prefix(a: &[ChatMessage], b: &[ChatMessage]) -> bool {
        a.len() <= b.len() && a.iter().zip(b).all(|(x, y)| x == y)
    }

    #[test]
    fn every_step_extends_the_previous_request_instead_of_rewriting_it() {
        let mut t = MissionThread::new();
        t.open(vec![(Role::User, "[MISSION_OBJECTIVE]\nwrite a report".into())]);
        t.push_step(vec![(Role::User, "STEP — PLAN".into())]);
        let first = t.messages();
        t.push_assistant("{\"tasks\":[]}", &[]);
        t.push_step(vec![(Role::User, "STEP — WORK a".into())]);
        let second = t.messages();
        assert!(is_prefix(&first, &second), "the second request rewrote the first");
        let calls = t.push_assistant("", &[call(None, "polaris_workspace_read"), call(Some("srv-2"), "polaris_workspace_list")]);
        t.push_results("a", &[turn("polaris.workspace.read", "SUCCEEDED"), turn("polaris.workspace.list", "SUCCEEDED")], true, |n, x| format!("call {n}: {} {}", x.tool_id, x.status));
        let third = t.messages();
        assert!(is_prefix(&second, &third));
        // نتيجة كل استدعاء برسالة أداة تحمل معرّفه، بعد رسالة المساعد مباشرة.
        assert_eq!(calls[0].id.as_deref(), Some("polaris_call_1"), "a call without an id was not given one");
        let n = third.len();
        assert_eq!(third[n - 2].role, Role::Tool);
        assert_eq!(third[n - 2].tool_call_id.as_deref(), Some("polaris_call_1"));
        assert_eq!(third[n - 1].tool_call_id.as_deref(), Some("srv-2"));
        assert_eq!(third[n - 3].tool_calls.len(), 2);
    }

    #[test]
    fn a_call_whose_result_was_never_shown_is_closed_before_the_conversation_moves_on() {
        let mut t = MissionThread::new();
        t.open(vec![(Role::User, "objective".into())]);
        t.push_step(vec![(Role::User, "work".into())]);
        t.push_assistant("", &[call(Some("c1"), "x"), call(Some("c2"), "y")]);
        // جولة واحدة فقط عادت؛ الثانية لم تُنفَّذ.
        t.push_results("a", &[turn("x", "SUCCEEDED")], true, |_, x| x.status.clone());
        let m = t.messages();
        assert_eq!(m[m.len() - 1].tool_call_id.as_deref(), Some("c2"));
        assert_eq!(m[m.len() - 1].text, NOT_SHOWN);
        // استدعاء معلّق ثم خطوة جديدة: يُغلق أولًا.
        t.push_assistant("", &[call(Some("c3"), "z")]);
        t.push_step(vec![(Role::User, "next".into())]);
        let m = t.messages();
        assert_eq!(m[m.len() - 2].tool_call_id.as_deref(), Some("c3"));
        assert_eq!(m[m.len() - 1].text, "next");
    }

    #[test]
    fn only_new_turns_are_appended_and_a_retry_starts_its_turns_again() {
        let mut t = MissionThread::new();
        t.open(vec![(Role::User, "o".into())]);
        t.push_step(vec![(Role::User, "w".into())]);
        t.push_assistant("{\"tools\":[1]}", &[]);
        let one = [turn("t", "SUCCEEDED")];
        assert_eq!(t.push_results("a", &one, false, |n, _| format!("call {n}")), 1);
        t.push_assistant("{\"tools\":[2]}", &[]);
        let two = [turn("t", "SUCCEEDED"), turn("u", "DENIED")];
        assert_eq!(t.push_results("a", &two, false, |n, _| format!("call {n}")), 1, "an earlier turn was appended twice");
        assert_eq!(t.messages().last().unwrap().text, "call 2");
        t.reset_turns("a");
        assert_eq!(t.push_results("a", &one, false, |n, _| format!("call {n}")), 1, "a retried step lost its first turn");
    }

    #[test]
    fn compaction_keeps_the_opener_only_and_is_counted() {
        let mut t = MissionThread::new();
        t.open(vec![(Role::User, "objective".into())]);
        t.push_step(vec![(Role::User, "x".repeat(THREAD_CHAR_BUDGET))]);
        assert!(t.over_budget());
        assert!(t.first_time("memory block"));
        t.compact();
        assert_eq!(t.messages().len(), 1);
        assert_eq!(t.compactions(), 1);
        assert!(t.first_time("memory block"), "a block dropped by compaction was not shown again");
    }

    #[test]
    fn a_failed_call_rolls_the_step_back_so_the_retry_extends_the_last_good_request() {
        let mut t = MissionThread::new();
        t.open(vec![(Role::User, "o".into())]);
        t.push_step(vec![(Role::User, "w".into())]);
        t.push_assistant("", &[call(Some("c1"), "x")]);
        let before = t.messages();
        let mark = t.mark();
        assert!(t.first_time("block seen during the failed step"));
        t.push_results("a", &[turn("x", "SUCCEEDED")], true, |_, x| x.status.clone());
        t.push_note("reminder".into());
        t.rollback(mark);
        assert_eq!(t.messages(), before);
        // الجولة نفسها تُلحق من جديد بعد العودة، لأن عدّاد الجولات عاد كذلك.
        assert_eq!(t.push_results("a", &[turn("x", "SUCCEEDED")], true, |_, x| x.status.clone()), 1);
        assert!(t.first_time("block seen during the failed step"), "a block from a rolled-back step stayed marked as shown");
    }
}
