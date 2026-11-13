# ADR-029 — Phase-08: deterministic runtime controls around a real, imperfect model

- Status: Accepted (Phase-08 remediation, 2026-09-29)
- Supersedes: nothing. Extends ADR-028.

## Context

The first canonical Phase-08 run failed six conditions (MISSION-B/C/D/E, P08-E2E-05, P08-E2E-07).
The raw timelines (harness and UI SQLite stores, `audit_events`, `obs_events`, `p08_execution_runs`)
show that none of the six was "the model's fault" alone:

| Condition | Measured root cause |
|---|---|
| E2E-07 | Cancel accepted **during planning**; the aborted planning call returned `Cancelled`, and `run()` sent every planning error to `fail_with()` → the mission was saved `FAILED`. |
| B, C, E, E2E-05 (+ B14–B18, B21, B24) | A single model call exceeded the **300 s absolute** provider timeout while its stream was still producing; the timeout was mapped to `InvalidOutput`, the call was re-sent **immediately** with a misleading JSON-repair note to a server still busy with the abandoned request (fails in < 1 s), and the mission ended `BLOCKED`. The local model decodes 7–27 characters/s, so the 4 096-token output cap and the 300 s limit were inconsistent. |
| E | `python` was not on `PATH` inside the PowerShell sandbox, and the generated script exited **0** after `CommandNotFoundException`, so "run the tests" was recorded as a success that never ran. |
| D | Site written; two malformed JSON replies (HTML inline) ended the task; nothing knew the ZIP was mandatory; packaging depended on the model remembering shell syntax. |
| C | Table extraction relied on rendered prose; the report task would only have received the predecessor's prose summary. |

## Decision

1. **Cancel arbitration gate** (`p03/cancel.rs::RunGate`). Accepting a cancel and deciding the terminal
   state happen under one lock. A cancel accepted before the decision always yields `CANCELLED` (tasks
   still open or failed after it are recorded `CANCELLED`); a cancel arriving after the decision is
   refused and returns the decided state. The snapshot is saved before the run is unregistered, so the
   "not running" cancel path can never write a second state. A storage failure stays a storage error.
2. **Transient provider failures are their own class** (`ModelError::Transient`, `p03/retry.rs`):
   timeout, 5xx, unreachable, rate-limited, model unavailable. Bounded retry (2 per call, 6 per mission,
   20 s then 60 s back-off, interrupted at once by cancel), each attempt reserved from the model-call
   budget. Exhaustion is `PROVIDER_UNAVAILABLE` (BLOCKED), never a JSON repair.
3. **Liveness deadline** for agent calls: 180 s idle limit on the stream (silent/queued streams end),
   600 s absolute ceiling (what the 4 096-token cap needs at the measured decode rate). The IPC
   `model.invoke` path keeps Phase-02 semantics (`idle_timeout_ms: None`).
4. **MissionExecutionContract** (`p03/contract.rs`) derived deterministically from the user's objective
   (deliverable paths and formats, chart, Python execution, passing tests, network proposal, browser
   visit), measured by a read-only `ContractProbe` (workspace re-open with the artifact verifiers; gateway
   invocation records). Used for: plan completeness with **one** `PLAN_REPAIR` and a runtime task for any
   remaining gap; **deliverable-gap continuation** (max 2 tasks, only for what is missing, never after a
   human denial); refusal of `COMPLETED` with a missing deliverable (`DELIVERABLES_INCOMPLETE`, BLOCKED);
   observation follow-up while requirements remain; one bounded **tool-selection reminder** per task
   (proposal only — PDP/PEP and approvals decide).
5. **Structured handoff** (`p03/handoff.rs`) — status, measured tool facts, bounded agent summary and
   structured DOM tables — fenced as untrusted data. Bounded context sections: remaining requirements,
   previous results, available files.
6. **Execution**: the POLARIS-owned Python on PATH (read-only root) for PowerShell runs; exit code
   propagation (`$LASTEXITCODE`, last-statement failure → 1); test runs classified
   `EXECUTED` + `TESTS_PASSED|TESTS_FAILED` in the trusted summary — failing tests are a diagnostic
   observation, not a tool failure.
7. **Deterministic tools**: `polaris.package.zip` (write + re-open + per-entry CRC/name verification);
   browser snapshots carry DOM tables as rows.
8. Tool guide entries state effects and approval class; model-neutral, no model-family names.

## Consequences

- Fixture ports of Phases 03–07 keep closed behaviour: every new hook defaults off
  (`recovery_enabled() == false`, `TransientPolicy` never triggered by fixtures).
- Budgets remain bounded in every dimension; no limit was made unbounded.
- New stop codes `PROVIDER_UNAVAILABLE`, `DELIVERABLES_INCOMPLETE` added to the P03 contract schema.

## Addendum — defects measured by the canonical run of 2026-09-29 (98/105) and their fixes

