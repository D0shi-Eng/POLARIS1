// نقل منهج agency-agents (2026-10-27) إلى المتخصّص `writing.report-writer`: قواعد «support-executive-summary-generator» (كل نتيجة برقم
// من المصدر، وكل توصية بأولوية ومسؤول وموعد، ولا افتراض خارج البيانات، وطول محدود) تُكتب في منهجه وبنود تحقّقه، لا في تعليمة النظام.
//
// اختباران:
// 1. حتمي: قائمة أدوات الوكيل لا تتغيّر بتغيير نصّه (الأدوات تُشتقّ من النصّ في `definition.rs::grants`)، وطول تعليمته مقيس.
// 2. حقيقي (`--ignored`): مهمّتان محجوزتان (إنجليزية وعربية) بالمتخصّص مثبّتًا، ويُقاس الملف الذي كتبه النموذج بمقياس ثابت كُتب هنا
//    قبل أي تعديل في نصّ المتخصّص. المتغيّرات كما في `fc_real_model.rs`، و`MEMBENCH_REPORT=<dir>` يكتب السجلّ JSON (تحت `_local`).

mod p08_support;

use std::time::Instant;

use serde_json::{json, Value};

use p08_support::{build, Harness};
use polaris_host_core::p03::agents::AgentDirectory;
use polaris_host_core::p03::specialist::SpecialistCatalog;

const SPECIALIST: &str = "writing.report-writer";

/// الأدوات قبل النقل، مثبّتة: النقل يغيّر المنهج لا الصلاحيات.
const TOOLS_BEFORE: &[&str] = &["polaris.artifact.document", "polaris.tool.context.read", "polaris.workspace.list", "polaris.workspace.read", "polaris.workspace.write"];

#[test]
fn mt02_the_report_writer_keeps_its_tools_and_its_brief_is_measured() {
    let catalog = SpecialistCatalog::builtin();
    let directory = AgentDirectory::build(catalog).expect("the directory builds");
    let definition = directory.for_specialist(SPECIALIST).expect("the report writer has a definition");
    assert_eq!(definition.tools, TOOLS_BEFORE, "changing the specialist's text changed its tools");
    let brief = catalog.get(SPECIALIST).unwrap().brief();
    println!("MT02 brief_chars={} approx_tokens={} contract_chars={}", brief.chars().count(), brief.chars().count() / 4, definition.contract_brief().chars().count());
}

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
    assert_eq!(refresh["results"][0]["health"]["state"], "HEALTHY", "the named provider is not reachable: {}", refresh["results"][0]["health"]);
    h.ok("model.configure", json!({ "model_id": model, "enabled": true }));
    h.ok("model.preferences.set", json!({ "default_model_id": model }));
}

struct Task {
    label: &'static str,
    objective: &'static str,
}

/// المهمّتان المحجوزتان: بيانات صغيرة داخل الطلب، فكل رقم صحيح في التقرير مصدره الطلب.
const TASKS: [Task; 2] = [
    Task {
        label: "en_clinic",
        objective: "Write an executive report for the clinic owners in outputs/report.md about the Noor clinic app's third quarter. Data: bookings 4200 (second quarter 3500); no-show rate 18% (second quarter 22%); SMS reminder cost 9000 SAR; average rating 4.3 of 5; 120 support tickets, 45 of them about payment failures.",
    },
    Task {
        label: "ar_fleet",
        objective: "\u{0627}\u{0643}\u{062A}\u{0628} \u{062A}\u{0642}\u{0631}\u{064A}\u{0631}\u{064B}\u{0627} \u{062A}\u{0646}\u{0641}\u{064A}\u{0630}\u{064A}\u{064B}\u{0627} \u{0644}\u{0644}\u{0625}\u{062F}\u{0627}\u{0631}\u{0629} \u{0641}\u{064A} outputs/report.md \u{0639}\u{0646} \u{0623}\u{062F}\u{0627}\u{0621} \u{0623}\u{0633}\u{0637}\u{0648}\u{0644} \u{0634}\u{0631}\u{0643}\u{0629} \u{0633}\u{0647}\u{0645} \u{0641}\u{064A} \u{0627}\u{0644}\u{0631}\u{0628}\u{0639} \u{0627}\u{0644}\u{062B}\u{0627}\u{0644}\u{062B}. \u{0627}\u{0644}\u{0628}\u{064A}\u{0627}\u{0646}\u{0627}\u{062A}: 30 \u{0634}\u{0627}\u{062D}\u{0646}\u{0629}\u{060C} \u{0648}\u{0627}\u{0644}\u{062A}\u{0633}\u{0644}\u{064A}\u{0645} \u{0641}\u{064A} \u{0627}\u{0644}\u{0645}\u{0648}\u{0639}\u{062F} 87% (\u{0627}\u{0644}\u{0631}\u{0628}\u{0639} \u{0627}\u{0644}\u{062B}\u{0627}\u{0646}\u{064A} 91%)\u{060C} \u{0648}\u{0643}\u{0644}\u{0641}\u{0629} \u{0627}\u{0644}\u{0648}\u{0642}\u{0648}\u{062F} 410000 \u{0631}\u{064A}\u{0627}\u{0644}\u{060C} \u{0648}6 \u{062D}\u{0648}\u{0627}\u{062F}\u{062B} \u{0628}\u{0633}\u{064A}\u{0637}\u{0629}\u{060C} \u{0648}\u{0623}\u{0643}\u{0628}\u{0631} \u{0639}\u{0645}\u{064A}\u{0644} \u{0623}\u{0633}\u{0648}\u{0627}\u{0642} \u{0627}\u{0644}\u{062A}\u{0645}\u{064A}\u{0645}\u{064A} \u{0628}\u{0640} 38% \u{0645}\u{0646} \u{0627}\u{0644}\u{0634}\u{062D}\u{0646}\u{0627}\u{062A}.",
    },
];

