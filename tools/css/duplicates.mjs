// المحدِّدات المعرَّفة أكثر من مرة في سياق واحد داخل polaris.css.
//
// بعد التوحيد (2026-10-01) بقيت 85 مجموعة لم تُدمج لأن دمجها قد يغيّر الفائز في الشلال (قاعدة بينها بالخصوصية
// نفسها تمسّ الخاصية نفسها). هي مسجّلة بأسمائها في duplicates-baseline.json. اختبار العارض p08-css-structure
// يرفض أي مجموعة جديدة: صنف موجود يُعدَّل في مكانه، لا بقاعدة ثانية في آخر الملف.
//
// الاستعمال: node tools/css/duplicates.mjs            يطبع المجموعات الجديدة (خارج القائمة) وعددها
//            node tools/css/duplicates.mjs --baseline يكتب القائمة من الحالة الحالية (بعد مراجعة بشرية فقط)

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const RENDERER = join(ROOT, "desktop", "renderer");
const require = createRequire(join(RENDERER, "package.json"));
const postcss = require("postcss");
const BASELINE = join(ROOT, "tools", "css", "duplicates-baseline.json");

export function duplicateGroups(css) {
  const seen = new Map();
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    const chain = [];
    for (let n = rule.parent; n && n.type !== "root"; n = n.parent) if (n.type === "atrule") chain.unshift(`@${n.name} ${n.params}`);
    const key = `${chain.join(" ")} ¦ ${rule.selectors.map((s) => s.replace(/\s+/g, " ").trim()).join(", ")}`.trim();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k).sort();
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1].endsWith("duplicates.mjs")) {
  const groups = duplicateGroups(readFileSync(join(RENDERER, "src", "ui", "polaris.css"), "utf8"));
  if (process.argv.includes("--baseline")) {
    writeFileSync(BASELINE, JSON.stringify(groups, null, 1) + "\n", "utf8");
    console.log(`baseline: ${groups.length} groups`);
  } else {
    const known = new Set(JSON.parse(readFileSync(BASELINE, "utf8")));
    const fresh = groups.filter((g) => !known.has(g));
    console.log(JSON.stringify({ groups: groups.length, known: known.size, new: fresh }, null, 1));
    process.exitCode = fresh.length === 0 ? 0 : 1;
  }
}
