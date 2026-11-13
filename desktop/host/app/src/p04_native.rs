// أفعال Phase-04 الأصلية لطبقة القياس. تُترجَم مع الميزة `e2e` وحدها.
//
// لماذا يوجد هذا الملف: ثلاث حقائق لا مسار لها من الواجهة عمدًا، ولا يجوز أن
// تُستنتَج من نجاح الشاشة —
//   ١ — كم استدعاء نموذج قائم الآن، وكم تشغيل مهمّة مسجَّل. بها يُقاس أن الإلغاء
//       أثناء الطيران لم يترك عملية يتيمة.
//   ٢ — كم دليل أداة سجّلته البوابة فعلًا، وأي نوع. بها يُقاس أن الدليل مقيس ومن
//       مصدره الموثوق لا من نثر وكيل.
//   ٣ — ما تملكه مِنحة زمن التشغيل من قدرات. بها يُقاس أن تنفيذ العملية والوصول
//       إلى السرّ بلا قدرة أصلًا في هذا البناء.
//
// الحدّ الذي يبقى: الفعل من قائمة مغلقة، ولا يقبل هذا المسار نتيجة أداة ولا
// دليلًا ولا موافقة. والأمر نفسه غير مُترجَم في ثنائي المنتج.

use polaris_host_core::services::host::DesktopHost;
use serde_json::{json, Value};

/// الأفعال المتاحة. قائمة مغلقة: لا اسم فعل يأتي حرًّا من العارض.
const ACTIONS: [&str; 6] = [
    "p04.inflight.count",
    "p04.tool.evidence",
    "p04.runtime.capabilities",
    "p04.gateway.state",
    "p04.cancellation.count",
    "p04.skill.tools",
];