| Measured symptom | Root cause (evidence) | Fix |
|---|---|---|
| MISSION-D, MISSION-E, B20 `BLOCKED: BudgetDenied { ConcurrentModelCalls, limit 3, requested 4 }` in a single-agent mission | `guarded_call` reserved a concurrency slot per attempt and only a successful reply settled it; failed attempts (transient, malformed, repair) leaked slots (audit: 3 failed attempts before the denial) | `BudgetLedger::abandon_model_call` releases concurrency for an attempt with no reply; the call still counts against `max_model_calls`. Regression test fails before the fix, passes after |
| Tools denied `ARGUMENTS_INVALID: the argument reason is not declared` | The model nested envelope fields (`reason`) inside `arguments` | Refusal kept; the message now says the field belongs beside `arguments` so the next attempt can correct it. Nothing is moved automatically |
| B20 `expected ',' or ']'` — excerpt `…["Dammam","1.3M"]]}}]},"reason"…` | Closing brackets of a nested table spec emitted in the wrong order (`]]}}]}` for `]]}]}}`) | Parse errors now carry a 60-character excerpt (in the repair note and the failure reason); two structural repairs: insert a missing comma between adjacent values, and reorder a run of closers to the order the bracket stack requires (same count and kinds only; strings untouched) |
| B24 verification task FAILED although the file held the correct value | The plan wrote an invented expected value (16386.16) into the verification objective | Plan contract: objectives state what the user asked only, never an expected figure the user did not give |
| B06 PARTIAL with correct values `2,3,5,…,97 / count: 25` | Harness measurement defect: needle `"2, 3, 5"` required one space; the task says only "comma separated" | Check now verifies all 25 primes in order, no extra value and `count: 25` (stricter); spacing around commas is free |
| Stage 6 FAIL (clippy 1.97) | `type_complexity`, `manual_range_contains` in the new test files | Fixed in the tests |
| E2E-22: 5 children alive 1.5 s after the restart launch exited | Not yet attributed (names were not recorded); no mission or sandbox ran at restart (audit) | Launcher records child process names and a bounded 10 s exit grace; a child alive after it is still an orphan |

## Addendum 2 — verification method, 2026-09-30 (owner decisions and chain defects)

### Owner decisions

1. **Each phase is tested separately.** Runners 05–08 take `-Regression PriorGates` (default): the regression stage
   no longer re-runs the runner below; the regression conditions read every lower gate as its own runner decided
   it and still require it canonical, `PASS` and (where the gate has one) opening the next phase. The blocking
   start prerequisite is unchanged. `-Regression Rerun` restores the nested re-run. Reason: one chain attempt
   re-ran Phase-00..05 four times (≈2 h per attempt).
2. **Real-model tests are deferred to a later phase.** The Phase-08 runner skips the harness sections `model` and
   `missions` and names no model to the UI suite unless `-IncludeModel` is given. A closed list of sixteen
   conditions (`p08-derive.mjs MODEL_DEFERRED_CLAIMS`: P08-MODEL-01..03, P08-BENCH-01/02, P08-MISSION-A..E,
   P08-SEC-03, P08-SCH-02, P08-E2E-03/05/06/07) is marked `DEFERRED`, listed apart in the gate and never counted as
   `PASS`; `REAL_MODEL_VERIFIED = DEFERRED_TO_LATER_PHASE`.

### Defects measured by the chain runs of 2026-09-30, each with a test that fails before the fix

| Symptom | Root cause (evidence) | Fix |
|---|---|---|
| PHASE-00 FAIL `CLEANUP_NOT_CLEAN`, workspaces 1 | `%TEMP%\polaris-w5-panic-2a23…` created 2026-09-29T10:52:59Z, the moment the earlier chain was interrupted (machine offline) | Moved (not deleted) to `_to_delete\p08-interrupted-run-residue\`; the check stays machine-wide. `run-chain.ps1` now names such leftovers before starting (seconds, not an hour) |
| Phase-01 runner died at "renderer: install dependencies" without a gate | `run-chain.ps1` ran runners inside `& runner *>&1`; Windows PowerShell 5.1 turned npm's stderr warning into a terminating `NativeCommandError` under `ErrorActionPreference = Stop`. The chain would also have accepted a stale `PASS` gate | Each runner runs as its own process (`-File`); a gate not re-decided after the runner started is refused. P08-TOOLS-010/010b |
| P03-E2E-04 "the created mission never appeared in mission.list" (cascade to E2E-05..08, 13, 26–29) | `p03-suite.ts waitFor` accepted only a synchronous probe; E2E-04 passed an `async` one, so the Promise itself ended the wait: one check 4 ms after the click instead of polling (the standalone run won the race, the regression run lost it) | `waitFor` awaits the probe (as p04–p08 already did). Renderer test "P03-UI waitFor …" (fails before, passes after); measured 69 ms in the next run |
| P05-E2E-16/17/21 `TARGET_OBSCURED` | The maximised Claude desktop window covered the desktop fixture; the product's refusal is correct | The fixture launcher minimises every window before the fixture opens (the runbook's Windows+D); the fixture stays non-topmost, so a real occlusion is still refused |

## Addendum 3 — functional closure, 2026-09-30

- `POLARIS_FUNCTIONAL_RC` is `PASS` only when the deterministic documents and all sixteen real-model conditions pass;
  a deferred one gives `NOT_PROVEN (real-model conditions deferred)`, any other non-PASS or absent one `FAIL (<reason>)`
  (`p08-final-gate.mjs functionalVerdict`, P08-TOOLS-015). Deferral may make the engineering gate pass; it can never
  make the functional verdict pass.
- A failed benchmark task is re-measured alone (`-Remeasure missions -RemeasureTasks`, same model, same checks, earlier
  rows kept under `superseded`; P08-TOOLS-016), never by a full re-run.
- Result: one canonical run with `-IncludeModel` decided PHASE-08 = PASS 105/105, 0 deferred (09:21:35Z). The only
  defect found was in the measurement harness (`P08-LCY-CANCEL-RUNNING` could not see a live run because runs are
  recorded when they finish); fixed in `lifecycle.rs run_in_flight` with a unit test, and the check now prepares the
  private Python runtime itself instead of relying on the `sandbox` section running first. Re-measured natively:
  PASS (a live run seen, `CANCELLED` in 36 ms, 0 survivors).
