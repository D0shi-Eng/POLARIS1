// Phase-02 في العارض: العميل، والمسارات، وشاشات المزوّدين والنماذج والمشاريع.
//
// تهيئة DOM أولًا وقبل أي استيراد يرسم.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { NavigationProvider, TranslatorProvider } from "../src/app/context";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase02Client } from "../src/ipc/p02-client";
import { PHASE02_OPERATIONS } from "../src/ipc/operations";
import { CONTRACT_SCHEMAS } from "../src/generated/contract-bundle";
import { createTranslator, keysOf, MissingKeyRecorder } from "../src/localization/translate";
import { memoryLocation, type LocationPort } from "../src/routes/location";
import { resolveRoute, ROUTES, viewCapabilityIds } from "../src/routes/registry";
import { ModelPicker } from "../src/ui/components/ModelPicker";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase02Host, type FakePhase02Options } from "./support/fake-p02-host";

interface Mounted {
  readonly location: LocationPort;
  readonly api: Phase02Client;
  readonly log: ReturnType<typeof fakePhase02Host>["log"];
  unmount(): void;
}

async function settle(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(path: string, options: FakePhase02Options = {}): Promise<Mounted> {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const location = memoryLocation(path);
  const { transport, log } = fakePhase02Host(options);
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const api = new Phase02Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase02={api} location={location} />);
  });
  await settle();
  return { location, api, log, unmount: () => act(() => root.unmount()) };
}

async function goTo(app: Mounted, path: string): Promise<void> {
  await act(async () => app.location.write(path));
  await settle();
}

function tablist(): ParentNode {
  const list = document.querySelector("[role=tablist]");
  assert.ok(list !== null, "no tab list");
  return list;
}

function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? "";
}

function buttonNamed(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === label || (candidate.textContent ?? "").trim() === label,
  );
  assert.ok(found !== undefined, `no button named "${label}"`);
  return found;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
  await settle();
}

async function type(id: string, value: string): Promise<void> {
  const element = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  assert.ok(element !== null, `no field #${id}`);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
  await settle();
}

const en = createTranslator("en");

// ── العميل ──────────────────────────────────────────────────────────────────

test("P02-UI-001 the Phase-02 client exposes exactly the nineteen routed operations, the four provider operations of ADR-037, and no generic call", () => {
  const surface = Object.getOwnPropertyNames(Phase02Client.prototype).filter((name) => name !== "constructor").sort();
  assert.deepEqual(surface, [
    "addContext", "archiveProject", "assembleContext", "call", "cancelInvocation", "clearProviderKey", "configureModel",
    "configureProvider", "createProject", "deleteCustomProvider", "getProject", "invokeModel", "listModels", "listProjects", "listProviders",
    "previewContext", "providerCatalog", "putProviderKey", "refreshProviders", "removeContext", "saveCustomProvider", "setModelPreferences", "setProviderKey", "updateProject",
  ]);
  assert.equal(PHASE02_OPERATIONS.length, 19);
});

test("P02-UI-002 every Phase-02 request travels at 1.2, and only side-effecting ones carry an idempotency key", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  assert.equal((await api.listProviders()).ok, true);
  assert.equal((await api.configureProvider({ provider_id: "fixture-local", enabled: true })).ok, true);
  assert.equal((await api.refreshProviders(["fixture-local"])).ok, true);
  assert.equal((await api.listModels()).ok, true);
  const created = await api.createProject({ name: "Alpha" });
  assert.equal(created.ok, true);
  for (const envelope of log.envelopes) {
    assert.equal(envelope["protocol_version"], "1.2");
    const record = PHASE02_OPERATIONS.find((entry) => entry.operation === envelope["operation"]);
    assert.ok(record !== undefined);
    const hasKey = typeof envelope["idempotency_key"] === "string";
    assert.equal(hasKey, record.idempotency === "REQUIRED", `${String(envelope["operation"])} key presence`);
    if (hasKey) assert.match(String(envelope["idempotency_key"]), /^[A-Za-z0-9._:-]{16,128}$/);
  }
});

