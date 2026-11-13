// النموذج الحقيقي: تُفعَّل مزوّدات الحلقة المحلية (Ollama وLM Studio) عبر IPC، ويُكتشف ما عليها، ويُختار نموذج محادثة،
// ويُقاس استدعاء حقيقي واحد. منذ 2026-10-06: مزوّد بعيد يُقاس كذلك حين يسمّيه POLARIS_P08_PROVIDERS ويُشغَّل بـ
// POLARIS_P08_REAL_KEYS=1 (مفتاح المالك من مخزن Windows، قراءة فقط)؛ تفضيل الموقع يصير «السماح بالبعيد» في مجلد بيانات العُدّة وحده.
// الاختيار: POLARIS_P08_MODEL إن سُمّي، وإلا ترتيب معلن (عائلات تُحسن JSON، وحجم قريب من 7..14B).

use serde_json::{json, Value};

use crate::platform::Harness;
use crate::report::{Section, Status};

pub struct Chosen {
    pub model_id: String,
    pub display: String,
}

fn fact(v: &Value) -> String {
    v["value"].as_str().map(String::from).or_else(|| v["value"].as_i64().map(|n| n.to_string())).unwrap_or_default()
}

/// عدد المعاملات بالمليار من نصّ مثل «8B» أو «7.6B» أو اسم مثل «qwen2.5:14b».
fn billions(text: &str) -> Option<f64> {
    let lower = text.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    for (i, c) in bytes.iter().enumerate() {
        if *c == b'b' && i > 0 && bytes[i - 1].is_ascii_digit() && bytes.get(i + 1).is_none_or(|n| !n.is_ascii_alphanumeric()) {
            let start = lower[..i].rfind(|ch: char| !(ch.is_ascii_digit() || ch == '.')).map(|s| s + 1).unwrap_or(0);
            if let Ok(n) = lower[start..i].parse::<f64>() {
                return Some(n);
            }
        }
    }
    None
}

fn score(m: &Value) -> f64 {
    let name = format!("{} {}", m["provider_model_id"].as_str().unwrap_or(""), fact(&m["family"])).to_ascii_lowercase();
    if name.contains("embed") || name.contains("vision") && !name.contains("instruct") {
        return -1.0;
    }
    let mut s = 0.0;
    for (family, bonus) in [("qwen3", 6.0), ("qwen2.5", 5.5), ("qwen", 4.0), ("llama3.1", 4.0), ("llama3", 3.5), ("mistral", 3.0), ("gemma", 3.0), ("phi", 2.0), ("deepseek", 2.0)] {
        if name.contains(family) {
            s += bonus;
            break;
        }
    }
    if name.contains("coder") {
        s -= 0.5;
    }
    // نماذج أُزيلت ضوابطها لا تُختار تلقائيًا لوكيل يحمل أدوات.
    if name.contains("abliterated") || name.contains("uncensored") {
        s -= 4.0;
    }
    let size = billions(&fact(&m["parameter_count"])).or_else(|| billions(m["provider_model_id"].as_str().unwrap_or("")));
    match size {
        Some(b) if (7.0..=14.9).contains(&b) => s += 3.0,
        Some(b) if (3.0..7.0).contains(&b) => s += 1.0,
        Some(b) if (15.0..=32.9).contains(&b) => s += 2.5,
        Some(b) if b > 33.0 => s -= 2.0,
        _ => {}
    }
    if fact(&m["loaded_state"]) == "LOADED" || m["loaded_state"]["value"] == "LOADED" {
        s += 0.5;
    }
    s
}

