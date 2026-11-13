// مقاييس كل مهمّة في مجموعة التقييم الثابتة (خطة 2026-10-05، البند A3): أرقام قبل وبعد كل تغيير في الأدوات أو
// السياق، من سجلّات المضيف وحدها.
//
// المصادر: سجلّ الاستهلاك (`usage.list`، ما أبلغ به المزوّد أو قاسه المضيف) وسجلّ البوابة (`tool.activity.list`).
// لا رقم مقدَّر هنا: نداء بلا رموز مبلَّغ عنها يُعدّ في `model_calls_unreported` ولا يُضاف صفرًا إلى المجموع كأنه قِيس.

use serde_json::{json, Value};

/// مقاييس مهمّة واحدة.
pub fn mission_metrics(usage_records: &[Value], invocations: &[Value]) -> Value {
    let models: Vec<&Value> = usage_records.iter().filter(|r| r["category"] == "MODEL").collect();
    let reported: Vec<&&Value> = models.iter().filter(|r| r["tokens_provenance"] == "PROVIDER_REPORTED").collect();
    let sum = |field: &str| -> u64 { reported.iter().filter_map(|r| r[field].as_u64()).sum() };
    let input = sum("input_tokens");
    let cached = sum("cached_tokens");
    // نسبة المخبوء من رموز الإدخال المبلَّغ عنها: ما وفّرته ذاكرة البادئة.
    let cache_ratio = if input > 0 { (cached as f64 / input as f64 * 1000.0).round() / 1000.0 } else { 0.0 };
    let model_ms: u64 = models.iter().filter_map(|r| r["wall_ms"].as_u64()).sum();

    let total_tools = invocations.len();
    let mut refusals: std::collections::BTreeMap<String, u64> = std::collections::BTreeMap::new();
    for i in invocations.iter().filter(|i| i["status"] == "DENIED") {
        *refusals.entry(i["denial_reason"].as_str().unwrap_or("UNKNOWN").to_string()).or_default() += 1;
    }
    let arguments_invalid = refusals.get("ARGUMENTS_INVALID").copied().unwrap_or(0);
    // عمل مكرَّر: نداء ناجح بالأداة نفسها والوسائط نفسها (بصمتها) بعد نجاح سابق مطابق. القراءة والسرد مستثناة: إعادة
    // القراءة كلفة لا أثر، وتُعدّ وحدها في `repeated_reads`.
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    let (mut repeated_effects, mut repeated_reads) = (0u64, 0u64);
    for i in invocations.iter().filter(|i| i["status"] == "SUCCEEDED") {
        let key = (i["tool_id"].as_str().unwrap_or_default().to_string(), i["arguments_digest"].as_str().unwrap_or_default().to_string());
        if key.1.is_empty() || seen.insert(key.clone()) {
            continue;
        }
        if matches!(key.0.as_str(), "polaris.workspace.read" | "polaris.workspace.list") {
            repeated_reads += 1;
        } else {
            repeated_effects += 1;
        }
    }
    json!({
        "model_calls": models.len(),
        "model_calls_reported": reported.len(),
        "model_calls_unreported": models.len() - reported.len(),
        "input_tokens_reported": input,
        "output_tokens_reported": sum("output_tokens"),
        "cached_tokens_reported": cached,
        "cached_share_of_input": cache_ratio,
        "model_wall_ms": model_ms,
        "tool_calls": total_tools,
        "refusals": refusals,
        "arguments_invalid": arguments_invalid,
        "arguments_invalid_share": if total_tools > 0 { (arguments_invalid as f64 / total_tools as f64 * 1000.0).round() / 1000.0 } else { 0.0 },
        "repeated_effectful_calls": repeated_effects,
        "repeated_reads": repeated_reads,
    })
}

/// ملخّص المجموعة: مجاميع المهامّ التي شُغّلت فعلًا، ونسب محسوبة من المجاميع لا متوسّط نسب.
pub fn suite_summary(rows: &[Value]) -> Value {
    let ran: Vec<&Value> = rows.iter().filter(|r| r.get("metrics").is_some()).collect();
    let total = |field: &str| -> u64 { ran.iter().filter_map(|r| r["metrics"][field].as_u64()).sum() };
    let (input, cached, tools, invalid) = (total("input_tokens_reported"), total("cached_tokens_reported"), total("tool_calls"), total("arguments_invalid"));
    let passed = rows.iter().filter(|r| r["status"] == "PASS").count();
    json!({
        "tasks": rows.len(),
        "tasks_run": ran.len(),
        "tasks_passed": passed,
        "duration_ms": ran.iter().filter_map(|r| r["duration_ms"].as_u64()).sum::<u64>(),
        "model_calls": total("model_calls"),
        "model_calls_unreported": total("model_calls_unreported"),
        "input_tokens_reported": input,
        "output_tokens_reported": total("output_tokens_reported"),
        "cached_tokens_reported": cached,
        "cached_share_of_input": if input > 0 { (cached as f64 / input as f64 * 1000.0).round() / 1000.0 } else { 0.0 },
        "tool_calls": tools,
        "arguments_invalid": invalid,
        "arguments_invalid_share": if tools > 0 { (invalid as f64 / tools as f64 * 1000.0).round() / 1000.0 } else { 0.0 },
        "repeated_effectful_calls": total("repeated_effectful_calls"),
        "repeated_reads": total("repeated_reads"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_count_only_reported_tokens_and_find_repeated_work() {
        let usage = vec![
            json!({ "category": "MODEL", "tokens_provenance": "PROVIDER_REPORTED", "input_tokens": 1000, "output_tokens": 100, "cached_tokens": 600, "wall_ms": 50 }),
            json!({ "category": "MODEL", "tokens_provenance": "UNKNOWN", "input_tokens": null, "output_tokens": null, "cached_tokens": null, "wall_ms": 40 }),
            json!({ "category": "TOOL", "tokens_provenance": "UNKNOWN", "wall_ms": 3 }),
        ];
        let call = |tool: &str, status: &str, reason: Option<&str>, digest: &str| json!({ "tool_id": tool, "status": status, "denial_reason": reason, "arguments_digest": digest });
        let invocations = vec![
            call("polaris.workspace.read", "SUCCEEDED", None, "r1"),
            call("polaris.workspace.read", "SUCCEEDED", None, "r1"),
            call("polaris.artifact.document", "DENIED", Some("ARGUMENTS_INVALID"), "d0"),
            call("polaris.artifact.document", "SUCCEEDED", None, "d1"),
            call("polaris.artifact.document", "SUCCEEDED", None, "d1"),
        ];
        let m = mission_metrics(&usage, &invocations);
        assert_eq!(m["model_calls"], 2);
        assert_eq!(m["model_calls_unreported"], 1, "an unreported call was counted as measured");
        assert_eq!(m["input_tokens_reported"], 1000);
        assert_eq!(m["cached_share_of_input"], 0.6);
        assert_eq!(m["arguments_invalid"], 1);
        assert_eq!(m["arguments_invalid_share"], 0.2);
        assert_eq!(m["repeated_effectful_calls"], 1);
        assert_eq!(m["repeated_reads"], 1);
        let rows = vec![json!({ "status": "PASS", "duration_ms": 10, "metrics": m }), json!({ "status": "BLOCKED" })];
        let s = suite_summary(&rows);
        assert_eq!((s["tasks"].as_u64(), s["tasks_run"].as_u64(), s["tasks_passed"].as_u64()), (Some(2), Some(1), Some(1)));
        assert_eq!(s["arguments_invalid_share"], 0.2);
    }
}