/// أرقام نصّ (الأرقام الهندية تُحوَّل، والفواصل داخل العدد تُحذف).
fn numbers(text: &str) -> Vec<String> {
    let ascii: String = text
        .chars()
        .map(|c| match c {
            '\u{0660}'..='\u{0669}' => char::from(b'0' + (c as u32 - 0x0660) as u8),
            '\u{06F0}'..='\u{06F9}' => char::from(b'0' + (c as u32 - 0x06F0) as u8),
            '\u{066C}' => ',',
            _ => c,
        })
        .collect();
    let mut out = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = ascii.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        let inner_separator = (*c == ',' || *c == '.') && !current.is_empty() && chars.get(i + 1).is_some_and(|n| n.is_ascii_digit());
        if c.is_ascii_digit() {
            current.push(*c);
        } else if inner_separator {
            if *c == '.' {
                current.push('.');
            }
        } else if !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

/// الأقسام (المقياس 2): عنوان Markdown وما تحته حتى عنوان من مستواه أو أعلى، فالعناوين الفرعية داخله بنود منه. المقياس 1 قطع عند كل
/// عنوان، فعدّ «### Finding 1» خارج «## Findings» (0 بنود في التقريرين قبل النقل): عيب قياس لا سلوك نموذج.
fn sections(text: &str) -> Vec<(String, Vec<String>)> {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let level = |l: &str| l.chars().take_while(|c| *c == '#').count();
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let depth = level(line);
        if depth == 0 {
            continue;
        }
        let body: Vec<String> = lines[i + 1..].iter().take_while(|l| level(l) == 0 || level(l) > depth).map(|l| l.to_string()).collect();
        out.push((line.trim_start_matches('#').trim().to_lowercase(), body));
    }
    out
}

fn section<'a>(all: &'a [(String, Vec<String>)], keys: &[&str]) -> Option<&'a Vec<String>> {
    all.iter().find(|(h, _)| keys.iter().any(|k| h.contains(k))).map(|(_, b)| b)
}

