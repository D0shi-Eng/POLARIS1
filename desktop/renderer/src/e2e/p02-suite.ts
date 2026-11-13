// مجموعة E2E الأصلية لـPhase-02: E2E-01 … E2E-21 داخل النافذة الحقيقية.
//
// المشغّل الأصلي يشغّل التطبيق مرتين على مجلد بيانات مؤقت: مرحلة أولى تبني كل
// شيء عبر الواجهة، ومرحلة إعادة تشغيل تتحقق مما بقي. E2E-22 (الخروج النظيف)
// يقيسه المشغّل من خارج النافذة.
//
// المزوّد المحلي هنا تجهيزة اختبار على الحلقة المحلية يملكها المشغّل، وهي موسومة
// «TEST FIXTURE» في التقرير. لا يُعرض شيء منها كأنه مزوّد إنتاجي.

import type { DesktopIpcClient } from "../ipc/client";
import type { ProjectGetResultV1 } from "../generated/types/desktop-p02-result-v1";
import type { Phase02Client } from "../ipc/p02-client";
import { createId } from "../ipc/envelope";
import { createTranslator, missingKeys, type Translator } from "../localization/translate";
import { button, doc, enabled, field, go, labelled, now, providerCard, setField, sleep, tablist, text, waitFor } from "./driver";

export interface Phase02SuiteConfig {
  readonly stage: "p02-first" | "p02-restart";
  readonly fixture_endpoint: string | null;
  readonly closed_endpoint: string | null;
  readonly workspace: string | null;
  readonly marker: string | null;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly status: "PASS" | "FAIL" | "NOT_TESTED";
  readonly detail: string;
}

/** اسم المزوّد العام الذي تُوجَّه إليه التجهيزة. معرّف تسجيل، لا اسم منتج. */
const GENERIC_PROVIDER = "local-openai-compatible";
/** المزوّد البعيد الذي تقف التجهيزة البعيدة مكانه في ثنائي القياس وحده. */
const REMOTE_PROVIDER = "openrouter";
const CHAT_MODEL = `${GENERIC_PROVIDER}:fixture-chat`;
const SLOW_MODEL = `${GENERIC_PROVIDER}:fixture-slow`;
const REMOTE_MODEL = `${REMOTE_PROVIDER}:fixture/remote-chat`;
const FIXTURE_REPLY = "POLARIS fixture reply.";
const NOTE_MARKER = "P02-NOTE-MARKER";

export function phase02Config(): Phase02SuiteConfig | null {
  const value = (globalThis as { __POLARIS_E2E_P02__?: Phase02SuiteConfig }).__POLARIS_E2E_P02__;
  return value !== undefined && typeof value === "object" && value !== null ? value : null;
}

class Recorder {
  readonly scenarios: Scenario[] = [];
  readonly measurements: Record<string, { value: number; unit: "ms"; provenance: "LOCALLY_MEASURED"; method: string }> = {};
  readonly facts: Record<string, unknown> = {};

  add(id: string, title: string, ok: boolean, detail: string): void {
    this.scenarios.push({ id, title, status: ok ? "PASS" : "FAIL", detail });
  }

  skip(id: string, title: string, detail: string): void {
    this.scenarios.push({ id, title, status: "NOT_TESTED", detail });
  }

  measure(name: string, started: number, method: string): void {
    this.measurements[name] = { value: Math.round(now() - started), unit: "ms", provenance: "LOCALLY_MEASURED", method };
  }
}

