# ADR-035 — One conversation per mission, and a measured "already done" list

- Status: Accepted (2026-10-06). The conversation mode is **off by default** until it is measured against the per-step path on Bonsai.
- Plan: `docs/plan/PLAN-2026-10-05-agent-system.md`, items C1, C2 and C4.
- Builds on: ADR-033 (agent orchestration) and ADR-034 (measured usage and native tool calls).

## Context

Three facts were measured in the MISSION-A run on Bonsai (2026-10-05, database kept in the session scratchpad).

### 1. The prompt cache was 0 at the start of every step

- Inside one step, each call reused the previous request almost entirely: `cached_tokens` equalled the previous `prompt_tokens` minus 4 (6476 → 6472, 6808 → 6804, 7356 → 7352).
- At the first call of every new step, `cached_tokens` was 0: 5939, 6568 and 7105 tokens were processed again from scratch.

### 2. The second step redid the first step's work

- Step `df23ad2d` read three inputs, wrote the document and registered it.
- Step `11548346` then read the same three inputs again (identical argument digests), wrote the document twice, and read the inputs a third time.
- No step was told what the other had already done.

### 3. Why the cache behaves this way on this model

- Bonsai's GGUF header says `general.architecture = qwen35`, a hybrid model (Gated DeltaNet plus attention).
- llama.cpp cannot cut the recurrent state of such a model at an arbitrary token. It restores from checkpoints taken near the end of earlier requests. This is described in llama.cpp issues #20225 and #22384.
- So reuse happens only when a new request **extends** an earlier one. Each step's prompt was built from scratch, so it always diverged early.
- Bonsai's chat template places the tool definitions **before** the system text. The tool list therefore belongs to the stable prefix, and it must be the same in every call.

### External guidance consulted (2026-10-06)

- **Manus, context engineering (2025-07-18):** keep the prefix stable, make the context append-only, and recite the plan at the end.
- **Cognition, "Don't Build Multi-Agents" (2025-06-12):** default to a single thread that shares full context. Use subagents only for narrow work.
- **TokenPilot (arXiv 2606.17016):** stable prefix plus append-only ingestion.
- **A production study (2026-08-18):** full history with caching beat summarisation on cost and recall. Compaction should answer a named constraint.

These are their own measurements. None of their numbers is claimed for POLARIS.

## Decision

### C2 — One conversation per mission (`p03/thread.rs`)

- **Every model call of a mission extends one conversation:** plan, each work step and its tool rounds, review, and the final message.
- **The system instruction is fixed for the whole mission:**
  - the policy;
  - a guide to the steps;
  - every reply format, given once;
  - the tool contract.
- **What changes from step to step travels as labelled messages:**
  - the role;
  - the specialist brief;
  - repair notes;
  - context sections.
- **Untrusted content keeps its fences:**
  - Tool results are `tool` messages that carry the call id.
  - Each result follows the assistant message that requested it.
  - A call whose result was never shown is closed with an explicit "not shown" result.
- **The same tool list is offered on every call** when native tools are on, because the template puts it first.
  - Steps other than work steps are told to call nothing.
- **A failed call leaves no trace.** A call that fails before any reply rolls the conversation back, so the retry again extends the last successful request.
- **A delegated colleague runs outside the conversation.** It gets its own clean context and returns a summary, which is the subagent pattern.
- **Compaction has exactly two triggers:**
  - the conversation exceeds 160,000 characters (about 45K tokens; a design limit, not a measurement);
  - the model's window refuses the prompt.

  Compaction returns the conversation to its opening messages. The step's measured context sections (plan states, reports, files, the "already done" list) carry what came before. It never happens in the middle of a step.
- **Tool output in the conversation is cut once, at a fixed size.** The first two thirds and the last third are kept, with the number of omitted characters named. It is never re-cut later, so the prefix does not change.
- **Providers carry the protocol, or refuse it:**
  - `ChatMessage` gains `tool_calls` and `tool_call_id`.
  - The OpenAI-compatible adapter sends them, and refuses a tool result without an id.
  - The Anthropic, Google and Ollama adapters refuse such messages before sending, as they already refuse native tools.

### C4 — An "already done" list at the end of every step

- `TaskContextSections.done_actions` lists every successful tool call with an effect in the mission (reads excluded), oldest first, up to 20 entries.
- Each entry gives the step title and the adapter's trusted summary.
- The source is the gateway's tool history when the probe is bound, which covers earlier runs; otherwise this run's decisions.
- The list comes last in the step's context, after memory: the position Manus calls recitation.
- It carries a host instruction not to repeat these actions unless a later result shows one failed.
- The list itself is fenced as data, because titles and summaries can contain agent-chosen text.
- It applies in both modes.

### C1 — Unique step keys

- The model port keys per-step state by objective text.
- The runtime now gives a repeated objective a suffix naming its step number and title.
- The first occurrence keeps its text, so existing plans and fixtures are unchanged.
- This replaces the plan's original wording ("a NodeContext keyed by node number"). That wording would have changed the signature of seven port implementations and the closed Phase-03..07 fixtures, for the same guarantee.

### Reasoning effort reaches a generic local server

- POLARIS asks for low reasoning effort, but never sent it to a `LocalGeneric` server.
- Bonsai's launch script sets `--reasoning-effort medium` with a thinking budget of 2048.
- The adapter now sends `chat_template_kwargs`:
  - `{"reasoning_effort":"low"}` for low;
  - `{"enable_thinking":false}` for none.
- A 400 that names this field is retried once without it, the same rule that applies to `stream_options`.
- **Whether the server honours a per-request override has not been measured.**

## Consequences

- **Tests:**
  - 13 new tests;
  - every existing test passes unchanged (1102 Rust tests);
  - an integration test checks real request bodies: the same system instruction and tools in every call, each request a strict extension of the one before, a call id paired with its fenced result, and the second step seeing the measured write in its "already done" list.
- **Not measured yet, and not claimed:**
  - the cache hit rate at step boundaries on Bonsai;
  - wall time;
  - repeated work;
  - plan and review quality when tools are offered on every call (they could call a tool where none is expected; such a reply fails its parse and gets one repair).
- **Measurement:** the harness switch `POLARIS_P08_THREAD=1` runs the same missions in conversation mode, for comparison against the default. The default changes only after that comparison is measured.
- **Known cost:**
  - The test harness offers 32 tool definitions on every call.
  - Tool search or deferred loading (Anthropic, 2025-11-24) is a candidate once the tool list's token count is measured.
