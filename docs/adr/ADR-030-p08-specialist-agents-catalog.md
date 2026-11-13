# ADR-030 — Phase-08: specialist agents as a catalog of domain method, not of authority

- Status: Accepted (2026-10-01)
- Supersedes: nothing. Extends ADR-021 (Phase-03 roles) and ADR-029 (conversation operations).

## Context

The nine Phase-03 roles (planner, builder, reviewer…) describe *where* an agent sits in a plan. Every
role received the same generic instruction — `"Your role for this task is BUILDER. Carry out the task…"`
(`p03/model_adapter.rs::base_plan`) — so no task received domain method or domain-specific checks.
The owner asked for a broad set of specialist agents across all fields, with a professional,
clean architecture.

What the system can honestly offer: an agent's reasoning ability comes from the model the user runs.
Specialist instructions can shape method and add checks; they cannot raise model capability.

## Decision

1. **A specialist is data, not code.** `p03/specialists/*.json` (one file per field, 20 fields × 15
   specialists = 300) is embedded in the binary. Each record carries Arabic and English names and
   summaries, an English working method (`expertise`), 3–6 pre-delivery checks, matching keywords in
   both languages, and the task types it serves. `SpecialistCatalog::parse` validates every record
   (unique `<domain>.<slug>` ids, both languages present, bounded lengths, valid task types); a broken
   catalog fails the tests and, at run time, degrades to "no specialists" instead of crashing.
2. **Selection is the runtime's, not the model's.** Before planning, the runtime offers the planner a
   shortlist (at most 8) ranked by deterministic keyword matching against the request. The planner
   may name one id per task. For each task the runtime accepts the hint only if it was in the shortlist
   it offered and serves that task type (amended 2026-10-01: on «هلا», with nothing offered, the real model
   named the business writer and it was accepted); otherwise it picks the best match for the task, then for
   the user's request; otherwise none (the task runs with its role instruction only, as before).
3. **A pinned specialist** (`mission.specialist.set`, schema v8 `p08_mission_preferences.specialist_id`)
   overrides selection for every task of the mission, and follow-up turns inherit it like the model.
4. **What reaches the prompt** is a `ROLE_INSTRUCTION` part after the role: the specialist's method and
   "Before you report, make sure that:" checks. The specialist grants no tool, permission or authority
   (item 19 of the Phase-03 contract still holds); every effect still passes the tool gateway and its
   approvals.
5. **Scope.** Specialists, like the reply step, apply to conversation missions — the product path. The
   closed Phase-03..07 mission paths keep their prompts unchanged.
6. **Renderer surface.** `agent.catalog` (read) returns domains and specialists *without* their
   instructions; the STEP narration's `detail` carries the chosen specialist id so the conversation can
   name it; `ConversationTurnV1.specialist_id` names a pinned one.

## Consequences

- Registry grows from 36 to 38 Phase-08 operations; envelope 1.7 gains two members additively.
- Routing accuracy is guarded by a regression sample written alongside the catalog (24 requests,
  including small talk that must reach no specialist). It is not an independent accuracy benchmark.
- No claim is made that specialists make the model smarter, or that POLARIS outperforms any named
  product. Quality on real tasks is judged by running them, and recorded as measured.
