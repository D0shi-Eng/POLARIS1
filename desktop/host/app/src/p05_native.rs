// أفعال Phase-05 الأصلية لطبقة القياس. تُترجَم مع الميزة `e2e` وحدها.
//
// ثلاث حقائق لا مسار لها من الواجهة عمدًا، ولا يجوز أن تُستنتَج من نجاح الشاشة:
//   ١ — أزمنة الذاكرة والمتصفّح والحاسوب كما قاسها زمن التشغيل، لقياس الأداء.
//   ٢ — هل بقي في مخزن الذاكرة صفّ يحمل نصًّا بعينه بعد حذفه: الحذف حقيقي أم إخفاء؟
//   ٣ — ما سجّله Phase-05 في سجل Phase-04، وما رُفض منه، وما أُغلق عند الإقلاع.
//
// الحدّ الذي يبقى: الفعل من قائمة مغلقة، ولا يقبل هذا المسار فعل متصفّح ولا فعل
// حاسوب ولا كتابة ذاكرة ولا موافقة. والأمر نفسه غير مُترجَم في ثنائي المنتج.

use polaris_host_core::services::host::DesktopHost;
use serde_json::{json, Value};

const ACTIONS: [&str; 5] = ["p05.timings", "p05.memory.residue", "p05.memory.accessed", "p05.registry.state", "p05.inflight.count"];

pub fn handle(host: &DesktopHost, action: &str, argument: &str) -> Value {
    if !ACTIONS.contains(&action) {
        return json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": action });
    }
    let Some(p05) = host.phase05() else {
        return json!({ "ok": false, "reason": "PHASE_05_UNAVAILABLE", "action": action });
    };
    match action {
        "p05.timings" => {
            let m = p05.memory.timings();
            let b = p05.browser.timings();
            let c = p05.computer.timings();
            json!({
                "ok": true,
                "action": action,
                "memory": { "writes": m.writes, "write_micros_total": m.write_micros_total, "retrievals": m.retrievals,
                    "retrieval_micros_total": m.retrieval_micros_total, "context_blocks": m.context_blocks, "context_tokens_total": m.context_tokens_total, "context_micros_total": m.context_micros_total },
                "evidence": host.phase03().map(|p| { let e = p.repository.evidence_timings(); json!({ "saves": e.saves, "rows": e.rows, "micros_total": e.micros_total }) }),
                "browser": { "sessions_started": b.sessions_started, "session_start_micros_total": b.session_start_micros_total,
                    "navigations": b.navigations, "navigation_overhead_micros_total": b.navigation_overhead_micros_total,
                    "observations": b.observations, "observation_micros_total": b.observation_micros_total },
                "computer": { "captures": c.captures, "capture_micros_total": c.capture_micros_total,
                    "dispatches": c.dispatches, "dispatch_micros_total": c.dispatch_micros_total },
            })
        }
        // الوسيط نصّ علامة يضعه الاختبار في ذاكرة ثم يحذفها. العدد يُعاد، لا النصّ.
        "p05.memory.residue" => {
            if argument.len() < 8 || argument.len() > 80 {
                return json!({ "ok": false, "reason": "ARGUMENT_INVALID", "action": action });
            }
            match p05.memory.store().rows_containing(argument) {
                Ok(count) => json!({ "ok": true, "action": action, "rows_containing": count }),
                Err(_) => json!({ "ok": false, "reason": "STORE_UNREADABLE", "action": action }),
            }
        }
        // الوسيط معرّف مهمّة. يُعاد ما قُرئ من الذاكرة سياقًا لوكلائها: معرّفات فقط.
        "p05.memory.accessed" => {
            if argument.len() != 36 {
                return json!({ "ok": false, "reason": "ARGUMENT_INVALID", "action": action });
            }
            match p05.memory.store().accessed_for_agent(argument) {
                Ok(ids) => json!({ "ok": true, "action": action, "memory_ids": ids }),
                Err(_) => json!({ "ok": false, "reason": "STORE_UNREADABLE", "action": action }),
            }
        }
        "p05.registry.state" => json!({
            "ok": true,
            "action": action,
            "refused_registrations": p05.refused_registrations.iter().map(|(id, reason)| json!({ "id": id, "reason": reason })).collect::<Vec<_>>(),
            "sessions_closed_at_start": p05.sessions_closed_at_start,
            "desktop_available": p05.computer.available(),
            "runtime_grant": polaris_host_core::p04::effect::RUNTIME_CAPABILITY_GRANT,
        }),
        "p05.inflight.count" => json!({
            "ok": true,
            "action": action,
            "running_model_requests": host.phase02().map(|p| p.invocations.running_count()).unwrap_or(0),
            "registered_mission_runs": host.phase03().map(|p| p.cancellation.running_count()).unwrap_or(0),
            "browser_state": if argument.is_empty() { Value::Null } else { json!(p05.browser.live_state(argument)) },
            "computer_state": if argument.is_empty() { Value::Null } else { json!(p05.computer.live_state(argument)) },
        }),
        other => json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": other }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_action_list_is_closed_and_carries_no_action_path() {
        for action in ACTIONS {
            for verb in ["execute", "navigate", "click", "type", "write", "grant", "approve", "trust"] {
                assert!(!action.contains(verb), "{action} reads like an action path");
            }
        }
        let host = DesktopHost::default();
        assert_eq!(handle(&host, "p05.browser.navigate", "")["reason"], "UNKNOWN_NATIVE_ACTION");
    }

    #[test]
    fn phase05_registers_without_refusal_and_residue_is_counted_not_returned() {
        let host = DesktopHost::default();
        let state = handle(&host, "p05.registry.state", "");
        assert_eq!(state["ok"], true);
        assert_eq!(state["refused_registrations"].as_array().unwrap().len(), 0);
        let residue = handle(&host, "p05.memory.residue", "NO-SUCH-MARKER-TEXT");
        assert_eq!(residue["rows_containing"], 0);
        assert!(residue.get("text").is_none());
        assert_eq!(handle(&host, "p05.memory.accessed", "short")["reason"], "ARGUMENT_INVALID");
        let none = handle(&host, "p05.memory.accessed", "00000000-0000-4000-8000-000000000000");
        assert_eq!(none["memory_ids"].as_array().unwrap().len(), 0);
    }
}
