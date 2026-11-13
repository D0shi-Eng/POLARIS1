// حارس العيب P01_STARTUP_REPORT_ABSENT.
// الشجرة الحقيقية أولًا، ثم حالات مصطنعة تثبت أن الحارس يرفض فعلًا. حالة الرفض
// الأولى هي الاستيراد الذي كان في `desktop/renderer/src/ipc/validator.ts` حين رمى
// WebView الخطأ: EvalError ... "script-src 'self'".

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkBundle, checkPolicy, checkRendererSources, checkTree, parseCsp } from "../csp-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PRODUCT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost";

for (const r of checkTree(ROOT)) {
  test(`${r.id} holds for the real tree`, () => {
    assert.equal(r.verdict, "PASS", r.detail);
  });
}

test("the policy parser keeps directives apart", () => {
  const csp = parseCsp(PRODUCT_CSP);
  assert.deepEqual(csp.get("script-src"), ["'self'"]);
  assert.deepEqual(csp.get("style-src"), ["'self'", "'unsafe-inline'"]);
});

test("P01-CSP-001 rejects a policy that re-enables string evaluation or inline script", () => {
  assert.equal(checkPolicy(PRODUCT_CSP).verdict, "PASS");
  assert.equal(checkPolicy(PRODUCT_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")).verdict, "FAIL");
  assert.equal(checkPolicy(PRODUCT_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")).verdict, "FAIL");
  assert.equal(checkPolicy("default-src 'self' 'unsafe-eval'").verdict, "FAIL");
  assert.equal(checkPolicy("").verdict, "FAIL");
});

test("P01-CSP-002 rejects the run-time Ajv compiler that broke the packaged bootstrap", () => {
  const defective = { name: "src/ipc/validator.ts", text: 'import AjvModule from "ajv/dist/2020.js";\nimport addFormatsModule from "ajv-formats";' };
  assert.equal(checkRendererSources([defective]).verdict, "FAIL");
  assert.equal(checkRendererSources([{ name: "a.ts", text: 'const Ajv = require("ajv");' }]).verdict, "FAIL");
  const precompiled = { name: "src/generated/contract-validators.ts", text: 'import ajvRuntimeEqual from "ajv/dist/runtime/equal";\nimport { fullFormats as f } from "ajv-formats/dist/formats";' };
  assert.equal(checkRendererSources([precompiled]).verdict, "PASS");
});

test("P01-CSP-003 rejects string evaluation in the built bundle and is inconclusive without one", () => {
  assert.equal(checkBundle([]).verdict, "INCONCLUSIVE");
  assert.equal(checkBundle([{ name: "x.js", text: "const f=new Function(\"a\",src);" }]).verdict, "FAIL");
  assert.equal(checkBundle([{ name: "x.js", text: "x=Function(src)" }]).verdict, "FAIL");
  assert.equal(checkBundle([{ name: "x.js", text: "window.eval(src);eval(src)" }]).verdict, "FAIL");
  assert.equal(checkBundle([{ name: "x.js", text: "setTimeout('run()',1)" }]).verdict, "FAIL");
  assert.equal(checkBundle([{ name: "x.js", text: "a.isFunction(b);typeof b==\"function\";evaluate(c);myFunction(d)" }]).verdict, "PASS");
});
