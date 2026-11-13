# ADR-033 — Phase-08: agent orchestration as a graph of bounded agent loops

- Status: Accepted (2026-10-02)
- Extends: ADR-030 (specialist catalog). Builds on the Phase-03 runtime (`desktop/host/core/src/p03`)
  without replacing it.

## Context

The owner asked two questions on 2026-10-01:

1. Is the agent system a real one, built on a current architecture?
2. Is the prompting a system prompt, a loop or a graph? If none of these, build a hybrid.

The answer was taken from the code, not from earlier documents. The runtime is already a hybrid of all
three:

| Layer | Where | What it does |
|---|---|---|
| Structured prompt | `p03/prompt.rs` | A prompt is assembled from named parts. Each part has a fixed authority class. System policy, role, specialist brief and output contract go in the system instruction. The objective, user instruction and agent messages are labelled messages. Content, memory, tool output and observations are fenced as data, never instructions. |
| Graph | `p03/graph.rs`, `runtime.rs::plan_phase` | The planner proposes a DAG of tasks. The runtime validates it (no cycles, no dangling edges, a task budget) and issues the real IDs. A deterministic scheduler runs the ready set. The mission is a state machine, and its graph is persisted and resumable. |
| Loop | `runtime.rs::continue_with_tools` | Each task is one agent working in a bounded tool loop. It proposes tools, the gateway decides, and the agent sees the measured results and continues. Limits: 12 rounds, the model-call budget, a no-progress guard, a stop on a repeated request, and a stop at an approval wait. |

The code also showed four places where the multi-agent parts were not real:

1. **The reviewer never saw the work.** A REVIEW task's prompt was only "Review the output of task <id>",
   so the verdict was given on nothing. On REVISE, the producer re-ran without the reviewer's notes, which
   were discarded.
2. **A delegation result reached nobody.** The colleague was called once, with no context and no tool
   rounds. Its result was published on the message bus, and nothing read the bus.
3. **The planner's `recommended_role` was parsed and dropped.** The role always came from the task type.
4. **A worker did not know the plan.** It saw the results of its dependencies, but not the other tasks or
   its own place among them.

## Decision

The hybrid is kept. The four gaps are closed inside it, behind the Phase-08 recovery controls: a model
port with `recovery_enabled()` plus a contract probe. Closed Phase-03..07 fixture ports keep their exact
behaviour, and the test `p08_agents_closed_fixture_ports_keep_their_behaviour_without_the_phase08_hooks`
measures that.

1. **Evaluator–optimizer loop.**
   - **What the reviewer is given:** `AgentModel::note_review_input` passes it the review objective, the
     handoff report of every task it depends on, and the workspace file list. Each report contains the
     agent summary, which is unverified, and the tool statuses measured by the gateway. This enters the
     prompt as fenced untrusted content.
   - **On REVISE:** the notes reach the producer's next attempt through `note_review_feedback`, as an agent
     message with no authority. A `REVIEW_RESULT` message also goes on the bus, from the reviewer to the
     producer.
   - **Limits:** review rounds and attempts keep their existing budgets.
   - **What it does not fix:** the review is still the same model reviewing itself. It is recorded as
     `SAME_MODEL_REVIEW`, as before.
2. **Delegation as a real bounded agent.** The coordinator still decides, under the depth limit and the
   delegation budget.
   - **The colleague's context:** its own objective, what the requester is working on and needs back, the
     unmet requirements and the files.
   - **How it runs:** a guarded call (budget, cancellation, transient retry), then up to 4 tool rounds
     (`MAX_DELEGATE_ROUNDS`) through the same gateway.
   - **Where the result goes:** to the requester through `note_agent_message`, which keeps the last 2
     messages. The requester is also given one follow-up round to read it.
   - **Isolation:** each agent's rounds see only its own tool decisions (`decision_owners`). A colleague's
     raw tool output does not leak into the requester's turns.
   - **Timing:** delegation may be requested in any round, not only the first.
   - **Failure:** a colleague's malformed output ends that delegation (`DELEGATION_OUTPUT_INVALID`) and does
     not fail the requester's task.
3. **The planner's role is heard but not obeyed.** The recommended role is used when the registry has it
   enabled and it allows the task type. Otherwise the task-type role is used. The model proposes; the
   registry decides.
4. **Plan awareness.** Each worker's context carries the whole plan: up to 12 tasks, each with its state
   and with "<- THIS TASK" marking its own place. Titles are planner output, so the plan arrives as an
   agent message and never as system text.

## What this is not

- **The agents run one at a time.** The ready set is executed in order, not concurrently. On the owner's
  machine a single local model serves every call, so parallel calls would queue on the same GPU. That has
  not been measured, and no speed-up is claimed.
- **The "300 agents" are 300 domain briefs** (ADR-030) layered on one model, not 300 running processes. The
  roles grant no authority. Tools pass the gateway and its approvals whatever the role.
- **There is no re-planning after a failed task.** A failed task still ends the mission as FAILED. This is
  left open because it changes the outcome of missions that are meant to fail, such as boundary denials.
- **There is no per-agent long-term memory.** Memory stays per user and per project (ADR-032).

## Evidence

- `desktop/host/core/tests/p08_agents.rs` has five tests:
  - the reviewer sees the work and REVISE carries its reasons;
  - the colleague runs and its result reaches the requester in a follow-up round;
  - the planner's role is used only when the registry allows it;
  - every worker sees the plan and its own place in it;
  - closed ports are unchanged.
- `model_adapter.rs`: the test `the_plan_outline_reaches_the_worker_as_an_agent_message_never_as_system_text`.
- The full host suite passed, 1078 tests, with clippy at `-D warnings`.
- The behaviour with the real model is measured separately and reported as measured. It is not inferred
  from these fixtures.