test("P02-UI-003 a request the contract refuses is never sent", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const refused = await api.configureProvider({ provider_id: "fixture-local", endpoint: "http://192.168.1.2:1234\u0000" });
  assert.equal(refused.ok, false);
  const traversal = await api.addContext({ project_id: "00000000-0000-4000-8000-000000000001", source_type: "FILE", reference: "../secrets" });
  assert.equal(traversal.ok, false);
  assert.deepEqual(log.operations, [], "an invalid request reached the transport");
});

test("P02-UI-004 an invocation retry reuses the caller's idempotency key", async () => {
  const { transport, log } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const request = { invocation_id: "00000000-0000-4000-8000-00000000abcd", routing_mode: "DEFAULT_MODEL" as const, messages: [{ role: "USER" as const, text: "hi" }] };
  await api.invokeModel(request, "ui:retry-key-0000000001");
  await api.invokeModel(request, "ui:retry-key-0000000001");
  const keys = log.envelopes.map((envelope) => envelope["idempotency_key"]);
  assert.deepEqual(keys, ["ui:retry-key-0000000001", "ui:retry-key-0000000001"]);
});

// ── المسارات ────────────────────────────────────────────────────────────────

test("P02-UI-005 the ten navigation sections stay ten; Phase-02 destinations are secondary", () => {
  assert.equal(ROUTES.length, 10);
  assert.equal(resolveRoute("/providers")?.id, "providers");
  assert.equal(resolveRoute("/models")?.id, "models");
  const detail = resolveRoute("/projects/00000000-0000-4000-8000-000000000001");
  assert.equal(detail?.id, "project-detail");
  assert.equal(detail?.param, "00000000-0000-4000-8000-000000000001");
  assert.equal(detail?.parentId, "projects");
  assert.equal(resolveRoute("/projects/../settings"), undefined);
  assert.equal(resolveRoute("/projects/NOT-A-UUID"), undefined);
  assert.ok(viewCapabilityIds().includes("polaris.desktop.providers"));
});

test("P02-UI-006 when the host says Phase-02 is unavailable, its screens are declared states with no controls", async () => {
  const app = await mount("/providers", { unavailable: true });
  assert.equal(document.querySelectorAll(".state").length, 1);
  assert.equal(document.querySelectorAll(".shell__main button, .shell__main input, .shell__main select").length, 0);
  await goTo(app, "/projects");
  assert.equal(textOf(".page-title"), "Projects");
  assert.equal(document.querySelectorAll(".shell__main button").length, 0);
  app.unmount();
});

// ── المزوّدون والنماذج ──────────────────────────────────────────────────────

test("P02-UI-007 Providers lists real host facts, measures on request and never shows a key", async () => {
  const app = await mount("/providers");
  assert.equal(textOf(".page-title"), en.t("providers.title"));
  assert.equal(document.querySelectorAll(".list-card .item").length, 3);
  const card = document.getElementById("provider-fixture-local-title")?.closest("article");
  assert.ok(card);
  assert.ok((card.textContent ?? "").includes(en.t("p02.health.UNKNOWN")));
  await click(buttonNamed(en.t("providers.action.check"), card));
  assert.ok((card.textContent ?? "").includes(en.t("p02.health.HEALTHY")), card.textContent ?? "");
  const remote = document.getElementById("provider-remote-fixture-title")?.closest("article");
  assert.ok(remote);
  assert.ok((remote.textContent ?? "").includes(en.t("providers.remote.note")));
  await click(buttonNamed(en.t("providers.action.set_key"), remote));
  assert.ok((document.body.textContent ?? "").includes(en.t("providers.key.outcome.STORED")));
  // الحقل الوحيد القابل للكتابة في البطاقة البعيدة غير موجود: لا نقطة نهاية بعيدة قابلة للتحرير.
  assert.equal(document.getElementById("provider-remote-fixture-endpoint"), null);
  assert.equal(document.querySelectorAll("input[type=password]").length, 0);
  app.unmount();
});

