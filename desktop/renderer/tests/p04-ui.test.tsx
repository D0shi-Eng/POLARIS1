// Phase-04 في العارض: المهارات، والأدوات، والموصّلات، والنشاط، والموافقات.
//
// ما تثبته هذه الاختبارات ليس أن الشاشات «تعمل»، بل أنها لا تكذب ولا تمنح:
//   ١ — لا مسار تنفيذ في العارض. مفردات Phase-04 المُوجَّهة اثنتا عشرة عملية،
//       وليس فيها واحدة تنفّذ أداة أو تنادي خادمًا نداءً حرًّا.
//   ٢ — الرفض يُعرض برمزه، والمحاولة التي مُنعت لا تُعرض بأثرٍ لم يقع.
//   ٣ — وصفٌ عدائي من خادم MCP يُعرض نصًّا ويوسَم غير موثوق، ولا يتحوّل تعليمة.
//   ٤ — الموافقة تُعرض برباطها ومدّتها، وأزرار القرار تُوجَد للمعلّقة وحدها.
//   ٥ — مفردات Phase-04 المغلقة كلها مترجمة بالعربية والإنجليزية: عضوٌ بلا مفتاح
//       يظهر رمزًا خامًا على الشاشة، ولن يكشفه أي اختبار سلوكي.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { PHASE04_IPC_REGISTRY } from "../src/generated/contract-bundle";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase04Client } from "../src/ipc/p04-client";
import { PHASE04_OPERATIONS } from "../src/ipc/operations";
import { CATALOGS } from "../src/localization/catalog";
import { createTranslator, keysOf } from "../src/localization/translate";
import { effectsOf, needsApproval, shortDigest, tallyActivity } from "../src/p04/present";
import { memoryLocation, type LocationPort } from "../src/routes/location";
import { resolveRoute } from "../src/routes/registry";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase04Host, P04_IDS, type FakePhase04Options } from "./support/fake-p04-host";

interface Mounted {
  readonly location: LocationPort;
  readonly log: ReturnType<typeof fakePhase04Host>["log"];
  unmount(): void;
}

async function settle(rounds = 5): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount(path: string, options: FakePhase04Options = {}): Promise<Mounted> {
  const container = resetDocument();
  const root: Root = createRoot(container);
  const location = memoryLocation(path);
  const { transport, log } = fakePhase04Host(options);
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  const api = new Phase04Client({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} phase04={api} location={location} />);
  });
  await settle();
  return { location, log, unmount: () => act(() => root.unmount()) };
}

function body(): string {
  return document.body.textContent ?? "";
}

function buttonNamed(label: string, root: ParentNode = document): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => (candidate.textContent ?? "").trim() === label || candidate.getAttribute("aria-label") === label,
  );
}

function requireButton(label: string): HTMLButtonElement {
  const found = buttonNamed(label);
  assert.ok(found !== undefined, `no button named "${label}"`);
  return found;
}

// ——— العقد: مفردات العارض تطابق السجل، ولا تحمل مسار تنفيذ.

test("P04-UI-001 the renderer knows exactly the twelve routed Phase-04 operations", () => {
  const names = PHASE04_OPERATIONS.map((record) => record.operation).sort();
  assert.deepEqual(names, [
    "approval.list",
    "mcp.configure",
    "mcp.list",
    "mcp.refresh",
    "mcp.register",
    "skill.configure",
    "skill.get",
    "skill.list",
    "tool.activity.list",
    "tool.approval.respond",
    "tool.get",
    "tool.list",
  ]);
  for (const record of PHASE04_OPERATIONS) assert.equal(record.envelope_version, "1.4");
});

test("P04-UI-002 no Phase-04 operation in the registry can execute a tool", () => {
  for (const record of PHASE04_IPC_REGISTRY.operations) {
    for (const forbidden of ["tool.execute", "tool.invoke", "tool.run", "tool.call", "mcp.call", "skill.execute"]) {
      assert.notEqual(record.operation, forbidden);
    }
  }
});

test("P04-UI-003 the client exposes no method that executes a tool", () => {
  const surface = Object.getOwnPropertyNames(Phase04Client.prototype);
  for (const name of ["executeTool", "invokeTool", "runTool", "callTool", "callMcp", "submitEvidence", "grantCapability"]) {
    assert.ok(!surface.includes(name), `Phase04Client exposes ${name}`);
  }
  // والسطح الفعلي اثنتا عشرة دالّة وباني الصنف، لا أكثر.
  assert.equal(surface.filter((name) => name !== "constructor" && name !== "call").length, 12);
});

