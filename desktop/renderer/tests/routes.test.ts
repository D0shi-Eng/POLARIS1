// سجل المسارات، ونموذج الإتاحة، وتجميع الإعدادات.

import assert from "node:assert/strict";
import { test } from "node:test";

import { explain, present } from "../src/app/availability";
import { createTranslator } from "../src/localization/translate";
import { memoryLocation } from "../src/routes/location";
import {
  navigationCapabilityIds,
  normalisePath,
  resolveRoute,
  routeById,
  ROUTES,
  ROUTE_IDS,
} from "../src/routes/registry";
import { groupOf, groupSections, GROUP_ORDER } from "../src/settings/groups";

test("the registry declares the ten sections exactly once each", () => {
  assert.equal(ROUTES.length, 10);
  assert.equal(new Set(ROUTES.map((route) => route.id)).size, 10);
  assert.equal(new Set(ROUTES.map((route) => route.path)).size, 10);
  assert.deepEqual([...ROUTE_IDS].sort(), ROUTES.map((route) => route.id).sort());
});

test("every route names a capability the host can answer for", () => {
  for (const route of ROUTES) {
    assert.match(route.capabilityId, /^polaris\.desktop\.[a-z][a-z0-9-]*$/, route.id);
    assert.match(route.labelKey, /^nav\./, route.id);
  }
  assert.equal(new Set(navigationCapabilityIds()).size, 10);
});

test("paths normalise to one canonical shape", () => {
  assert.equal(normalisePath(""), "/");
  assert.equal(normalisePath("/"), "/");
  assert.equal(normalisePath("settings"), "/settings");
  assert.equal(normalisePath("/settings/"), "/settings");
  assert.equal(normalisePath("/settings?tab=1"), "/settings");
  assert.equal(normalisePath("/settings#frag"), "/settings");
});

test("a known path resolves and an unknown one returns nothing rather than throwing", () => {
  assert.equal(resolveRoute("/")?.id, "home");
  assert.equal(resolveRoute("/settings")?.id, "settings");
  assert.equal(resolveRoute("/nope"), undefined);
  assert.equal(resolveRoute("/../etc"), undefined);
  assert.equal(routeById("nope"), undefined);
});

test("the in-memory location port notifies subscribers exactly on change", () => {
  const port = memoryLocation("/");
  let calls = 0;
  const stop = port.subscribe(() => {
    calls += 1;
  });
  port.write("/settings");
  port.write("/settings");
  assert.equal(port.read(), "/settings");
  assert.equal(calls, 1);
  stop();
  port.write("/");
  assert.equal(calls, 1);
});

test("availability presentation couples state and reason the way the contract does", () => {
  const available = present({ state: "AVAILABLE" });
  assert.equal(available.reasonKey, null);
  assert.equal(available.actionable, true);
  assert.equal(available.tone, "POSITIVE");

  const unavailable = present({ state: "UNAVAILABLE", reason: "PHASE_NOT_IMPLEMENTED" });
  assert.equal(unavailable.reasonKey, "availability.reason.PHASE_NOT_IMPLEMENTED");
  assert.equal(unavailable.actionable, false);

  // غياب الجواب ليس متاحًا.
  const absent = present(undefined);
  assert.equal(absent.state, "ERROR");
  assert.equal(absent.actionable, false);
});

test("the explanation is one interpolated sentence, not a concatenation", () => {
  const translator = createTranslator("en");
  const sentence = explain(translator, present({ state: "UNAVAILABLE", reason: "PROVIDER_NOT_CONFIGURED" }));
  assert.equal(sentence, "Unavailable — no provider is configured");
  assert.equal(explain(translator, present({ state: "AVAILABLE" })), "Available");
});

test("settings sections group by their declared prefix, in declared order", () => {
  assert.equal(groupOf("general.appearance"), "general");
  assert.equal(groupOf("security.data-egress"), "security");

  const groups = groupSections([
    { section_id: "security.audit", label_key: "k", mode: "READ_ONLY", settings: [] },
    { section_id: "general.startup", label_key: "k", mode: "READ_ONLY", settings: [] },
    { section_id: "general.appearance", label_key: "k", mode: "READ_ONLY", settings: [] },
  ]);
  assert.deepEqual(groups.map((group) => group.id), ["general", "security"]);
  assert.equal(groups[0]?.sections.length, 2);
  assert.ok(GROUP_ORDER.includes("advanced"));
});

test("an unknown group prefix sorts last instead of disappearing", () => {
  const groups = groupSections([
    { section_id: "zeta.thing", label_key: "k", mode: "READ_ONLY", settings: [] },
    { section_id: "general.appearance", label_key: "k", mode: "READ_ONLY", settings: [] },
  ]);
  assert.deepEqual(groups.map((group) => group.id), ["general", "zeta"]);
});
