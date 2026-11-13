// اختبارات خدمة الإعدادات: التحقق، النطاقات، المفاتيح المجهولة، الإصدارات،
// الأسبقية، الذرّية، ومراجع الأسرار.

import test from "node:test";
import assert from "node:assert/strict";

import { ConfigService } from "../src/config/service.js";
import { InMemoryConfigStore } from "../src/config/store.js";
import { resolve } from "../src/config/resolver.js";
import { allSettings, CONFIG_SCHEMA_VERSION, findSetting } from "../src/config/schema.js";
import { validateKeyValue } from "../src/config/validate.js";
import { REDACTED } from "../src/config/export.js";
import type { Changeset } from "../src/config/changeset.js";
import { layer } from "./helpers.js";

const changeset = (changes: Changeset["changes"], origin: Changeset["origin"] = "CORE"): Changeset => ({
  changeset_id: "cs-test",
  origin,
  changes,
});

test("the schema is internally consistent: every default validates against its own definition", () => {
  for (const definition of allSettings()) {
    assert.deepEqual(validateKeyValue(definition.key, definition.default), [], `${definition.key} default is invalid`);
    assert.ok(definition.allowed_scopes.length > 0, `${definition.key} has no allowed scope`);
    assert.ok(definition.description.length > 20, `${definition.key} has no real description`);
  }
});

test("every core setting lives in the reserved namespace", () => {
  for (const definition of allSettings()) {
    assert.ok(definition.key.startsWith("polaris."), `${definition.key} is outside the core namespace`);
  }
});

test("a fresh service resolves every setting to its schema default", () => {
  const service = new ConfigService();
  const effective = service.effective();
  assert.equal(effective.integrity, "HEALTHY");
  assert.equal(effective.schema_version, CONFIG_SCHEMA_VERSION);
  for (const definition of allSettings()) {
    assert.deepEqual(effective.settings[definition.key]?.value, definition.default);
    assert.equal(effective.settings[definition.key]?.source_scope, "DEFAULT");
  }
});

test("a valid changeset applies and is reflected in effective config", () => {
  const service = new ConfigService();
  const result = service.apply(changeset([{ key: "polaris.ui.language", scope: "USER", value: "ar" }]));
  assert.equal(result.applied, true);
  assert.equal(service.get("polaris.ui.language"), "ar");
  assert.equal(service.effective().settings["polaris.ui.language"]?.source_scope, "USER");
});

test("an invalid value is rejected and nothing changes", () => {
  const service = new ConfigService();
  const before = service.effective();
  const result = service.apply(changeset([{ key: "polaris.ui.language", scope: "USER", value: "fr" }]));
  assert.equal(result.applied, false);
  assert.equal(service.effective(), before);
});

test("a setting cannot be written in a scope it does not allow", () => {
  const service = new ConfigService();
  const result = service.apply(changeset([{ key: "polaris.security.fail_closed", scope: "USER", value: false }]));
  assert.equal(result.applied, false);
  if (result.applied) return;
  assert.equal(result.errors[0]?.code, "POLICY_DENIED");
  assert.match(result.errors[0]?.internal_detail ?? "", /allowed scopes: DEFAULT/);
  assert.equal(service.get("polaris.security.fail_closed"), true);
});

test("a secret-backed setting rejects a literal value and accepts only a reference", () => {
  const service = new ConfigService();
  const literal = service.apply(
    changeset([{ key: "polaris.model.provider_credential_ref", scope: "USER", value: "sk-not-a-real-key-000000000000" }]),
  );
  assert.equal(literal.applied, false);
  if (!literal.applied) assert.match(literal.errors[0]?.internal_detail ?? "", /reference object, never a literal/);

  const reference = service.apply(
    changeset([
      { key: "polaris.model.provider_credential_ref", scope: "USER", value: { $secret_ref: "polaris-secret://provider/main" } },
    ]),
  );
  assert.equal(reference.applied, true);
});

test("a credential-shaped reference is refused by the shared secret detector", () => {
  const service = new ConfigService();
  const result = service.apply(
    changeset([
      {
        key: "polaris.model.provider_credential_ref",
        scope: "USER",
        value: { $secret_ref: "polaris-secret://ghp_abcdefghijklmnopqrstuvwxyz01" },
      },
    ]),
  );
  assert.equal(result.applied, false);
  if (!result.applied) assert.equal(result.errors[0]?.code, "CONTRACT_VIOLATION");
});

test("a plugin cannot write to the reserved core namespace", () => {
  const service = new ConfigService();
  const result = service.apply(changeset([{ key: "polaris.ui.language", scope: "USER", value: "ar" }], "PLUGIN"));
  assert.equal(result.applied, false);
  if (!result.applied) assert.equal(result.errors[0]?.code, "POLICY_DENIED");
  assert.equal(service.get("polaris.ui.language"), "en");
});

