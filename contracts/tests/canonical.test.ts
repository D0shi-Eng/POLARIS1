// اختبارات التقنين والتجزئة والانجراف. الغرض إثبات أن التمثيل القانوني حتمي فعلًا،
// وأن الأنواع المولّدة مشتقة من المخططات ولم تُحرّر يدويًا.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalize, canonicalBytes, withoutTopLevelKey, CanonicalizationError } from "../src/canonical.js";
import { sha256Hex } from "../src/hash.js";
import { findSecrets } from "../src/secret-hygiene.js";
import { redactForUntrusted, ErrorCode } from "../src/errors.js";
import { loadFixtures, fixture } from "./helpers.js";

const GENERATED_DIR = fileURLToPath(new URL("../../generated/types/", import.meta.url));

test("keys are ordered and whitespace is absent", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ a: { d: 1, c: 2 } }), '{"a":{"c":2,"d":1}}');
});

test("array order is content, not formatting, and is preserved", () => {
  assert.equal(canonicalize([3, 1, 2]), "[3,1,2]");
});

test("undefined members vanish exactly as they do in JSON", () => {
  assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
});

test("values that cannot be canonicalised deterministically are refused", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 1e21]) {
    assert.throws(() => canonicalize({ v: bad }), CanonicalizationError);
  }
  assert.throws(() => canonicalize({ v: 1n }), CanonicalizationError);
});

test("canonical bytes are UTF-8 and stable across repeated runs", () => {
  const value = { arabic: "بوليس", nested: { z: 1, a: [1, 2] } };
  const first = canonicalBytes(value);
  const second = canonicalBytes(JSON.parse(JSON.stringify(value)));
  assert.deepEqual(Buffer.from(first), Buffer.from(second));
});

test("digests are stable and differ when content differs", () => {
  const doc = fixture("positive", "audit-event.policy-evaluated.json");
  const digest = sha256Hex(canonicalize(withoutTopLevelKey(doc, "integrity")));
  assert.equal((doc["integrity"] as Record<string, string>)["hash"], digest);

  const changed = { ...withoutTopLevelKey(doc, "integrity"), sequence: 4 };
  assert.notEqual(sha256Hex(canonicalize(changed)), digest);
});

test("every positive fixture hashes identically on repeated canonicalisation", () => {
  for (const fx of loadFixtures("positive")) {
    const a = sha256Hex(canonicalize(fx.doc));
    const b = sha256Hex(canonicalize(JSON.parse(canonicalize(fx.doc))));
    assert.equal(a, b, `${fx.file} hash is unstable`);
  }
});

test("generated types carry the do-not-edit header and match a fresh generation", async () => {
  // المسار محسوب لا حرفي، حتى لا يحاول المترجم تحليل وحدة .mjs بلا أنواع.
  const generatorUrl = new URL("../../scripts/generate-types.mjs", import.meta.url).href;
  const { generate } = (await import(generatorUrl)) as {
    generate: (options: { check: boolean }) => Promise<Array<{ file: string; content: string }>>;
  };
  const expected = await generate({ check: true });
  const onDisk = readdirSync(GENERATED_DIR).sort();

  assert.deepEqual(onDisk, expected.map((e) => e.file).sort(), "generated file set drifted from the schemas");
  for (const { file, content } of expected) {
    const actual = readFileSync(join(GENERATED_DIR, file), "utf8");
    assert.ok(actual.includes("GENERATED FILE - DO NOT EDIT MANUALLY"), `${file} lost its header`);
    assert.equal(actual, content, `${file} drifted from its schema; run npm run generate`);
  }
});

test("the error taxonomy in code matches the schema exactly", () => {
  const schema = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../schemas/common/error.schema.json", import.meta.url)), "utf8"),
  ) as { $defs: { ErrorCode: { enum: string[] } } };
  assert.deepEqual(Object.keys(ErrorCode).sort(), [...schema.$defs.ErrorCode.enum].sort());
});

test("internal detail is stripped for untrusted callers", () => {
  const redacted = redactForUntrusted({
    code: ErrorCode.POLICY_DENIED,
    display_message: "Not permitted.",
    internal_detail: "rule fs.deny.system_paths",
  });
  assert.equal("internal_detail" in redacted, false);
  assert.equal(redacted.display_message, "Not permitted.");
});

test("the secret detector finds credential keys and shapes, and stays quiet otherwise", () => {
  assert.equal(findSecrets({ api_key: "x" }, "/m").length, 1);
  assert.equal(findSecrets({ note: "ghp_abcdefghijklmnopqrstuvwxyz01" }, "/m").length, 1);
  assert.equal(findSecrets({ host_platform: "windows", sequence: "3" }, "/m").length, 0);
});

test("the secret detector never echoes the secret it found", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz";
  for (const finding of findSecrets({ note: secret }, "/m")) {
    assert.equal(finding.detail.includes(secret), false);
  }
});
