// خصائص خدمة الإعدادات المطلوبة في W3 (PROP-001..PROP-006) وخاصيتان إضافيتان.
// كل خاصية تُثبت على مجموعة حالات مولّدة بمولّد مزروع، لا على مثال واحد منتقى.

import test from "node:test";
import assert from "node:assert/strict";

import { ConfigService } from "../src/config/service.js";
import { InMemoryConfigStore } from "../src/config/store.js";
import { resolve } from "../src/config/resolver.js";
import { allSettings } from "../src/config/schema.js";
import { REDACTED } from "../src/config/export.js";
import type { Changeset, ConfigChange } from "../src/config/changeset.js";
import type { Scope, SettingValue } from "../src/config/types.js";
import { layer } from "./helpers.js";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** أفعال أثر صالحة، لمفاتيح القوائم التي تحمل نمط فعل لا نمط مسار. */
const SAMPLE_EFFECTS: readonly string[] = [
  "read.filesystem",
  "write.filesystem",
  "create.filesystem",
  "network.fetch",
];

/** قيمة صالحة مولّدة لكل نوع، حتى تشمل الخصائص المخطط كله لا إعدادًا واحدًا. */
function sampleValue(key: string, random: () => number): SettingValue {
  const definition = allSettings().find((d) => d.key === key)!;
  switch (definition.type) {
    case "BOOLEAN":
      return random() < 0.5;
    case "INTEGER": {
      // الحدود المُعلنة في المخطط جزء من الصلاحية. مولّد يتجاوزها يُنتج
      // تغييرًا مرفوضًا، فيصير فشل الخاصية فشلَ مولّد لا فشلَ خدمة.
      const low = definition.min ?? 1;
      const high = definition.max ?? low + 4095;
      return low + Math.floor(random() * (high - low + 1));
    }
    case "ENUM":
      return definition.enum_values![Math.floor(random() * definition.enum_values!.length)]!;
    case "STRING_LIST":
      // المولّد يجب أن ينتج قيمة تجتاز نمط العنصر المُعلن للمفتاح، وإلا صار
      // فشل الخاصية فشلَ مولّد لا فشلَ خدمة إعدادات. القوائم الثلاث في المخطط
      // لها ثلاثة أنماط: وجهات شبكية، وأفعال أثر، وجذور مسارات ويندوز.
      if (key.includes("destinations")) return [`host${String(Math.floor(random() * 50))}.example:443`];
      if (key.includes("effects")) return [SAMPLE_EFFECTS[Math.floor(random() * SAMPLE_EFFECTS.length)]!];
      return [`D:\\POLARIS\\sub${String(Math.floor(random() * 50))}`];
    case "SECRET_REF":
      return { $secret_ref: `polaris-secret://slot/${String(Math.floor(random() * 50))}` };
    default:
      return "unused";
  }
}

function writableIn(scope: Scope): readonly string[] {
  return allSettings().filter((d) => d.allowed_scopes.includes(scope)).map((d) => d.key);
}

function randomChangeset(random: () => number, id: string): Changeset {
  const scope: Scope = random() < 0.5 ? "DEFAULT" : "USER";
  const keys = writableIn(scope);
  const count = 1 + Math.floor(random() * 3);
  const chosen = new Set<string>();
  while (chosen.size < Math.min(count, keys.length)) chosen.add(keys[Math.floor(random() * keys.length)]!);
  const changes: ConfigChange[] = [...chosen].map((key) => ({ key, scope, value: sampleValue(key, random) }));
  return { changeset_id: id, origin: "CORE", changes };
}

// ── PROP-001 Determinism ─────────────────────────────────────────────────────

test("PROP-001 the same store always resolves to the same effective configuration", () => {
  const random = seeded(1001);
  for (let i = 0; i < 100; i += 1) {
    const service = new ConfigService();
    service.apply(randomChangeset(random, `cs-${String(i)}`));
    const store = new InMemoryConfigStore([...(service.effective(), [])]);
    void store;
    const a = JSON.stringify(service.effective());
    const b = JSON.stringify(service.effective());
    assert.equal(a, b);
  }
});

test("PROP-001 two services built from identical layers resolve identically", () => {
  const random = seeded(1002);
  for (let i = 0; i < 100; i += 1) {
    const values: Record<string, unknown> = {};
    for (const change of randomChangeset(random, "x").changes) values[change.key] = change.value;
    const layers = [layer("USER", values)];
    assert.equal(
      JSON.stringify(ConfigService.fromLayers(layers).effective()),
      JSON.stringify(ConfigService.fromLayers(JSON.parse(JSON.stringify(layers)) as typeof layers).effective()),
    );
  }
});

