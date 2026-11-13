// تكليف الإغلاق الوظيفي 2026-10-19: صدق ما تعرضه الواجهة. كُتب قبل الإصلاح؛ فشله على `4c58d5a` محفوظ خارج Git.

import assert from "node:assert/strict";
import { test } from "node:test";

import { HEALTH_FRESH_MS, shownHealth } from "../src/p02/present";

const NOW = Date.parse("2026-10-19T12:00:00Z");

test("E-4: a HEALTHY measurement older than the freshness window is not shown as healthy", () => {
  const old = shownHealth({ state: "HEALTHY", reason_code: "OK", checked_at: "2026-09-30T22:13:52Z" }, NOW);
  assert.equal(old.state, "UNKNOWN");
  assert.equal(old.reason_code, "NOT_CHECKED");
  assert.equal(old.stale, true);
  const missing = shownHealth({ state: "HEALTHY", reason_code: "OK" }, NOW);
  assert.equal(missing.state, "UNKNOWN");
});

test("E-4: a fresh HEALTHY measurement and any non-healthy measurement are shown as measured", () => {
  const fresh = shownHealth({ state: "HEALTHY", reason_code: "OK", checked_at: new Date(NOW - HEALTH_FRESH_MS + 1000).toISOString() }, NOW);
  assert.equal(fresh.state, "HEALTHY");
  assert.equal(fresh.stale, false);
  const down = shownHealth({ state: "UNREACHABLE", reason_code: "NETWORK_UNREACHABLE", checked_at: "2026-09-30T22:13:52Z" }, NOW);
  assert.equal(down.state, "UNREACHABLE", "an old outage stays a warning until something measures otherwise");
});

test("T-8: a completed model call without a token count is counted, not summed as zero", async () => {
  const { traceTotals } = await import("../src/screens/p08/MissionTrace");
  const span = (id: string, extra: Record<string, unknown>) => ({ span_id: id.repeat(16), trace_id: "b".repeat(32), name: "chat", status: "OK", started_at: "t", semconv: "s", ...extra });
  const totals = traceTotals({
    mission_id: "11111111-1111-4111-8111-111111111111",
    semconv: "gen_ai/1.37-development",
    spans: [span("a", { input_tokens: 40, output_tokens: 5 }), span("c", {}), span("d", { status: "ERROR" })],
    spans_total: 3,
    next_after: null,
    // CP-10-1: المجاميع يحسبها المضيف على المهمّة كلها؛ العارض يعرضها كما هي.
    totals: { agents: 0, model_calls: 3, tool_calls: 0, input_tokens: 40, output_tokens: 5, unreported: 1, denied: 0 },
    security_events: [],
    session_events: 3,
    session_chain: { state: "INTACT", events: 3 },
  } as never);
  assert.equal(totals.inputTokens, 40);
  assert.equal(totals.unreported, 1, "the completed call without tokens must be reported as uncounted; the failed one sent nothing countable");
});

test("E-1: digits typed in Arabic-Indic or Persian become Latin, other characters are dropped, and the range is checked", async () => {
  const { normalizeDigits, inRange } = await import("../src/localization/digits");
  assert.equal(normalizeDigits("١٠٠"), "100");
  assert.equal(normalizeDigits("۲۵"), "25");
  assert.equal(normalizeDigits("1e3 x"), "13");
  assert.equal(normalizeDigits("-5"), "5", "a minus sign is refused unless the field allows negatives");
  assert.equal(normalizeDigits("-5", true), "-5");
  assert.equal(inRange("100", 10, 1000), true);
  assert.equal(inRange("5", 10, 1000), false);
  assert.equal(inRange("", 10, 1000), false);
});

test("E-5: the rating is saved through the host, and localStorage is only read once to move an old rating", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  let dir = process.cwd();
  for (let i = 0; i < 6 && !readdirSync(dir).includes("src"); i += 1) dir = join(dir, "..");
  const source = readFileSync(join(dir, "src", "screens", "p08", "MissionWorkspace.tsx"), "utf8");
  assert.ok(source.includes("phase08.rateMission("), "the rating does not reach the host");
  assert.ok(!/localStorage\?\.setItem\(`polaris\.rating/.test(source), "the rating is still written to localStorage only");
});
