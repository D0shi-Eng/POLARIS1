// POLARIS QA 2026-10-15: join the static control inventory (file:line, handler, label keys, IPC) with the
// native sweep rows (route, verdict, effect) by accessible name, and write UI-CONTROL-MATRIX.md.
// Usage: node qa-matrix.cjs <ui-inventory.json> <startup-e2e.json> <out.md> <build_sha> <commit>
const fs = require("fs");
const [invFile, sweepFile, outFile, buildSha, commit] = process.argv.slice(2);
const inv = JSON.parse(fs.readFileSync(invFile, "utf8"));
const sweep = JSON.parse(fs.readFileSync(sweepFile, "utf8")).renderer.results;
const passes = Object.fromEntries(sweep.map((p) => [p.locale, p.rows]));
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
const index = (rows) => {
  const m = new Map();
  for (const r of rows || []) {
    const k = norm(r.name);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};
const ar = index(passes.ar);
const en = index(passes.en);
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 90);
const verdictOf = (rows) => {
  if (!rows || rows.length === 0) return null;
  const order = ["ERROR", "NO_EFFECT", "EFFECT", "SKIPPED_EFFECTFUL", "DISABLED", "NOT_CLICKED"];
  return [...rows].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict))[0];
};
const counts = {};
const lines = [];
for (const c of inv.rows) {
  // كل مفاتيح النص داخل العنصر، والقالب يصير نمطًا: «{name}» يطابق أي نص.
  const pattern = (template) => {
    const t = norm(template);
    if (t === "" || t.length < 2) return null;
    const parts = t.split(/\{[^}]+\}/).map((p) => p.replace(/[.*+?^$()|[\]\\]/g, "\\$&"));
    return new RegExp(parts.join(".*"));
  };
  const patterns = (locale) => (c.label_keys_values?.[locale] || [c[locale === "ar" ? "label_ar" : "label_en"]]).map(pattern).filter(Boolean);
  const matchIn = (m, pats) => pats.length === 0 ? [] : [...m.entries()].filter(([k]) => pats.some((p) => p.test(k))).flatMap(([, v]) => v);
  const nativeAr = matchIn(ar, patterns("ar"));
  const nativeEn = matchIn(en, patterns("en"));
  const best = verdictOf([...nativeAr, ...nativeEn]);
  let verdict;
  if (best === null) verdict = c.label_keys.length === 0 ? "NOT_MATCHED_NO_LABEL_KEY" : "NOT_REACHED_NATIVE";
  else if (best.verdict === "EFFECT") verdict = "PASS_NATIVE";
  else if (best.verdict === "NO_EFFECT") verdict = /already the current/.test(best.effect || "") ? "PASS_NATIVE_CURRENT" : "NO_EFFECT_REVIEWED";
  else if (best.verdict === "SKIPPED_EFFECTFUL") verdict = "SKIPPED_EFFECTFUL";
  else if (best.verdict === "DISABLED") verdict = "DISABLED_IN_FIXTURE";
  else if (best.verdict === "ERROR") verdict = "FAIL_NATIVE";
  else verdict = best.effect && /sample/.test(best.effect) ? "PASS_BY_FAMILY_SAMPLE" : "NOT_CLICKED";
  counts[verdict] = (counts[verdict] || 0) + 1;
  const routes = [...new Set([...nativeAr, ...nativeEn].map((r) => r.route))].slice(0, 3).join(" ");
  lines.push(`| ${esc(c.control_id)} | ${esc(routes || "—")} | ${esc(c.tag)} | ${esc(c.label_ar || c.aria_label || "")} | ${esc(c.label_en || "")} | ${esc(c.handlers.join(","))} | ${esc(c.ipc_operations.join(",") || c.client_methods.join(",") || "—")} | ${esc(best ? best.effect || best.verdict : "")} | ${verdict} |`);
}
const header = [
  "# مصفوفة العناصر التفاعلية — UI-CONTROL-MATRIX",
  "",
  `> مولّدة آليًا (\`tools/remediation/windows/qa-matrix.cjs\`). Build \`${buildSha}\`، commit \`${commit}\`، ${new Date().toISOString()}.`,
  "> المصدر الثابت: جرد شجرة TypeScript لكل عنصر تفاعلي في `desktop/renderer/src` (عدا الاختبارات وe2e والمولّد). المصدر الأصلي: مسح `qa-controls` داخل نافذة WebView2 الحقيقية لثنائي القياس، بالعربية ثم الإنجليزية، على مجلد بيانات معزول.",
  "> الربط بالاسم الوصولي. العنصر الذي لا يظهر إلا في حالة لم يصلها المسح (مهمة جارية، حوار مفتوح، خطأ مزوّد) يبقى `NOT_REACHED_NATIVE`، ولا يُحسب نجاحًا.",
  "",
  "## الأحكام",
  "",
  "| الحكم | العدد | المعنى |",
  "|---|---|---|",
  ...Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} | ${({
    PASS_NATIVE: "ضُغط في النافذة الحقيقية وأحدث أثرًا مقيسًا",
    PASS_NATIVE_CURRENT: "العنصر الحالي (aria-current/pressed)، الضغط عليه بلا أثر متوقّع",
    PASS_BY_FAMILY_SAMPLE: "عضو في عائلة متماثلة (>8)؛ ضُغطت عيّنة منها",
    NO_EFFECT_REVIEWED: "ضُغط بلا أثر؛ رُوجع يدويًا في SKILLS/UI التقارير",
    SKIPPED_EFFECTFUL: "أثره خارجي أو مدمّر؛ لم يُضغط آليًا",
    DISABLED_IN_FIXTURE: "معطّل في حالة التجهيزة",
    NOT_REACHED_NATIVE: "موجود في الشيفرة ولم يظهر في أي حالة وصلها المسح",
    NOT_MATCHED_NO_LABEL_KEY: "لا مفتاح نصّ ثابت يربطه بصف أصلي",
    NOT_CLICKED: "ظهر ولم يُضغط (اختفى بعد ضغطة سابقة أو خلف حوار)",
    FAIL_NATIVE: "خطأ console/promise عند الضغط",
  })[k] || ""} |`),
  "",
  "## الصفوف",
  "",
  "| control_id (ملف:سطر) | route | tag | label_ar | label_en | handler | IPC / client | الأثر المقيس | الحكم |",
  "|---|---|---|---|---|---|---|---|---|",
];
fs.writeFileSync(outFile, header.concat(lines).join("\n") + "\n");
console.log(JSON.stringify({ rows: lines.length, counts }));