/** يجعل كل خطوة مستقلة: استثناء في خطوة يُسجَّل فشلًا لها ولا يوقف البقية. */
async function step(recorder: Recorder, id: string, title: string, body: () => Promise<[boolean, string]>): Promise<void> {
  try {
    const [ok, detail] = await body();
    recorder.add(id, title, ok, detail);
  } catch (error) {
    recorder.add(id, title, false, `threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function setLocale(code: "en" | "ar"): Promise<boolean> {
  const select = field<HTMLSelectElement>("session-locale");
  if (select === null) return false;
  setField(select, code);
  return (await waitFor(() => doc().documentElement.getAttribute("lang") === code, 5_000)) !== null;
}

async function clickAndWait(label: string, root: ParentNode = doc(), timeoutMs = 10_000): Promise<boolean> {
  const target = await waitFor(() => enabled(button(label, root)), timeoutMs);
  if (target === null) return false;
  target.click();
  return true;
}

function healthOf(providerId: string, t: Translator, state: string): boolean {
  const card = providerCard(providerId);
  return card !== null && text(".item__head .pill", card).startsWith(t.t(`p02.health.${state}`));
}

export async function runPhase02Suite(
  client: DesktopIpcClient,
  api: Phase02Client,
  bootstrapOutcome: string,
  config: Phase02SuiteConfig,
): Promise<Record<string, unknown>> {
  const recorder = new Recorder();
  const t = createTranslator("en");
  const projectName = `P02 E2E Project ${config.marker ?? "run"}`;
  await setLocale("en");

  if (config.stage === "p02-restart") {
    await restartStage(client, api, recorder, projectName, config);
  } else {
    await firstStage(client, api, recorder, t, projectName, bootstrapOutcome, config);
  }

  return {
    suite: "p02",
    stage: config.stage,
    fixture_label: "TEST FIXTURE",
    scenarios: recorder.scenarios,
    measurements: recorder.measurements,
    facts: recorder.facts,
    missing_keys: missingKeys.list(),
  };
}

async function firstStage(
  client: DesktopIpcClient,
  api: Phase02Client,
  recorder: Recorder,
  t: Translator,
  projectName: string,
  bootstrapOutcome: string,
  config: Phase02SuiteConfig,
): Promise<void> {
  // ── E2E-01 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-01", "launch POLARIS and hydrate at the protocol the host declares", async () => {
    const snapshot = await client.bootstrap();
    const version = snapshot.ok ? snapshot.value.ipc_protocol_version : "unreadable";
    // النسخة لا تُثبَّت على رقم: كل مرحلة تزيد العمليات فترفع النسخة الصغرى، وتثبيت
    // الرقم هنا يجعل مرحلةً لاحقةً تُسقط بوابةَ مرحلةٍ سابقة بلا عيب في أيّهما.
    // المقيس هو ما قِيس دائمًا: أن القشرة رطّبت وأن المضيف أعلن نسخته من العائلة 1.
    const declared = /^1\.\d+$/.test(version);
    return [bootstrapOutcome === "HYDRATED" && declared, `bootstrap ${bootstrapOutcome}, ipc ${version}`];
  });

  // ── E2E-02 ────────────────────────────────────────────────────────────────
  let providerIds: string[] = [];
  await step(recorder, "E2E-02", "open Providers and see every registered provider", async () => {
    await go("/providers");
    const listed = await api.listProviders();
    if (!listed.ok) return [false, `provider.list ${listed.error.code}`];
    providerIds = listed.value.providers.map((provider) => provider.provider_id);
    recorder.facts["provider_list_snapshot"] = listed.value;
    const rendered = await waitFor(() => (doc().querySelectorAll(".list-card .item").length === providerIds.length ? true : null));
    const title = text(".page-title");
    return [rendered === true && title === t.t("providers.title"), `${providerIds.length} providers, title "${title}"`];
  });

  // ── E2E-03 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-03", "local provider discovery is measured from the UI", async () => {
    const listed = await api.listProviders();
    if (!listed.ok) return [false, "provider.list failed"];
    const known = listed.value.providers.filter((provider) => provider.locality === "LOCAL" && provider.endpoint !== undefined && provider.provider_id !== GENERIC_PROVIDER);
    const states: Record<string, string> = {};
    for (const provider of known) {
      const card = providerCard(provider.provider_id);
      if (card === null) return [false, `no card for ${provider.provider_id}`];
      const started = now();
      if (!(await clickAndWait(t.t("providers.action.check"), card))) return [false, `check unavailable for ${provider.provider_id}`];
      const settled = await waitFor(() => {
        const pill = text(".item__head .pill", card);
        return pill !== "" && !pill.startsWith(t.t("p02.health.UNKNOWN")) ? pill : null;
      }, 20_000);
      recorder.measure(`discovery_${provider.provider_id}`, started, "UI click to rendered health, round trip through the host");
      if (settled === null) return [false, `${provider.provider_id} never showed a measured state`];
      const after = await api.listProviders();
      const view = after.ok ? after.value.providers.find((entry) => entry.provider_id === provider.provider_id) : undefined;
      states[provider.provider_id] = `${view?.health.state ?? "?"}/${view?.health.reason_code ?? "?"}/${view?.health.installation ?? "?"}`;
    }
    recorder.facts["local_discovery"] = states;
    return [known.length > 0, JSON.stringify(states)];
  });

  // ── LIVE-01 (اختياري) ─────────────────────────────────────────────────────
  // إن أجاب خادم نماذج محلي حقيقي وأبلغ عن نموذج محمَّل فعلًا، يُستدعى ذلك النموذج
  // مرة واحدة برسالة قصيرة وحدّ إخراج صغير، عبر خدمة الاستدعاء نفسها. لا يُحمَّل
  // نموذج ولا يُفرَّغ، ولا يُختار نموذج غير محمَّل. غياب الخادم NOT_TESTED لا فشل.
  await liveStep(api, recorder);

  // ── E2E-04 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-04", "an unreachable provider shows an explicit unavailable state", async () => {
    if (config.closed_endpoint === null) return [false, "the runner gave no closed port"];
    const card = providerCard(GENERIC_PROVIDER);
    const input = field<HTMLInputElement>(`provider-${GENERIC_PROVIDER}-endpoint`);
    if (card === null || input === null) return [false, "generic provider card or endpoint field missing"];
    setField(input, config.closed_endpoint);
    if (!(await clickAndWait(t.t("providers.endpoint.save"), card))) return [false, "save unavailable"];
    await waitFor(() => text(".success", card).includes(t.t("providers.action.endpoint_saved")));
    if (!(await clickAndWait(t.t("providers.action.check"), card))) return [false, "check unavailable"];
    const shown = await waitFor(() => (healthOf(GENERIC_PROVIDER, t, "UNREACHABLE") ? text(".item__head .pill", card) : null), 15_000);
    return [shown !== null, `pill "${shown ?? text(".item__head .pill", card)}"`];
  });

  // ── E2E-05 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-05", "configure the TEST FIXTURE provider and see it healthy", async () => {
    if (config.fixture_endpoint === null) return [false, "the runner gave no fixture port"];
    const card = providerCard(GENERIC_PROVIDER);
    const input = field<HTMLInputElement>(`provider-${GENERIC_PROVIDER}-endpoint`);
    if (card === null || input === null) return [false, "generic provider card missing"];
    setField(input, config.fixture_endpoint);
    if (!(await clickAndWait(t.t("providers.endpoint.save"), card))) return [false, "save unavailable"];
    await sleep(300);
    const started = now();
    if (!(await clickAndWait(t.t("providers.action.check"), card))) return [false, "check unavailable"];
    const healthy = await waitFor(() => healthOf(GENERIC_PROVIDER, t, "HEALTHY"), 15_000);
    recorder.measure("discovery_fixture", started, "UI click to rendered HEALTHY, TEST FIXTURE provider");
    return [healthy === true, `pill "${text(".item__head .pill", card)}"`];
  });

  // ── E2E-06 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-06", "the model list shows the discovered fixture models", async () => {
    const started = now();
    const listed = await api.listModels({ provider_id: GENERIC_PROVIDER });
    recorder.measure("model_list", started, "model.list round trip");
    await go("/models");
    const row = await waitFor(() => button(t.t("models.action.enable_named", { name: "fixture-chat" })), 10_000);
    const ids = listed.ok ? listed.value.models.map((model) => model.model_id) : [];
    return [row !== null && ids.includes(CHAT_MODEL) && ids.includes(SLOW_MODEL), `models ${ids.join(", ")}`];
  });

  // ── E2E-07 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-07", "enable a model from the Models screen", async () => {
    for (const name of ["fixture-chat", "fixture-slow"]) {
      if (!(await clickAndWait(t.t("models.action.enable_named", { name })))) return [false, `enable ${name} unavailable`];
      const done = await waitFor(() => button(t.t("models.action.disable_named", { name })), 10_000);
      if (done === null) return [false, `${name} did not become enabled`];
    }
    const listed = await api.listModels({ provider_id: GENERIC_PROVIDER });
    const chat = listed.ok ? listed.value.models.find((model) => model.model_id === CHAT_MODEL) : undefined;
    return [chat?.enabled === true, `enabled=${String(chat?.enabled)}`];
  });

  // ── E2E-08 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-08", "set the default model", async () => {
    if (!(await clickAndWait(t.t("models.action.make_default_named", { name: "fixture-chat" })))) return [false, "make default unavailable"];
    // الافتراضي يُعرض في قائمة الاختيار (تصميم 2026-10-01).
    const shown = await waitFor(() => ((doc().getElementById("models-default") as HTMLSelectElement | null)?.value === CHAT_MODEL ? true : null), 10_000);
    const listed = await api.listModels();
    const preference = listed.ok ? listed.value.preferences.default_model_id : undefined;
    return [shown === true && preference === CHAT_MODEL, `default ${preference ?? "none"}`];
  });

  // ── E2E-16 (قبل المشروع: شاشة النماذج مفتوحة الآن) ────────────────────────
  await step(recorder, "E2E-16", "cancel a running invocation from the UI and discard its output", async () => {
    const mode = field<HTMLSelectElement>("models-invoke-mode");
    if (mode === null) return [false, "invoke panel missing"];
    setField(mode, "MANUAL");
    const model = await waitFor(() => field<HTMLSelectElement>("models-invoke-model"));
    const prompt = field<HTMLTextAreaElement>("models-invoke-prompt");
    if (model === null || prompt === null) return [false, "invoke fields missing"];
    setField(model, SLOW_MODEL);
    setField(prompt, "Count slowly.");
    if (!(await clickAndWait(t.t("invoke.send")))) return [false, "send unavailable"];
    await waitFor(() => text(".note[aria-busy]") !== "", 5_000);
    await sleep(700);
    const started = now();
    if (!(await clickAndWait(t.t("invoke.cancel")))) return [false, "cancel unavailable"];
    const section = doc().querySelector("#models-invoke-title")?.closest("section") ?? null;
    if (section === null) return [false, "invoke section missing"];
    const status = await waitFor(() => {
      const shown = text("div[role=status] > .alert, div[role=status] > .success", section);
      return shown !== "" ? shown : null;
    }, 15_000);
    recorder.measure("cancel_to_result", started, "cancel click to rendered result");
    const cancelled = status === t.t("invoke.status.CANCELLED");
    const noOutput = section.querySelector("pre.untrusted") === null;
    return [cancelled && noOutput, `status "${status ?? "none"}", output discarded ${noOutput}`];
  });

  // ── E2E-09 ────────────────────────────────────────────────────────────────
  let projectId = "";
  await step(recorder, "E2E-09", "create a project with a workspace folder", async () => {
    if (config.workspace === null) return [false, "the runner gave no workspace"];
    await go("/projects");
    const name = await waitFor(() => field<HTMLInputElement>("project-name"));
    const workspace = field<HTMLInputElement>("project-workspace");
    if (name === null || workspace === null) return [false, "create form missing"];
    setField(name, projectName);
    setField(workspace, config.workspace);
    if (!(await clickAndWait(t.t("projects.create.submit")))) return [false, "create unavailable"];
    const opened = await waitFor(() => {
      const match = /^#\/projects\/([0-9a-f-]{36})$/.exec(globalThis.location.hash);
      return match?.[1] ?? null;
    }, 10_000);
    projectId = opened ?? "";
    return [opened !== null, `project ${projectId}`];
  });

  // ── E2E-10 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-10", "open the project and see its sections", async () => {
    if (projectId === "") return [false, "no project"];
    await go("/projects");
    const started = now();
    if (!(await clickAndWait(t.t("projects.open_named", { name: projectName })))) return [false, "open unavailable"];
    const title = await waitFor(() => (text(".page-title") === projectName ? true : null), 10_000);
    recorder.measure("project_open", started, "open click to rendered project title");
    const tabs = doc().querySelectorAll("[role=tab]").length;
    const listed = now();
    await api.listProjects();
    recorder.measure("project_list", listed, "project.list round trip");
    return [title === true && tabs === 4, `title shown ${String(title)}, ${tabs} tabs`];
  });

  // ── E2E-11 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-11", "bind a model to the project", async () => {
    if (!(await clickAndWait(t.t("project.tab.model"), tablist()))) return [false, "model tab unavailable"];
    const select = await waitFor(() => {
      const element = field<HTMLSelectElement>("project-default-model");
      return element !== null && element.querySelector(`option[value="${CHAT_MODEL}"]`) !== null ? element : null;
    }, 10_000);
    if (select === null) return [false, "project model select missing"];
    setField(select, CHAT_MODEL);
    const detail = await waitForProject(api, projectId, (value) => value.effective_model_origin === "PROJECT_DEFAULT");
    return [detail !== null, `origin ${detail?.effective_model_origin ?? "unchanged"}`];
  });

  // ── E2E-12 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-12", "add a workspace file as a context source", async () => {
    if (!(await clickAndWait(t.t("project.tab.context"), tablist()))) return [false, "context tab unavailable"];
    for (const reference of ["notes.md", "docs/hostile.md"]) {
      const input = await waitFor(() => field<HTMLInputElement>("context-reference"));
      if (input === null) return [false, "reference field missing"];
      setField(input, reference);
      if (!(await clickAndWait(t.t("context.add.submit")))) return [false, `add ${reference} unavailable`];
      const added = await waitFor(() => (text("#context-sources ~ div table") .includes(reference) ? true : null), 10_000);
      if (added === null) return [false, `${reference} not listed`];
    }
    const refused = await api.addContext({ project_id: projectId, source_type: "FILE", reference: ".env" });
    const detail = await api.getProject(projectId);
    const types = detail.ok ? detail.value.sources.map((source) => source.source_type) : [];
    return [
      types.includes("WORKSPACE_ROOT") && types.filter((type) => type === "FILE").length === 2 && !refused.ok,
      `sources ${types.join(",")}; .env refused ${String(!refused.ok)}`,
    ];
  });

  // ── E2E-13 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-13", "preview a context source as untrusted text", async () => {
    if (!(await clickAndWait(t.t("context.preview_named", { name: "notes.md" })))) return [false, "preview unavailable"];
    const shown = await waitFor(() => {
      const pre = doc().querySelector("#context-preview ~ pre.untrusted");
      return pre !== null && (pre.textContent ?? "").includes(NOTE_MARKER) ? true : null;
    }, 10_000);
    const labelled = text("#context-preview ~ .untrusted__label") === t.t("context.preview.untrusted");
    return [shown === true && labelled, `marker shown ${String(shown)}, labelled ${labelled}`];
  });

  // ── E2E-14 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-14", "assemble a bounded context bundle with explicit omissions", async () => {
    // الاسم المعروض للملف اسمُه المجرّد (basename)، كما يشتقّه المضيف من المرجع؛
    // فالمربّع يُطلَب باسمه المعروض لا بمساره الكامل.
    for (const reference of ["notes.md", "docs/hostile.md"]) {
      const name = reference.slice(reference.lastIndexOf("/") + 1);
      const box = labelled<HTMLInputElement>("input[type=checkbox]", t.t("context.select_named", { name }));
      if (box === null) return [false, `no checkbox for ${name}`];
      if (!box.checked) box.click();
    }
    await sleep(200);
    const started = now();
    if (!(await clickAndWait(t.t("context.assemble.submit")))) return [false, "assemble unavailable"];
    const summary = await waitFor(() => {
      const shown = text("#context-assemble ~ [role=status] .success");
      return shown !== "" ? shown : null;
    }, 10_000);
    recorder.measure("context_assembly", started, "assemble click to rendered bundle summary");
    const detail = await api.getProject(projectId);
    const root = detail.ok ? detail.value.sources.find((source) => source.source_type === "WORKSPACE_ROOT") : undefined;
    const whole = root === undefined ? null : await api.assembleContext({ project_id: projectId, source_ids: [root.source_id], instruction: "Check." });
    const omitted = whole?.ok === true ? whole.value.bundle.omitted.map((item) => `${item.item_reference}:${item.reason}`) : [];
    const budget = whole?.ok === true ? whole.value.bundle.budget : null;
    recorder.facts["workspace_bundle_omissions"] = omitted;
    const envOmitted = omitted.some((entry) => entry.startsWith(".env:SENSITIVE_FILE_EXCLUDED"));
    return [summary !== null && envOmitted && budget !== null && budget.max_total_bytes > 0, `summary "${summary ?? ""}", .env excluded ${envOmitted}`];
  });

  // ── E2E-15 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-15", "invoke the deterministic TEST FIXTURE model with project context", async () => {
    const before = await api.listModels();
    if (!(await clickAndWait(t.t("project.tab.model"), tablist()))) return [false, "model tab unavailable"];
    const prompt = await waitFor(() => field<HTMLTextAreaElement>("project-invoke-prompt"));
    if (prompt === null) return [false, "prompt missing"];
    setField(prompt, "Summarise the notes.");
    const started = now();
    if (!(await clickAndWait(t.t("invoke.send")))) return [false, "send unavailable"];
    const output = await waitFor(() => {
      const pre = doc().querySelector("#project-invoke-title")?.closest("section")?.querySelector("pre.untrusted");
      return pre?.textContent ?? null;
    }, 30_000);
    recorder.measure("invocation_ui_round_trip", started, "send click to rendered output");
    const after = await api.listModels();
    const unchanged =
      before.ok && after.ok &&
      JSON.stringify(before.value.preferences) === JSON.stringify(after.value.preferences) &&
      before.value.models.filter((model) => model.enabled).length === after.value.models.filter((model) => model.enabled).length;
    // قياس المضيف نفسه: زمن الاستدعاء الكلي وأول بايت، كما أعادهما.
    const direct = await api.invokeModel({
      invocation_id: createId(),
      routing_mode: "DEFAULT_MODEL",
      project_id: projectId,
      messages: [{ role: "USER", text: "Reply." }],
    });
    if (direct.ok) {
      recorder.facts["host_invocation_timing"] = direct.value.timing;
      recorder.facts["host_invocation_routing"] = direct.value.routing;
      recorder.facts["host_invocation_context"] = direct.value.context ?? null;
    }
    const labelled = doc().querySelector("#project-invoke-title")?.closest("section")?.querySelector(".untrusted__label") !== null;
    const ok = output === FIXTURE_REPLY && labelled && unchanged && direct.ok && direct.value.status === "COMPLETED" && direct.value.output?.authority === "NONE";
    return [ok, `output "${output ?? ""}", labelled ${labelled}, preferences unchanged after hostile context ${String(unchanged)}`];
  });

  // ── E2E-17 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-17", "a model the user chose over an API receives the request and the project context, and no local/remote control exists", async () => {
    // ADR-040 (2026-10-07): لا خيار «محلي/بعيد» في أيّ طبقة. ما كان يُثبته هذا الشرط (رفض البعيد) صار عكسه المقيس.
    await go("/providers");
    const card = await waitFor(() => providerCard(REMOTE_PROVIDER));
    if (card === null) return [false, "remote provider card missing"];
    if (!(await clickAndWait(t.t("providers.action.enable"), card))) return [false, "enable unavailable"];
    if (!(await clickAndWait(t.t("providers.action.check"), card))) return [false, "check unavailable"];
    const healthy = await waitFor(() => healthOf(REMOTE_PROVIDER, t, "HEALTHY"), 15_000);
    if (healthy === null) return [false, `remote fixture not healthy: ${text(".item__head .pill", card)}`];
    const enabledRemote = await api.configureModel(REMOTE_MODEL, true);
    await go("/models");
    const reviewer = await waitFor(() => field<HTMLSelectElement>("models-reviewer"));
    // لا عنصر تحكّم بالموقع بأيّ معرّف (الاسم القديم لا يُكتب هنا كي يبقى فحص المصدر صارمًا).
    const noLocality = doc().querySelector('[id*="localit"], [name*="localit"]') === null;
    const plain = await api.invokeModel({ invocation_id: createId(), routing_mode: "MANUAL", model_id: REMOTE_MODEL, messages: [{ role: "USER", text: "x" }] });
    const detail = await api.getProject(projectId);
    const sources = detail.ok ? detail.value.sources.filter((source) => source.source_type === "FILE").map((source) => source.source_id) : [];
    const withContext = await api.invokeModel({
      invocation_id: createId(),
      routing_mode: "MANUAL",
      model_id: REMOTE_MODEL,
      project_id: projectId,
      context_source_ids: sources,
      messages: [{ role: "USER", text: "x" }],
    });
    const describe = (r: typeof plain) => (r.ok ? `${r.value.status}/${r.value.routing.reason_codes.join("+")}/${r.value.egress.decision}/${r.value.egress.reason}` : "error");
    const reached = (r: typeof plain) => r.ok && r.value.status !== "DENIED" && r.value.egress.decision === "ALLOWED" && r.value.egress.network_class === "REMOTE_EGRESS";
    const ok = enabledRemote.ok && reviewer !== null && noLocality && reached(plain) && reached(withContext) && withContext.ok && withContext.value.egress.context_attached;
    return [ok, `reviewer select ${reviewer !== null}, locality control absent ${noLocality}; plain ${describe(plain)}; with project context ${describe(withContext)}`];
  });

  // ── E2E-18 / E2E-19 ───────────────────────────────────────────────────────
  const screens = ["/providers", "/models", "/projects", `/projects/${projectId}`];
  for (const [id, code, direction] of [["E2E-18", "ar", "rtl"], ["E2E-19", "en", "ltr"]] as const) {
    await step(recorder, id, `${code === "ar" ? "Arabic" : "English"} renders ${direction.toUpperCase()} on every Phase-02 screen`, async () => {
      const before = missingKeys.size;
      if (!(await setLocale(code))) return [false, "locale switch unavailable"];
      const translator = createTranslator(code);
      const titles: string[] = [];
      for (const path of screens) {
        await go(path);
        await sleep(400);
        titles.push(text(".page-title"));
      }
      const dir = doc().documentElement.getAttribute("dir");
      const expected = translator.t("providers.title");
      const ok = dir === direction && titles[0] === expected && missingKeys.size === before;
      return [ok, `dir ${dir ?? "none"}, titles ${titles.join(" | ")}, new missing keys ${missingKeys.size - before}`];
    });
  }
  await setLocale("en");

  // ── E2E-21 ────────────────────────────────────────────────────────────────
  await step(recorder, "E2E-21", "archive the project; it becomes read only and nothing is deleted", async () => {
    await go(`/projects/${projectId}`);
    if (!(await clickAndWait(t.t("project.action.archive")))) return [false, "archive unavailable"];
    const archived = await waitForProject(api, projectId, (value) => value.project.status === "ARCHIVED");
    const refused = await api.addContext({ project_id: projectId, source_type: "TEXT_NOTE", text: "late", display_name: "late" });
    const kept = archived !== null ? archived.sources.length : 0;
    return [archived !== null && !refused.ok && kept >= 3, `archived ${String(archived !== null)}, write refused ${String(!refused.ok)}, sources kept ${kept}`];
  });

  const memory = (globalThis.performance as { memory?: { usedJSHeapSize?: number } } | undefined)?.memory?.usedJSHeapSize;
  recorder.facts["renderer_js_heap_bytes"] = memory ?? null;
  recorder.facts["project_id"] = projectId;
}

async function liveStep(api: Phase02Client, recorder: Recorder): Promise<void> {
  const liveTitle = "optional live local model server: discovery through the host and one bounded invocation";
  try {
    const listed = await api.listProviders();
    if (!listed.ok) {
      recorder.skip("LIVE-01", liveTitle, "provider.list failed");
      return;
    }
    const live = listed.value.providers.filter(
      (provider) => provider.locality === "LOCAL" && provider.provider_id !== GENERIC_PROVIDER && provider.health.state === "HEALTHY",
    );
    const summary: Record<string, unknown> = {};
    for (const provider of live) {
      const models = await api.listModels({ provider_id: provider.provider_id });
      const views = models.ok ? models.value.models : [];
      summary[provider.provider_id] = {
        health_latency: provider.health.latency ?? null,
        model_ids: views.slice(0, 50).map((model) => model.provider_model_id),
        discovered: views.length,
        loaded: views.filter((model) => model.loaded_state.value === "LOADED").map((model) => model.provider_model_id),
      };
    }
    recorder.facts["live_local_providers"] = summary;
    const candidates = [];
    for (const provider of live) {
      const models = await api.listModels({ provider_id: provider.provider_id });
      const loaded = models.ok ? models.value.models.find((model) => model.loaded_state.value === "LOADED" && model.kind !== "EMBEDDING") : undefined;
      if (loaded !== undefined) candidates.push(loaded);
    }
    const chosen = candidates[0];
    if (chosen === undefined) {
      recorder.skip("LIVE-01", liveTitle, live.length === 0 ? "no local model server answered" : "a server answered but reported no loaded chat model; nothing was loaded on its behalf");
      return;
    }
    await api.configureModel(chosen.model_id, true);
    const started = now();
    const result = await api.invokeModel({
      invocation_id: createId(),
      routing_mode: "MANUAL",
      model_id: chosen.model_id,
      messages: [{ role: "USER", text: "Reply with the single word OK." }],
      max_output_tokens: 16,
      timeout_ms: 60_000,
    });
    recorder.measure("live_invocation_round_trip", started, "model.invoke round trip against a live local model server");
    await api.configureModel(chosen.model_id, false);
    if (!result.ok) {
      recorder.add("LIVE-01", liveTitle, false, `model.invoke boundary error ${result.error.code}`);
      return;
    }
    recorder.facts["live_invocation"] = {
      provider_id: chosen.provider_id,
      model: chosen.provider_model_id,
      status: result.value.status,
      error: result.value.error ?? null,
      timing: result.value.timing,
      usage: result.value.usage ?? null,
      output_characters: result.value.output?.text.length ?? 0,
    };
    recorder.add("LIVE-01", liveTitle, result.value.status === "COMPLETED", `${chosen.provider_id} ${result.value.status}`);
  } catch (error) {
    recorder.add("LIVE-01", liveTitle, false, `threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function restartStage(
  client: DesktopIpcClient,
  api: Phase02Client,
  recorder: Recorder,
  projectName: string,
  config: Phase02SuiteConfig,
): Promise<void> {
  await step(recorder, "E2E-20", "after a restart the project, the bindings and the provider configuration remain", async () => {
    const boot = await client.bootstrap();
    const projects = await api.listProjects({ include_archived: true });
    const project = projects.ok ? projects.value.projects.find((entry) => entry.name === projectName) : undefined;
    const detail = project === undefined ? null : await api.getProject(project.project_id);
    const models = await api.listModels();
    const providers = await api.listProviders();
    const generic = providers.ok ? providers.value.providers.find((entry) => entry.provider_id === GENERIC_PROVIDER) : undefined;
    const chat = models.ok ? models.value.models.find((model) => model.model_id === CHAT_MODEL) : undefined;
    const checks = {
      bootstrap: boot.ok,
      project_found: project !== undefined,
      project_archived: project?.status === "ARCHIVED",
      project_model: project?.default_model_id === CHAT_MODEL,
      sources_kept: detail?.ok === true ? detail.value.sources.length : 0,
      default_model: models.ok ? models.value.preferences.default_model_id ?? null : null,
      model_enabled: chat?.enabled === true,
      endpoint_kept: generic?.endpoint === config.fixture_endpoint,
    };
    recorder.facts["restart_checks"] = checks;
    const ok =
      checks.bootstrap && checks.project_found && checks.project_archived && checks.project_model &&
      checks.sources_kept >= 3 && checks.default_model === CHAT_MODEL && checks.model_enabled && checks.endpoint_kept;
    return [ok, JSON.stringify(checks)];
  });
}

async function waitForProject(
  api: Phase02Client,
  projectId: string,
  predicate: (value: ProjectGetResultV1) => boolean,
): Promise<ProjectGetResultV1 | null> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await api.getProject(projectId);
    if (result.ok && predicate(result.value)) return result.value;
    await sleep(250);
  }
  return null;
}