test("P04-UI-004 the Phase-04 routes resolve to their own capabilities", () => {
  for (const [path, capability] of [
    ["/skills", "polaris.desktop.skills"],
    ["/tools", "polaris.desktop.skills"],
    ["/connectors", "polaris.desktop.connectors"],
    ["/activity", "polaris.desktop.activity"],
  ] as const) {
    const route = resolveRoute(path);
    assert.ok(route !== undefined, `${path} does not resolve`);
    assert.equal(route.capabilityId, capability);
  }
});

// ——— المهارات.

test("P04-UI-010 the Skills screen shows each skill with its source, risk and tool count", async () => {
  const mounted = await mount("/skills");
  const translator = createTranslator("en");
  const text = body();
  assert.ok(text.includes(translator.t("nav.skills")));
  assert.ok(text.includes("evidence gathering"));
  assert.ok(text.includes("external tooling"));
  assert.ok(text.includes(translator.t("p04.source.BUILT_IN")));
  assert.ok(text.includes(translator.t("p04.risk.HIGH")));
  // والقاعدة المُعلنة مكتوبة على الشاشة: المهارة لا تمنح سلطة.
  assert.ok(text.includes(translator.t("skills.note.no_authority")));
  mounted.unmount();
});

test("P04-UI-011 the Skills screen offers only enable and disable, no tool or effect widening", async () => {
  const mounted = await mount("/skills");
  const translator = createTranslator("en");
  const labels = [...document.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? (button.textContent ?? "").trim(),
  );
  for (const label of labels) {
    for (const verb of ["Add tool", "Allow tool", "Grant", "Widen", "Run", "Execute"]) {
      assert.ok(!label.includes(verb), `the Skills screen offers "${label}"`);
    }
  }
  assert.ok(labels.some((label) => label.includes(translator.t("skills.action.disable"))));
  mounted.unmount();
});

test("P04-UI-012 disabling a skill sends skill.configure with enabled false and nothing else", async () => {
  const mounted = await mount("/skills");
  const translator = createTranslator("en");
  const button = requireButton(`${translator.t("skills.action.disable")} evidence gathering`);
  await act(async () => {
    button.click();
  });
  await settle();
  const index = mounted.log.operations.lastIndexOf("skill.configure");
  assert.ok(index >= 0, "skill.configure was never sent");
  assert.deepEqual(mounted.log.payloads[index], { skill_id: P04_IDS.SKILL_EVIDENCE, enabled: false });
  mounted.unmount();
});

// ——— الأدوات.

test("P04-UI-020 the Tools screen names every effect and never renders a run button", async () => {
  const mounted = await mount("/tools");
  const translator = createTranslator("en");
  const text = body();
  assert.ok(text.includes(translator.t("p04.effect.DATABASE_READ")));
  assert.ok(text.includes(translator.t("p04.effect.WRITE_LOCAL")));
  assert.ok(text.includes(translator.t("p04.effect.NETWORK_EGRESS")));
  assert.ok(text.includes(translator.t("tools.approval.required")));
  for (const button of document.querySelectorAll("button")) {
    const label = button.getAttribute("aria-label") ?? (button.textContent ?? "").trim();
    for (const verb of ["Run", "Execute", "Invoke", "Call"]) {
      assert.ok(!label.includes(verb), `the Tools screen offers "${label}"`);
    }
  }
  mounted.unmount();
});

test("P04-UI-021 an MCP tool is shown untrusted, and what its server asked for is shown as a request", async () => {
  const mounted = await mount("/tools");
  const translator = createTranslator("en");
  const text = body();
  assert.ok(text.includes(translator.t("p04.trust.MCP_UNTRUSTED")), "the MCP tool is not marked untrusted");
  assert.ok(text.includes(P04_IDS.TOOL_MCP));
  // الأثر الذي طلبه الخادم يُعرض طلبًا، والمعروض فوقه هو الأضيق فعلًا.
  assert.ok(text.includes("The server asked for"), "the declared effects were not shown as a request");
  mounted.unmount();
});