pub fn handle(host: &DesktopHost, action: &str, argument: &str) -> Value {
    if !ACTIONS.contains(&action) {
        return json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": action });
    }
    let Some(phase02) = host.phase02() else {
        return json!({ "ok": false, "reason": "PHASE_02_UNAVAILABLE", "action": action });
    };
    let Some(phase04) = host.phase04() else {
        return json!({ "ok": false, "reason": "PHASE_04_UNAVAILABLE", "action": action });
    };

    match action {
        // عدد النداءات القائمة عند Phase-02، وعدد تشغيلات المهامّ المسجَّلة عند
        // Phase-03. بعد الإلغاء يجب أن يكونا صفرًا: لا نداء معلّق ولا تشغيل يتيم.
        "p04.inflight.count" => {
            let missions = host.phase03().map(|p03| p03.cancellation.running_count()).unwrap_or(0);
            json!({
                "ok": true,
                "action": action,
                "running_model_requests": phase02.invocations.running_count(),
                "registered_mission_runs": missions,
            })
        }
        // أدلّة الأدوات كما سجّلتها البوابة. العارض لا يستطيع أن يضيف إليها شيئًا:
        // لا عملية IPC تقبل دليلًا، وهذا الفعل يقرأ ولا يكتب.
        "p04.tool.evidence" => {
            let source = host.tool_evidence();
            let records = if argument.is_empty() { Vec::new() } else { source.for_task(argument, "") };
            json!({
                "ok": true,
                "action": action,
                "total_recorded": source.len(),
                "for_task": records.len(),
                "note": "recorded by the tool gateway after a real execution; no IPC operation can add to this",
            })
        }
        "p04.runtime.capabilities" => {
            let granted = polaris_host_core::p04::service::Phase04::runtime_capabilities();
            let ungranted: Vec<&str> = polaris_host_core::p04::effect::ungranted_effects()
                .into_iter()
                .map(|effect| effect.as_str())
                .collect();
            json!({
                "ok": true,
                "action": action,
                "granted": granted,
                "ungranted_effects": ungranted,
                "note": "fixed in code; no setting, server, model or skill widens it",
            })
        }
        "p04.gateway.state" => {
            let state = phase04.gateway.state.lock();
            match state {
                Ok(state) => json!({
                    "ok": true,
                    "action": action,
                    "skills": state.skills.skills().len(),
                    "enabled_skills": state.skills.skills().iter().filter(|s| s.enabled).count(),
                    "tools": state.tools.tools().len(),
                    "mcp_tools": state
                        .tools
                        .tools()
                        .iter()
                        .filter(|t| t.provider == polaris_host_core::p04::tool::ToolProvider::Mcp)
                        .count(),
                    "adapters": state.adapters.len(),
                    "servers": state.servers.len(),
                    "approvals": state.approvals.records().len(),
                    "activity": state.activity.len(),
                }),
                Err(_) => json!({ "ok": false, "reason": "GATEWAY_LOCK_POISONED", "action": action }),
            }
        }
        "p04.cancellation.count" => json!({
            "ok": true,
            "action": action,
            "registered_mission_runs": host.phase03().map(|p03| p03.cancellation.running_count()).unwrap_or(0),
        }),
        // أدوات مهارة كما يقرأها زمن التشغيل قبل أن يعرضها على النموذج. تُقاس
        // لإثبات أن المعروض هو المسجَّل، لا قائمة ثانية تنجرف عنه.
        "p04.skill.tools" => json!({
            "ok": true,
            "action": action,
            "skill_id": argument,
            "tools": phase04.tools_for_skill(argument),
        }),
        other => json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": other }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_action_list_is_closed_and_carries_no_write_path() {
        assert_eq!(ACTIONS.len(), 6);
        for forbidden in ["p04.tool.execute", "p04.evidence.submit", "p04.approval.grant", "p04.tool.register"] {
            assert!(!ACTIONS.contains(&forbidden), "{forbidden} is a native action");
        }
        // ولا فعل يحمل كلمة كتابة أو تنفيذ في اسمه.
        for action in ACTIONS {
            for verb in ["execute", "submit", "grant", "write", "register"] {
                assert!(!action.contains(verb), "{action} reads like a write path");
            }
        }
    }

    #[test]
    fn an_unknown_action_is_refused_before_anything_is_read() {
        let host = DesktopHost::default();
        let out = handle(&host, "p04.anything", "");
        assert_eq!(out["ok"], false);
        assert_eq!(out["reason"], "UNKNOWN_NATIVE_ACTION");
    }

    #[test]
    fn the_runtime_grant_never_includes_a_process_or_a_secret_capability() {
        let host = DesktopHost::default();
        let out = handle(&host, "p04.runtime.capabilities", "");
        assert_eq!(out["ok"], true);
        let granted = out["granted"].as_array().cloned().unwrap_or_default();
        let text = serde_json::to_string(&granted).unwrap_or_default();
        assert!(!text.contains("tool.process"), "the runtime holds a process capability");
        assert!(!text.contains("tool.secret"), "the runtime holds a secret capability");
        let ungranted = out["ungranted_effects"].as_array().cloned().unwrap_or_default();
        let ungranted_text = serde_json::to_string(&ungranted).unwrap_or_default();
        assert!(ungranted_text.contains("PROCESS_EXECUTION"));
        assert!(ungranted_text.contains("SECRET_ACCESS"));
    }

    #[test]
    fn the_gateway_starts_with_the_builtin_tools_and_no_server() {
        let host = DesktopHost::default();
        let out = handle(&host, "p04.gateway.state", "");
        assert_eq!(out["ok"], true);
        assert_eq!(out["servers"], 0);
        assert_eq!(out["mcp_tools"], 0);
        // لكل أداة محوّل: أداة بلا محوّل لا تدخل السجل. أدوات Phase-04 المدمجة ومهاراته
        // الأربع حاضرة؛ وما تضيفه مرحلة لاحقة (Phase-05) يخضع للخاصيّة نفسها لا لعدد مُثبَّت.
        assert_eq!(out["tools"], out["adapters"]);
        assert!(out["tools"].as_u64().unwrap() >= 3);
        assert!(out["skills"].as_u64().unwrap() >= 4);
        let phase04 = host.phase04().unwrap();
        let state = phase04.gateway.state.lock().unwrap();
        for id in ["polaris.tool.context.read", "polaris.tool.audit.chain.verify", "polaris.tool.project.note.append"] {
            assert!(state.tools.get(id).is_some(), "{id} is missing");
        }
    }

    #[test]
    fn nothing_is_in_flight_before_a_mission_starts() {
        let host = DesktopHost::default();
        let out = handle(&host, "p04.inflight.count", "");
        assert_eq!(out["ok"], true);
        assert_eq!(out["running_model_requests"], 0);
        assert_eq!(out["registered_mission_runs"], 0);
    }

    #[test]
    fn the_tool_evidence_source_starts_empty_and_this_action_cannot_fill_it() {
        let host = DesktopHost::default();
        let out = handle(&host, "p04.tool.evidence", "m1");
        assert_eq!(out["ok"], true);
        assert_eq!(out["total_recorded"], 0);
        // النداء مرّتين لا يضيف شيئًا: القراءة قراءة.
        assert_eq!(handle(&host, "p04.tool.evidence", "m1")["total_recorded"], 0);
    }
}
