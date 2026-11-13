// D3 في الاشتقاق الأصلي: الحكم يأتي من قياسه المُسمّى، ولا يُرقّى غير المقيس.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { D3_HEADLESS_GROUP, D3_HEADLESS_TEST, headlessBootstrapFailureVerdict } from "../p01-native.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SOURCE = readFileSync(path.join(ROOT, "desktop", "renderer", "tests", "app.test.tsx"), "utf8");
const group = (verdict, counts) => ({ groups: [{ group_id: D3_HEADLESS_GROUP, verdict, counts }] });
const clean = { tests: 24, passed: 24, failed: 0, skipped: 0, todo: 0, cancelled: 0 };

test("the named D3 test exists in the real renderer UI lane", () => {
  assert.ok(SOURCE.includes(`test(${JSON.stringify(D3_HEADLESS_TEST)}`));
});

test("D3 passes only when the UI lane ran clean in this run", () => {
  assert.equal(headlessBootstrapFailureVerdict(group("PASS", clean), SOURCE).verdict, "PASS");
});

test("D3 fails when the UI lane failed", () => {
  const result = headlessBootstrapFailureVerdict(group("FAIL", { ...clean, passed: 23, failed: 1 }), SOURCE);
  assert.equal(result.verdict, "FAIL");
});

test("D3 is not promoted without a measurement", () => {
  assert.equal(headlessBootstrapFailureVerdict(null, SOURCE).reason, "RENDERER_UI_GROUP_NOT_MEASURED");
  assert.equal(headlessBootstrapFailureVerdict({ groups: [] }, SOURCE).verdict, "NOT_TESTED");
  assert.equal(headlessBootstrapFailureVerdict(group("PASS", { ...clean, skipped: 1, passed: 23 }), SOURCE).verdict, "NOT_TESTED");
  assert.equal(headlessBootstrapFailureVerdict(group("PASS", { ...clean, passed: 0, tests: 0 }), SOURCE).verdict, "NOT_TESTED");
  assert.equal(headlessBootstrapFailureVerdict(group("NOT_TESTED", clean), SOURCE).verdict, "NOT_TESTED");
});

test("D3 is not promoted when the named test is gone", () => {
  const result = headlessBootstrapFailureVerdict(group("PASS", clean), SOURCE.replace(D3_HEADLESS_TEST, "renamed"));
  assert.equal(result.verdict, "NOT_TESTED");
  assert.equal(result.reason, "D3_HEADLESS_TEST_ABSENT");
});
