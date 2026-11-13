// سطح الحزمة: ما تُعلنه ‎@polaris/contracts‎ يجب أن يوجد فعلًا بعد البناء.
//
// المستهلك الوحيد اليوم هو runtime، وهو يستورد من المدخل الرئيسي. هذا الملف
// يمنع أن يمضي بناءٌ ناجح وحزمةٌ لا تُحلّ: exports وعدٌ، والوعد يُقاس.
//
// يعمل هذا الاختبار من dist بعد البناء، فما يفحصه هو المخرجات الحقيقية لا المصدر.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as surface from "../src/index.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));

interface Manifest {
  readonly name: string;
  readonly main: string;
  readonly types: string;
  readonly files: readonly string[];
  readonly exports: Record<string, Record<string, string> | string>;
}

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as Manifest;

test("the package name is the one runtime declares", () => {
  assert.equal(manifest.name, "@polaris/contracts");
});

test("every path the package exports exists on disk after the build", () => {
  const entry = manifest.exports["."] as Record<string, string>;
  for (const [condition, target] of Object.entries(entry)) {
    assert.equal(typeof target, "string", `exports['.'].${condition} is not a path`);
    assert.equal(existsSync(join(PACKAGE_ROOT, target)), true, `exports['.'].${condition} → ${target} is missing`);
  }
  // مسار فرعي بنمط: يكفي أن يوجد المجلد وملف مخطط واحد على الأقل.
  assert.equal(existsSync(join(PACKAGE_ROOT, "schemas")), true, "the schemas subpath export has no directory");
});

test("main and types agree with the exports map, so resolvers cannot disagree", () => {
  const entry = manifest.exports["."] as Record<string, string>;
  assert.equal(manifest.types, entry["types"]);
  assert.equal(manifest.main, entry["import"]);
  assert.ok(manifest.types.endsWith(".d.ts"));
  assert.ok(manifest.main.endsWith(".js"));
});

test("the published file list covers everything the exports point at", () => {
  const roots = new Set(manifest.files);
  const entry = manifest.exports["."] as Record<string, string>;
  for (const target of [...Object.values(entry), "schemas/"]) {
    const top = target.replace(/^\.\//, "").split("/")[0] as string;
    assert.equal(roots.has(top), true, `files does not include ${top}, which exports depends on`);
  }
});

test("the entry point exposes exactly what the runtime imports from it", () => {
  // هذه الأسماء يستوردها runtime نصًّا. سقوط أحدها يكسر المستهلك لا الحزمة وحدها.
  for (const name of ["validateContract", "checkInvariants", "invariantViolations", "findSecrets", "ErrorCode"]) {
    assert.ok(name in surface, `the package entry point no longer exports ${name}`);
  }
});
