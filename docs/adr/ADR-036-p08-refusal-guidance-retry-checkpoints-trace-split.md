# ADR-036 — Refusal guidance, one retry of a failed step, checkpoints, model-call trace events, and the runtime split

- **Status:** Accepted (2026-10-06).
- **Plan:** `docs/plan/PLAN-2026-10-05-agent-system.md`, items B6, E3, D3, A3, E2, A2 and E1.
- **Builds on:** ADR-034 and ADR-035.

**None of these changes has been measured on a real model yet.** The evidence for each is a passing test, named below.

## Decisions

### B6 — Argument refusals say how to fix them

The gateway rejects a tool's arguments that fail its schema with `ARGUMENTS_INVALID`. That rejection now carries four things, all derived from the adapter's schema alone, never from model text:

- the failing JSON pointers;
- the expected shape;
- the schema's stated rule;
- a minimal valid example.

The refusal itself is unchanged. The stored summary limit rises from 400 to 1200 characters, still below the contract's 2000.

A test checks that the example for each of the 10 built-in tools is accepted by that tool's real validator. Before the fix it found three misleading examples:

| Tool | Example | Validator's objection |
|---|---|---|
| (path argument) | `"<path>"` | uses characters Windows forbids |
| document | empty `blocks` | rejected |
| Python | `{}` | "exactly one of `code` or `script`" exists only in prose |

The Python rule now travels as the standard `examples` annotation. It is not expressed as `oneOf`, which could change the decoding grammar the server builds from the schema.

### E3 — A failed step gets one more attempt, with the measured reason

A step can fail in two ways:

- the agent reports `failed`;
- the step's last write was refused.

Either way, the step returns to pending once, within `max_attempts` and the retry budget. The next attempt receives two things:

- **the reason:** the tool calls that did not succeed, with their status and adapter summary, plus the agent's own summary marked unverified;
- **an instruction** to take a different approach.

There is no retry after a human refusal or a refusal at a safety or policy boundary.

An existing test exposed a hole in the first version. A retry that wrote nothing could succeed, because "the last write was refused" looked only at the current attempt. The check now spans every attempt and every agent of the step.

### D3 — A measured tool lesson

A mission in which a tool did not succeed leaves an episodic memory built from the gateway's history. For each tool it records:

- the number of calls;
- how many did not succeed;
- the last status, refusal reason and adapter summary.

**Where it is stored:**

- The lesson goes to the mission's project.
- Without a project it stays with the mission, because policy does not let the runtime write at user scope.

### A3 — Per-mission metrics in the native harness

For every task, the harness records:

- model calls;
- provider-reported tokens only, with unreported calls counted apart;
- the cached share of input;
- refusals by reason;
- the `ARGUMENTS_INVALID` share;
- repeated successful calls with the same arguments digest.

A suite summary and the active modes are added, so two runs on the same tasks can be compared.

### E2 — Checkpoints

The run saved its snapshot only when it ended. A killed run therefore left no graph, and the restart's re-plan could repeat effects that had already happened.

**What the run saves now:**

- The run saves through the same single-transaction `save` after planning and after every step.
- The save is a full rewrite, so it is idempotent.

**What a resume does:**

- Steps that are `INTERRUPTED`, `RUNNING` or `ASSIGNED` return to pending.
- No re-plan happens, and finished steps are not repeated (test).

**What this does not guarantee:** a write that happened inside the interrupted step before the cut may be repeated. The "already done" list from the gateway's history reduces this risk; it does not remove it.

### A2 — Model calls as events tied to their step

- The run handle carries the running step.
- The cost guard emits a `model.invoke` event for every model call, with:
  - mission and step;
  - duration;
  - token provenance.
- Together with the existing tool events, this lets the tree mission → step → model and tool calls be read from the structured events.

**Not built:**

- per-call parent span ids;
- per-step token totals, which would need a `task_id` column on `usage_records` and therefore a migration.

### E1 — The runtime is a module

`p03/runtime.rs` (2164 lines) is now `p03/runtime/`:

| Module | Content |
|---|---|
| `mod.rs` (1092 lines) | types, builders, main loop, planning |
| `step.rs` | one step |
| `review.rs` | review |
| `tools.rs` | tool proposals |
| `delegation.rs` | delegation |
| `finish.rs` | verification and terminal state |
| `support.rs` | free helpers |

- Only visibility markers changed.
- All 1114 tests pass with no changed expectation, which was the acceptance criterion written in advance.

## Not built, with reasons

| Item | What it would be | Why not now |
|---|---|---|
| E4 | Parallel steps | Bonsai runs one server slot, so there is no speed-up. Parallel load on one GPU is what the owner warned against after the 2026-10-05 incident. |
| E5 | Specialist-imposed machine checks | Measured checks already come from the user's objective. Checks imposed by a specialist could block missions the user framed differently, with no per-domain data to calibrate them. |
| E6 | Reviewer on a different model | A second local model breaks the one-model rule. A hosted reviewer needs the owner's decision on a remote provider. |
| B4 | Output schemas | No output schema is sent to a local server when native tools are offered, and Bonsai does not declare JSON-schema output. |
| D1 | Embedding retrieval | Deferred on the MERIT evidence. |
| D2 | Update or delete on write | Needs a model-derived subject key, a new conflict state and a migration. |
| F1 | Step-tree view | The owner asked that the design not change. |

## Test totals after these changes

| Suite | Passed |
|---|---|
| Rust (providers, core, harness) | 1114 of 1114 |
| Contracts | 628 of 628 |
| Renderer | 199 of 199 |
