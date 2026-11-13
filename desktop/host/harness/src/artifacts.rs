// فحوص خطّ المخرجات على الجهاز: كل صيغة تُبنى عبر أداة الوكيل، ثم يعيد المضيف فتحها ويتحقّق
// منها (VERIFIED أو لا)، وتُعاين، ويُصدَّر واحد إلى مجلد التصدير. PDF العربي بخط النظام.

use serde_json::{json, Value};

use crate::platform::Harness;
use crate::probe::Probe;
use crate::report::{Section, Status};

fn doc_spec(title: &str, language: &str, paragraph: &str) -> Value {
    json!({ "title": title, "language": language, "blocks": [
        { "type": "heading", "text": title },
        { "type": "paragraph", "text": paragraph },
        { "type": "bullets", "items": ["one", "two", "three"] },
        { "type": "table", "header": ["Region", "Total"], "rows": [["Riyadh", "895"], ["Jeddah", "668"]] },
        { "type": "chart", "chart": { "title": "Totals", "kind": "bar", "categories": ["Riyadh", "Jeddah"], "series": [{ "name": "Total", "values": [895.0, 668.0] }] } }
    ] })
}

pub fn run(h: &Harness) -> Section {
    let mut s = Section::default();
    let mut p = Probe::new(h, "artifact probes");
    let cases: Vec<(&str, &str, Value)> = vec![
        ("P08-ART-DOCX", "polaris.artifact.document", json!({ "format": "docx", "path": "outputs/report.docx", "spec": doc_spec("Quarterly report", "en", "Revenue grew in every region.") })),
        ("P08-ART-PDF-EN", "polaris.artifact.document", json!({ "format": "pdf", "path": "outputs/report-en.pdf", "spec": doc_spec("Quarterly report", "en", "Revenue grew in every region.") })),
        ("P08-ART-PDF-AR", "polaris.artifact.document", json!({ "format": "pdf", "path": "outputs/report-ar.pdf", "spec": doc_spec("التقرير الربعي", "ar", "نمت الإيرادات في كل المناطق، والرياض في المقدّمة.") })),
        ("P08-ART-HTML", "polaris.artifact.document", json!({ "format": "html", "path": "outputs/report.html", "spec": doc_spec("Quarterly report", "en", "Revenue grew.") })),
        ("P08-ART-MD", "polaris.artifact.document", json!({ "format": "markdown", "path": "outputs/report.md", "spec": doc_spec("Quarterly report", "en", "Revenue grew.") })),
        ("P08-ART-PPTX", "polaris.artifact.presentation", json!({ "path": "outputs/deck.pptx", "spec": { "title": "Quarterly review", "subtitle": "Native measurement", "slides": [
            { "title": "Highlights", "bullets": ["Riyadh leads", "Jeddah grows"] },
            { "title": "Totals", "table": { "header": ["Region", "Total"], "rows": [["Riyadh", "895"], ["Jeddah", "668"]] } },
            { "title": "Chart", "chart": { "title": "Totals", "kind": "bar", "categories": ["Riyadh", "Jeddah"], "series": [{ "name": "Total", "values": [895.0, 668.0] }] } }
        ] } })),
        ("P08-ART-XLSX", "polaris.artifact.spreadsheet", json!({ "path": "outputs/sales.xlsx", "spec": { "title": "Sales", "sheets": [
            { "name": "Totals", "header": ["Region", "Total"], "rows": [["Riyadh", 895], ["Jeddah", 668], ["Dammam", 487]], "chart": { "title": "Totals", "kind": "bar", "value_columns": [1] } }
        ] } })),
    ];
    for (id, tool, args) in cases {
        let c = p.invoke(tool, args);
        s.record(id, Status::of(c.ok()), &c.summary, c.view());
    }
    // CSV وصورة ومشروع شيفرة: ملفّات تكتبها الأداة ثم تُسجَّل مخرجاتٍ ويُتحقّق منها.
    let w = p.invoke("polaris.workspace.write", json!({ "path": "outputs/sales.csv", "content": "region,total\nRiyadh,895\nJeddah,668\n" }));
    let r = p.invoke("polaris.artifact.register", json!({ "path": "outputs/sales.csv", "title": "Sales CSV" }));
    s.record("P08-ART-CSV", Status::of(w.ok() && r.ok()), &r.summary, json!({ "write": w.view(), "register": r.view() }));
    let w = p.invoke("polaris.workspace.write", json!({ "path": "outputs/app/main.py", "content": "print('hello')\n" }));
    let r = p.invoke("polaris.artifact.register", json!({ "path": "outputs/app/main.py", "title": "Code project entry" }));
    s.record("P08-ART-CODE", Status::of(w.ok() && r.ok()), &r.summary, json!({ "write": w.view(), "register": r.view() }));

    let listed = h.call("artifact.list", json!({ "mission_id": p.mission_id })).unwrap_or(Value::Null);
    let artifacts = listed["artifacts"].as_array().cloned().unwrap_or_default();
    let verified = artifacts.iter().filter(|a| a["verification"]["status"] == "VERIFIED").count();
    let summary: Vec<Value> = artifacts.iter().map(|a| json!({ "type": a["type"], "file_ref": a["file_ref"], "size": a["size"], "verification": a["verification"]["status"], "checks": a["verification"]["checks"] })).collect();
    s.record("P08-ART-REOPEN-VERIFIED", Status::of(!artifacts.is_empty() && verified == artifacts.len()), format!("{verified} of {} artifacts re-opened and verified by the host", artifacts.len()), json!({ "artifacts": summary }));
    let ar = artifacts.iter().find(|a| a["file_ref"] == "outputs/report-ar.pdf");
    let ar_text = ar.and_then(|a| a["preview"]["excerpt"].as_str()).unwrap_or("");
    s.record("P08-ART-PDF-ARABIC-TEXT", Status::of(ar_text.contains("التقرير") || ar_text.contains("الإيرادات")), "the Arabic PDF's text is extracted back in logical order", json!({ "excerpt": ar_text.chars().take(200).collect::<String>(), "font_available": h.host().phase08().map(|p8| p8.pdf_font_available) }));
    let preview = h.call("workspace.preview", json!({ "mission_id": p.mission_id, "path": "outputs/report.docx" }));
    s.record("P08-ART-PREVIEW", Status::of(preview.as_ref().is_ok_and(|v| v["text"].as_str().is_some_and(|t| t.contains("Revenue grew")))), "a DOCX previews as its text", json!({ "kind": preview.as_ref().ok().map(|v| v["kind"].clone()) }));
    let exported = h.call("workspace.export", json!({ "mission_id": p.mission_id, "path": "outputs/sales.xlsx" }));
    let label = exported.as_ref().ok().and_then(|v| v["file_label"].as_str().map(String::from)).unwrap_or_default();
    let exists = !label.is_empty() && h.export_dir.join(&label).is_file();
    s.record("P08-ART-EXPORT", Status::of(exists), "an artifact is exported to the configured folder, not to an arbitrary path", json!({ "result": exported.unwrap_or_else(|e| e) }));
    let escape = h.call("workspace.preview", json!({ "mission_id": p.mission_id, "path": "../../outside-workspace/secret.txt" }));
    s.record("P08-ART-PREVIEW-ESCAPE-REFUSED", Status::of(escape.is_err()), "previewing a path outside the workspace is refused at the boundary", json!({ "result": escape.unwrap_or_else(|e| e) }));
    p.finish();
    s
}
