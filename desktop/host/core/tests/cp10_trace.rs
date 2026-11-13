// PHASE-10 — التتبّع مع آلاف الأحداث (تكليف المالك 2026-10-20): الواجهة لا تُحمَّل بسجلّات خام كبيرة.
//
// قِيس (CP-10-1): `mission.trace` كان يعيد كل امتدادات المهمّة بلا حدّ، والعقد يقول 5000 على الأكثر، فمهمّة تتجاوزها تعطي نتيجة
// يرفضها مدقّق العارض فتختفي شاشة التتبّع؛ والعارض كان يرسم كل امتداد صفًّا ويحسب المجاميع من القائمة كلها.
// TEST FIXTURE: الامتدادات تُكتب مباشرةً في مخزن الامتدادات الحقيقي للمضيف.

mod p08_support;

use std::time::Instant;

use serde_json::json;

use polaris_host_core::p03::watch::spans::{trace_id_of, SpanRecord, SpanSink, TRACE_PAGE_DEFAULT, TRACE_PAGE_MAX};

fn seed(h: &p08_support::Harness, mission: &str, count: usize) {
    let sink = h.host().phase08().expect("phase-08").spans.clone();
    for i in 0..count {
        let name = match i % 3 {
            0 => "chat",
            1 => "execute_tool",
            _ => "invoke_agent",
        };
        let span = SpanRecord {
            span_id: format!("{:016x}", i + 1),
            trace_id: trace_id_of(mission),
            parent_span_id: None,
            mission_id: mission.to_string(),
            name,
            agent_id: Some("agent".into()),
            task_id: None,
            model_id: (name == "chat").then(|| "fixture-model".into()),
            provider_id: None,
            tool_id: (name == "execute_tool").then(|| "polaris.workspace.write".into()),
            invocation_id: None,
            input_tokens: (name == "chat" && i % 30 != 0).then_some(10),
            output_tokens: (name == "chat" && i % 30 != 0).then_some(5),
            latency_ms: Some(3),
            cost_micros: None,
            status: if name == "execute_tool" && i % 50 == 1 { "DENIED" } else { "OK" },
            gate_decision: None,
            started_at: format!("2026-10-21T10:{:02}:{:02}.{:06}Z", (i / 60_000) % 60, (i / 1000) % 60, i % 1000),
        };
        sink.record(&span).expect("record a span");
    }
}

#[test]
fn cp10_a_trace_with_thousands_of_spans_is_paged_and_its_totals_cover_every_span() {
    let h = p08_support::build(None);
    let mission = h.ok("mission.create", json!({ "title": "trace", "objective": "trace load" }))["mission_id"].as_str().unwrap().to_string();
    let count = 6_000;
    seed(&h, &mission, count);

    let began = Instant::now();
    let first = h.ok("mission.trace", json!({ "mission_id": mission }));
    let first_ms = began.elapsed().as_millis();
    let bytes = first.to_string().len();
    let page = first["spans"].as_array().expect("spans").len();
    println!("CP10 first page: {page} spans of {} in {first_ms} ms, {bytes} bytes", first["spans_total"]);
    assert_eq!(page, TRACE_PAGE_DEFAULT, "the first page is not bounded");
    assert_eq!(first["spans_total"], count);
    assert_eq!(first["next_after"], TRACE_PAGE_DEFAULT);

    // المجاميع تُحسب على كل الامتدادات لا على الصفحة.
    let totals = &first["totals"];
    let chats = (0..count).filter(|i| i % 3 == 0).count();
    let unreported = (0..count).filter(|i| i % 3 == 0 && i % 30 == 0).count();
    assert_eq!(totals["model_calls"], chats);
    assert_eq!(totals["tool_calls"], (0..count).filter(|i| i % 3 == 1).count());
    assert_eq!(totals["agents"], (0..count).filter(|i| i % 3 == 2).count());
    assert_eq!(totals["input_tokens"], (chats - unreported) * 10);
    assert_eq!(totals["output_tokens"], (chats - unreported) * 5);
    assert_eq!(totals["unreported"], unreported);
    assert_eq!(totals["denied"], (0..count).filter(|i| i % 3 == 1 && i % 50 == 1).count());

    // الصفحات تمشي حتى آخرها بلا تكرار ولا ثغرة، وبحدّ أقصى.
    let mut seen = std::collections::BTreeSet::new();
    let mut after = 0u64;
    loop {
        let page = h.ok("mission.trace", json!({ "mission_id": mission, "after": after, "limit": TRACE_PAGE_MAX }));
        let spans = page["spans"].as_array().unwrap();
        assert!(spans.len() <= TRACE_PAGE_MAX);
        for s in spans {
            assert!(seen.insert(s["span_id"].as_str().unwrap().to_string()), "a span came twice");
        }
        match page["next_after"].as_u64() {
            Some(next) => after = next,
            None => break,
        }
    }
    assert_eq!(seen.len(), count, "paging lost spans");
    // حدّ أعلى من المسموح يرفضه العقد قبل المضيف (والمضيف يرفضه أيضًا إن وصله)، لا يُقبل صامتًا.
    assert_eq!(h.err("mission.trace", json!({ "mission_id": mission, "limit": TRACE_PAGE_MAX + 1 }))["code"], "MALFORMED_MESSAGE");
}