test("an unknown key in a changeset is rejected, not ignored", () => {
  const service = new ConfigService();
  const result = service.apply(changeset([{ key: "polaris.not.a.setting", scope: "USER", value: 1 }]));
  assert.equal(result.applied, false);
  if (!result.applied) assert.match(result.errors[0]?.internal_detail ?? "", /not in config schema/);
});

test("the same slot changed twice in one changeset is a conflict, not a last-write-wins", () => {
  const service = new ConfigService();
  const result = service.apply(
    changeset([
      { key: "polaris.ui.language", scope: "USER", value: "ar" },
      { key: "polaris.ui.language", scope: "USER", value: "en" },
    ]),
  );
  assert.equal(result.applied, false);
  if (!result.applied) assert.equal(result.errors[0]?.code, "CONFLICT");
});

test("an unknown key stored in the reserved namespace degrades config and is quarantined, never silently ignored", () => {
  const service = ConfigService.fromLayers([layer("USER", { "polaris.future.privileged_mode": true })]);
  const effective = service.effective();
  assert.equal(effective.integrity, "DEGRADED");
  assert.equal(effective.degradations[0]?.code, "UNKNOWN_RESERVED_KEY");
  assert.deepEqual(
    effective.quarantined.map((q) => q.key),
    ["polaris.future.privileged_mode"],
  );
});

test("an unknown key outside the reserved namespace is quarantined without degrading config", () => {
  const service = ConfigService.fromLayers([layer("USER", { "vendor.plugin.setting": 1 })]);
  const effective = service.effective();
  assert.equal(effective.integrity, "HEALTHY");
  assert.equal(effective.quarantined.length, 1);
});

test("a layer written by a newer MAJOR schema applies nothing at all", () => {
  const service = ConfigService.fromLayers([
    layer("USER", { "polaris.ui.language": "ar", "polaris.filesystem.allow_write": true }, "2.0"),
  ]);
  const effective = service.effective();
  assert.equal(effective.integrity, "DEGRADED");
  assert.equal(effective.degradations[0]?.code, "LAYER_SCHEMA_MAJOR_TOO_NEW");
  // الحاسم: لا قيمة واحدة من الطبقة الأحدث طُبِّقت، بما فيها الإعداد ذو الأثر الأمني.
  assert.equal(service.get("polaris.ui.language"), "en");
  assert.equal(service.get("polaris.filesystem.allow_write"), false);
  assert.equal(effective.quarantined.length, 2);
});

test("a layer written by a newer MINOR schema applies known keys and quarantines the rest", () => {
  const service = ConfigService.fromLayers([
    layer("USER", { "polaris.ui.language": "ar", "polaris.future.knob": 3 }, "1.9"),
  ]);
  assert.equal(service.get("polaris.ui.language"), "ar");
  assert.equal(service.effective().integrity, "DEGRADED");
  assert.ok(service.effective().degradations.some((d) => d.code === "LAYER_SCHEMA_MINOR_TOO_NEW"));
});

test("a stored value that fails validation is quarantined and the lower-precedence value survives", () => {
  const service = ConfigService.fromLayers([layer("USER", { "polaris.execution.max_output_bytes": -5 })]);
  assert.equal(service.get("polaris.execution.max_output_bytes"), findSetting("polaris.execution.max_output_bytes")?.default);
  assert.equal(service.effective().integrity, "DEGRADED");
  assert.equal(service.effective().degradations[0]?.code, "INVALID_STORED_VALUE");
});

test("a value stored in a scope it is not allowed in is quarantined", () => {
  const service = ConfigService.fromLayers([layer("USER", { "polaris.security.fail_closed": false })]);
  assert.equal(service.get("polaris.security.fail_closed"), true);
  assert.equal(service.effective().integrity, "DEGRADED");
});

test("removing a USER value falls back to the DEFAULT layer beneath it", () => {
  const service = ConfigService.fromLayers([layer("DEFAULT", { "polaris.ui.language": "ar" })]);
  assert.equal(service.get("polaris.ui.language"), "ar");
  service.apply(changeset([{ key: "polaris.ui.language", scope: "USER", value: "en" }]));
  assert.equal(service.get("polaris.ui.language"), "en");
  service.apply(changeset([{ key: "polaris.ui.language", scope: "USER", value: null }]));
  assert.equal(service.get("polaris.ui.language"), "ar");
  assert.equal(service.effective().settings["polaris.ui.language"]?.source_scope, "DEFAULT");
});

test("the export surface never emits a secret-backed value", () => {
  const service = new ConfigService();
  service.apply(
    changeset([
      { key: "polaris.model.provider_credential_ref", scope: "USER", value: { $secret_ref: "polaris-secret://provider/main" } },
    ]),
  );
  const exported = service.export();
  const entry = exported.settings.find((s) => s.key === "polaris.model.provider_credential_ref");
  assert.equal(entry?.value, REDACTED);
  assert.equal(JSON.stringify(exported).includes("provider/main"), false);
});

test("the resolver is a pure function of the store", () => {
  const store = new InMemoryConfigStore([layer("USER", { "polaris.ui.language": "ar" })]);
  assert.deepEqual(resolve(store), resolve(store));
});
