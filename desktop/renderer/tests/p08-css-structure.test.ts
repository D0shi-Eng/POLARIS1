// بنية التنسيق: ملف واحد، ولا محدِّد جديد مكرَّر.
//
// قِيس 2026-10-01 أن سبعة ملفات تنسيق متراكبة سبّبت خطأين في يوم واحد (قاعدة في ملف متأخّر تغلب قاعدة الصنف
// نفسه في ملف آخر بلا أن يُرى ذلك). وُحِّدت في polaris.css (tools/css/consolidate.mjs) وتحقّق التوحيد بمقارنة
// الأنماط المحسوبة. هذا الاختبار يمنع الرجوع: استيراد ملف تنسيق ثانٍ، أو تعريف محدِّد مرتين في سياق واحد خارج
// المجموعات الموروثة المسجّلة (tools/css/duplicates-baseline.json).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

interface CssNode {
  type: string;
  name?: string;
  params?: string;
  parent?: CssNode;
  selectors?: string[];
  walkRules(callback: (rule: CssNode) => void): void;
}
// postcss يصل مع vite؛ يُحمَّل بلا أنواعه، فالواجهة المستعملة هنا موصوفة أعلاه.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const postcss = require("postcss") as { parse(css: string): CssNode };

const RENDERER = process.cwd();
const REPOSITORY = join(RENDERER, "..", "..");

function duplicateGroups(css: string): string[] {
  const seen = new Map<string, number>();
  postcss.parse(css).walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name ?? "")) return;
    const chain: string[] = [];
    for (let n = rule.parent; n !== undefined && n.type !== "root"; n = n.parent) if (n.type === "atrule") chain.unshift(`@${n.name ?? ""} ${n.params ?? ""}`);
    const key = `${chain.join(" ")} ¦ ${(rule.selectors ?? []).map((s) => s.replace(/\s+/g, " ").trim()).join(", ")}`.trim();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

test("P08-CSS-001 the renderer imports exactly one stylesheet, polaris.css", () => {
  for (const entry of [join(RENDERER, "src", "main.tsx"), join(RENDERER, "preview", "main.tsx")]) {
    const imports = [...readFileSync(entry, "utf8").matchAll(/^import\s+"([^"]+\.css)";/gm)].map((m) => m[1]);
    assert.equal(imports.length, 1, `${entry} imports ${imports.length} stylesheets: ${imports.join(", ")}`);
    assert.ok(imports[0]?.endsWith("ui/polaris.css"), `${entry} imports ${imports[0] ?? "nothing"}`);
  }
});

test("P08-CSS-002 no selector is defined twice in one context beyond the recorded inherited groups", () => {
  const groups = duplicateGroups(readFileSync(join(RENDERER, "src", "ui", "polaris.css"), "utf8"));
  const known = new Set(JSON.parse(readFileSync(join(REPOSITORY, "tools", "css", "duplicates-baseline.json"), "utf8")) as string[]);
  const fresh = groups.filter((g) => !known.has(g));
  assert.deepEqual(fresh, [], `a selector is styled in two places; edit its existing rule instead:\n${fresh.join("\n")}`);
  // القائمة لا تكبر: مجموعة موروثة دُمجت تُحذف منها، فلا تبقى رخصة لتكرار لم يعد قائمًا.
  assert.ok(groups.length <= known.size, `${groups.length} duplicate groups exceed the ${known.size} recorded`);
});
