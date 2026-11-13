// أفعال Phase-06 الأصلية لطبقة القياس. تُترجَم مع الميزة `e2e` وحدها.
//
// أربع حقائق لا مسار لها من الواجهة عمدًا، ولا يجوز أن تُستنتَج من نجاح الشاشة:
//   ١ — أزمنة بوابة الموصلات كما قاسها زمن التشغيل، وقياس داخل العملية لحلّ الإعدادات
//       ونظرة الصحّة، لقياس الأداء.
//   ٢ — هل ظهرت قيمة مفتاح الاختبار في أيّ صفّ من المخزن أو في أيّ ملف تشخيص؟ القيمة
//       تُقرأ هنا من بيئة العملية نفسها، ولا تمرّ بالعارض، ويُعاد العدد لا النصّ.
//   ٣ — كم نداءً جاريًا لموصل الآن، لقياس الإلغاء وهو في الطيران.
//   ٤ — ما سجّله Phase-06 في سجلّ Phase-04، وما رُفض منه، وما استُعيد عند الإقلاع.
//
// الحدّ الذي يبقى: الفعل من قائمة مغلقة، ولا يقبل هذا المسار نداء موصل ولا كتابة إعداد
// ولا موافقة ولا مفتاحًا. والأمر نفسه غير مُترجَم في ثنائي المنتج.

use std::time::Instant;

use polaris_host_core::p06::config::ConfigScope;
use polaris_host_core::services::host::DesktopHost;
use serde_json::{json, Value};

const ACTIONS: [&str; 5] = ["p06.timings", "p06.measure", "p06.connector.inflight", "p06.registry.state", "p06.canary.scan"];
/// متغيّر البيئة الذي يحمل مفتاح موصل الاختبار. اسمه ثابت هنا، وقيمته لا تغادر هذا الملف.
const TOKEN_ENV: &str = "POLARIS_CONNECTOR_TEST_TOKEN";
const CONNECTOR_SKILL: &str = "polaris.skill.connector-operator";

fn mean_micros(total: u64, count: u64) -> Value {
    if count == 0 {
        Value::Null
    } else {
        json!(total as f64 / count as f64)
    }
}

/// يقيس دالّة N مرّة داخل العملية. يعيد المتوسّط والأقصى بالميكروثانية، محسوبين من
/// النانوثانية: قراءة أسرع من ميكروثانية لا تُقرَّب إلى صفر.
fn bench(rounds: u32, mut work: impl FnMut()) -> Value {
    let mut total = 0u128;
    let mut max = 0u128;
    for _ in 0..rounds {
        let started = Instant::now();
        work();
        let spent = started.elapsed().as_nanos();
        total += spent;
        max = max.max(spent);
    }
    let mean = total as f64 / f64::from(rounds.max(1)) / 1_000.0;
    json!({ "rounds": rounds, "mean_micros": mean, "max_micros": max as f64 / 1_000.0, "resolution": "nanoseconds" })
}

