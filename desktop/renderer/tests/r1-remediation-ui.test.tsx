// تكليف الإصلاح 2026-10-12، R-11: اكتمال الواجهة لطبقات الحماية الجديدة.
//
// ما يثبته هذا الملف في jsdom (لا نافذة WebView2 حقيقية — تلك في اختبارات النافذة الأصلية على Windows):
//   ١ — UNVERIFIED_DONE حالة نهائية: لا تُعدّ «الخطوة الحالية» في العدّاد، ولا تُرسم نجاحًا، ولها ترجمة بالعربية والإنجليزية.
//   ٢ — أسباب التوقّف الجديدة (STORAGE_FAILURE، REPEATED_DENIALS، TAMPER_DETECTED) مترجمة.
//   ٣ — العارض يستطيع تسمية `mission.trace` و`mcp.tool.accept_redefinition`، ولوحة التتبّع تعرض ما قاسه المضيف.
//   ٤ — قبول إعادة تعريف أداة MCP قرار صريح يرسل معرّف الأداة.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { TranslatorProvider } from "../src/app/context";
import type { MissionTraceResultV1 } from "../src/generated/types/desktop-p08-result-v1";
import { PHASE08_OPERATIONS } from "../src/ipc/operations";
import { Phase08Client } from "../src/ipc/p08-client";
import { createTranslator } from "../src/localization/translate";
import { MissionTrace, traceTotals } from "../src/screens/p08/MissionTrace";
import { isFinished, stepCounter } from "../src/screens/p08/StepTree";
import { RedefinitionNotice } from "../src/screens/p04/RedefinitionNotice";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

type Step = Parameters<typeof stepCounter>[0][number];
const step = (id: string, state: string): Step => ({ task_id: id, state, title: id, task_type: "BUILD", attempt: 0 }) as unknown as Step;

test("R11-UI-01 UNVERIFIED_DONE is a finished state and never the current step", () => {
  assert.equal(isFinished("UNVERIFIED_DONE"), true);
  const counter = stepCounter([step("a", "SUCCEEDED"), step("b", "UNVERIFIED_DONE"), step("c", "PENDING")]);
  assert.deepEqual(counter, { current: 3, total: 3 }, "an unverified-done step was counted as the current one");
  const allDone = stepCounter([step("a", "UNVERIFIED_DONE"), step("b", "UNVERIFIED_DONE")]);
  assert.deepEqual(allDone, { current: 2, total: 2 });
});

test("R11-UI-02 the new state and stop reasons have Arabic and English text, not their keys", () => {
  for (const locale of ["ar", "en"] as const) {
    const t = createTranslator(locale);
    for (const key of ["p03.task_state.UNVERIFIED_DONE", "p03.stop.STORAGE_FAILURE", "p03.stop.REPEATED_DENIALS", "p03.stop.TAMPER_DETECTED", "p08.trace.title", "mcp.redefined.accept", "models.monitor_model"]) {
      assert.ok(t.has(key), `${locale} has no text for ${key}`);
      assert.notEqual(t.t(key), key);
    }
  }
});

test("R11-UI-03 the client sends the trace and the redefinition-acceptance operations, and both are registered", async () => {
  for (const op of ["mission.trace", "mcp.tool.accept_redefinition"]) {
    assert.ok(PHASE08_OPERATIONS.some((record) => record.operation === op), `${op} is not a routed Phase-08 operation`);
  }
  const sent: string[] = [];
  const transport = { send: async (envelope: unknown) => (sent.push(String((envelope as Record<string, unknown>)["operation"])), { not: "an envelope" }) };
  const client = new Phase08Client({ transport, identity: IDENTITY });
  await client.missionTrace("11111111-1111-4111-8111-111111111111");
  await client.acceptToolRedefinition("mcp:11111111:drift");
  assert.deepEqual(sent, ["mission.trace", "mcp.tool.accept_redefinition"]);
});