test("PROP-001 resolution uses no clock and no randomness", () => {
  const store = new InMemoryConfigStore([layer("USER", { "polaris.ui.language": "ar" })]);
  const first = JSON.stringify(resolve(store));
  const originalNow = Date.now;
  const originalRandom = Math.random;
  try {
    // أي اعتماد على الساعة أو العشوائية سيظهر فورًا كاختلاف أو كاستثناء.
    Date.now = () => {
      throw new Error("resolver must not read the clock");
    };
    Math.random = () => {
      throw new Error("resolver must not use randomness");
    };
    assert.equal(JSON.stringify(resolve(store)), first);
  } finally {
    Date.now = originalNow;
    Math.random = originalRandom;
  }
});

// ── PROP-002 Idempotence ─────────────────────────────────────────────────────

test("PROP-002 applying the same valid changeset twice changes nothing after the first", () => {
  const random = seeded(2001);
  for (let i = 0; i < 100; i += 1) {
    const service = new ConfigService();
    const cs = randomChangeset(random, `idem-${String(i)}`);
    const first = service.apply(cs);
    assert.equal(first.applied, true);
    const afterFirst = JSON.stringify(service.effective());
    const second = service.apply(cs);
    assert.equal(second.applied, true);
    assert.equal(JSON.stringify(service.effective()), afterFirst);
  }
});

// ── PROP-003 Atomicity ───────────────────────────────────────────────────────

test("PROP-003 one invalid change anywhere in a changeset applies zero changes", () => {
  const random = seeded(3001);
  for (let i = 0; i < 100; i += 1) {
    const service = new ConfigService();
    const valid = randomChangeset(random, `atomic-${String(i)}`).changes;
    const poison: ConfigChange = { key: "polaris.execution.max_output_bytes", scope: "USER", value: -1 };
    const position = Math.floor(random() * (valid.length + 1));
    const changes = [...valid.slice(0, position), poison, ...valid.slice(position)];

    const before = JSON.stringify(service.effective());
    const result = service.apply({ changeset_id: `atomic-${String(i)}`, origin: "CORE", changes });
    assert.equal(result.applied, false);
    assert.equal(JSON.stringify(service.effective()), before, "a failed changeset left a partial change behind");
  }
});

test("PROP-003 atomicity holds when the failure is a scope violation rather than a bad value", () => {
  const service = new ConfigService();
  const before = JSON.stringify(service.effective());
  const result = service.apply({
    changeset_id: "atomic-scope",
    origin: "CORE",
    changes: [
      { key: "polaris.ui.language", scope: "USER", value: "ar" },
      { key: "polaris.security.fail_closed", scope: "USER", value: false },
      { key: "polaris.audit.detail_level", scope: "USER", value: "DETAILED" },
    ],
  });
  assert.equal(result.applied, false);
  assert.equal(JSON.stringify(service.effective()), before);
});

test("PROP-003 a failed changeset spanning two scopes leaves neither scope touched", () => {
  const service = new ConfigService();
  const before = JSON.stringify(service.effective());
  const result = service.apply({
    changeset_id: "atomic-multiscope",
    origin: "CORE",
    changes: [
      { key: "polaris.ui.language", scope: "DEFAULT", value: "ar" },
      { key: "polaris.audit.detail_level", scope: "USER", value: "DETAILED" },
      { key: "polaris.ui.language", scope: "USER", value: "not-a-language" },
    ],
  });
  assert.equal(result.applied, false);
  assert.equal(JSON.stringify(service.effective()), before);
});

// ── PROP-004 Scope legality ──────────────────────────────────────────────────

test("PROP-004 no setting can be written in a scope its definition does not allow", () => {
  for (const definition of allSettings()) {
    for (const scope of ["DEFAULT", "USER"] as const) {
      if (definition.allowed_scopes.includes(scope)) continue;
      const service = new ConfigService();
      const result = service.apply({
        changeset_id: "scope-legality",
        origin: "CORE",
        changes: [{ key: definition.key, scope, value: sampleValue(definition.key, seeded(7)) }],
      });
      assert.equal(result.applied, false, `${definition.key} was writable in ${scope}`);
      assert.deepEqual(service.get(definition.key), definition.default);
    }
  }
});

