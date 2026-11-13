// قياس الحلقة (P0، تكليف المالك 2026-10-27): ما عُرض على النموذج من أدوات وحجمه، ومتى حُمّلت مجموعة، وكيف حُسم قرار التوجيه،
// وحجم كل نداء نموذج. بلا هذا لا يُقاس أي تحسين قبل/بعد (G-10-1).
//
// تُكتب سجلّات `record_only` في سجلّ الجلسة (كقائمة المرشحين من قبل): لا تُعاد إلى المحادثة، ولا تحمل نص المستخدم ولا وسائط
// الاستدعاءات ولا أسرارًا. أسماء أدوات وأعداد وأحجام بالأحرف فقط. امتداد `chat` يبقى مصدر الزمن لكل نداء.

use serde_json::{json, Value};

use crate::p03::agent_loop::LoopTool;

/// مفتاح نوع السجلّ في الحمولة.
pub const MEASURE_KEY: &str = "measure";
pub const TOOL_SELECTION: &str = "tool_selection";
pub const TOOLS_LOADED: &str = "tools_loaded";
pub const ROUTE: &str = "route";
pub const ROUTE_REFUSED: &str = "route_refused";
pub const MODEL_TURN: &str = "model_turn";
/// W-2: تلخيص سياق وكيل مفوَّض (حجم محادثته قبل وبعد، وما غطّاه).
pub const HELPER_SUMMARY: &str = "helper_summary";
/// W-2: نسبة الرموز الحقيقية إلى تقدير التوجيه، بالألف، حين ترتفع.
pub const TOKEN_CALIBRATION: &str = "token_calibration";

/// كيف حُسم قرار التوجيه.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteDecision {
    Delegate,
    Direct,
    /// نفدت مرّات الرفض فمضى العمل بلا قرار صريح (`ROUTE_REFUSALS`).
    AfterRefusals,
    /// W-1: مفتاح التوجيه الضمني مشغَّل، فاستدعاء العمل الأول قبل القرار عُدّ «أعمل بنفسي».
    Implicit,
}

impl RouteDecision {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Delegate => "delegate",
            Self::Direct => "direct",
            Self::AfterRefusals => "after_refusals",
            Self::Implicit => "implicit",
        }
    }
}

/// حجم مخططات الأدوات كما تُرسل (الاسم والوصف والمعاملات)، بالأحرف.
pub fn tool_schema_chars(tools: &[LoopTool]) -> usize {
    tools.iter().map(|t| t.name.chars().count() + t.description.chars().count() + t.parameters.to_string().chars().count()).sum()
}

fn record(kind: &str, mut fields: Value) -> Value {
    if let Value::Object(map) = &mut fields {
        map.insert("text".into(), Value::String(format!("[POLARIS] measure: {kind}")));
        map.insert(MEASURE_KEY.into(), Value::String(kind.to_string()));
        map.insert("record_only".into(), Value::Bool(true));
    }
    fields
}

/// ما عُرض في بداية الحلقة.
pub struct SelectionFacts<'a> {
    pub offered: &'a [LoopTool],
    pub deferred: usize,
    pub playbooks: usize,
    pub system_chars: usize,
    pub candidates: usize,
    pub route_required: bool,
    pub helper: bool,
}

pub fn selection_record(f: &SelectionFacts<'_>) -> Value {
    record(
        TOOL_SELECTION,
        json!({
            "offered": f.offered.iter().map(|t| t.name.clone()).collect::<Vec<_>>(),
            "offered_count": f.offered.len(),
            "deferred_count": f.deferred,
            "playbooks": f.playbooks,
            "tool_schema_chars": tool_schema_chars(f.offered),
            "system_chars": f.system_chars,
            "candidates": f.candidates,
            "route_required": f.route_required,
            "helper": f.helper,
        }),
    )
}

