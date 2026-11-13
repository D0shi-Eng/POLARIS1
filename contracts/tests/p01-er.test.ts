// P01-ER — خريطة الأخطاء.
//
// الادعاء: كل رمز خطأ قانوني له فئة معروضة، ولا فئة تخترع رمزًا، ولا تفصيل
// داخلي يعبر الحدّ افتراضيًا. الاكتمال هو المهم: رمز بلا فئة هو الطريق الذي
// تتسرّب منه رسالة داخلية إلى شاشة لأن أحدًا لم يقرّر ما تعنيه.

import test from "node:test";
import assert from "node:assert/strict";

import { ErrorCode, redactForUntrusted } from "../src/errors.js";
import {
  desktopCategoryFor,
  desktopErrorEntry,
  loadDesktopErrorMapping,
  toDesktopErrorView,
} from "../src/desktop/index.js";
import { validateAgainstSchemaReference } from "../src/validator.js";
import { schemaEnum } from "./p01-helpers.js";

const CATEGORIES = [
  "IPC_UNAVAILABLE",
  "IPC_TIMEOUT",
  "UNSUPPORTED_OPERATION",
  "INVALID_RESPONSE",
  "NATIVE_SERVICE_UNAVAILABLE",
  "CONFIG_UNAVAILABLE",
  "PERMISSION_DENIED",
  "FEATURE_NOT_AVAILABLE",
  "INTERNAL_ERROR",
];

test("P01-ER-001 the category set is exactly the nine the architecture declares", () => {
  assert.deepEqual([...schemaEnum("desktop-error-mapping.v1.schema.json", "DesktopErrorCategory")], CATEGORIES);
});

test("P01-ER-002 the mapping document is valid against its own schema", () => {
  const mapping = loadDesktopErrorMapping();
  assert.equal(validateAgainstSchemaReference("desktop-error-mapping.v1.schema.json", mapping).ok, true);
});

test("P01-ER-003 every category appears exactly once", () => {
  const seen = loadDesktopErrorMapping().entries.map((entry) => entry.category);
  assert.deepEqual([...seen].sort(), [...CATEGORIES].sort());
  assert.equal(new Set(seen).size, seen.length, "a category is mapped twice");
});

test("P01-ER-004 every frozen error code is covered by at least one category", () => {
  const covered = new Set(loadDesktopErrorMapping().entries.flatMap((entry) => entry.canonical_codes));
  for (const code of Object.values(ErrorCode)) {
    assert.ok(covered.has(code), `${code} has no desktop category and would render as nothing`);
  }
});

test("P01-ER-005 no category invents a code outside the frozen vocabulary", () => {
  const known = new Set<string>(Object.values(ErrorCode));
  for (const entry of loadDesktopErrorMapping().entries) {
    for (const code of entry.canonical_codes) {
      assert.ok(known.has(code), `${entry.category} maps the unknown code ${code}`);
    }
  }
});

test("P01-ER-006 every code resolves to a category, and the resolution is stable", () => {
  for (const code of Object.values(ErrorCode)) {
    const first = desktopCategoryFor(code);
    assert.ok(CATEGORIES.includes(first), `${code} resolved outside the category set`);
    assert.equal(desktopCategoryFor(code), first, `${code} does not resolve deterministically`);
  }
});

test("P01-ER-007 no Phase-01 category lets internal detail cross the boundary", () => {
  for (const entry of loadDesktopErrorMapping().entries) {
    assert.equal(
      entry.detail_may_cross_boundary,
      false,
      `${entry.category} would let internal_detail reach the renderer`,
    );
  }
});

test("P01-ER-008 the rendered view carries no internal detail and no stack trace", () => {
  const view = toDesktopErrorView(
    {
      code: ErrorCode.INTERNAL_ERROR,
      display_message: "Something went wrong.",
      internal_detail: "thread 'main' panicked at src/ipc/gateway.rs:214",
      pointer: "/payload/section_id",
      retryable: false,
    },
    { correlationId: "11111111-1111-4111-8111-111111111111" },
  );

  assert.equal("internal_detail" in view, false);
  assert.equal("stack" in view, false);
  assert.equal(JSON.stringify(view).includes("gateway.rs"), false, "host source detail reached the view");
  assert.equal(validateAgainstSchemaReference("desktop-error-mapping.v1.schema.json#/$defs/DesktopErrorView", view).ok, true);
});

test("P01-ER-009 STRIP_ALL_DETAIL also removes the pointer", () => {
  const category = "PERMISSION_DENIED";
  assert.equal(desktopErrorEntry(category).default_redaction, "STRIP_ALL_DETAIL");
  const view = toDesktopErrorView(
    {
      code: ErrorCode.POLICY_DENIED,
      display_message: "Not permitted.",
      internal_detail: "rule fs.deny.system_paths",
      pointer: "/payload/section_id",
    },
    { category },
  );
  assert.equal("pointer" in view, false);
});

test("P01-ER-010 STRIP_INTERNAL_DETAIL keeps the pointer and drops the detail", () => {
  const category = "INVALID_RESPONSE";
  assert.equal(desktopErrorEntry(category).default_redaction, "STRIP_INTERNAL_DETAIL");
  const view = toDesktopErrorView(
    {
      code: ErrorCode.VALIDATION_ERROR,
      display_message: "Payload failed contract validation.",
      internal_detail: "/settings/0 must NOT have additional properties",
      pointer: "/settings/0",
    },
    { category },
  );
  assert.equal(view.pointer, "/settings/0");
  assert.equal("internal_detail" in view, false);
});

test("P01-ER-011 retryability is declared per category, not guessed per screen", () => {
  assert.equal(desktopErrorEntry("IPC_TIMEOUT").retryable, true);
  assert.equal(desktopErrorEntry("UNSUPPORTED_OPERATION").retryable, false);
  assert.equal(desktopErrorEntry("PERMISSION_DENIED").retryable, false);
  const view = toDesktopErrorView({ code: ErrorCode.TIMEOUT, display_message: "The host did not answer." });
  assert.equal(view.retryable, true);
});

test("P01-ER-012 the desktop view is a narrowing of the frozen redaction gate, not a replacement for it", () => {
  // بوابة الإفصاح المجمّدة تُسقط internal_detail؛ العرض هنا يُسقطه أيضًا ويزيد
  // فئةً وقابليةَ إعادة. لو اختلفا لصار عند الحدّ مساران بسياستَي إفصاح.
  const error = {
    code: ErrorCode.DEPENDENCY_UNAVAILABLE,
    display_message: "The host is not answering.",
    internal_detail: "bootstrap service not initialised",
  };
  assert.equal("internal_detail" in redactForUntrusted(error), false);
  assert.equal("internal_detail" in toDesktopErrorView(error), false);
});