pub fn handle(host: &DesktopHost, action: &str, argument: &str) -> Value {
    if !ACTIONS.contains(&action) {
        return json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": action });
    }
    let Some(p06) = host.phase06() else {
        return json!({ "ok": false, "reason": "PHASE_06_UNAVAILABLE", "action": action });
    };
    match action {
        "p06.timings" => {
            let t = p06.gateway.as_ref().map(|g| g.timings()).unwrap_or_default();
            json!({
                "ok": true,
                "action": action,
                "gateway": {
                    "invocations": t.invocations, "overhead_mean_micros": mean_micros(t.overhead_micros_total, t.invocations),
                    "auth_resolutions": t.auth_resolutions, "auth_mean_micros": mean_micros(t.auth_micros_total, t.auth_resolutions),
                    "budget_checks": t.budget_checks, "budget_mean_micros": mean_micros(t.budget_micros_total, t.budget_checks),
                    "cost_writes": t.cost_writes, "cost_write_mean_micros": mean_micros(t.cost_write_micros_total, t.cost_writes),
                    "event_writes": t.event_writes, "event_write_mean_micros": mean_micros(t.event_write_micros_total, t.event_writes),
                    "registry_loads": t.registry_loads, "registry_load_mean_micros": mean_micros(t.registry_load_micros_total, t.registry_loads),
                },
            })
        }
        // قياس داخل العملية على المضيف الحقيقي. قراءة فقط: لا كتابة إعداد ولا حدث.
        "p06.measure" => {
            let global = ConfigScope::global();
            let scoped = ConfigScope { project_id: Some("00000000-0000-4000-8000-000000000001".into()), mission_id: Some("00000000-0000-4000-8000-000000000002".into()) };
            json!({
                "ok": true,
                "action": action,
                "settings_read": bench(500, || {
                    let _ = p06.config.resolve("connectors.max_external_calls_per_mission", &global);
                }),
                "settings_reload_from_store": bench(20, || p06.config.reload()),
                "effective_config_resolution": bench(200, || {
                    let _ = p06.config.effective(&scoped);
                }),
                "health_overview": bench(20, || {
                    let _ = p06.health();
                }),
                "budget_list": bench(50, || {
                    let _ = p06.books.budgets.list();
                }),
            })
        }
        // الوسيط معرّف موصل. العدد وحده يُعاد.
        "p06.connector.inflight" => {
            if argument.len() != 36 {
                return json!({ "ok": false, "reason": "ARGUMENT_INVALID", "action": action });
            }
            json!({ "ok": true, "action": action, "in_flight": p06.gateway.as_ref().map(|g| g.limiter.in_flight(argument)).unwrap_or(0) })
        }
        "p06.registry.state" => json!({
            "ok": true,
            "action": action,
            "refused_tools": p06.refused_tools.iter().map(|(id, reason)| json!({ "id": id, "reason": reason })).collect::<Vec<_>>(),
            "guard_installed": p06.guard_installed,
            "overlay_installed": p06.overlay_installed,
            "recovered_at_start": p06.gateway.as_ref().map(|g| g.recovered_at_start).unwrap_or(0),
            "connector_tools": host.phase04().map(|p| p.tools_for_skill(CONNECTOR_SKILL).len()).unwrap_or(0),
            // هل وصل مفتاح الاختبار إلى بيئة العملية؟ نعم أو لا، ولا شيء غير ذلك.
            "test_token_present": std::env::var(TOKEN_ENV).map(|v| !v.is_empty()).unwrap_or(false),
        }),
        "p06.canary.scan" => {
            let Ok(canary) = std::env::var(TOKEN_ENV) else {
                return json!({ "ok": false, "reason": "NO_TEST_TOKEN", "action": action });
            };
            if canary.len() < 8 {
                return json!({ "ok": false, "reason": "NO_TEST_TOKEN", "action": action });
            }
            let rows = match p06.stored_rows_containing(&canary) {
                Ok(count) => json!(count),
                Err(_) => Value::Null,
            };
            let mut files = 0u64;
            let mut files_with_canary = 0u64;
            let mut files_not_json = 0u64;
            let mut largest = 0u64;
            if let Some(dir) = p06.diagnostics_dir() {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        let Ok(bytes) = std::fs::read(entry.path()) else { continue };
                        files += 1;
                        largest = largest.max(bytes.len() as u64);
                        let text = String::from_utf8_lossy(&bytes);
                        if text.contains(canary.as_str()) {
                            files_with_canary += 1;
                        }
                        if serde_json::from_slice::<Value>(&bytes).is_err() {
                            files_not_json += 1;
                        }
                    }
                }
            }
            json!({
                "ok": true,
                "action": action,
                "store_rows_containing": rows,
                "diagnostics_files": files,
                "diagnostics_files_containing": files_with_canary,
                "diagnostics_files_not_json": files_not_json,
                "diagnostics_largest_bytes": largest,
            })
        }
        other => json!({ "ok": false, "reason": "UNKNOWN_NATIVE_ACTION", "action": other }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_action_list_is_closed_and_carries_no_action_path() {
        for action in ACTIONS {
            for verb in ["invoke", "execute", "set", "write", "grant", "approve", "credential", "secret", "call"] {
                assert!(!action.contains(verb), "{action} reads like an action path");
            }
        }
        let host = DesktopHost::default();
        assert_eq!(handle(&host, "p06.connector.invoke", "")["reason"], "UNKNOWN_NATIVE_ACTION");
    }

    #[test]
    fn phase06_registers_its_hooks_and_counts_are_returned_not_values() {
        let host = DesktopHost::default();
        let state = handle(&host, "p06.registry.state", "");
        assert_eq!(state["ok"], true);
        assert_eq!(state["refused_tools"].as_array().unwrap().len(), 0);
        assert_eq!(state["guard_installed"], true);
        assert_eq!(state["overlay_installed"], true);
        assert_eq!(handle(&host, "p06.connector.inflight", "short")["reason"], "ARGUMENT_INVALID");
        let measured = handle(&host, "p06.measure", "");
        assert_eq!(measured["ok"], true);
        assert!(measured["effective_config_resolution"]["mean_micros"].as_f64().is_some());
    }
}