const TRACE: MissionTraceResultV1 = {
  mission_id: "11111111-1111-4111-8111-111111111111",
  semconv: "gen_ai/1.37-development",
  spans: [
    { span_id: "a".repeat(16), trace_id: "b".repeat(32), name: "invoke_agent", agent_id: "agent-1", status: "OK", started_at: "t", semconv: "s" },
    { span_id: "c".repeat(16), trace_id: "b".repeat(32), name: "chat", model_id: "qwen-local", input_tokens: 40, output_tokens: 5, latency_ms: 900, status: "OK", started_at: "t", semconv: "s" },
    { span_id: "d".repeat(16), trace_id: "b".repeat(32), name: "chat", model_id: "monitor-model", tool_id: "polaris.execution.command", input_tokens: 30, output_tokens: 2, status: "OK", gate_decision: "MONITOR_BLOCKED", started_at: "t", semconv: "s" },
    { span_id: "e".repeat(16), trace_id: "b".repeat(32), name: "execute_tool", tool_id: "polaris.execution.command", status: "DENIED", gate_decision: "MONITOR_BLOCKED", started_at: "t", semconv: "s" },
  ],
  spans_total: 4,
  next_after: null,
  totals: { agents: 1, model_calls: 2, tool_calls: 1, input_tokens: 70, output_tokens: 7, unreported: 0, denied: 1 },
  security_events: [{ seq: 4, kind: "MONITOR_BLOCKED", detail: "polaris.execution.command: not requested", created_at: "t" }],
  session_events: 6,
  session_chain: { state: "BROKEN", at_seq: 5 },
};

test("CP-10-1 a long trace shows one page, totals for the whole task, and loads the next page on request", async () => {
  const span = (i: number) => ({ span_id: i.toString(16).padStart(16, "0"), trace_id: "b".repeat(32), name: "execute_tool" as const, tool_id: "polaris.workspace.write", status: "OK" as const, started_at: "t", semconv: "s" });
  const first: MissionTraceResultV1 = { ...TRACE, spans: Array.from({ length: 500 }, (_, i) => span(i)), spans_total: 900, next_after: 500, totals: { ...TRACE.totals, tool_calls: 900 } };
  const second: MissionTraceResultV1 = { ...first, spans: Array.from({ length: 400 }, (_, i) => span(500 + i)), next_after: null };
  const asked: (number | undefined)[] = [];
  const phase08 = { missionTrace: async (_id: string, _otlp?: boolean, after?: number) => (asked.push(after), { ok: true as const, value: after === 500 ? second : first }) } as unknown as Phase08Client;
  const container = resetDocument();
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <TranslatorProvider translator={createTranslator("en")}>
        <MissionTrace phase08={phase08} missionId={TRACE.mission_id} refreshKey="1" onClose={() => undefined} />
      </TranslatorProvider>,
    );
  });
  await settle();
  assert.equal(container.querySelectorAll(".steptree__list > li").length, 500, "more than one page was rendered");
  assert.ok((container.textContent ?? "").includes("tools 900"), "the totals did not cover the whole task");
  const more = [...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("500 of 900"));
  assert.ok(more !== undefined, "no way to load the next page");
  await act(async () => {
    more.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
  assert.deepEqual(asked, [undefined, 500]);
  assert.equal(container.querySelectorAll(".steptree__list > li").length, 900);
  assert.equal([...container.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes("of 900")).length, 0, "the button stayed after the last page");
  root.unmount();
});

test("R11-UI-04 the trace panel shows measured totals, the monitor decision, and a broken session chain as an alert", async () => {
  assert.deepEqual(traceTotals(TRACE), { agents: 1, modelCalls: 2, toolCalls: 1, inputTokens: 70, outputTokens: 7, unreported: 0, denied: 1 });
  const container = resetDocument();
  const root = createRoot(container);
  const asked: string[] = [];
  const phase08 = { missionTrace: async (id: string) => (asked.push(id), { ok: true as const, value: TRACE }) } as unknown as Phase08Client;
  await act(async () => {
    root.render(
      <TranslatorProvider translator={createTranslator("ar")}>
        <MissionTrace phase08={phase08} missionId={TRACE.mission_id} refreshKey="1" onClose={() => undefined} />
      </TranslatorProvider>,
    );
  });
  await settle();
  assert.deepEqual(asked, [TRACE.mission_id]);
  const text = container.textContent ?? "";
  assert.ok(text.includes("MONITOR_BLOCKED"), "the monitor decision is not shown");
  assert.ok(container.querySelector('[role="alert"]')?.textContent?.includes("5"), "a broken session chain is not raised as an alert");
  root.unmount();
});

