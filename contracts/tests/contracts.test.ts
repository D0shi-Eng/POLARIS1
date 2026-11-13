// اختبارات العقود الستة: قبول العينات الصالحة، ورفض كل عينة سلبية، وثبات التسلسل،
// ورفض الإصدارات غير المدعومة. الفشل هنا يعني أن العقد لا يفرض ما يدّعيه.

import test from "node:test";
import assert from "node:assert/strict";

import { validateContract, compileAllContracts } from "../src/validator.js";
import { CONTRACT_NAMES, checkContractVersion, type ContractName } from "../src/version.js";
import { canonicalize } from "../src/canonical.js";
import { ErrorCode } from "../src/errors.js";
import { loadFixtures, negativeIndex, clone } from "./helpers.js";

const positives = loadFixtures("positive");
const negatives = loadFixtures("negative");

test("every contract schema compiles", () => {
  assert.equal(compileAllContracts().length, CONTRACT_NAMES.length);
});

test("every contract has at least one positive and one negative fixture", () => {
  for (const contract of CONTRACT_NAMES) {
    assert.ok(positives.some((f) => f.contract === contract), `no positive fixture for ${contract}`);
    assert.ok(negatives.some((f) => f.contract === contract), `no negative fixture for ${contract}`);
  }
});

for (const fx of positives) {
  test(`positive: ${fx.file} validates`, () => {
    const result = validateContract(fx.contract, fx.doc);
    assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
  });
}

const expectations = negativeIndex();

for (const fx of negatives) {
  test(`negative: ${fx.file} is rejected for the intended defect`, () => {
    const expected = expectations[fx.file];
    assert.ok(expected !== undefined, `${fx.file} has no recorded expectation`);
    assert.ok(expected!.reason.length > 0, `${fx.file} has no documented reason`);

    const result = validateContract(fx.contract, fx.doc);
    assert.equal(result.ok, false, `${fx.file} was accepted but must be rejected`);
    if (result.ok) return;

    // الرمز والمؤشر معًا: الرفض وحده ليس دليلًا، إذ قد تبطل العينة لسبب غير المقصود.
    assert.equal(result.errors[0]!.code, expected!.expect_code, `${fx.file} rejected with the wrong error class`);
    assert.equal(result.errors[0]!.pointer ?? "/", expected!.expect_pointer, `${fx.file} rejected at the wrong location`);
  });
}

test("negative fixtures cover every rejection class the pipeline can produce", () => {
  const classes = new Set(Object.values(expectations).map((e) => e.expect_code));
  for (const required of [ErrorCode.VALIDATION_ERROR, ErrorCode.UNSUPPORTED_VERSION, ErrorCode.CONTRACT_VIOLATION]) {
    assert.ok(classes.has(required), `no negative fixture exercises ${required}`);
  }
});

test("serialization round-trips through canonical form without loss", () => {
  for (const fx of positives) {
    const once = canonicalize(fx.doc);
    const twice = canonicalize(JSON.parse(once));
    assert.equal(twice, once, `${fx.file} is not canonicalisation-stable`);
    assert.deepEqual(JSON.parse(once), fx.doc, `${fx.file} lost data in round-trip`);
  }
});

test("canonical form is independent of key insertion order", () => {
  for (const fx of positives) {
    const reversed = Object.fromEntries(Object.entries(fx.doc).reverse());
    assert.equal(canonicalize(reversed), canonicalize(fx.doc), `${fx.file} depends on key order`);
  }
});

test("unsupported versions are rejected as UNSUPPORTED_VERSION, not generic validation errors", () => {
  const cases: ReadonlyArray<readonly [ContractName, string]> = CONTRACT_NAMES.map((c) => [c, "2.0"] as const);
  for (const [contract, version] of cases) {
    const gate = checkContractVersion(contract, version);
    assert.equal(gate.ok, false);
    assert.equal(gate.ok === false ? gate.error.code : "", ErrorCode.UNSUPPORTED_VERSION);
  }
});

test("a higher minor version within the same major is rejected, a lower one is accepted", () => {
  assert.equal(checkContractVersion("IPCEnvelopeV1", "1.9").ok, false);
  assert.equal(checkContractVersion("IPCEnvelopeV1", "1.0").ok, true);
});

test("malformed version strings are MALFORMED_MESSAGE, not UNSUPPORTED_VERSION", () => {
  for (const bad of ["1", "1.0.0", "v1.0", "", null, 1.0]) {
    const gate = checkContractVersion("AuditEventV1", bad);
    assert.equal(gate.ok, false);
    assert.equal(gate.ok === false ? gate.error.code : "", ErrorCode.MALFORMED_MESSAGE);
  }
});

test("non-object payloads are rejected before any schema runs", () => {
  for (const bad of [null, [], "{}", 42, true]) {
    const result = validateContract("IPCEnvelopeV1", bad);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.errors[0]!.code : "", ErrorCode.MALFORMED_MESSAGE);
  }
});

test("an unknown top-level field is rejected on every contract", () => {
  for (const fx of positives) {
    const tampered = clone(fx.doc);
    tampered["polaris_injected_field"] = "x";
    assert.equal(validateContract(fx.contract, tampered).ok, false, `${fx.file} accepted an unknown field`);
  }
});