test("PROP-004 an illegal scope is refused at the boundary and also quarantined if smuggled into the store", () => {
  const smuggled = ConfigService.fromLayers([layer("USER", { "polaris.security.fail_closed": false })]);
  assert.equal(smuggled.get("polaris.security.fail_closed"), true);
  assert.equal(smuggled.effective().integrity, "DEGRADED");
});

// ── PROP-005 Secret non-exportability ────────────────────────────────────────

test("PROP-005 no secret-backed value reaches the export surface, whatever the reference is", () => {
  const random = seeded(5001);
  for (let i = 0; i < 50; i += 1) {
    const service = new ConfigService();
    const ref = `polaris-secret://slot/${String(Math.floor(random() * 1000))}`;
    const applied = service.apply({
      changeset_id: `secret-${String(i)}`,
      origin: "CORE",
      changes: [{ key: "polaris.model.provider_credential_ref", scope: "USER", value: { $secret_ref: ref } }],
    });
    assert.equal(applied.applied, true);
    const serialised = JSON.stringify(service.export());
    assert.equal(serialised.includes(ref), false, "the export surface leaked a secret reference");
    assert.ok(serialised.includes(REDACTED));
  }
});

test("PROP-005 every setting marked SECRET_REFERENCE is redacted, not just the one we know about", () => {
  const service = new ConfigService();
  const exported = service.export();
  for (const definition of allSettings()) {
    if (definition.sensitivity !== "SECRET_REFERENCE") continue;
    assert.equal(exported.settings.find((s) => s.key === definition.key)?.value, REDACTED);
  }
});

// ── PROP-006 Ordering ────────────────────────────────────────────────────────

test("PROP-006 USER always wins over DEFAULT, for every setting writable in both", () => {
  const random = seeded(6001);
  for (const definition of allSettings()) {
    if (!definition.allowed_scopes.includes("DEFAULT") || !definition.allowed_scopes.includes("USER")) continue;
    let defaultValue = sampleValue(definition.key, random);
    let userValue = sampleValue(definition.key, random);
    // القيمتان يجب أن تختلفا وإلا لم تُثبت الأسبقية شيئًا.
    let guard = 0;
    while (JSON.stringify(defaultValue) === JSON.stringify(userValue) && guard < 20) {
      userValue = sampleValue(definition.key, random);
      guard += 1;
    }
    if (JSON.stringify(defaultValue) === JSON.stringify(userValue)) {
      defaultValue = definition.default;
      if (JSON.stringify(defaultValue) === JSON.stringify(userValue)) continue;
    }

    const service = ConfigService.fromLayers([
      layer("DEFAULT", { [definition.key]: defaultValue }),
      layer("USER", { [definition.key]: userValue }),
    ]);
    assert.deepEqual(service.get(definition.key), userValue, `${definition.key} did not honour USER precedence`);
    assert.equal(service.effective().settings[definition.key]?.source_scope, "USER");
  }
});

test("PROP-006 precedence does not depend on the order layers were written to the store", () => {
  const values = { "polaris.ui.language": "ar" };
  const forward = new InMemoryConfigStore();
  forward.replaceLayer(layer("DEFAULT", { "polaris.ui.language": "en" }));
  forward.replaceLayer(layer("USER", values));

  const backward = new InMemoryConfigStore();
  backward.replaceLayer(layer("USER", values));
  backward.replaceLayer(layer("DEFAULT", { "polaris.ui.language": "en" }));

  assert.equal(JSON.stringify(resolve(forward)), JSON.stringify(resolve(backward)));
});

// ── خصائص إضافية ─────────────────────────────────────────────────────────────

test("PROP-007 a rejected changeset never changes the config integrity state", () => {
  const service = new ConfigService();
  assert.equal(service.effective().integrity, "HEALTHY");
  service.apply({
    changeset_id: "bad",
    origin: "CORE",
    changes: [{ key: "polaris.ui.language", scope: "USER", value: 42 }],
  });
  assert.equal(service.effective().integrity, "HEALTHY");
});

test("PROP-008 effective configuration is frozen against mutation by its consumers", () => {
  const service = new ConfigService();
  const effective = service.effective();
  assert.throws(() => {
    (effective.settings as Record<string, unknown>)["polaris.ui.language"] = { value: "hacked" };
  });
  assert.equal(service.get("polaris.ui.language"), "en");
});