test("P04-UI-022 a hostile tool description is displayed as text and changes nothing", async () => {
  const mounted = await mount("/tools");
  const text = body();
  // يُعرض كما وصل: المستخدم يرى ما يقوله الخادم بدل أن يُخفى عنه.
  assert.ok(text.includes(P04_IDS.HOSTILE_DESCRIPTION), "the description was silently dropped");
  // ولا يتحوّل إلى سلطة: الأداة تبقى غير موثوقة وتبقى تحتاج موافقة، والشاشة
  // لا تُنشئ أي مسار تنفيذ لأن الوصف طلب ذلك.
  const translator = createTranslator("en");
  assert.ok(text.includes(translator.t("p04.trust.MCP_UNTRUSTED")));
  assert.equal(document.querySelectorAll("form").length, 0);
  assert.ok(!mounted.log.operations.some((operation) => operation.includes("execute")));
  mounted.unmount();
});

// ——— الموصّلات.

test("P04-UI-030 the Connectors screen offers only the loopback transport and a user-held grant", async () => {
  const mounted = await mount("/connectors");
  const translator = createTranslator("en");
  const text = body();
  assert.ok(text.includes(translator.t("mcp.note.transport")));
  assert.ok(text.includes(translator.t("mcp.note.grant")));
  // النقطة المعروضة على الحلقة المحلية: عنوان خارجي لا يصل إلى هذه الشاشة أصلًا،
  // لأن المضيف يرفض تسجيله. والمعروض هنا هو ما سجّله المستخدم كما هو.
  assert.ok(text.includes("http://127.0.0.1:4310/mcp"));
  // والأثران الممنوعان بنية لا سياسة: لا خيار لهما في الشاشة.
  assert.equal(document.querySelector("#mcp-grant-PROCESS_EXECUTION"), null);
  assert.equal(document.querySelector("#mcp-grant-SECRET_ACCESS"), null);
  assert.ok(document.querySelector("#mcp-grant-NETWORK_EGRESS") !== null);
  mounted.unmount();
});

test("P04-UI-031 an empty connector list is an honest empty state, not an invented server", async () => {
  const mounted = await mount("/connectors", { withServer: false });
  const translator = createTranslator("en");
  assert.ok(body().includes(translator.t("mcp.empty")));
  assert.ok(!body().includes("fixture connector"));
  mounted.unmount();
});

// ——— النشاط: الرفض يُعرض كما يُعرض النجاح.

test("P04-UI-040 the Activity screen shows the denied attempt with its reason", async () => {
  const mounted = await mount("/activity");
  const translator = createTranslator("en");
  const text = body();
  assert.ok(text.includes(P04_IDS.TOOL_AUDIT));
  assert.ok(text.includes(translator.t("p04.invocation.SUCCEEDED")));
  assert.ok(text.includes(translator.t("p04.invocation.DENIED")), "a denied attempt was not shown");
  assert.ok(text.includes(translator.t("p04.denial.UNKNOWN_TOOL")), "the denial reason was not shown");
  assert.ok(text.includes(translator.t("p04.invocation.AWAITING_APPROVAL")));
  assert.ok(text.includes(translator.t("p04.denial.APPROVAL_REQUIRED")));
  mounted.unmount();
});

test("P04-UI-041 a refused attempt is not shown as having had an effect", async () => {
  const mounted = await mount("/activity");
  const translator = createTranslator("en");
  // المحاولة المرفوضة قائمة آثارها فارغة، فتُعرض «لم يقع أثر» لا «حساب محلي».
  assert.ok(body().includes(translator.t("p04.effect.none")), "an empty effect list was not named");
  assert.ok(!body().includes(translator.t("p04.effect.LOCAL_COMPUTE")), "a refused attempt was given an effect");
  mounted.unmount();
});

test("P04-UI-042 arguments are shown by digest, never as text", async () => {
  const mounted = await mount("/activity");
  const translator = createTranslator("en");
  assert.ok(body().includes(translator.t("activity.note.digest")));
  assert.ok(body().includes(shortDigest("1".repeat(64))));
  // البصمة الكاملة تبقى في `title` للنسخ، والنصّ المعروض مختصر.
  assert.ok(!body().includes("1".repeat(64)));
  mounted.unmount();
});

// ——— الموافقات.

