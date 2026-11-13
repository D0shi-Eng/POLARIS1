# ADR-038 — Parallel first calls for a remote executor, an independent remote reviewer, the live step tree, and user-named memory topics

- **Status:** Accepted (2026-10-06).
- **Plan:** `docs/plan/PLAN-2026-10-05-agent-system.md`, items E4, E6, F1 and D2.
- **Builds on:** ADR-035, ADR-036 and ADR-037.

**What the owner decided (2026-10-06):**

- build F1, which changes the mission view;
- build E4 for remote models only, with at most three in parallel.

**What is still not measured:** none of this has run on a real provider. The evidence for each item is a passing test, named below.

## E6 — An independent reviewer on a remote model

ADR-036 declined E6 because a second local model breaks the one-model rule. ADR-037 made hosted providers available, and that removes the objection for a *remote* reviewer.

**How the reviewer is chosen and checked:**

- The user picks a reviewer model in Models > Preferences.
- The model is stored in `preferences` as `review_model_id`.
- `model.preferences.set` refuses a model whose provider is local (`POLICY_DENIED`).
- The binding drops the reviewer when it is the executor itself.

**How the review runs:**

- It uses the existing self-contained review prompt, sent with `RoutingMode::Manual` to the reviewer model.
- It passes through the same routing, egress gate and budget as any call.
- It never extends the mission thread. Another model's cache does not help, and a clean context is what makes the review independent.

**What gets recorded:** `INDEPENDENT_MODEL_REVIEW` in the run report and in each review record. The column already allowed it.

**Evidence:** `p08_agent_a_remote_reviewer_reviews_the_local_work_and_the_review_is_recorded_independent`. The test uses a remote fixture standing in for a catalogued provider. It shows that:

- planning and execution ran on the local model without a key;
- only the review reached the remote fixture with its bearer key;
- the report says `INDEPENDENT_MODEL_REVIEW`;
- without a reviewer, the report says `SAME_MODEL_REVIEW`.

## E4 — Parallel first calls, for a remote executor only

The runtime state, meaning the graph, budget, evidence, tool decisions and bus, is single-owner. Running whole steps concurrently would make all of it concurrent, and there is no measured need for that.

**What runs in parallel:** only what dominates the wall-clock time, which is waiting for the model's first execution reply.

**How a batch runs:**

1. When at least two independent steps are ready and the executor is remote, up to `min(3, max_active_agents)` of them begin as they always did (agent, specialist brief, narration, task context).
2. Their first `execute` calls run together in scoped threads.
3. Each step is then completed one after another, in the same deterministic order, with:
   - its tools through the gateway;
   - its recording;
   - its verification;
   - its checkpoint.

**What stays one at a time:**

- reviews;
- a local executor;
- the mission thread (C2).

**Failures and attribution:**

- A first call that failed has its reservation returned, and is redone in its turn by the single path, with repair and transient retry.
- Every call is still attributed to its own step. A per-thread step (`cancel::with_thread_step`) pins the step on the invocation.

**Declared limit:** a step's first call does not see what a parallel sibling writes. They have no dependency between them, or they would not both be ready.

**Evidence (`core/tests/p08_parallel.rs`):**

- the width reaches three and never more;
- the default stays at one;
- a failed first call is redone once and every other step runs exactly once.

## F1 — The live step tree

A "Step N/M" button in the mission dock opens the mission plan.

| Shown | Where it comes from |
|---|---|
| Each step and its state | `task.list` |
| The tool calls under each step, with status and duration | `tool.activity.list`, by the `task_id` the gateway recorded |
| The review step, tagged "Verification" | the step's task type |

It refreshes with the mission's pulse while it runs. Nothing in it comes from model narration.

**Not shown:** model calls per step. They are recorded as `model.invoke` events with their step (A2), but no operation reads events by mission.

**Evidence:**

- renderer test `P08-UI-F1`;
- the preview was observed.

**Not observed:** the built program. Window access was declined in this session.

## D2 — The user updates what they said about a named topic

"Remember this" takes an optional topic, up to 80 characters.

**When two statements match** — same scope and project, same normalised subject, both written by the user — the newer one:

- marks the older one `SUPERSEDED`, which keeps it visible;
- records the conflict as `SUPERSEDED_BY_USER`.

**Without a topic:** the subject stays the first eight words, as before.

**What stays unchanged:** agent statements never resolve this way. Two agent values on one subject remain a recorded `CONFLICT`, and the newest is never chosen as fact.

**Schema v14:** rebuilds `memory_conflicts` with the new state in its `CHECK`, and copies every row.

**Not built:** a subject key derived by a model for agent proposals. It would let the model decide which facts collide.

**Evidence:**

- `a_users_newer_statement_on_a_named_topic_replaces_their_older_one_and_agents_still_conflict`;
- `v14_keeps_every_conflict_and_admits_the_user_supersession_state_only`.

## Still not built, with reasons

| Item | Reason |
|---|---|
| E5 | No measured per-domain data calibrates a specialist-imposed check. An uncalibrated check blocks correct missions. |
| B4 | Bonsai does not declare JSON-schema output. Hosted providers get `json_object` today. A strict schema for them needs a measurement with a real key first. |
| D1 | Deferred on the MERIT evidence (ADR-036). |
| F2 | Needs Bonsai running, which only the owner may start. Manus would also run the same tasks, and sending them to Manus needs explicit permission. |

## Test totals after these changes

| Suite | Passed |
|---|---|
| Rust (providers, core, harness) | 1126 of 1126 |
| Contracts | 637 of 637 |
| Renderer | 203 of 203 |
| P02 security conformance | 14 of 14 |