/// مجموعة حُمّلت أثناء الحلقة: تغيّر بادئة التعليمة فيُعاد معالجتها كاملة عند الخادم المحلي.
pub fn loaded_record(turn: u32, names: &[String], offered: &[LoopTool], system_chars: usize) -> Value {
    record(
        TOOLS_LOADED,
        json!({ "turn": turn, "loaded": names, "offered_count": offered.len(), "tool_schema_chars": tool_schema_chars(offered), "system_chars": system_chars }),
    )
}

pub fn route_record(turn: u32, decision: RouteDecision, refusals: u32) -> Value {
    record(ROUTE, json!({ "turn": turn, "decision": decision.as_str(), "refusals": refusals }))
}

pub fn route_refused_record(turn: u32, refusals: u32) -> Value {
    record(ROUTE_REFUSED, json!({ "turn": turn, "refusals": refusals }))
}

/// W-2: المساعد لخّص سياقه: الرسائل المطويّة، والبايتات قبل وبعد بتقدير التوجيه، وهل نجح نداء التلخيص.
pub fn helper_summary_record(turn: u32, covered: usize, bytes_before: usize, bytes_after: usize, ok: bool, chunks: usize) -> Value {
    record(HELPER_SUMMARY, json!({ "turn": turn, "covered": covered, "bytes_before": bytes_before, "bytes_after": bytes_after, "ok": ok, "chunks": chunks }))
}

/// W-2: أكبر نسبة رموز حقيقية إلى تقدير التوجيه حتى الآن، بالألف (1000 = مطابق).
pub fn token_calibration_record(turn: u32, ratio_permille: u32) -> Value {
    record(TOKEN_CALIBRATION, json!({ "turn": turn, "ratio_permille": ratio_permille }))
}

/// نداء نموذج واحد في دور: حجمه وما عاد به. الرموز كما بلّغها المزوّد (صفر = لم يبلّغ).
pub struct TurnFacts {
    pub turn: u32,
    pub ok: bool,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tool_calls: usize,
    pub system_chars: usize,
    pub conversation_chars: usize,
    pub offered_count: usize,
    pub routed: bool,
}

pub fn turn_record(f: &TurnFacts) -> Value {
    record(
        MODEL_TURN,
        json!({
            "turn": f.turn,
            "status": if f.ok { "OK" } else { "ERROR" },
            "input_tokens": f.input_tokens,
            "output_tokens": f.output_tokens,
            "tool_calls": f.tool_calls,
            "system_chars": f.system_chars,
            "conversation_chars": f.conversation_chars,
            "offered_count": f.offered_count,
            "routed": f.routed,
        }),
    )
}

/// خلاصة القياس لحلقة واحدة (من حمولات سجلّ الجلسة بترتيبها).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MeasureSummary {
    pub model_turns: u32,
    pub failed_turns: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tool_calls: u64,
    pub initial_offered: usize,
    pub initial_tool_schema_chars: usize,
    pub initial_system_chars: usize,
    pub max_system_chars: usize,
    pub max_conversation_chars: usize,
    pub loads: u32,
    pub route_required: bool,
    pub route_refusals: u32,
    /// القرار ودوره (عدد أدوار النموذج قبله = رقم الدور).
    pub route: Option<(String, u32)>,
}