test("P02-UI-008 an endpoint outside loopback is refused and the refusal is shown", async () => {
  const app = await mount("/providers");
  await type("provider-local-openai-compatible-endpoint", "http://127.0.0.1:9999/v1");
  const card = document.getElementById("provider-local-openai-compatible-title")?.closest("article");
  assert.ok(card);
  await click(buttonNamed(en.t("providers.endpoint.save"), card));
  assert.ok(card.querySelector(".alert") !== null, "no refusal shown");
  app.unmount();
});

test("P02-UI-009 Models shows only discovered models, enables one and sets the default", async () => {
  const app = await mount("/models");
  assert.ok((document.body.textContent ?? "").includes(en.t("models.empty.title")));
  await app.api.refreshProviders(["fixture-local"]);
  await goTo(app, "/providers");
  await goTo(app, "/models");
  await click(buttonNamed(en.t("models.action.enable_named", { name: "fixture-chat" })));
  await click(buttonNamed(en.t("models.action.make_default_named", { name: "fixture-chat" })));
  // الافتراضي يُعرض الآن في قائمة اختيار (تصميم 2026-10-01)، لا نصًّا ثابتًا.
  assert.equal((document.getElementById("models-default") as HTMLSelectElement | null)?.value, "fixture-local:fixture-chat");
  const listed = await app.api.listModels();
  assert.ok(listed.ok && listed.value.preferences.default_model_id === "fixture-local:fixture-chat");
  app.unmount();
});

test("P02-UI-010 model output is rendered as labelled untrusted text, never as markup", async () => {
  const app = await mount("/models", { invokeOutput: "<script>window.__pwned = true</script><b>bold</b>" });
  await app.api.refreshProviders(["fixture-local"]);
  await app.api.configureModel("fixture-local:fixture-chat", true);
  await app.api.setModelPreferences({ default_model_id: "fixture-local:fixture-chat" });
  await goTo(app, "/providers");
  await goTo(app, "/models");
  await type("models-invoke-prompt", "hello");
  await click(buttonNamed(en.t("invoke.send")));
  const pre = document.querySelector("pre.untrusted");
  assert.ok(pre !== null, "no output rendered");
  assert.equal(pre.textContent, "<script>window.__pwned = true</script><b>bold</b>");
  assert.equal(pre.querySelector("script, b"), null);
  assert.equal((globalThis as { __pwned?: boolean }).__pwned, undefined);
  assert.equal(textOf(".untrusted__label"), en.t("invoke.output.label"));
  app.unmount();
});

// ── المشاريع ────────────────────────────────────────────────────────────────

test("P02-UI-011 create a project, open it, bind a model, add context, preview, assemble and archive", async () => {
  const app = await mount("/projects");
  assert.ok((document.body.textContent ?? "").includes(en.t("projects.empty")));
  await type("project-name", "Research");
  await type("project-workspace", "D:\\Work\\Research");
  await click(buttonNamed(en.t("projects.create.submit")));
  assert.equal(textOf(".page-title"), "Research");
  assert.equal(document.querySelectorAll("[role=tab]").length, 4);

  await app.api.refreshProviders(["fixture-local"]);
  await app.api.configureModel("fixture-local:fixture-chat", true);
  await click(buttonNamed(en.t("project.tab.model"), tablist()));
  await type("project-default-model", "fixture-local:fixture-chat");
  const bound = await app.api.listProjects();
  assert.ok(bound.ok && bound.value.projects[0]?.default_model_id === "fixture-local:fixture-chat");

  await click(buttonNamed(en.t("project.tab.context"), tablist()));
  await type("context-reference", "notes.md");
  await click(buttonNamed(en.t("context.add.submit")));
  assert.ok(textOf("#context-sources ~ div table").includes("notes.md"));
  await type("context-reference", ".env");
  await click(buttonNamed(en.t("context.add.submit")));
  assert.ok(document.querySelector(".alert") !== null, "the refused sensitive file was not reported");

  await click(buttonNamed(en.t("context.preview_named", { name: "notes.md" })));
  const preview = document.querySelector("#context-preview ~ pre.untrusted");
  assert.ok(preview !== null);
  assert.equal(preview.querySelector("img"), null, "preview content became markup");
  assert.equal(textOf("#context-preview ~ .untrusted__label"), en.t("context.preview.untrusted"));

  const box = document.querySelector<HTMLInputElement>(`input[aria-label="${en.t("context.select_named", { name: "notes.md" })}"]`);
  assert.ok(box !== null);
  await click(box);
  await click(buttonNamed(en.t("context.assemble.submit")));
  assert.ok(textOf("#context-assemble ~ [role=status] .success").includes("1"));
  assert.ok((document.body.textContent ?? "").includes(en.t("context.omission.SENSITIVE_FILE_EXCLUDED")));

  await click(buttonNamed(en.t("project.tab.overview"), tablist()));
  await click(buttonNamed(en.t("project.action.archive")));
  assert.ok((document.body.textContent ?? "").includes(en.t("project.archived.note")));
  await click(buttonNamed(en.t("project.tab.context"), tablist()));
  assert.equal(document.getElementById("context-reference"), null, "an archived project still offers writes");
  app.unmount();
});

