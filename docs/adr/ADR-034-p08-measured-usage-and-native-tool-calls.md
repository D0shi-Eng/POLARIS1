# ADR-034 — Measured token usage and native tool calls

- Status: Accepted (2026-10-05)
- Plan: `docs/plan/PLAN-2026-10-05-agent-system.md`, items A1, B1, B2 and B3.
- Builds on: ADR-029 (runtime controls around real models) and ADR-033 (agent orchestration).

## Context

The audit of 2026-10-05 measured two facts in the owner's live database:

1. **Token usage was `UNKNOWN` in 69 of 69 real model calls.**
   - The OpenAI-compatible adapter asked for `stream_options.include_usage` only from hosted services.
   - Local servers therefore never reported usage.
   - As a result, token budgets did not work on local models.
2. **3 of 14 tool calls were refused `ARGUMENTS_INVALID`.**
   - All three were on `polaris.artifact.document`, which failed 3 of its 7 calls.
   - Tools were requested as JSON inside the reply text, and described to the model in prose.
   - Built-in tools had no JSON Schema, only a name reference (`input_schema_ref`).

Two facts were measured against the owner's Bonsai llama-server (`127.0.0.1:8080`, started with `--jinja`) on the same day:

- With `include_usage`, the server returns `usage` (`prompt_tokens=44`, `completion_tokens=37`) and llama.cpp `timings`.
- Offered one function, it returned a native `tool_calls` entry with valid arguments on the first call.

## Decision

### A1 — Usage is requested from every server

- Every streamed chat request asks for `stream_options.include_usage`.
- If a local server refuses that field with a 400 response naming it, the call is sent once more without it. No other refusal is retried.
- If `usage` is absent, llama.cpp `timings` are read instead (`prompt_n + cache_n`, `predicted_n`). This is the server's own count, not an estimate.
- Cached prefix tokens (`prompt_tokens_details.cached_tokens`) are recorded:
  - in `usage_records.cached_tokens`;
  - in the audit detail, as `cached_tokens_reported`.
- The published `desktop-p02-result-v1` contract is unchanged, because the new field is `#[serde(skip)]`.

### B1 — Built-in tools declare a JSON Schema

- `ToolAdapter::input_schema()` returns an optional schema.
- Schemas exist for the 10 tools that real missions use: workspace list/read/write/export, Python, command, document, presentation, spreadsheet and register.
- MCP tools offer the schema their server declared, after the existing sanitisation.
- The schema guides the model and does not guard anything. `validate()` remains the judge. A test checks that on fixed samples, each schema and its validator accept and refuse the same arguments.
- Schemas carry no length or count bounds. llama.cpp turns tool schemas into a decoding grammar, and large bounds only inflate it.

### B2 — The provider layer carries native tool calls

- `InvocationSpec.tools` and `InvocationOutput.tool_calls` are added.
- The OpenAI-compatible adapter (local, LM Studio, OpenRouter, hosted):
  - sends `tools` with `tool_choice: "auto"`;
  - joins streamed `delta.tool_calls` by `index`, with bounds of 16 calls and 64 000 characters of arguments each;
  - accepts a reply that has calls but no text.
- A local server is not sent a JSON-schema `response_format` alongside tools. That grammar would block the calls themselves.
- Adapters that do not carry native tools (Anthropic, Google, Ollama native) refuse an offer before sending. The p02 service never sends them one.

### B3 — Agents use native calls where the route carries them

- Once per mission, `InvocationService::carries_native_tools` evaluates the same routing as `invoke`, without side effects. The prompt then keeps one form for the whole mission.
- Tools are offered under protocol-safe names (`polaris.workspace.write` → `polaris_workspace_write`).
- Names are mapped back through the offered list only. An unknown name passes through unchanged, so the gateway refuses it as before.
- Arguments that do not parse reach the gateway as text and are refused `ARGUMENTS_INVALID` with a readable reason. They are not silently repaired.
- A native call always asks to see its results. The final answer is still the closed JSON contract, parsed as strictly as before.
- If the server refuses the offer (`InvalidRequest` or `UnsupportedCapability`), the mission switches to the text contract. That call is retried once as transient.
- `Phase03::set_native_tool_calls(false)` keeps the text contract alone, so the same task can be measured both ways.

### What did not change

- The gateway, approvals, budgets, the evidence layer and the authority model are untouched.
- A native call is a proposal like any other.
- The text JSON contract remains a complete fallback.

## Consequences

- Token budgets can work on local models. **This holds only after a real run shows `PROVIDER_REPORTED`.**
- **The ARGUMENTS_INVALID rate is not claimed to drop until it is measured.** The plan's threshold (≤ 5%) is measured on the plan's fixed task set, against the text-contract baseline on the same tasks.
- Known risk: llama.cpp documents that extreme KV-cache quantisation degrades tool calling, and Bonsai runs with a 4-bit KV cache. This is measured, not assumed.
