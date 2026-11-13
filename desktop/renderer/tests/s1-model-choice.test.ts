// الجلسة 1 (خطة 2026-10-07، ADR-040): لا خيار «محلي/بعيد» في أيّ مكان من الواجهة.
//
// الفحص يقرأ المصدر كله، ومعه الأنواع المولّدة من العقود وملفات اللغة: أداة اختيار واحدة متبقّية، أو مفتاح ترجمة
// يصفها، أو نوع عقد يحملها، يعني أن الخيار ما زال في النظام. كُتب قبل الإصلاح، وفشله على `0803b99` محفوظ.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { test } from "node:test";

function findSourceRoot(start: string): string {
  let current = start;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, "src");
    try {
      if (readdirSync(join(candidate, "ipc")).some((name) => name.endsWith(".ts"))) return candidate;
    } catch {
      // نصعد.
    }
    current = join(current, "..");
  }
  throw new Error("the renderer source tree was not found from " + start);
}

const SOURCE_ROOT = findSourceRoot(join(__dirname, ".."));

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(directory, entry.name), found);
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(join(directory, entry.name));
  }
  return found;
}

/** كل صيغة يظهر بها الخيار: نوع العقد وحقلاه وقيمه، وسبب الرفض، ومفتاحا الخصوصية، ومعرّف عنصر الواجهة. */
const FORBIDDEN = [
  "LocalityPreference",
  "locality_preference",
  "ContextPolicy",
  "context_policy",
  "LOCAL_ONLY",
  "ALLOW_REMOTE",
  "PREFER_LOCAL",
  "REMOTE_ONLY",
  "LOCALITY_POLICY",
  "PROJECT_CONTEXT_POLICY",
  "privacy.local_only",
  "privacy.allow_remote_models",
  "models-locality",
];

test("no local/remote option survives anywhere in the renderer source, generated contracts or language files", () => {
  const files = walk(SOURCE_ROOT);
  assert.ok(files.length > 100, "the scan covers too few files to mean anything");
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const term of FORBIDDEN) {
      if (text.includes(term)) hits.push(`${relative(SOURCE_ROOT, file)}: ${term}`);
    }
  }
  assert.deepEqual(hits, [], `the local/remote option is still present:\n${hits.join("\n")}`);
});