test("P02-UI-012 a stale version is refused as a conflict, not written over", async () => {
  const { transport } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const created = await api.createProject({ name: "Beta" });
  assert.ok(created.ok);
  const id = created.value.project.project_id;
  assert.equal((await api.updateProject({ project_id: id, expected_version: 1, name: "Beta 2" })).ok, true);
  const stale = await api.updateProject({ project_id: id, expected_version: 1, name: "Beta 3" });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.error.code, "CONFLICT");
    assert.equal(stale.error.retryable, true);
  }
});

// ── اللغة والوصول ───────────────────────────────────────────────────────────

test("P02-UI-013 every Phase-02 screen renders in Arabic, right to left, with no missing key", async () => {
  const app = await mount("/providers");
  const select = document.getElementById("session-locale") as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")?.set?.call(select, "ar");
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await settle();
  const ar = createTranslator("ar");
  assert.equal(document.documentElement.getAttribute("dir"), "rtl");
  assert.equal(textOf(".page-title"), ar.t("providers.title"));
  const created = await app.api.createProject({ name: "مشروع" });
  assert.ok(created.ok);
  for (const path of ["/models", "/projects", `/projects/${created.value.project.project_id}`]) {
    await goTo(app, path);
    assert.notEqual(textOf(".page-title"), "");
  }
  for (const tab of ["context", "model", "settings", "overview"]) {
    await click(buttonNamed(ar.t(`project.tab.${tab}`), tablist()));
  }
  const body = document.body.textContent ?? "";
  assert.ok(!/\b(?:p02|providers|models|projects|project|context|invoke)\.[a-z_]+\.[A-Za-z_.]+/.test(body), "a raw key reached the screen");
  app.unmount();
});

test("P02-UI-014 every value a Phase-02 contract enum can take has an English and an Arabic label", () => {
  const recorder = new MissingKeyRecorder();
  const translators = [createTranslator("en", recorder), createTranslator("ar", recorder)];
  const domain = CONTRACT_SCHEMAS["desktop-p02-domain.schema.json"] as { $defs: Record<string, { enum?: string[] }> };
  const result = CONTRACT_SCHEMAS["desktop-p02-result.v1.schema.json"] as { $defs: Record<string, unknown> };
  const enumOf = (name: string): string[] => domain.$defs[name]?.enum ?? [];
  const families: Array<[string, string[]]> = [
    ["p02.health", enumOf("HealthState")],
    ["p02.health_reason", enumOf("HealthReason")],
    ["p02.provenance", enumOf("Provenance")],
    ["p02.support", enumOf("Support")],
    ["p02.locality", enumOf("Locality")],
    ["p02.network_class", enumOf("NetworkClass")],
    ["p02.installation", enumOf("InstallationState")],
    ["p02.runtime", enumOf("RuntimeState")],
    ["p02.capability", enumOf("ModelCapability")],
    ["p02.trust", enumOf("TrustClass")],
    ["p02.outcome", enumOf("ProviderOutcomeCode")],
    ["models.kind", enumOf("ModelKind")],
    ["models.availability", enumOf("ModelAvailability")],
    ["models.loaded", enumOf("LoadedState")],
    ["context.type", enumOf("SourceType")],
    ["context.availability", enumOf("SourceAvailability")],
    ["context.omission", enumOf("OmissionReason")],
    ["projects.status", enumOf("ProjectStatus")],
    ["providers.key.source", enumOf("CredentialSource")],
  ];
  const routing = JSON.stringify(result.$defs["RoutingDecisionView"]);
  const reasons = /"reason_codes":\{[^}]*"enum":\[([^\]]*)\]/.exec(routing)?.[1] ?? "";
  families.push(["invoke.routing", [...reasons.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1] ?? "")]);
  for (const [prefix, values] of families) {
    assert.ok(values.length > 0, `${prefix} has no values in the contract`);
    for (const value of values) for (const translator of translators) translator.t(`${prefix}.${value}`);
  }
  assert.deepEqual(recorder.list(), []);
});