test("R11-UI-05 accepting a redefined MCP tool is an explicit decision that sends the tool id", async () => {
  const container = resetDocument();
  const root = createRoot(container);
  const sent: string[] = [];
  const accepted: string[] = [];
  const client = { acceptToolRedefinition: async (id: string) => (sent.push(id), { ok: true as const, value: { tool_id: id, accepted: true, pending: [] } }) } as unknown as Phase08Client;
  await act(async () => {
    root.render(
      <TranslatorProvider translator={createTranslator("en")}>
        <RedefinitionNotice pending={["mcp:11111111:drift"]} client={client} onAccepted={(id) => accepted.push(id)} />
      </TranslatorProvider>,
    );
  });
  assert.deepEqual(sent, [], "a redefinition was accepted without a click");
  const button = container.querySelector("button");
  assert.ok(button !== null);
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
  assert.deepEqual(sent, ["mcp:11111111:drift"]);
  assert.deepEqual(accepted, ["mcp:11111111:drift"]);
  root.unmount();
});

// ——— PHASE-12: إعداد الاسترجاع الدلالي للذاكرة.

test("CP12-UI-SEM the semantic memory panel saves a local server and model, and its check reports what the host measured", async () => {
  const { SemanticMemoryPanel } = await import("../src/screens/p08/SemanticMemoryPanel");
  const off = { enabled: false, endpoint: null, model: null, min_similarity: 0.6, query_prefix: "", document_prefix: "", active: false, retrievals: 0, failures: 0 };
  const saved: unknown[] = [];
  let current: typeof off | { enabled: boolean; endpoint: string; model: string; min_similarity: number; query_prefix: string; document_prefix: string; active: boolean; retrievals: number; failures: number } = off;
  const phase08 = {
    memorySemanticStatus: async () => ({ ok: true as const, value: current }),
    setMemorySemantic: async (input: Record<string, unknown>) => {
      saved.push(input);
      current = { ...off, ...input, endpoint: String(input["endpoint"]), model: String(input["model"]), active: true } as typeof current;
      return { ok: true as const, value: current };
    },
    testMemorySemantic: async () => ({ ok: true as const, value: { outcome: "OK", dimensions: 768, duration_ms: 14 } }),
  } as unknown as Phase08Client;
  const container = resetDocument();
  const root = createRoot(container);
  const en = createTranslator("en");
  await act(async () => {
    root.render(
      <TranslatorProvider translator={en}>
        <SemanticMemoryPanel client={phase08} />
      </TranslatorProvider>,
    );
  });
  await settle();
  assert.ok((container.textContent ?? "").includes(en.t("p08.semantic.state.off")), "the panel does not say it is off");
  const save = [...container.querySelectorAll("button")].find((b) => b.textContent === en.t("p08.save")) as HTMLButtonElement;
  const setValue = async (id: string, value: string) => {
    const input = container.querySelector(`#${id}`) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await act(async () => {
    (container.querySelector("#semantic-enabled") as HTMLInputElement).click();
  });
  assert.equal(save.disabled, true, "turning it on without a server and a model can be saved");
  await setValue("semantic-endpoint", "http://127.0.0.1:8090");
  await setValue("semantic-model", "nomic-embed-text-v1.5");
  await setValue("semantic-query-prefix", "search_query: ");
  await settle(2);
  assert.equal(save.disabled, false);
  await act(async () => {
    save.click();
  });
  await settle();
  assert.deepEqual(saved, [{ enabled: true, endpoint: "http://127.0.0.1:8090", model: "nomic-embed-text-v1.5", min_similarity: 0.6, query_prefix: "search_query: ", document_prefix: "" }]);
  assert.ok((container.textContent ?? "").includes("Active"), "the panel does not show the host's active state after saving");
  const check = [...container.querySelectorAll("button")].find((b) => b.textContent === en.t("p08.semantic.test")) as HTMLButtonElement;
  await act(async () => {
    check.click();
  });
  await settle();
  assert.ok((container.textContent ?? "").includes(en.t("p08.semantic.test.OK", { dimensions: 768, ms: 14 })));
  root.unmount();
});