pub fn summarize<'a>(payloads: impl IntoIterator<Item = &'a Value>) -> MeasureSummary {
    let mut s = MeasureSummary::default();
    let n = |v: &Value, k: &str| v.get(k).and_then(Value::as_u64).unwrap_or(0);
    for p in payloads {
        match p.get(MEASURE_KEY).and_then(Value::as_str) {
            Some(TOOL_SELECTION) if s.initial_offered == 0 && !p["helper"].as_bool().unwrap_or(false) => {
                s.initial_offered = n(p, "offered_count") as usize;
                s.initial_tool_schema_chars = n(p, "tool_schema_chars") as usize;
                s.initial_system_chars = n(p, "system_chars") as usize;
                s.route_required = p["route_required"].as_bool().unwrap_or(false);
            }
            Some(TOOLS_LOADED) => s.loads += 1,
            Some(ROUTE_REFUSED) => s.route_refusals += 1,
            Some(ROUTE) if s.route.is_none() => s.route = Some((p["decision"].as_str().unwrap_or("").to_string(), n(p, "turn") as u32)),
            Some(MODEL_TURN) => {
                s.model_turns += 1;
                s.failed_turns += u32::from(p["status"] != "OK");
                s.input_tokens += n(p, "input_tokens");
                s.output_tokens += n(p, "output_tokens");
                s.tool_calls += n(p, "tool_calls");
                s.max_system_chars = s.max_system_chars.max(n(p, "system_chars") as usize);
                s.max_conversation_chars = s.max_conversation_chars.max(n(p, "conversation_chars") as usize);
            }
            _ => {}
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(name: &str) -> LoopTool {
        LoopTool { name: name.into(), tool_id: None, description: "d".into(), parameters: json!({ "type": "object" }) }
    }

    #[test]
    fn every_record_is_record_only_and_names_its_kind() {
        let offered = [tool("write_file")];
        let all = [
            selection_record(&SelectionFacts { offered: &offered, deferred: 3, playbooks: 2, system_chars: 900, candidates: 5, route_required: true, helper: false }),
            loaded_record(2, &["web_search".into()], &offered, 1000),
            route_record(1, RouteDecision::Direct, 1),
            route_refused_record(0, 1),
            turn_record(&TurnFacts { turn: 0, ok: true, input_tokens: 100, output_tokens: 20, tool_calls: 1, system_chars: 900, conversation_chars: 50, offered_count: 1, routed: false }),
        ];
        for r in &all {
            assert_eq!(r["record_only"], true, "{r}");
            assert!(r[MEASURE_KEY].is_string(), "{r}");
        }
    }

    #[test]
    fn the_summary_counts_turns_tokens_loads_and_the_route_turn() {
        let offered = [tool("write_file"), tool("read_file")];
        let events = [
            selection_record(&SelectionFacts { offered: &offered, deferred: 3, playbooks: 0, system_chars: 900, candidates: 5, route_required: true, helper: false }),
            turn_record(&TurnFacts { turn: 0, ok: true, input_tokens: 100, output_tokens: 20, tool_calls: 1, system_chars: 900, conversation_chars: 50, offered_count: 2, routed: false }),
            route_refused_record(0, 1),
            turn_record(&TurnFacts { turn: 1, ok: true, input_tokens: 120, output_tokens: 10, tool_calls: 1, system_chars: 900, conversation_chars: 80, offered_count: 2, routed: false }),
            route_record(1, RouteDecision::Direct, 1),
            loaded_record(2, &["web_search".into()], &offered, 1200),
            turn_record(&TurnFacts { turn: 2, ok: false, input_tokens: 0, output_tokens: 0, tool_calls: 0, system_chars: 1200, conversation_chars: 90, offered_count: 3, routed: true }),
        ];
        let s = summarize(events.iter());
        assert_eq!((s.model_turns, s.failed_turns, s.input_tokens, s.output_tokens, s.tool_calls), (3, 1, 220, 30, 2));
        assert_eq!((s.initial_offered, s.initial_system_chars, s.max_system_chars, s.max_conversation_chars), (2, 900, 1200, 90));
        assert_eq!((s.loads, s.route_refusals, s.route_required), (1, 1, true));
        assert_eq!(s.route, Some(("direct".into(), 1)));
    }

    #[test]
    fn a_helpers_selection_does_not_replace_the_coordinators() {
        let a = [tool("a")];
        let b = [tool("b"), tool("c"), tool("d")];
        let events = [
            selection_record(&SelectionFacts { offered: &b, deferred: 0, playbooks: 0, system_chars: 1, candidates: 0, route_required: false, helper: true }),
            selection_record(&SelectionFacts { offered: &a, deferred: 0, playbooks: 0, system_chars: 1, candidates: 0, route_required: false, helper: false }),
        ];
        assert_eq!(summarize(events.iter()).initial_offered, 1);
    }
}