test("P02-UI-015 Arabic and English declare the same Phase-02 keys", () => {
  const ar = new Set(keysOf("ar"));
  const missing = keysOf("en").filter((key) => !ar.has(key));
  assert.deepEqual(missing, []);
});

test("P02-UI-016 every Phase-02 form control has an accessible name", async () => {
  const app = await mount("/projects");
  await type("project-name", "Gamma");
  await click(buttonNamed(en.t("projects.create.submit")));
  for (const tab of ["context", "model", "settings"]) {
    await click(buttonNamed(en.t(`project.tab.${tab}`), tablist()));
    for (const control of document.querySelectorAll<HTMLElement>(".shell__main input, .shell__main select, .shell__main textarea")) {
      const id = control.id;
      const labelled =
        control.getAttribute("aria-label") !== null ||
        (id !== "" && document.querySelector(`label[for="${id}"]`) !== null);
      assert.ok(labelled, `unlabelled control ${control.outerHTML.slice(0, 80)}`);
    }
  }
  const tabs = [...document.querySelectorAll("[role=tab]")];
  assert.equal(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length, 1);
  app.unmount();
});

// انحدار 2026-10-05: الإعدادات نافذة فوق الرئيسية فلا تُفكّ الرئيسية، ومحدّد النموذج كان يقرأ القائمة مرّة عند
// تركيبه؛ نموذج فُعِّل بعدها لا يظهر فيه، فلا يُختار ولا تُنشأ مهمّة من المُركِّب (P08-E2E-02..07).
test("P02-UI-017 the model picker re-reads the host after a model is enabled while it stays mounted", async () => {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const { transport } = fakePhase02Host();
  const api = new Phase02Client({ transport, identity: IDENTITY });
  const navigation = { current: undefined, requestedPath: "/", navigate: () => undefined };
  await act(async () => {
    root.render(
      <TranslatorProvider translator={en}>
        <NavigationProvider navigation={navigation}>
          <ModelPicker phase02={api} value="" onChange={() => undefined} nativeId="composer-model" />
        </NavigationProvider>
      </TranslatorProvider>,
    );
  });
  await settle();
  const options = () => [...(document.getElementById("composer-model") as HTMLSelectElement).options].map((o) => o.value);
  assert.deepEqual(options(), [""]);
  // التفعيل من خارج المحدّد (شاشة المزوّدين، أو أداة القياس) والمحدّد ما زال مركّبًا.
  await act(async () => {
    const refreshed = await api.refreshProviders(["fixture-local"]);
    const configured = await api.configureModel("fixture-local:fixture-chat", true);
    assert.ok(refreshed.ok && configured.ok, `the fake host refused: ${JSON.stringify([refreshed, configured]).slice(0, 300)}`);
  });
  await settle();
  assert.ok(options().includes("fixture-local:fixture-chat"), `the enabled model is not offered: ${options().join(",")}`);
  act(() => root.unmount());
});