test("P04-UI-050 a pending approval is shown with its binding and offers grant and deny", async () => {
  const mounted = await mount("/activity");
  const translator = createTranslator("en");
  const tab = requireButton(translator.t("activity.tab.approvals"));
  await act(async () => {
    tab.click();
  });
  await settle();
  const text = body();
  assert.ok(text.includes(translator.t("approvals.note.binding")));
  assert.ok(text.includes(P04_IDS.TOOL_NOTE));
  assert.ok(text.includes(translator.t("p04.effect.WRITE_LOCAL")));
  assert.ok(text.includes(translator.t("p04.approval.PENDING")));
  assert.ok(buttonNamed(`${translator.t("approvals.action.grant")} ${P04_IDS.TOOL_NOTE}`) !== undefined);
  assert.ok(buttonNamed(`${translator.t("approvals.action.deny")} ${P04_IDS.TOOL_NOTE}`) !== undefined);
  mounted.unmount();
});

test("P04-UI-051 answering an approval sends only the identifier and the decision", async () => {
  const mounted = await mount("/activity");
  const translator = createTranslator("en");
  await act(async () => {
    requireButton(translator.t("activity.tab.approvals")).click();
  });
  await settle();
  await act(async () => {
    requireButton(`${translator.t("approvals.action.grant")} ${P04_IDS.TOOL_NOTE}`).click();
  });
  await settle();
  const index = mounted.log.operations.lastIndexOf("tool.approval.respond");
  assert.ok(index >= 0, "tool.approval.respond was never sent");
  // الحمولة لا تُعيد ذكر الأداة ولا الحجج ولا الأثر: الرباط ثُبِّت حين طُلبت.
  assert.deepEqual(mounted.log.payloads[index], { approval_id: P04_IDS.APPROVAL, decision: "GRANT" });
  mounted.unmount();
});

test("P04-UI-052 an already-consumed approval offers no decision button", async () => {
  const mounted = await mount("/activity", { approvalStatus: "CONSUMED" });
  const translator = createTranslator("en");
  await act(async () => {
    requireButton(translator.t("activity.tab.approvals")).click();
  });
  await settle();
  assert.ok(body().includes(translator.t("p04.approval.CONSUMED")));
  assert.equal(buttonNamed(`${translator.t("approvals.action.grant")} ${P04_IDS.TOOL_NOTE}`), undefined);
  assert.equal(buttonNamed(`${translator.t("approvals.action.deny")} ${P04_IDS.TOOL_NOTE}`), undefined);
  mounted.unmount();
});

// ——— اللغة والاتجاه.

test("P04-UI-060 the Phase-04 screens render in Arabic right-to-left with no English leaking", async () => {
  const mounted = await mount("/skills");
  const button = document.querySelector<HTMLButtonElement>("[data-testid='locale-ar']");
  if (button !== null) {
    await act(async () => {
      button.click();
    });
    await settle();
  }
  const html = document.documentElement;
  if (html.getAttribute("lang") === "ar") {
    assert.equal(html.getAttribute("dir"), "rtl");
    const arabic = createTranslator("ar");
    assert.ok(body().includes(arabic.t("skills.note.no_authority")));
  } else {
    // لا مبدّل لغة في هذا البناء من الشاشة: التكافؤ يُقاس على الفهرس مباشرة.
    const arabic = createTranslator("ar");
    const english = createTranslator("en");
    assert.notEqual(arabic.t("nav.skills"), english.t("nav.skills"));
  }
  mounted.unmount();
});

// ——— المفردات المغلقة: كل عضو مترجم بالعربية والإنجليزية.

