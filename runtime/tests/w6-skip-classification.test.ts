// W6 / K — عقد سجل التخطّي.
//
// هذا الملف يقيس السجل نفسه، لا التشغيل: أن كل بند مكتمل، وأن الأصناف من
// المفردات المُعلنة، وأن لا بند من الصنف D موجود أصلًا، وأن أي بند يمنع
// الإغلاق يقول ذلك صراحةً بدل أن يُترك للقارئ.
//
// مطابقة التخطّيات الفعلية بالسجل ليست هنا: ملف اختبار لا يرى تخطّي ملف آخر.
// تلك يجريها `tools/w6-conformance/w6-skip-inventory.mjs` على مخرَج TAP للمجموعة
// كاملة، وهو المكان الوحيد الذي يرى التشغيل كله.

import test from "node:test";
import assert from "node:assert/strict";

import { findSkipDeclaration, SKIP_REGISTRY, type SkipClass } from "./w6-skip-registry.js";

const CLASSES: readonly SkipClass[] = ["A", "B", "C", "D"];

test("W6-K every declaration is complete and uses the declared vocabulary", () => {
  assert.ok(SKIP_REGISTRY.length > 0, "the skip registry is empty");
  for (const declaration of SKIP_REGISTRY) {
    assert.ok(declaration.reason.trim().length > 0, "a declaration has no reason text");
    assert.ok(CLASSES.includes(declaration.skip_class), `${declaration.reason}: unknown class`);
    assert.ok(declaration.rationale.length > 40, `${declaration.reason}: the rationale explains nothing`);
    assert.equal(typeof declaration.blocks_closure, "boolean");
  }
});

test("W6-K no reason is declared twice, and no declaration shadows another", () => {
  const reasons = SKIP_REGISTRY.map((declaration) => declaration.reason);
  assert.equal(new Set(reasons).size, reasons.length, "a skip reason is declared more than once");
  for (const declaration of SKIP_REGISTRY) {
    const matched = SKIP_REGISTRY.filter((candidate) => declaration.reason.includes(candidate.reason));
    assert.equal(matched.length, 1, `'${declaration.reason}' matches more than one declaration`);
  }
});

test("W6-K no skip is classified D, and every class-D skip would block closure", () => {
  const securityCritical = SKIP_REGISTRY.filter((declaration) => declaration.skip_class === "D");
  assert.deepEqual(
    securityCritical.map((declaration) => declaration.reason),
    [],
    "a security-critical unmeasured skip is declared: Phase-00 cannot close",
  );
  for (const declaration of SKIP_REGISTRY) {
    if (declaration.skip_class === "D") assert.equal(declaration.blocks_closure, true);
  }
});

test("W6-K a platform-legitimate skip names who carries its Windows claim", () => {
  for (const declaration of SKIP_REGISTRY) {
    if (declaration.skip_class === "A" || declaration.skip_class === "B") {
      assert.ok(
        declaration.windows_claim_carried_by.length > 0,
        `${declaration.reason}: nothing is named as carrying the claim on Windows`,
      );
    }
  }
});

test("W6-K lookup matches by reason text, and an unknown reason stays unknown", () => {
  assert.notEqual(findSkipDeclaration("no PowerShell interpreter on this host"), undefined);
  assert.notEqual(findSkipDeclaration("junction creation needs a native Windows run"), undefined);
  assert.equal(findSkipDeclaration("because I said so"), undefined);
  assert.equal(findSkipDeclaration(""), undefined);
});
