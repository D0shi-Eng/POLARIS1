// Phase-06 في العارض: الموصلات، ولوحة الإعدادات، والرصد، والاستعمال والكلفة.
//
// ما تثبته هذه الاختبارات أن الشاشات لا تكذب ولا تمنح:
//   ١ — لا مسار تنفيذ موصل في العارض، ولا مسار يكشف مفتاحًا: ثمانٍ وعشرون عملية بلا واحدة منها.
//   ٢ — الموصل يُسجَّل معطَّلًا، والتفعيل نقرة ثانية، والإزالة تُسأل عنها.
//   ٣ — ما تُعيده الخدمة يُعرض نصًّا موسومًا غير موثوق، لا عنصرًا.
//   ٤ — الصحّة مجهولة حتى تُقاس في هذا الإقلاع.
//   ٥ — كل قيمة فعّالة تعرض مصدرها، والتوسيع المرفوض يُعرض رفضًا، والمقفل لا محرّر له.
//   ٦ — الكلفة بمصدرها وعملتها: لا جمع لتقدير مع تقرير، ولا تحويل.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { PHASE06_IPC_REGISTRY } from "../src/generated/contract-bundle";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase04Client } from "../src/ipc/p04-client";
import { Phase06Client } from "../src/ipc/p06-client";
import { PHASE06_OPERATIONS } from "../src/ipc/operations";
import { CATALOGS } from "../src/localization/catalog";
import { createTranslator, keysOf, MissingKeyRecorder } from "../src/localization/translate";
import { formatMicros, inputToValue, invocationTone, provenanceTone, sameValue } from "../src/p06/present";
import { memoryLocation, type LocationPort } from "../src/routes/location";
import { resolveRoute, ROUTES } from "../src/routes/registry";
import { ConnectorActionNote } from "../src/screens/p06/ConnectorApproval";
import { TranslatorProvider } from "../src/app/context";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase06Host, HOSTILE_SUMMARY, P06_IDS, type FakePhase06Log, type FakePhase06Options } from "./support/fake-p06-host";

const en = createTranslator("en");

async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

interface Mounted {
  readonly log: FakePhase06Log;
  readonly location: LocationPort;
  unmount(): void;
}

async function mount(path: string, options: FakePhase06Options = {}): Promise<Mounted> {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const { transport, log } = fakePhase06Host(options);
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const phase04 = new Phase04Client({ transport, identity: IDENTITY });
  const phase06 = new Phase06Client({ transport, identity: IDENTITY });
  const location = memoryLocation(path);
  await act(async () => {
    root.render(<AppRoot client={client} phase04={phase04} phase06={phase06} location={location} />);
  });
  await settle();
  return { log, location, unmount: () => act(() => root.unmount()) };
}

function body(): string {
  return document.body.textContent ?? "";
}

async function click(element: Element | null | undefined): Promise<void> {
  assert.ok(element !== null && element !== undefined, "the element to click is absent");
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle();
}