/// البنود: نقاط، وترقيم، وصفوف جدول (بلا سطر الفاصل)، وعناوين فرعية.
fn items(body: &[String]) -> Vec<&String> {
    body.iter()
        .filter(|l| {
            l.starts_with('-') || l.starts_with('*') || l.starts_with('#') || (l.starts_with('|') && !l.contains("---")) || l.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .collect()
}

/// أرقام تُشتقّ من زوج من أرقام الطلب: الفرق، والنسبة، ونسبة التغيّر، مقرّبة إلى عدد صحيح أو منزلة عشرية.
fn derivable(source: &[String]) -> Vec<String> {
    let values: Vec<f64> = source.iter().filter_map(|n| n.parse::<f64>().ok()).collect();
    let mut out = Vec::new();
    let mut push = |v: f64| {
        if v.is_finite() {
            let v = v.abs();
            out.push(format!("{}", v.round() as i64));
            out.push(format!("{:.1}", v));
            out.push(format!("{:.2}", v));
        }
    };
    for a in &values {
        for b in &values {
            if a == b || *b == 0.0 {
                continue;
            }
            push(a - b);
            push(a / b);
            push(a / b * 100.0);
            push((a - b) / b * 100.0);
        }
    }
    out
}

fn share(lines: &[&String], keys: &[&str]) -> Option<f64> {
    if lines.is_empty() {
        return None;
    }
    Some(lines.iter().filter(|l| { let low = l.to_lowercase(); keys.iter().any(|k| low.contains(k)) }).count() as f64 / lines.len() as f64)
}

/// المقياس (الإصدار 2، صُحّح بعد قراءة تقريرَي «قبل» ويُطبَّق على «قبل» و«بعد» معًا): الأقسام الأربعة، وأرقام النتائج، وأولوية التوصيات ومسؤولها وموعدها، والطول، والأرقام غير الموجودة في الطلب.
fn rubric(report: &str, objective: &str) -> Value {
    let all = sections(report);
    let summary = section(&all, &["summary", "\u{0645}\u{0644}\u{062E}\u{0635}"]);
    let findings = section(&all, &["finding", "\u{0646}\u{062A}\u{0627}\u{0626}\u{062C}", "\u{0627}\u{0644}\u{0646}\u{062A}\u{0627}\u{0626}\u{062C}"]);
    let recommendations = section(&all, &["recommend", "\u{062A}\u{0648}\u{0635}\u{064A}"]);
    let next = section(&all, &["next step", "\u{0627}\u{0644}\u{062E}\u{0637}\u{0648}\u{0627}\u{062A} \u{0627}\u{0644}\u{062A}\u{0627}\u{0644}\u{064A}\u{0629}", "\u{0627}\u{0644}\u{062E}\u{0637}\u{0648}\u{0627}\u{062A} \u{0627}\u{0644}\u{0642}\u{0627}\u{062F}\u{0645}\u{0629}"]);
    let finding_items = findings.map(|b| items(b)).unwrap_or_default();
    let rec_items = recommendations.map(|b| items(b)).unwrap_or_default();
    let numeric = share(&finding_items, &["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "\u{0660}", "\u{0661}", "\u{0662}", "\u{0663}", "\u{0664}", "\u{0665}", "\u{0666}", "\u{0667}", "\u{0668}", "\u{0669}"]);
    let priority = share(&rec_items, &["critical", "high", "medium", "low", "\u{062D}\u{0631}\u{062C}", "\u{0639}\u{0627}\u{0644}\u{064A}", "\u{0645}\u{062A}\u{0648}\u{0633}\u{0637}", "\u{0645}\u{0646}\u{062E}\u{0641}\u{0636}"]);
    let owner = share(&rec_items, &["owner", "responsible", "team", "lead", "manager", "\u{0645}\u{0633}\u{0624}\u{0648}\u{0644}", "\u{0641}\u{0631}\u{064A}\u{0642}", "\u{064A}\u{062A}\u{0648}\u{0644}\u{0649}", "\u{0645}\u{062F}\u{064A}\u{0631}", "\u{0625}\u{062F}\u{0627}\u{0631}\u{0629}"]);
    let timeline = share(&rec_items, &["day", "week", "month", "quarter", "q1", "q4", "by ", "within", "\u{064A}\u{0648}\u{0645}", "\u{0623}\u{0633}\u{0628}\u{0648}\u{0639}", "\u{0634}\u{0647}\u{0631}", "\u{0627}\u{0644}\u{0631}\u{0628}\u{0639}", "\u{062E}\u{0644}\u{0627}\u{0644}"]);
    let words = report.split_whitespace().count();
    let source: Vec<String> = numbers(objective);
    let derived = derivable(&source);
    let trim = |n: &str| if n.contains('.') { n.trim_end_matches('0').trim_end_matches('.').to_string() } else { n.to_string() };
    let unsupported: Vec<String> = numbers(report).into_iter().filter(|n| n.len() > 1 && !source.contains(n) && !derived.iter().any(|d| trim(d) == trim(n))).collect();
    let sections_found = [summary.is_some(), findings.is_some(), recommendations.is_some(), next.is_some()].iter().filter(|b| **b).count();
    let parts = [sections_found as f64 / 4.0, numeric.unwrap_or(0.0), priority.unwrap_or(0.0), owner.unwrap_or(0.0), timeline.unwrap_or(0.0), if words <= 500 { 1.0 } else { 0.0 }];
    json!({
        "sections_found": sections_found,
        "finding_items": finding_items.len(),
        "findings_with_number": numeric,
        "recommendation_items": rec_items.len(),
        "recommendations_with_priority": priority,
        "recommendations_with_owner": owner,
        "recommendations_with_timeline": timeline,
        "words": words,
        "numbers_not_in_request": unsupported,
        "rubric_version": 2,
        "score": (parts.iter().sum::<f64>() / parts.len() as f64 * 1000.0).round() / 1000.0,
    })
}

#[test]
#[ignore = "needs one local model: POLARIS_FC_PROVIDER and POLARIS_FC_MODEL"]
fn mt02_real_model_report_writer_follows_the_method() {
    let h = build(None);
    configure(&h);
    let conn = rusqlite::Connection::open_with_flags(h.data_dir.join("polaris.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut rows: Vec<Value> = Vec::new();
    for task in &TASKS {
        let id = h.ok("mission.create", json!({ "title": task.label, "objective": task.objective, "budget_preset": "EXTENDED" }))["mission_id"].as_str().unwrap().to_string();
        h.ok("conversation.begin", json!({ "mission_id": id }));
        h.ok("mission.specialist.set", json!({ "mission_id": id, "specialist_id": SPECIALIST }));
        let started = Instant::now();
        let run = h.call("mission.start", json!({ "mission_id": id }));
        let seconds = started.elapsed().as_secs_f64();
        let state = run["result"]["state"].as_str().unwrap_or("ERROR").to_string();
        let report = std::fs::read_to_string(h.host().phase08().unwrap().workspaces.dir_of(&id).join("outputs").join("report.md")).ok();
        let (input_tokens, output_tokens, calls): (i64, i64, i64) = conn
            .query_row(
                "SELECT ifnull(sum(input_tokens),0), ifnull(sum(output_tokens),0), count(*) FROM usage_records WHERE mission_id = ?1 AND category = 'MODEL'",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        let measured = report.as_deref().map(|r| rubric(r, task.objective)).unwrap_or(json!({ "score": 0.0, "report_missing": true }));
        println!("MT02-REAL {} state={state} seconds={seconds:.1} input_tokens={input_tokens} output_tokens={output_tokens} calls={calls} rubric={measured}", task.label);
        rows.push(json!({ "task": task.label, "state": state, "seconds": seconds, "input_tokens": input_tokens, "output_tokens": output_tokens, "model_calls": calls, "rubric": measured, "report": report }));
        assert!(matches!(state.as_str(), "COMPLETED" | "BLOCKED" | "FAILED" | "WAITING_FOR_APPROVAL"), "the turn did not end: {run}");
    }
    if let Some(dir) = env("MEMBENCH_REPORT") {
        std::fs::write(std::path::Path::new(&dir).join("mt02-real.json"), serde_json::to_string_pretty(&rows).unwrap()).unwrap();
    }
}

#[test]
fn mt02_the_rubric_reads_a_conforming_report_and_a_bare_one() {
    let good = "# Report\n## Executive summary\nBookings rose.\n## Key findings\n- Bookings 4200 vs 3500.\n- No-show 18%.\n## Recommendations\n- High: owner Ops team, within 30 days, cut no-shows.\n## Next steps\n- Review in 2 weeks.\n";
    let r = rubric(good, "bookings 4200 (3500); no-show 18%");
    assert_eq!(r["sections_found"], 4);
    assert_eq!(r["findings_with_number"], 1.0);
    assert_eq!(r["recommendations_with_priority"], 1.0);
    assert_eq!(r["numbers_not_in_request"], json!(["30"]));
    // ٢٠٪ نسبة تغيّر من 3500 إلى 4200، فهي مشتقّة لا مختلقة؛ و«### Finding» داخل «## Findings» بند منه.
    let nested = rubric("## Key findings
### Finding 1
Bookings grew 20% to 4200.
## Recommendations
- x
", "bookings 4200 (3500)");
    assert_eq!(nested["finding_items"], 1);
    assert_eq!(nested["numbers_not_in_request"], json!([]));
    let bare = rubric("Bookings went up a lot.", "bookings 4200");
    assert_eq!(bare["sections_found"], 0);
}

/// يعيد قياس التقارير المحفوظة بالمقياس الحالي: `MT02_RESCORE=<dir>` فيه `before/mt02-real.json` و`after/mt02-real.json` إن وُجد.
#[test]
#[ignore = "reads saved runs: MT02_RESCORE"]
fn mt02_rescore_saved_runs() {
    let dir = std::path::PathBuf::from(env("MT02_RESCORE").expect("MT02_RESCORE"));
    let mut out = Vec::new();
    for phase in ["before", "after"] {
        let Ok(text) = std::fs::read_to_string(dir.join(phase).join("mt02-real.json")) else { continue };
        let rows: Vec<Value> = serde_json::from_str(&text).unwrap();
        for row in rows {
            let task = TASKS.iter().find(|t| t.label == row["task"].as_str().unwrap()).unwrap();
            let measured = row["report"].as_str().map(|r| rubric(r, task.objective)).unwrap_or(json!({ "score": 0.0, "report_missing": true }));
            println!("MT02-RESCORE {phase} {} {measured}", task.label);
            out.push(json!({ "phase": phase, "task": task.label, "input_tokens": row["input_tokens"], "output_tokens": row["output_tokens"], "seconds": row["seconds"], "rubric": measured }));
        }
    }
    std::fs::write(dir.join("mt02-rescored.json"), serde_json::to_string_pretty(&out).unwrap()).unwrap();
}
