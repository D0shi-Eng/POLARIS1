// P01-ST — واصفات الإعدادات.
//
// الادعاء: الواجهة تستطيع أن تصف شجرة الإعدادات ووضع كل إعداد بصدق، وأن تقرأ
// قيمًا آمنة للعرض، دون أن تصير محلِّلًا ثانيًا ودون أن ترى سرًّا. الوصف لا
// يحمل قيمة، والقراءة لا تحمل ما يُحجب.

import test from "node:test";
import assert from "node:assert/strict";

import { validateAgainstSchemaReference } from "../src/validator.js";
import { validateDesktopResultPayload } from "../src/desktop/index.js";
import { payloadFixture, clonePayload, schemaEnum, schemaDocument } from "./p01-helpers.js";

const DESCRIPTOR = "desktop-settings.schema.json#/$defs/SettingDescriptor";
const RESOLVED = "desktop-settings.schema.json#/$defs/ResolvedSetting";

test("P01-ST-001 the mode set is exactly ACTIVE, READ_ONLY and UNAVAILABLE_THIS_PHASE", () => {
  assert.deepEqual(
    [...schemaEnum("desktop-settings.schema.json", "SettingMode")],
    ["ACTIVE", "READ_ONLY", "UNAVAILABLE_THIS_PHASE"],
  );
});

test("P01-ST-002 the reference describe result validates", () => {
  const result = validateDesktopResultPayload(
    "desktop.settings.describe",
    payloadFixture("positive", "settings-describe.result.json"),
  );
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
});

test("P01-ST-003 an unknown mode is refused", () => {
  assert.equal(
    validateAgainstSchemaReference(DESCRIPTOR, {
      setting_id: "locale",
      value_kind: "LOCALE",
      mode: "DISABLED",
      label_key: "settings.general.locale",
    }).ok,
    false,
  );
});

test("P01-ST-004 a setting that is not ACTIVE must say why", () => {
  for (const mode of ["READ_ONLY", "UNAVAILABLE_THIS_PHASE"]) {
    assert.equal(
      validateAgainstSchemaReference(DESCRIPTOR, {
        setting_id: "approval-timeout",
        value_kind: "INTEGER",
        mode,
        label_key: "settings.approvals.timeout",
      }).ok,
      false,
      `${mode} was accepted without a reason`,
    );
    assert.equal(
      validateAgainstSchemaReference(DESCRIPTOR, {
        setting_id: "approval-timeout",
        value_kind: "INTEGER",
        mode,
        label_key: "settings.approvals.timeout",
        availability_reason: "PHASE_NOT_IMPLEMENTED",
      }).ok,
      true,
    );
  }
});

test("P01-ST-005 an ENUM setting must publish its allowed values", () => {
  assert.equal(
    validateAgainstSchemaReference(DESCRIPTOR, {
      setting_id: "log-level",
      value_kind: "ENUM",
      mode: "ACTIVE",
      label_key: "settings.general.log_level",
    }).ok,
    false,
  );
  assert.equal(
    validateAgainstSchemaReference(DESCRIPTOR, {
      setting_id: "log-level",
      value_kind: "ENUM",
      mode: "ACTIVE",
      label_key: "settings.general.log_level",
      allowed_values: ["INFO", "WARN"],
    }).ok,
    true,
  );
});

test("P01-ST-006 a descriptor carries a localization key, never localized prose", () => {
  assert.equal(
    validateAgainstSchemaReference(DESCRIPTOR, {
      setting_id: "locale",
      value_kind: "LOCALE",
      mode: "ACTIVE",
      label_key: "اللغة",
    }).ok,
    false,
    "a translated label was accepted as a key",
  );
  assert.equal(
    validateAgainstSchemaReference(DESCRIPTOR, {
      setting_id: "locale",
      value_kind: "LOCALE",
      mode: "ACTIVE",
      label_key: "settings.general.locale",
      label: "Language",
    }).ok,
    false,
    "a prose member was accepted alongside the key",
  );
});

test("P01-ST-007 describing carries no value at all", () => {
  const schema = schemaDocument("desktop-settings.schema.json");
  const defs = schema["$defs"] as Record<string, Record<string, unknown>>;
  const properties = Object.keys(defs["SettingDescriptor"]!["properties"] as object);
  for (const forbidden of ["value", "current_value", "resolved_value"]) {
    assert.equal(properties.includes(forbidden), false, `SettingDescriptor exposes ${forbidden}`);
  }
  assert.equal(
    validateAgainstSchemaReference(DESCRIPTOR, {
      setting_id: "locale",
      value_kind: "LOCALE",
      mode: "ACTIVE",
      label_key: "settings.general.locale",
      value: { kind: "LOCALE", code_value: "ar" },
    }).ok,
    false,
  );
});

test("P01-ST-008 a withheld value cannot be accompanied by a value", () => {
  assert.equal(
    validateAgainstSchemaReference(RESOLVED, {
      setting_id: "provider-key",
      mode: "READ_ONLY",
      availability_reason: "PROVIDER_NOT_CONFIGURED",
      value_withheld: true,
    }).ok,
    true,
  );
  assert.equal(
    validateAgainstSchemaReference(RESOLVED, {
      setting_id: "provider-key",
      mode: "READ_ONLY",
      availability_reason: "PROVIDER_NOT_CONFIGURED",
      value_withheld: true,
      value: { kind: "TEXT", text_value: "configured" },
    }).ok,
    false,
    "a withheld setting was allowed to carry a value",
  );
});

test("P01-ST-009 a resolved value is typed by kind, with no untyped member to smuggle through", () => {
  const schema = schemaDocument("desktop-settings.schema.json");
  const defs = schema["$defs"] as Record<string, Record<string, unknown>>;
  const value = defs["DisplaySafeValue"]!;
  assert.equal(value["additionalProperties"], false);
  assert.deepEqual(Object.keys(value["properties"] as object).sort(), [
    "boolean_value",
    "code_value",
    "integer_value",
    "kind",
    "text_value",
  ]);
});

test("P01-ST-010 a read result cannot span more than the section it names", () => {
  const doc = clonePayload(payloadFixture("positive", "settings-read.result.json")) as Record<string, unknown>;
  doc["sections"] = [{ section_id: "approvals", settings: [] }];
  assert.equal(validateDesktopResultPayload("desktop.settings.read", doc).ok, false);
});
