// قياس محدود بنموذج حقيقي (تكليف المالك 2026-10-27): مهمّة بسيطة (صفحة HTML)، ومهمّة تعديل صفحة قائمة. يُشغَّل بـ`--ignored` فقط،
// ومع `POLARIS_FC_PROVIDER` و`POLARIS_FC_MODEL` و`POLARIS_FC_ENDPOINT` (كما في fc_real_model). البيانات في مجلد اختبار معزول.
//
// يطبع سطر JSON لكل تشغيل: الحالة، والزمن، ومجاميع الامتدادات (نداءات النموذج والرموز والأدوات والرفض)، والأدوات بنتائجها،
// والموافقات، وفحص الملف. الملف نفسه يعمل على commit سابق بلا تغيير (لا يعتمد على سجلّات P0)، فيصلح للمقارنة قبل/بعد.

mod p08_support;

use std::time::Instant;

use serde_json::{json, Value};

use p08_support::{build, Harness};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

fn configure(h: &Harness) {
    let provider = env("POLARIS_FC_PROVIDER").expect("POLARIS_FC_PROVIDER");
    let model = env("POLARIS_FC_MODEL").expect("POLARIS_FC_MODEL");
    match env("POLARIS_FC_ENDPOINT") {
        Some(endpoint) => h.ok("provider.configure", json!({ "provider_id": provider, "endpoint": endpoint })),
        None => h.ok("provider.configure", json!({ "provider_id": provider, "enabled": true })),
    };
    let refresh = h.ok("provider.refresh", json!({ "provider_ids": [provider] }));
    assert_eq!(refresh["results"][0]["health"]["state"], "HEALTHY", "the provider is not reachable: {}", refresh["results"][0]["health"]);
    h.ok("model.configure", json!({ "model_id": model, "enabled": true }));
    h.ok("model.preferences.set", json!({ "default_model_id": model }));
}

/// يشغّل المهمّة حتى تنتهي، موافقًا على ما تنتظره (ويعدّه)، ثم يطبع سطر القياس ويعيده.
fn measure(h: &Harness, task: &str, mission: &str, path: &str, check: impl Fn(&str) -> bool) -> Value {
    let began = Instant::now();
    let mut approvals = 0;
    let mut state = String::new();
    for _ in 0..6 {
        state = h.ok("mission.start", json!({ "mission_id": mission }))["state"].as_str().unwrap_or("").to_string();
        if state != "WAITING_FOR_APPROVAL" {
            break;
        }
        for a in h.ok("approval.list", json!({ "mission_id": mission }))["approvals"].as_array().cloned().unwrap_or_default() {
            if a["status"] == "PENDING" {
                approvals += 1;
                h.ok("tool.approval.respond", json!({ "approval_id": a["approval_id"], "decision": "GRANT" }));
            }
        }
    }
    let wall_ms = began.elapsed().as_millis() as u64;
    let trace = h.ok("mission.trace", json!({ "mission_id": mission }));
    let calls: Vec<String> = h.ok("tool.activity.list", json!({ "mission_id": mission }))["invocations"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|i| format!("{}={}{}", i["tool_id"].as_str().unwrap_or(""), i["status"].as_str().unwrap_or(""), i["denial_reason"].as_str().map(|r| format!("({r})")).unwrap_or_default()))
        .collect();
    // الملف من القرص كاملًا (المعاينة مقتطف).
    let file = std::fs::read_to_string(h.data_dir.join("workspaces").join(mission).join(path)).unwrap_or_default();
    // W-1: قرار التوجيه ودوره ورفضه من سجلّات P0 (الطلب والوكيل المختار من السجلّ القائم).
    let route = route_of(h, mission);
    let line = json!({
        "task": task,
        "commit": env("M1_COMMIT").unwrap_or_default(),
        "state": state,
        "wall_ms": wall_ms,
        "totals": trace["totals"],
        "tools": calls,
        "approvals": approvals,
        "quality_ok": check(&file),
        "implicit_route_flag": env("POLARIS_IMPLICIT_ROUTE").as_deref() == Some("1"),
        "deliverable_facts_flag": env("POLARIS_DELIVERABLE_FACTS").as_deref() == Some("1"),
        "rewrite_note_flag": env("POLARIS_REWRITE_NOTE").as_deref() == Some("1"),
        "route": route,
        "agents": agents_of(h, mission),
    });
    println!("M1 {line}");
    line
}

