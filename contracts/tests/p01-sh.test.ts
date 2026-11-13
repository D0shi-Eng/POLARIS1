// P01-SH — النظافة الأمنية على حمولات سطح المكتب.
//
// القاعدة مستعارة كاملة من contracts/src/secret-hygiene.ts ولم تُستنسخ: نفس
// الأنماط، ومستهلك ثانٍ يمشي عميقًا بدل خريطة مسطحة. ما يُثبَت هنا شيئان:
// أن المفاتيح والقيم ذات شكل الاعتماد تُرفض، وأن رسالة الرفض لا تحمل السرّ.

import test from "node:test";
import assert from "node:assert/strict";

import { findSecrets, findSecretsDeep } from "../src/secret-hygiene.js";
import { validateDesktopResultPayload, validateDesktopRequestPayload } from "../src/desktop/index.js";
import { payloadFixture, clonePayload } from "./p01-helpers.js";

const CREDENTIAL_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["github token", "ghp_abcdefghijklmnopqrstuvwxyz01"],
  ["openai key", "sk-abcdefghijklmnopqrstuvwxyz"],
  ["aws access key", "AKIAIOSFODNN7EXAMPLE"],
  ["slack token", "xoxb-1234567890-abcdefghijkl"],
  ["bearer header", "Bearer abcdefghijklmnopqrstuvwxyz012345"],
  ["json web token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r"],
];

const CREDENTIAL_KEYS = ["token", "password", "api_key", "authorization", "client_secret", "refresh_token"];

test("P01-SH-001 the deep scanner uses the shared rule and finds credential-shaped values at any depth", () => {
  for (const [name, value] of CREDENTIAL_SHAPES) {
    const findings = findSecretsDeep({ a: { b: [{ note: value }] } }, "/result");
    assert.equal(findings.length, 1, `${name} was not detected`);
    assert.equal(findings[0]!.reason, "SECRET_LIKE_VALUE");
    assert.equal(findings[0]!.pointer, "/result/a/b/0/note");
  }
});

test("P01-SH-002 the deep scanner finds credential-named keys at any depth", () => {
  for (const key of CREDENTIAL_KEYS) {
    const findings = findSecretsDeep({ settings: [{ [key]: "x" }] }, "/result");
    assert.equal(findings.length, 1, `the key ${key} was not detected`);
    assert.equal(findings[0]!.reason, "SECRET_LIKE_KEY");
  }
});

test("P01-SH-003 the deep scanner agrees with the flat one on a flat map", () => {
  const metadata = { api_key: "x", host_platform: "windows" };
  assert.deepEqual(findSecretsDeep(metadata, "/metadata"), findSecrets(metadata, "/metadata"));
});

test("P01-SH-004 ordinary shell facts are not flagged", () => {
  const snapshot = payloadFixture("positive", "bootstrap.result.json");
  assert.deepEqual(findSecretsDeep(snapshot, "/result"), []);
  const describe = payloadFixture("positive", "settings-describe.result.json");
  assert.deepEqual(findSecretsDeep(describe, "/result"), []);
});

test("P01-SH-005 no reported finding echoes the secret it found", () => {
  for (const [, value] of CREDENTIAL_SHAPES) {
    for (const finding of findSecretsDeep({ note: value }, "/result")) {
      assert.equal(finding.detail.includes(value), false, "the finding echoed the credential");
      assert.equal(finding.pointer.includes(value), false, "the pointer echoed the credential");
    }
  }
});

test("P01-SH-006 a credential-shaped value inside a settings read result is rejected", () => {
  const doc = clonePayload(payloadFixture("positive", "settings-read.result.json")) as Record<string, unknown>;
  const settings = doc["settings"] as Array<Record<string, unknown>>;
  settings[0]!["value"] = { kind: "TEXT", text_value: "ghp_abcdefghijklmnopqrstuvwxyz01" };
  const result = validateDesktopResultPayload("desktop.settings.read", doc);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.errors[0]!.code, "CONTRACT_VIOLATION");
  assert.equal(
    JSON.stringify(result.errors).includes("ghp_abcdefghijklmnopqrstuvwxyz01"),
    false,
    "the rejection echoed the credential",
  );
});

test("P01-SH-007 a credential-named key cannot be introduced into any desktop payload at all", () => {
  // الأشكال مغلقة، فالمفتاح يُرفض عند additionalProperties قبل أن يبلغ الكاشف.
  // هذا أقوى من الكشف: غير قابل للتمثيل بدل مرفوض بعد الفحص.
  const doc = clonePayload(payloadFixture("positive", "settings-read.result.json")) as Record<string, unknown>;
  doc["authorization"] = "Bearer abcdefghijklmnopqrstuvwxyz012345";
  assert.equal(validateDesktopResultPayload("desktop.settings.read", doc).ok, false);

  const request = { section_id: "general", api_key: "x" };
  assert.equal(validateDesktopRequestPayload("desktop.settings.read", request).ok, false);
});

test("P01-SH-008 no Phase-01 fixture in the repository carries credential-shaped data by accident", () => {
  // العيّنات السالبة تحمله عمدًا؛ الموجبة لا يجوز أن تحمله إطلاقًا.
  for (const file of [
    "bootstrap.result.json",
    "runtime-status.result.json",
    "capability-availability.result.json",
    "settings-describe.result.json",
    "settings-read.result.json",
    "settings-read.request.json",
    "capability-availability.request.json",
    "settings-describe.request.json",
  ]) {
    assert.deepEqual(findSecretsDeep(payloadFixture("positive", file), "/"), [], `${file} carries a credential shape`);
  }
});

test("P01-SH-009 nesting beyond the scanned depth is reported, never silently passed as clean", () => {
  let deep: unknown = "leaf";
  for (let i = 0; i < 20; i += 1) deep = { next: deep };
  const findings = findSecretsDeep(deep, "/result");
  assert.ok(findings.length > 0, "an unscannable depth was reported as clean");
});