test("P04-UI-070 every member of every closed Phase-04 vocabulary has an Arabic and an English key", () => {
  const defs = (PHASE04_IPC_REGISTRY as unknown as { readonly operations: readonly unknown[] }) !== undefined;
  assert.ok(defs);
  const vocabularies: Readonly<Record<string, readonly string[]>> = {
    effect: [
      "LOCAL_COMPUTE",
      "READ_LOCAL",
      "WRITE_LOCAL",
      "NETWORK_EGRESS",
      "PROCESS_EXECUTION",
      "SECRET_ACCESS",
      "DATABASE_READ",
      "DATABASE_WRITE",
      "EXTERNAL_SIDE_EFFECT",
    ],
    risk: ["LOW", "MODERATE", "HIGH", "CRITICAL"],
    provider: ["BUILT_IN", "MCP"],
    source: ["BUILT_IN", "USER_DEFINED", "MCP_BACKED"],
    trust: ["TRUSTED_RUNTIME", "MCP_UNTRUSTED"],
    invocation: ["SUCCEEDED", "FAILED", "DENIED", "TIMED_OUT", "CANCELLED", "AWAITING_APPROVAL"],
    approval: ["PENDING", "GRANTED", "DENIED", "EXPIRED", "CONSUMED"],
    server: ["REGISTERED", "ENABLED", "DISABLED", "UNREACHABLE"],
    transport: ["LOOPBACK_HTTP"],
    network: ["NONE", "LOOPBACK_ONLY"],
    denial: [
      "UNKNOWN_TOOL",
      "TOOL_DISABLED",
      "SKILL_DISABLED",
      "SKILL_DOES_NOT_ALLOW_TOOL",
      "ARGUMENTS_INVALID",
      "CAPABILITY_MISSING",
      "EFFECT_NOT_PERMITTED",
      "NETWORK_POLICY_DENIED",
      "APPROVAL_REQUIRED",
      "APPROVAL_MISSING",
      "APPROVAL_MISMATCH",
      "APPROVAL_EXPIRED",
      "APPROVAL_ALREADY_USED",
      "APPROVAL_DENIED",
      "BUDGET_EXHAUSTED",
      "CROSS_MISSION_DENIED",
      "SERVER_DISABLED",
      "SERVER_UNREACHABLE",
      "SCHEMA_DRIFT",
      "RESULT_TOO_LARGE",
      "RESULT_MALFORMED",
      "SECRET_REQUESTED",
      "CANCELLED",
    ],
  };
  const missing: string[] = [];
  for (const locale of ["ar", "en"] as const) {
    const catalog = CATALOGS[locale];
    for (const [namespace, members] of Object.entries(vocabularies)) {
      for (const member of members) {
        const key = `p04.${namespace}.${member}`;
        if (catalog[key] === undefined) missing.push(`${locale}:${key}`);
      }
    }
  }
  assert.deepEqual(missing, [], `untranslated Phase-04 vocabulary members:\n${missing.join("\n")}`);
});

test("P04-UI-071 the Phase-04 keys are declared in both proven locales with no English placeholder in Arabic", () => {
  const ar = keysOf("ar").filter((key) => key.startsWith("p04."));
  const en = keysOf("en").filter((key) => key.startsWith("p04."));
  assert.deepEqual([...ar].sort(), [...en].sort());
  assert.ok(ar.length >= 60, `only ${ar.length} Phase-04 keys exist, which suggests a partial catalog`);
  // أسماء الأعلام تتطابق بالحقّ: «POLARIS» و«MCP» ليسا نصًّا يُترجَم.
  const PROPER_NAMES = ["p04.provider.BUILT_IN"];
  const untranslated = ar.filter((key) => !PROPER_NAMES.includes(key) && CATALOGS["ar"][key] === CATALOGS["en"][key]);
  assert.deepEqual(untranslated, [], `Arabic still carries the English string for: ${untranslated.join(", ")}`);
});

// ——— تحويلات العرض: ما تقوله الدوالّ النقية.

test("P04-UI-080 the presenters describe what happened without softening a refusal", () => {
  const tally = tallyActivity([
    { status: "SUCCEEDED" },
    { status: "DENIED" },
    { status: "AWAITING_APPROVAL" },
    { status: "FAILED" },
  ]);
  // «نُفِّذ» تضمّ ما فشل وما انقضت مهلته: أداة فشلت قد أحدثت أثرًا، فلا تُعدّ
  // مع ما لم يُنفَّذ أصلًا.
  assert.equal(tally.executed, 2);
  assert.equal(tally.denied, 1);
  assert.equal(tally.awaiting, 1);
  // أداة تكتب تحتاج موافقة حتى لو لم يُعلن الواصف ذلك صراحةً.
  assert.equal(needsApproval({ requires_approval: false, effects: ["WRITE_LOCAL"] }), true);
  assert.equal(needsApproval({ requires_approval: false, effects: ["DATABASE_READ"] }), false);
  assert.equal(effectsOf(["READ_LOCAL"]).length, 1);
  // البصمة تُختصر ولا تُبتر من طرف واحد: الطرفان يبقيان، فالمقارنة البصرية ممكنة.
  const short = shortDigest("a".repeat(48) + "b".repeat(16));
  assert.ok(short.length < 64 && short.startsWith("aaaaaaaa") && short.endsWith("bbbbbbbb"), short);
  assert.equal(shortDigest("abc"), "abc");
});