fn route_of(h: &Harness, mission: &str) -> Value {
    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = db.prepare("SELECT payload_json FROM session_events WHERE mission_id = ?1 ORDER BY rowid").unwrap();
    let rows: Vec<Value> = stmt.query_map([mission], |r| r.get::<_, String>(0)).unwrap().filter_map(|r| r.ok()).filter_map(|p| serde_json::from_str(&p).ok()).collect();
    let s = polaris_host_core::p03::watch::measure::summarize(rows.iter().filter(|p| p.get("measure").is_some()));
    let delegated: Vec<Value> = rows.iter().filter_map(|p| p.get("agent_selected").cloned()).collect();
    json!({ "required": s.route_required, "decision": s.route.as_ref().map(|r| r.0.clone()), "turn": s.route.as_ref().map(|r| r.1), "refusals": s.route_refusals, "delegated_to": delegated, "loop_turns": s.model_turns })
}

/// RW: أدوار المنسّق والمفوَّض من سجلّات P0 لكل جلسة، وآخر حكم للمصحِّح، وعدد ملاحظات RW-A وRW-B التي ظهرت.
fn agents_of(h: &Harness, mission: &str) -> Value {
    let db = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = db.prepare("SELECT session_id, kind, payload_json FROM session_events WHERE mission_id = ?1 ORDER BY rowid").unwrap();
    let rows: Vec<(String, String, Value)> = stmt
        .query_map([mission], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .filter_map(|(s, k, p)| serde_json::from_str(&p).ok().map(|v| (s, k, v)))
        .collect();
    let helpers: std::collections::HashSet<&str> = rows.iter().filter(|(_, k, p)| k == "USER_MESSAGE" && p["text"].as_str().is_some_and(|t| t.contains("[DELEGATED_TASK"))).map(|(s, _, _)| s.as_str()).collect();
    let turns = |helper: bool| rows.iter().filter(|(s, _, p)| p["measure"] == "model_turn" && helpers.contains(s.as_str()) == helper).count();
    let grade = rows.iter().rev().find(|(_, _, p)| p["agent_grade"] == true).and_then(|(_, _, p)| p["text"].as_str()).map(|t| t.contains(": PASSED"));
    let results: Vec<&str> = rows.iter().filter(|(_, k, _)| k == "TOOL_RESULT").filter_map(|(_, _, p)| p["text"].as_str()).collect();
    json!({
        "coordinator_turns": turns(false),
        "helper_turns": turns(true),
        "grader_passed": grade,
        "facts_lines": results.iter().filter(|t| t.contains("[POLARIS_MEASURED]")).count(),
        "identical_notes": results.iter().filter(|t| t.contains("this write did not change")).count(),
        "rewrite_notes": results.iter().filter(|t| t.contains("times in this task")).count(),
        // W-2: تلخيصات سياق المساعد الناجحة، وأدوار النموذج الفاشلة (رفض النافذة أو الخادم).
        "helper_summaries": rows.iter().filter(|(_, _, p)| p["measure"] == "helper_summary" && p["ok"] == true).count(),
        "failed_turns": rows.iter().filter(|(_, _, p)| p["measure"] == "model_turn" && p["status"] != "OK").count(),
    })
}

/// معيار جودة التقرير، ثُبِّت قبل حملة RW (2026-10-27): العناوين المطلوبة عناوينَ `##` بترتيبها، والطول 240–360 كلمة مفصولة
/// بالمسافات، ولا نسبة مئوية ولا مضاعف رقمي حين لا بيانات مرفقة. حكم المصحِّح وحالة المهمّة يُقرآن من السطر نفسه.
fn report_rubric(file: &str, headings: &[&str]) -> Value {
    let found: Vec<String> = file.lines().filter_map(|l| l.trim_start().strip_prefix("## ")).map(|h| h.trim().to_lowercase()).collect();
    let mut cursor = 0usize;
    let in_order = headings.iter().all(|wanted| match found.iter().skip(cursor).position(|h| h.contains(&wanted.to_lowercase())) {
        Some(i) => {
            cursor += i + 1;
            true
        }
        None => false,
    });
    let words = file.split_whitespace().count();
    let tokens: Vec<&str> = file.split_whitespace().collect();
    let has_digit = |t: &str| t.chars().any(|c| c.is_ascii_digit() || ('\u{0660}'..='\u{0669}').contains(&c));
    let percentages = tokens.iter().filter(|t| has_digit(t) && (t.contains('%') || t.contains('٪'))).count();
    let multipliers = tokens.windows(2).filter(|w| has_digit(w[0]) && ["أضعاف", "ضعف", "times", "fold", "x"].iter().any(|m| w[1].trim_matches(|c: char| !c.is_alphanumeric()).eq_ignore_ascii_case(m))).count()
        + tokens.iter().filter(|t| has_digit(t) && (t.ends_with("-fold") || (t.ends_with('x') && t.trim_end_matches('x').chars().all(|c| c.is_ascii_digit() || c == '.')))).count();
    json!({ "headings_in_order": in_order, "words": words, "words_in_range": (240..=360).contains(&words), "unsupported_numbers": percentages + multipliers })
}

fn mission(h: &Harness, objective: &str) -> String {
    // DEF-16 / C-01: القياس بميزانية المنتج (الواجهة ترسل EXTENDED = 150 نداءً)، لا بالافتراضي المحافظ (24) الذي قيست به W-1/W-2/RW.
    let id = h.ok("mission.create", json!({ "title": "m1", "objective": objective, "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
    h.ok("conversation.begin", json!({ "mission_id": id }));
    id
}

/// المهمّة 11: صفحة ترحيبية بسيطة بالعربية (أثر بوابة التوجيه على المهام البسيطة).
#[test]
#[ignore]
fn m1_real_simple_page() {
    let h = build(None);
    configure(&h);
    let m = mission(&h, "أنشئ صفحة HTML ترحيبية بسيطة في outputs/index.html فيها العنوان «مرحبا بكم في مكتبة النور» وزر مكتوب عليه «ابدأ».");
    measure(&h, "simple_page", &m, "outputs/index.html", |f| f.contains("مكتبة النور") && f.contains("ابدأ"));
}

/// صفحة قائمة بنحو 300 سطر، تُوضع في المساحة قبل المهمّة (حالة البداية في التجهيزة).
fn landing_page() -> String {
    let mut page = String::from("<!doctype html>\n<html lang=\"ar\" dir=\"rtl\">\n<head>\n<meta charset=\"utf-8\">\n<title>مكتبة النور</title>\n<style>\n.cta { background: #c0392b; color: #fff; padding: 12px 24px; }\n</style>\n</head>\n<body>\n<h1>مرحبا بكم في مكتبة النور</h1>\n<button class=\"cta\">ابدأ</button>\n");
    for i in 1..=280 {
        page.push_str(&format!("<p class=\"item\">الكتاب رقم {i}: وصف قصير للكتاب ومؤلفه وسنة نشره.</p>\n"));
    }
    page.push_str("</body>\n</html>\n");
    page
}

/// المهمّة 12: تعديل العنوان ولون الزر في صفحة من نحو 300 سطر (أثر أداة التعديل الجزئي).
#[test]
#[ignore]
fn m1_real_edit_page() {
    let h = build(None);
    configure(&h);
    let m = mission(&h, "في الملف outputs/index.html غيّر العنوان الرئيسي إلى «أهلا بكم في مكتبة الفجر» واجعل لون خلفية الزر أخضر (#27ae60). لا تغيّر أي شيء آخر.");
    let outputs = h.data_dir.join("workspaces").join(&m).join("outputs");
    std::fs::create_dir_all(&outputs).unwrap();
    std::fs::write(outputs.join("index.html"), landing_page()).unwrap();
    measure(&h, "edit_page", &m, "outputs/index.html", |f| f.contains("مكتبة الفجر") && f.contains("27ae60") && f.contains("الكتاب رقم 280") && !f.contains("c0392b"));
}

/// مهمّة تفويض: تقرير تنفيذي يغطّيه وكيل كاتب التقارير بعقده. تقيس دقّة التفويض مع المفتاح وبدونه، وجودة التقرير.
#[test]
#[ignore]
fn m1_real_report() {
    let h = build(None);
    configure(&h);
    let m = mission(&h, "اكتب تقريرًا تنفيذيًا موجزًا (نحو 300 كلمة) عن فوائد العمل عن بعد للشركات الصغيرة في الملف outputs/report.md، بالعناوين: الملخص، الفوائد، المخاطر، التوصيات.");
    let line = measure(&h, "report", &m, "outputs/report.md", |f| ["الملخص", "الفوائد", "المخاطر", "التوصيات"].iter().all(|t| f.contains(t)) && f.split_whitespace().count() >= 150);
    rubric_line(&h, &m, "report", &line, &["الملخص", "الفوائد", "المخاطر", "التوصيات"]);
}

/// RW: التوأم الإنجليزي لمهمّة التقرير، بالطلب نفسه والعناوين نفسها.
#[test]
#[ignore]
fn m1_real_report_en() {
    let h = build(None);
    configure(&h);
    let m = mission(&h, "Write a concise executive report (about 300 words) on the benefits of remote work for small businesses in the file outputs/report.md, with the headings: Summary, Benefits, Risks, Recommendations.");
    let line = measure(&h, "report_en", &m, "outputs/report.md", |f| ["summary", "benefits", "risks", "recommendations"].iter().all(|t| f.to_lowercase().contains(t)) && f.split_whitespace().count() >= 150);
    rubric_line(&h, &m, "report_en", &line, &["Summary", "Benefits", "Risks", "Recommendations"]);
}

/// سطر المعيار بجانب سطر القياس، بمفتاح المهمّة نفسه.
fn rubric_line(h: &Harness, mission: &str, task: &str, line: &Value, headings: &[&str]) {
    let file = std::fs::read_to_string(h.data_dir.join("workspaces").join(mission).join("outputs/report.md")).unwrap_or_default();
    let rubric = report_rubric(&file, headings);
    println!("RUBRIC {}", json!({ "task": task, "state": line["state"], "grader_passed": line["agents"]["grader_passed"], "rubric": rubric, "file": file }));
}

#[test]
fn m1_the_report_rubric_reads_headings_length_and_invented_numbers() {
    let words = |n: usize| vec!["word"; n].join(" ");
    let good = format!("# T\n## Summary\n{}\n## Benefits\nx\n## Risks\nx\n## Recommendations\nx\n", words(280));
    let r = report_rubric(&good, &["Summary", "Benefits", "Risks", "Recommendations"]);
    assert_eq!((r["headings_in_order"].as_bool(), r["words_in_range"].as_bool(), r["unsupported_numbers"].as_u64()), (Some(true), Some(true), Some(0)), "{r}");
    let bad = format!("## Risks\n## Summary\n{} saves 20% and 3 times more ٣٠٪ 5x\n", words(10));
    let r = report_rubric(&bad, &["Summary", "Risks"]);
    assert_eq!((r["headings_in_order"].as_bool(), r["words_in_range"].as_bool(), r["unsupported_numbers"].as_u64()), (Some(false), Some(false), Some(4)), "{r}");
}

/// W-2: مهمّة قراءة طويلة بنافذة صغيرة (يُشغَّل Bonsai بـ BONSAI_CTX صغير). ثمانية أجزاء كبيرة ثم ملخّص بجملة لكل جزء.
#[test]
#[ignore]
fn m1_real_long_read() {
    use base64::Engine;
    let h = build(None);
    configure(&h);
    let m = mission(&h, "اقرأ الأجزاء الثمانية المرفقة في inputs/ (part0.txt إلى part7.txt) واحدًا تلو الآخر، ثم اكتب في outputs/summary.md سطرًا واحدًا لكل جزء يذكر رقمه وأهم ما فيه.");
    let ids: Vec<Value> = (0..8)
        .map(|i| {
            let text: String = (0..90).map(|l| format!("Part {i} line {l}: the quarterly figures for region {l} were reviewed; the total for part {i} is {}.\n", 1000 + i * 7 + l)).collect();
            h.ok("attachment.stage", json!({ "file_name": format!("part{i}.txt"), "content_base64": base64::engine::general_purpose::STANDARD.encode(text) }))["attachment"]["attachment_id"].clone()
        })
        .collect();
    h.ok("attachment.bind", json!({ "mission_id": m, "attachment_ids": ids }));
    measure(&h, "long_read", &m, "outputs/summary.md", |f| (0..8).filter(|i| f.contains(&format!("{i}"))).count() >= 6 && f.lines().filter(|l| !l.trim().is_empty()).count() >= 6);
}