pub fn run(h: &Harness) -> (Section, Option<Chosen>) {
    let mut s = Section::default();
    // المزوّدات المفعَّلة للقياس: الافتراض كما كان؛ و POLARIS_P08_PROVIDERS يحصرها (مثلًا خادم Bonsai المحلي وحده،
    // فلا يُحمَّل نموذج LM Studio بجانبه على البطاقة نفسها).
    let providers: Vec<String> = std::env::var("POLARIS_P08_PROVIDERS")
        .ok()
        .map(|v| v.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect())
        .filter(|v: &Vec<String>| !v.is_empty())
        .unwrap_or_else(|| vec!["ollama".into(), "lm-studio".into()]);
    for provider in &providers {
        let mut config = json!({ "provider_id": provider, "enabled": true });
        if provider == "local-openai-compatible" {
            if let Ok(endpoint) = std::env::var("POLARIS_P08_ENDPOINT") {
                config["endpoint"] = json!(endpoint);
            }
        }
        let r = h.call("provider.configure", config);
        s.record(&format!("P08-MDL-ENABLE-{}", provider.to_ascii_uppercase()), if r.is_ok() { Status::Pass } else { Status::Fail }, format!("enable local provider {provider}"), r.unwrap_or_else(|e| e));
    }
    // لا خطوة «اسمح بالبعيد» (ADR-040): النموذج الذي يسمّيه المشغّل يُستعمل من أيّ صنف كان.
    let refreshed = h.call("provider.refresh", json!({ "provider_ids": providers }));
    let models = h.call("model.list", json!({})).map(|v| v["models"].as_array().cloned().unwrap_or_default()).unwrap_or_default();
    // خادم متوافق عامّ لا يبلّغ بنوع النموذج (UNKNOWN). يُقبل نموذج بنوع مجهول فقط إن سمّاه المشغّل صراحةً في
    // POLARIS_P08_MODEL، والإجابة الحقيقية أدناه هي ما يثبت أنه نموذج محادثة، لا الاسم.
    let named = std::env::var("POLARIS_P08_MODEL").ok().filter(|v| !v.trim().is_empty());
    let chat: Vec<&Value> = models
        .iter()
        .filter(|m| {
            let kind_ok = m["kind"] == "CHAT" || (m["kind"] == "UNKNOWN" && named.as_deref().is_some_and(|id| m["model_id"] == id || m["provider_model_id"] == id));
            // الاختيار التلقائي في أداة القياس لا يصرف حصّة مزوّد API لم يسمّه المشغّل؛ النموذج المسمّى يُقبل من أيّ صنف.
            kind_ok && m["availability"] == "AVAILABLE" && (m["locality"] == "LOCAL" || named.is_some())
        })
        .collect();
    let inventory: Vec<Value> = models.iter().map(|m| json!({ "model_id": m["model_id"], "kind": m["kind"], "availability": m["availability"], "parameter_count": fact(&m["parameter_count"]), "quantization": fact(&m["quantization"]), "family": fact(&m["family"]) })).collect();
    s.record("P08-MDL-DISCOVERED", if chat.is_empty() { Status::Blocked } else { Status::Pass }, format!("{} local chat models available", chat.len()), json!({ "refresh": refreshed.map(|v| v.to_string().chars().take(1500).collect::<String>()).unwrap_or_else(|e| e.to_string()), "models": inventory }));
    let requested = std::env::var("POLARIS_P08_MODEL").ok().filter(|v| !v.trim().is_empty());
    let mut candidates: Vec<&Value> = match &requested {
        Some(id) => chat.iter().filter(|m| m["model_id"] == id.as_str() || m["provider_model_id"] == id.as_str()).copied().collect(),
        None => chat.iter().copied().filter(|m| score(m) >= 0.0).collect(),
    };
    candidates.sort_by(|a, b| score(b).partial_cmp(&score(a)).unwrap_or(std::cmp::Ordering::Equal));
    if candidates.is_empty() {
        s.record("P08-MDL-SELECTED", Status::Blocked, "no local chat model could be selected (BLOCKED_ENVIRONMENT)", json!({ "requested": requested }));
        return (s, None);
    }
    // الاختيار بالتجربة: أول نموذج (بالترتيب المعلن) يجيب استدعاءً حقيقيًا صحيحًا يُختار. النماذج
    // «المفكّرة» تستهلك رموزًا قبل الجواب، فالحدّ 4096 رمزًا كما في استدعاءات الوكلاء.
    let mut attempts = Vec::new();
    let mut chosen: Option<(String, String, String)> = None;
    let mut viable: Vec<(String, String, String, u64, f64, f64)> = Vec::new();
    for model in candidates.iter().take(4) {
        let model_id = model["model_id"].as_str().unwrap_or("").to_string();
        let _ = h.call("model.configure", json!({ "model_id": model_id, "enabled": true }));
        let invoked = h.call(
            "model.invoke",
            json!({ "invocation_id": polaris_host_core::ids::new_uuid_v4(), "routing_mode": "MANUAL", "model_id": model_id, "messages": [{ "role": "USER", "text": "What is the sum of 17 and 25? Reply with the number only." }], "max_output_tokens": 4096, "timeout_ms": 300000 }),
        );
        let text = invoked.as_ref().ok().and_then(|v| v["output"]["text"].as_str().map(String::from)).unwrap_or_default();
        let ok = invoked.as_ref().is_ok_and(|v| v["status"] == "COMPLETED") && text.contains("42");
        attempts.push(json!({ "model_id": model_id, "score": score(model), "answered": ok, "text": text.chars().take(80).collect::<String>(), "timing": invoked.as_ref().ok().map(|v| v["timing"].clone()), "usage": invoked.as_ref().ok().map(|v| v["usage"].clone()), "status": invoked.as_ref().map(|v| v["status"].clone()).unwrap_or_else(|e| e.clone()) }));
        let total = invoked.as_ref().ok().and_then(|v| v["timing"]["total"]["value"].as_u64()).unwrap_or(u64::MAX);
        if ok {
            let display = model["display_name"]["value"].as_str().unwrap_or(&model_id).to_string();
            let size = billions(&fact(&model["parameter_count"])).or_else(|| billions(model["provider_model_id"].as_str().unwrap_or(""))).unwrap_or(0.0);
            viable.push((model_id, display, text, total, size, score(model)));
        }
    }
    // بين النماذج التي أجابت صحيحًا: الأعلى ترتيبًا مما حجمه 7B فأكثر وزمنه دقيقتان فأقلّ (تكفي
    // ميزانية المهمّة لجولات عدّة)، وإلا الأسرع. القاعدة معلنة ومسجّلة مع كل محاولة.
    viable.sort_by(|a, b| b.5.partial_cmp(&a.5).unwrap_or(std::cmp::Ordering::Equal));
    let pick = viable.iter().find(|v| v.4 >= 7.0 && v.3 <= 120_000).or_else(|| viable.iter().min_by_key(|v| v.3));
    if let Some(v) = pick {
        chosen = Some((v.0.clone(), v.1.clone(), v.2.clone()));
    }
    match chosen {
        Some((model_id, display, text)) => {
            s.record("P08-MDL-SELECTED", Status::Pass, format!("selected {model_id} of {} tried", attempts.len()), json!({ "requested": requested, "attempts": attempts }));
            s.record("P08-MDL-INVOKE", Status::Pass, format!("a real local inference answered: {}", text.chars().take(120).collect::<String>()), json!({ "attempts": attempts }));
            (s, Some(Chosen { model_id, display }))
        }
        None => {
            s.record("P08-MDL-SELECTED", Status::Fail, "no local model answered a real inference correctly", json!({ "requested": requested, "attempts": attempts }));
            s.record("P08-MDL-INVOKE", Status::Fail, "no correct answer from any tried model", json!({ "attempts": attempts }));
            (s, None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::billions;

    #[test]
    fn billions_reads_sizes_from_facts_and_names() {
        assert_eq!(billions("8B"), Some(8.0));
        assert_eq!(billions("7.6B"), Some(7.6));
        assert_eq!(billions("qwen2.5:14b"), Some(14.0));
        assert_eq!(billions("llama3.1:8b-instruct-q4_K_M"), Some(8.0));
        assert_eq!(billions("nomic-embed-text"), None);
    }
}