async function type(element: Element | null | undefined, value: string): Promise<void> {
  assert.ok(element !== null && element !== undefined, "the field is absent");
  const field = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  await act(async () => {
    const prototype = field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await settle(2);
}

function payloadOf(log: FakePhase06Log, operation: string): Record<string, unknown> | undefined {
  const index = log.operations.lastIndexOf(operation);
  return index < 0 ? undefined : log.payloads[index];
}

// ——— العقد: المفردات والسطح.

test("P06-UI-001 the renderer knows exactly the thirty routed Phase-06 operations on envelope 1.6", () => {
  const names = PHASE06_OPERATIONS.map((record) => record.operation).sort();
  // 28 + connector.preset.list و connector.preset.register (PHASE-05).
  assert.equal(names.length, 30);
  for (const record of PHASE06_OPERATIONS) assert.equal(record.envelope_version, "1.6");
  for (const record of PHASE06_IPC_REGISTRY.operations) {
    for (const forbidden of ["connector.invoke", "connector.execute", "connector.call", "connector.credential.get", "connector.credential.reveal", "config.secret.get"]) {
      assert.notEqual(record.operation, forbidden);
    }
  }
});

test("P06-UI-002 the client exposes no method that runs a connector operation or reveals a key", () => {
  const surface = Object.getOwnPropertyNames(Phase06Client.prototype);
  for (const name of ["invoke", "invokeConnector", "execute", "call_operation", "getCredential", "revealCredential", "readSecret", "secretValue"]) {
    assert.ok(!surface.includes(name), `Phase06Client exposes ${name}`);
  }
  assert.equal(surface.filter((name) => name !== "constructor" && name !== "call").length, 30);
});

test("P06-UI-003 observability screens are secondary routes under Activity, and the sidebar keeps its ten sections", () => {
  assert.equal(ROUTES.length, 10);
  for (const path of ["/health", "/events", "/usage", "/diagnostics"]) {
    const route = resolveRoute(path);
    assert.equal(route?.parentId, "activity", path);
    assert.equal(route?.capabilityId, "polaris.desktop.activity", path);
  }
  assert.equal(resolveRoute("/settings/host")?.parentId, "settings");
});

// ——— الموصلات.

test("P06-UI-010 the Connectors page shows the service connectors and keeps the tool servers below them", async () => {
  const mounted = await mount("/connectors");
  try {
    assert.equal(document.querySelector(".page-title")?.textContent, en.t("ui.rail.addons"));
    const card = document.querySelector(`li.mp-addon[data-connector-id="${P06_IDS.CONNECTOR}"]`);
    assert.ok(card !== null, "the add-ons catalog does not list the registered connector");
    assert.ok(card.querySelector("button.mp-addon__add") !== null, "a disabled connector offers no add control");
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    // مانوس 2.0 (2026-10-05): «إدارة الموصلات» تفتح «الموصلات» بأدواتها الكاملة، ورجوع إلى «الإضافات».
    assert.equal(document.querySelector(".page-title")?.textContent, en.t("nav.connectors"));
    assert.ok(body().includes(en.t("conn.note.secret")));
    assert.ok(body().includes(en.t("mcp.embedded.title")));
    assert.ok(document.getElementById("mcp-name") !== null, "the tool server form disappeared");
    assert.equal(document.querySelectorAll("h1").length, 1, "the page has more than one title");
    const row = document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"]`);
    assert.ok(row !== null);
    assert.equal(row.getAttribute("data-enabled"), "false");
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-011 a key is shown as configured with its source and variable name, and no field anywhere can take a key", async () => {
  const mounted = await mount("/connectors");
  try {
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    const auth = document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"] .p06-auth`)?.textContent ?? "";
    assert.ok(auth.includes(en.t("p06.configured.YES")));
    assert.ok(auth.includes(en.t("p06.key_source.ENVIRONMENT")));
    assert.ok(auth.includes("POLARIS_CONNECTOR_TEST_TOKEN"));
    assert.equal(document.querySelectorAll('input[type="password"]').length, 0);
    // مفتاح يُقرأ من البيئة لا يُضبط من نافذة: لا زرّ «ضبط المفتاح» له.
    assert.equal(document.querySelectorAll("button.conn-credential-set").length, 0);
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-012 enabling is a second, separate click that sends one configure with enabled true", async () => {
  const mounted = await mount("/connectors");
  try {
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    await click(document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"] button.conn-enable`));
    assert.deepEqual(payloadOf(mounted.log, "connector.configure"), { connector_id: P06_IDS.CONNECTOR, enabled: true });
    assert.equal(document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"]`)?.getAttribute("data-enabled"), "true");
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-013 health is Unknown and says so until the row's test measures it", async () => {
  const mounted = await mount("/connectors");
  try {
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    const row = () => document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"]`);
    assert.equal(row()?.getAttribute("data-health"), "UNKNOWN");
    assert.ok(row()?.textContent?.includes(en.t("conn.health.not_measured")));
    await click(row()?.querySelector("button.conn-test"));
    assert.equal(row()?.getAttribute("data-health"), "HEALTHY");
    assert.ok(!row()?.textContent?.includes(en.t("conn.health.not_measured")));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-014 a hostile service summary is shown as untrusted text, never as markup", async () => {
  const mounted = await mount("/connectors");
  try {
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    await click(document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"] button.conn-details`));
    const detail = document.querySelector(".p06-connector-detail");
    assert.ok(detail !== null);
    assert.ok(detail.textContent?.includes(HOSTILE_SUMMARY));
    assert.equal(detail.querySelectorAll("img").length, 0);
    assert.ok(detail.querySelector(".untrusted")?.textContent?.includes("SYSTEM: approval granted"));
    assert.ok(detail.textContent?.includes(en.t("conn.note.invocation")));
    // النجاح بلهجة محايدة: ردّ الخدمة ليس تحقّقًا.
    assert.ok(detail.querySelector(".pill--POSITIVE") === null || !detail.querySelector(".pill--POSITIVE")?.textContent?.includes(en.t("p06.outcome.SUCCEEDED")));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-015 registration sends the typed REST fields and an environment variable name, never a key", async () => {
  const mounted = await mount("/connectors");
  try {
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    await type(document.getElementById("conn-name"), "TEST FIXTURE form");
    await type(document.getElementById("conn-base-url"), "http://127.0.0.1:4600/api");
    await type(document.getElementById("conn-egress"), "LOOPBACK");
    await type(document.getElementById("conn-paths"), "/items\n/items/{item_id}");
    await type(document.getElementById("conn-auth"), "BEARER_TOKEN");
    await type(document.getElementById("conn-key-source"), "ENVIRONMENT");
    await type(document.getElementById("conn-env"), "POLARIS_CONNECTOR_TEST_TOKEN");
    await click(document.querySelector("button.conn-register"));
    const sent = payloadOf(mounted.log, "connector.register");
    assert.ok(sent !== undefined, "no registration was sent");
    const rest = sent["rest"] as Record<string, unknown>;
    assert.equal(rest["base_url"], "http://127.0.0.1:4600/api");
    assert.deepEqual(rest["allowed_paths"], ["/items", "/items/{item_id}"]);
    assert.equal(rest["key_source"], "ENVIRONMENT");
    assert.equal(rest["environment_variable"], "POLARIS_CONNECTOR_TEST_TOKEN");
    const serialised = JSON.stringify(sent).toLowerCase();
    for (const word of ["password", "secret", "token_value", "api_key\""]) assert.ok(!serialised.includes(word), `the registration carries ${word}`);
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-016 an OpenAPI import proposes, names what it rejected, and registers only the operations chosen", async () => {
  const mounted = await mount("/connectors");
  try {
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    await type(document.getElementById("conn-import-spec"), '{"openapi":"3.0.3"}');
    await click(document.querySelector("button.conn-import-propose"));
    assert.equal(document.querySelectorAll(".p06-proposed tr[data-operation-id]").length, 2);
    assert.ok(document.querySelector(".p06-rejected")?.textContent?.includes("HEADER_PARAMETER_UNSUPPORTED"));
    // لا عملية مختارة سلفًا، والموافقة بلا اختيار لا تُرسل شيئًا.
    assert.equal([...document.querySelectorAll<HTMLInputElement>("input.conn-import-choose")].filter((box) => box.checked).length, 0);
    await click(document.querySelector("button.conn-import-approve"));
    assert.equal(mounted.log.operations.includes("connector.openapi.approve"), false);
    await click(document.querySelector('.p06-proposed tr[data-operation-id="items.get"] input.conn-import-choose'));
    await click(document.querySelector("button.conn-import-approve"));
    const sent = payloadOf(mounted.log, "connector.openapi.approve");
    assert.deepEqual(sent?.["operation_ids"], ["items.get"]);
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-017 removal is asked about first, and cancelling sends nothing", async () => {
  const mounted = await mount("/connectors");
  try {
    // مانوس 2.0: الإدارة الكاملة خلف «إدارة الموصلات».
    await click(document.querySelector("button.addons-manage"));
    await click(document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"] button.conn-remove`));
    assert.ok(document.querySelector('[role="alertdialog"]') !== null);
    await click([...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((b) => b.textContent === en.t("conn.remove.cancel")));
    assert.equal(mounted.log.operations.includes("connector.remove"), false);
    await click(document.querySelector(`tr[data-connector-id="${P06_IDS.CONNECTOR}"] button.conn-remove`));
    await click(document.querySelector("button.conn-remove-confirm"));
    assert.deepEqual(payloadOf(mounted.log, "connector.remove"), { connector_id: P06_IDS.CONNECTOR });
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-018 a connector approval says what approving means: one call, these arguments, no automatic retry", async () => {
  const container = resetDocument();
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TranslatorProvider translator={en}>
        <ConnectorActionNote action="CONNECTOR_SEND" />
        <ConnectorActionNote action="POLARIS_WEB_NAVIGATE" />
      </TranslatorProvider>,
    );
  });
  try {
    const notes = document.querySelectorAll(".p06-approval-note");
    assert.equal(notes.length, 1, "a note was shown for an action that is not a connector action");
    assert.equal(notes[0]?.getAttribute("data-connector-action"), "SEND");
    assert.ok(notes[0]?.textContent?.includes(en.t("p06.action.SEND")));
    assert.ok(notes[0]?.textContent?.includes(en.t("conn.approval.side_effect")));
  } finally {
    act(() => root.unmount());
  }
});

// ——— لوحة الإعدادات.

test("P06-UI-020 the settings control plane lists nineteen sections and shows each value with its source", async () => {
  const mounted = await mount("/settings");
  try {
    assert.equal(document.querySelectorAll("button.cfg-section").length, 19);
    const row = document.querySelector('.p06-setting[data-setting-key="general.activity_page_size"]');
    assert.ok(row !== null);
    assert.equal(row.getAttribute("data-source"), "DEFAULT");
    assert.ok(row.textContent?.includes(en.t("p06.source.DEFAULT")));
    assert.ok(row.textContent?.includes(en.t("config.setting.general.activity_page_size")));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-021 a locked setting and a setting this build lacks have no editor and say why", async () => {
  const mounted = await mount("/settings");
  try {
    await click(document.querySelector('button.cfg-section[data-section="BROWSER"]'));
    const locked = document.querySelector('.p06-setting[data-setting-key="browser.private_network_allowed"]');
    assert.ok(locked?.textContent?.includes(en.t("cfg.state.LOCKED")));
    assert.equal(locked?.querySelectorAll(".cfg-input").length, 0);
    assert.ok(locked?.textContent?.includes(en.t("p06.security.BEARING")));
    await click(document.querySelector('button.cfg-section[data-section="ADVANCED"]'));
    const later = document.querySelector('.p06-setting[data-setting-key="advanced.cloud_telemetry"]');
    assert.ok(later?.textContent?.includes(en.t("cfg.state.UNAVAILABLE_THIS_PHASE")));
    assert.equal(later?.querySelectorAll(".cfg-input").length, 0);
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-022 saving a value sends one typed config.set and the row then names its source", async () => {
  const mounted = await mount("/settings");
  try {
    await click(document.querySelector('button.cfg-section[data-section="CONNECTORS"]'));
    const row = () => document.querySelector('.p06-setting[data-setting-key="connectors.side_effect_policy"]');
    await type(row()?.querySelector(".cfg-input"), "DENY");
    await click(row()?.querySelector("button.cfg-save"));
    assert.deepEqual(payloadOf(mounted.log, "config.set"), { layer: "USER", key: "connectors.side_effect_policy", value: "DENY" });
    assert.equal(row()?.getAttribute("data-source"), "USER");
    await click(row()?.querySelector("button.cfg-reset"));
    assert.deepEqual(payloadOf(mounted.log, "config.reset"), { layer: "USER", key: "connectors.side_effect_policy" });
    assert.equal(row()?.getAttribute("data-source"), "DEFAULT");
  } finally {
    mounted.unmount();
  }
});

// قرار المالك 2026-10-06: لا محدّد «تُكتب القيم في» في أي صفحة. القيمة تُكتب في طبقة المستخدم، وحدود الأمن يفرضها المضيف
// كما كانت (اختبارات المضيف تقيسها)؛ الصفحة لا تعرض طبقة ولا معرّف نطاق.
test("P06-UI-023 there is no layer picker: a value is saved to the user layer with no scope", async () => {
  const mounted = await mount("/settings");
  try {
    await click(document.querySelector('button.cfg-section[data-section="CONNECTORS"]'));
    const key = "connectors.max_external_calls_per_mission";
    const row = () => document.querySelector(`.p06-setting[data-setting-key="${key}"]`);
    assert.equal(document.getElementById("cfg-layer"), null, "the layer picker is back");
    assert.equal(document.getElementById("cfg-scope"), null, "the scope field is back");
    assert.ok(!document.body.textContent?.includes(en.t("cfg.scope.legend")), "the layer legend is back");
    await type(row()?.querySelector(".cfg-input"), "5");
    await click(row()?.querySelector("button.cfg-save"));
    assert.deepEqual(payloadOf(mounted.log, "config.set"), { layer: "USER", key, value: 5 });
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-024 settings saved by a newer version are announced, and defaults are shown", async () => {
  const mounted = await mount("/settings", { newerConfig: true });
  try {
    const alert = document.querySelector(".p06-config-status");
    assert.equal(alert?.getAttribute("data-config-state"), "UNSUPPORTED_VERSION");
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-025 the frozen host settings view stays reachable at its own route", async () => {
  const mounted = await mount("/settings/host");
  try {
    assert.ok(document.querySelector(".settings__index") !== null, "the host settings view is gone");
    assert.equal(document.querySelectorAll("button.cfg-section").length, 0);
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-026 theme, density and language saved in the control plane apply to the document at once", async () => {
  const mounted = await mount("/settings");
  try {
    await click(document.querySelector('button.cfg-section[data-section="APPEARANCE"]'));
    const theme = () => document.querySelector('.p06-setting[data-setting-key="appearance.theme"]');
    // السمة بطاقات تُحفظ عند النقر، بلا زرّ «حفظ».
    assert.equal(theme()?.querySelectorAll("button.cfg-save").length, 0);
    await click(theme()?.querySelector('button.cfg-theme[data-option="DARK"]'));
    assert.deepEqual(payloadOf(mounted.log, "config.set"), { layer: "USER", key: "appearance.theme", value: "DARK" });
    assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
    assert.equal(theme()?.querySelector('button.cfg-theme[data-option="DARK"]')?.getAttribute("aria-checked"), "true");
    const density = () => document.querySelector('.p06-setting[data-setting-key="appearance.density"]');
    await type(density()?.querySelector(".cfg-input"), "COMPACT");
    await click(density()?.querySelector("button.cfg-save"));
    assert.equal(document.documentElement.getAttribute("data-density"), "compact");
    await click(document.querySelector('button.cfg-section[data-section="LANGUAGE"]'));
    const locale = () => document.querySelector('.p06-setting[data-setting-key="language.locale"]');
    await type(locale()?.querySelector(".cfg-input"), "ar");
    await click(locale()?.querySelector("button.cfg-save"));
    assert.equal(document.documentElement.getAttribute("dir"), "rtl");
    assert.equal(document.querySelector(".page-title")?.textContent, createTranslator("ar").t("nav.settings"));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-027 keys are listed as configured, source and last update, with no way to reveal one", async () => {
  const mounted = await mount("/settings");
  try {
    await click(document.querySelector('button.cfg-section[data-section="SECURITY"]'));
    const listed = document.querySelector(`tr[data-sensitive-subject="connector:${P06_IDS.CONNECTOR}"]`);
    assert.ok(listed?.textContent?.includes(en.t("p06.configured.YES")));
    assert.equal(listed?.querySelectorAll("button").length, 0);
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-028 budgets and prices are set from their sections with typed payloads", async () => {
  const mounted = await mount("/settings");
  try {
    await click(document.querySelector('button.cfg-section[data-section="BUDGETS"]'));
    await type(document.getElementById("budget-scope"), "CONNECTOR");
    await type(document.getElementById("budget-key"), P06_IDS.CONNECTOR);
    await type(document.getElementById("budget-dimension"), "EXTERNAL_CALLS");
    await type(document.getElementById("budget-limit"), "1");
    await type(document.getElementById("budget-mode"), "SOFT");
    await click(document.querySelector("button.budget-save"));
    assert.deepEqual(payloadOf(mounted.log, "budget.set"), { scope: "CONNECTOR", scope_key: P06_IDS.CONNECTOR, dimension: "EXTERNAL_CALLS", limit: 1, mode: "SOFT" });
    assert.ok(document.querySelector('tr[data-budget-state="EXCEEDED"]') !== null);
    await click(document.querySelector('button.cfg-section[data-section="COST"]'));
    assert.ok(body().includes(en.t("pricing.note")));
    await type(document.getElementById("pricing-target-id"), "local-openai-compatible:fixture-chat");
    await type(document.getElementById("pricing-amount"), "2.5");
    await type(document.getElementById("pricing-currency"), "usd");
    await type(document.getElementById("pricing-source"), "TEST FIXTURE price");
    await click(document.querySelector("button.pricing-save"));
    const sent = payloadOf(mounted.log, "pricing.set");
    assert.equal(sent?.["amount"], "2.5");
    assert.equal(sent?.["currency"], "USD");
    assert.equal(sent?.["source_note"], "TEST FIXTURE price");
    assert.ok(document.querySelector(".p06-pricing-table")?.textContent?.includes(en.t("p06.provenance.ESTIMATED")));
  } finally {
    mounted.unmount();
  }
});

// ——— الرصد والاستعمال.

test("P06-UI-030 the Usage screen keeps each amount in its own currency and provenance", async () => {
  const mounted = await mount("/usage");
  try {
    const connector = document.querySelector(`.p06-usage-connector tr[data-usage-key="${P06_IDS.CONNECTOR}"]`);
    assert.ok(connector !== null);
    const buckets = [...connector.querySelectorAll("[data-provenance]")].map((node) => `${node.getAttribute("data-currency") ?? ""}:${node.getAttribute("data-provenance") ?? ""}`);
    assert.deepEqual(buckets, ["USD:PROVIDER_REPORTED", "EUR:ESTIMATED"]);
    assert.ok(connector.textContent?.includes(en.t("p06.provenance.PROVIDER_REPORTED")));
    assert.ok(connector.textContent?.includes(en.t("p06.provenance.ESTIMATED")));
    assert.ok(document.querySelector('.p06-usage-record-table tr[data-cost-provenance="UNKNOWN"]')?.textContent?.includes(en.t("usage.cost.unknown")));
    assert.ok(body().includes(en.t("usage.note.no_conversion")));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-031 System health shows each part with its state, alerts and counters since this start", async () => {
  const mounted = await mount("/health");
  try {
    assert.equal(document.querySelector(".page-title")?.textContent, en.t("nav.health"));
    assert.equal(document.querySelector(`.p06-health-table tr[data-subject="CONNECTOR"]`)?.getAttribute("data-health"), "UNKNOWN");
    assert.ok(document.querySelector('.p06-alert-list li[data-alert-kind="BUDGET_EXCEEDED"]') !== null);
    assert.ok(document.querySelector('[data-counter="connector_calls"]')?.textContent?.includes(en.t("obs.counter.connector_calls")));
    assert.ok(document.querySelector('.p06-errors tr[data-error-code="RATE_LIMITED"]') !== null);
    assert.ok(body().includes(en.t("obs.metrics.note")));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-032 structured events say they are diagnostic, not audit, and show codes only", async () => {
  const mounted = await mount("/events");
  try {
    assert.ok(body().includes(en.t("obs.events.note")));
    const row = document.querySelector('.p06-events tr[data-event-operation="connector.invoke"]');
    assert.ok(row?.textContent?.includes("BUDGET_EXHAUSTED"));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-033 diagnostics are written locally from one button with an empty request", async () => {
  const mounted = await mount("/diagnostics");
  try {
    assert.ok(body().includes(en.t("diag.note.local")));
    await click(document.querySelector("button.diag-export"));
    assert.deepEqual(payloadOf(mounted.log, "diagnostics.export"), {});
    assert.ok(document.querySelector(".diag-file")?.textContent?.startsWith("polaris-diagnostics-"));
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-034 the Activity page links to the observability screens", async () => {
  const mounted = await mount("/activity");
  try {
    for (const path of ["health", "events", "usage", "diagnostics"]) {
      assert.ok(document.querySelector(`.obs-link-${path}`) !== null, `no link to ${path}`);
    }
    await click(document.querySelector(".obs-link-usage"));
    assert.equal(mounted.location.read(), "/usage");
  } finally {
    mounted.unmount();
  }
});

test("QA-A11Y-01 the observability link for the open screen is marked as the current page", async () => {
  const mounted = await mount("/usage");
  try {
    assert.equal(document.querySelector(".obs-link-usage")?.getAttribute("aria-current"), "page");
    assert.equal(document.querySelector(".obs-link-health")?.getAttribute("aria-current"), null);
  } finally {
    mounted.unmount();
  }
});

// ——— العرض والترجمة.

test("P06-UI-040 presentation never gives a connector success or a cost a success tone, and parses typed values", () => {
  assert.notEqual(invocationTone("SUCCEEDED"), "POSITIVE");
  assert.notEqual(invocationTone("REPLAYED"), "POSITIVE");
  assert.equal(invocationTone("OUTCOME_UNKNOWN"), "WARNING");
  for (const provenance of ["PROVIDER_REPORTED", "LOCALLY_MEASURED", "ESTIMATED", "UNKNOWN"]) assert.notEqual(provenanceTone(provenance), "POSITIVE");
  const integer = { kind: "INTEGER" } as Parameters<typeof inputToValue>[0];
  assert.equal(inputToValue(integer, "12"), 12);
  assert.equal(inputToValue(integer, "1.5"), null);
  assert.equal(inputToValue({ kind: "DECIMAL" } as Parameters<typeof inputToValue>[0], "2.500000"), "2.500000");
  assert.equal(inputToValue({ kind: "BOOLEAN" } as Parameters<typeof inputToValue>[0], "maybe"), null);
  assert.ok(sameValue(["a"], ["a"]));
  assert.ok(formatMicros(1200, "USD", "en").includes("0.0012"));
});

test("P06-UI-041 every member of every closed Phase-06 vocabulary has an Arabic and an English key", () => {
  const vocabularies: Readonly<Record<string, readonly string[]>> = {
    category: ["EMAIL", "CALENDAR", "FILES", "MESSAGING", "PROJECT_MANAGEMENT", "CODE_HOSTING", "DATABASE", "CUSTOM_API"],
    connector_status: ["REGISTERED", "ENABLED", "DISABLED"],
    egress: ["PUBLIC_HTTPS", "LOOPBACK", "NONE"],
    auth_mode: ["NONE", "API_KEY", "BEARER_TOKEN", "BASIC", "OAUTH2"],
    key_source: ["NONE", "CREDENTIAL_STORE", "ENVIRONMENT"],
    health: ["UNKNOWN", "HEALTHY", "DEGRADED", "UNHEALTHY", "UNAVAILABLE"],
    action: ["READ", "WRITE", "DELETE", "SEND", "PUBLISH", "CREATE_EXTERNAL_RESOURCE", "MODIFY_EXTERNAL_RESOURCE"],
    outcome: ["SUCCEEDED", "FAILED", "DENIED", "CANCELLED", "REPLAYED", "OUTCOME_UNKNOWN"],
    provenance: ["PROVIDER_REPORTED", "LOCALLY_MEASURED", "ESTIMATED", "UNKNOWN"],
    budget_scope: ["MISSION", "PROJECT", "DAY", "PROVIDER", "CONNECTOR"],
    dimension: ["COST_MICROS", "MODEL_TOKENS", "EXTERNAL_CALLS"],
    budget_state: ["WITHIN", "NEAR_LIMIT", "AT_LIMIT", "EXCEEDED"],
    subject: ["PROVIDER", "CONNECTOR", "STORAGE", "BROWSER", "COMPUTER", "MEMORY", "TOOL_GATEWAY", "AGENT_RUNTIME", "CONFIG"],
    component: ["CONNECTOR_GATEWAY", "CONNECTOR", "MODEL", "TOOL", "BROWSER", "COMPUTER", "MEMORY", "MISSION", "BUDGET", "COST", "CONFIG", "STORAGE", "HEALTH", "DIAGNOSTICS"],
    alert: ["BUDGET_NEAR_LIMIT", "BUDGET_EXCEEDED", "PROVIDER_UNHEALTHY", "CONNECTOR_UNHEALTHY", "ERROR_SPIKE", "STORAGE_ISSUE"],
    layer: ["USER", "PROJECT", "MISSION", "SECURITY"],
    source: ["DEFAULT", "USER", "PROJECT", "MISSION", "SECURITY_CLAMP"],
    applies: ["NEXT_OPERATION", "NEXT_MISSION", "IMMEDIATELY"],
  };
  const missing: string[] = [];
  for (const locale of ["ar", "en"] as const) {
    for (const [namespace, members] of Object.entries(vocabularies)) {
      for (const member of members) {
        const key = `p06.${namespace}.${member}`;
        if (CATALOGS[locale][key] === undefined) missing.push(`${locale}:${key}`);
      }
    }
    for (const section of ["GENERAL", "APPEARANCE", "LANGUAGE", "MODELS", "PROVIDERS", "AGENTS", "SKILLS", "TOOLS", "MCP", "MEMORY", "BROWSER", "COMPUTER", "CONNECTORS", "PRIVACY", "SECURITY", "BUDGETS", "COST", "OBSERVABILITY", "ADVANCED"]) {
      for (const key of [`config.section.${section}`, `cfg.section_hint.${section}`]) if (CATALOGS[locale][key] === undefined) missing.push(`${locale}:${key}`);
    }
  }
  assert.deepEqual(missing, [], `untranslated Phase-06 vocabulary members:\n${missing.join("\n")}`);
});

test("P06-UI-042 the Phase-06 keys are declared in both proven locales with no English placeholder in Arabic", () => {
  const prefixes = ["p06.", "conn.", "cfg.", "config.", "obs.", "usage.", "budget.", "pricing.", "diag."];
  const ar = keysOf("ar").filter((key) => prefixes.some((p) => key.startsWith(p)));
  const enKeys = keysOf("en").filter((key) => prefixes.some((p) => key.startsWith(p)));
  assert.deepEqual([...ar].sort(), [...enKeys].sort());
  assert.ok(ar.length >= 500, `only ${ar.length} Phase-06 keys exist, which suggests a partial catalog`);
  // رموز تقنية تُكتب كما هي في كل لغة.
  const technical = new Set(["conn.http_status", "p06.auth_mode.OAUTH2"]);
  const untranslated = ar.filter((key) => !technical.has(key) && CATALOGS["ar"][key] === CATALOGS["en"][key]);
  assert.deepEqual(untranslated, [], `Arabic still carries the English string for: ${untranslated.join(", ")}`);
});

test("P06-UI-043 a chosen fallback language fills an untranslated key before English does", () => {
  const recorder = new MissingKeyRecorder();
  const german = createTranslator("de", recorder, "ar");
  assert.equal(german.t("conn.title"), CATALOGS["ar"]["conn.title"]);
  assert.equal(createTranslator("de", recorder).t("conn.title"), CATALOGS["en"]["conn.title"]);
  assert.equal(recorder.size, 0);
});

test("P06-UI-044 every Phase-06 screen renders in Arabic and English with no missing key", async () => {
  for (const locale of ["en", "ar"] as const) {
    for (const path of ["/connectors", "/settings", "/health", "/events", "/usage", "/diagnostics"]) {
      const mounted = await mount(path);
      try {
        const select = document.getElementById("session-locale") as HTMLSelectElement | null;
        if (locale === "ar" && select !== null) await type(select, "ar");
        const translator = createTranslator(locale);
        const texts = document.body.textContent ?? "";
        // مفتاح مفقود يُعرض كما هو؛ فلا يظهر نصّ يشبه مفتاحًا من مجالات Phase-06.
        const leaked = texts.match(/\b(?:conn|cfg|obs|usage|budget|pricing|diag|p06|config)\.[a-z_]+\.[a-zA-Z_.]+/g) ?? [];
        assert.deepEqual(leaked, [], `${locale} ${path} shows raw keys: ${leaked.join(", ")}`);
        assert.equal(document.documentElement.getAttribute("dir"), locale === "ar" ? "rtl" : "ltr");
        assert.ok((document.querySelector(".page-title")?.textContent ?? "") !== "" && translator.locale === locale);
      } finally {
        mounted.unmount();
      }
    }
  }
});

// قرار المالك (2026-09-30): حقائق البناء والجهاز تنتقل من الرئيسية إلى «الإعدادات ← حول».
test("P06-UI-ABOUT Settings > About shows the host's build facts", async () => {
  const mounted = await mount("/settings");
  try {
    const about = document.querySelector<HTMLButtonElement>("button.cfg-about");
    assert.ok(about !== null, "no About entry in Settings");
    await act(async () => {
      about.click();
    });
    await settle();
    const text = document.body.textContent ?? "";
    assert.ok(text.includes("0.1.0"), "the version is not in About");
    assert.ok(text.includes("WINDOWS"), "the platform is not in About");
  } finally {
    mounted.unmount();
  }
});

test("P06-UI-045 Esc closes the settings dialog and returns to the page behind it", async () => {
  const mounted = await mount("/connectors");
  try {
    await act(async () => mounted.location.write("/settings"));
    await settle();
    assert.ok(document.querySelector(".settings-dialog") !== null, "the settings dialog did not open");
    await act(async () => {
      const view = document.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent };
      document.body.dispatchEvent(new view.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    assert.ok(document.querySelector(".settings-dialog") === null, "Esc left the settings dialog open");
    assert.equal(mounted.location.read(), "/connectors");
  } finally {
    mounted.unmount();
  }
});

// PHASE-05 (2026-10-20): الإعدادات الجاهزة تعبر الحدّ كما يقبلها العقد، والتسجيل لا يحمل عنوانًا ولا ترويسة ولا اعتمادًا.
test("CP05-UI-001 presets pass the contract and registering one sends only its id and name", async () => {
  const { transport, log } = fakePhase06Host();
  const client = new Phase06Client({ transport, identity: IDENTITY });
  const listed = await client.listPresets();
  assert.ok(listed.ok, "the preset list did not pass the result contract");
  if (!listed.ok) return;
  assert.equal(listed.value.presets[0]?.preset_id, "slack.read");
  assert.ok(listed.value.presets[0]?.operations.every((o) => o.action === "READ"), "a preset offers a non-read operation");
  const registered = await client.registerPreset("slack.read", "Team Slack");
  assert.ok(registered.ok, "the preset registration did not pass the contract");
  if (!registered.ok) return;
  assert.equal(registered.value.connector.descriptor.enabled, false, "a preset connector was registered enabled");
  const sent = payloadOf(log, "connector.preset.register");
  assert.deepEqual(Object.keys(sent ?? {}).sort(), ["display_name", "preset_id"]);
});

// ——— PHASE-12: القوالب، والصلاحيات، ونصّ خوادم الأدوات الصادق.

test("CP12-UI-01 Create offers the built-in templates, and Add registers one without connecting anything", async () => {
  const mounted = await mount("/connectors");
  try {
    await click([...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === en.t("ui.addons.create")));
    await click([...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent ?? "").includes(en.t("ui.addons.create.preset"))));
    const preset = document.querySelector('[data-preset-id="slack.read"]');
    assert.ok(preset !== null, "the Slack template is not listed");
    const text = preset.textContent ?? "";
    assert.ok(text.includes("List channels") && text.includes(en.t("p06.action.READ")), "the template does not say what it reads");
    assert.ok(text.includes(en.t("p06.auth_mode.BEARER_TOKEN")), "the template does not say how it authenticates");
    assert.ok(text.includes("Bot User OAuth Token"), "the setup requirement is not shown");
    assert.equal(mounted.log.operations.filter((o) => o === "connector.preset.register").length, 0, "a template was registered before the click");
    await click(preset.querySelector("button"));
    assert.deepEqual(payloadOf(mounted.log, "connector.preset.register"), { preset_id: "slack.read" });
    assert.ok(body().includes(en.t("ui.addons.preset.added")), "the result does not say the key is still needed");
    assert.equal(document.querySelector('[data-preset-id="slack.read"]'), null, "the sheet stayed open after adding");
  } finally {
    mounted.unmount();
  }
});

test("CP12-UI-02 a connector's details show its permissions: how it authenticates and whether its key is there", async () => {
  const mounted = await mount("/connectors");
  try {
    await click(document.querySelector(`li.mp-addon[data-connector-id="${P06_IDS.CONNECTOR}"] button.mp-addon__open`));
    const permissions = [...document.querySelectorAll("dl")].find((d) => d.getAttribute("aria-label") === en.t("ui.addons.permissions"));
    assert.ok(permissions !== undefined, "no permission details");
    assert.ok((permissions.textContent ?? "").includes(en.t("p06.auth_mode.BEARER_TOKEN")));
    assert.ok((permissions.textContent ?? "").includes(en.t("ui.addons.perm.key_set")));
  } finally {
    mounted.unmount();
  }
});

test("CP12-UI-04 a template already added is recognised by its official address, so it is not offered twice", async () => {
  const { presetAdded } = await import("../src/screens/p06/Phase06ConnectorsScreen");
  const connector = (origin: string, base: string) => ({ descriptor: { provenance: { origin } }, rest: { base_url: base } }) as never;
  assert.equal(presetAdded({ base_url: "https://slack.com" }, [connector("BUILT_IN_PRESET", "https://slack.com")]), true);
  assert.equal(presetAdded({ base_url: "https://slack.com" }, [connector("USER_REGISTERED", "https://slack.com")]), false, "a hand-registered connector is not the template");
  assert.equal(presetAdded({ base_url: "https://slack.com" }, [connector("BUILT_IN_PRESET", "https://api.notion.com")]), false);
  // قالبان بعنوان واحد (Google Calendar وDrive): إضافة أحدهما لا تُخفي الآخر.
  const named = (base: string, name: string) => ({ descriptor: { provenance: { origin: "BUILT_IN_PRESET" }, display_name: name }, rest: { base_url: base } }) as never;
  assert.equal(presetAdded({ base_url: "https://www.googleapis.com", display_name: "Google Drive" }, [named("https://www.googleapis.com", "Google Calendar")]), false);
  assert.equal(presetAdded({ base_url: "https://www.googleapis.com", display_name: "Google Drive" }, [named("https://www.googleapis.com", "Google Drive")]), true);
});

test("CP12-UI-03 the tool-server copy says what the host accepts since PHASE-06, in both languages", () => {
  const ar = createTranslator("ar");
  for (const translator of [en, ar]) {
    assert.ok(translator.t("mcp.field.endpoint_hint").includes("https"), "the hint still says loopback only");
    assert.ok(translator.t("mcp.note.transport").includes("HTTPS"), "the note still says one transport");
  }
  assert.ok(!en.t("mcp.field.endpoint_hint").includes("contacts nothing else"));
});
