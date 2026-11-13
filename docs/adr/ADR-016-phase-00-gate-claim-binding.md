# ADR-016 — a Phase-00 claim reads the document its measurement lives in, bound to the run

**Status:** accepted · **Date:** 2026-09-10 · **Scope:** `tools/w6-conformance/phase-00-gate.mjs`,
`tools/w6-conformance/phase-00-derivation.mjs`. No W2, W3, W4, W5 or W6 implementation is changed
by this decision, and no acceptance threshold is lowered by it.

## Context

The native Windows W6 run of 2026-09-10T04:21:48Z was clean in every measurement it made:
9/9 test groups, 12/12 dogfood scenarios, 480 runtime tests with 477 passing and 0 failing,
contracts verify at exit 0, 12/12 W4 native probes, 43 evidence documents with 0 byte defects.

The Phase-00 final gate, reading that same evidence, wrote `PH00-W2 = NOT_TESTED` and
`PH00-W3 = FAIL`, and closed Phase-00 as `FAIL`.

Both claims were read out of `evidence/w6-run.json`. Neither measurement is in that document.
W6 does not run the contracts step and does not run the runtime suite: it invokes the frozen W5
runner, which owns both, and that runner writes them to `evidence/w5-run.json`. The gate was
written against the W5 run-record shape and then pointed at the W6 run record when W6 took over
as the owner command.

Two distinct failure modes came out of one mistake:

* `steps.find(name === "contracts: verify")` returned `undefined`, and the gate named that
  `NOT_TESTED`. Honest about itself, wrong about the world.
* `document.runtime_test_exit_code === 0` compared `undefined` to `0`, got `false`, and the gate
  named that `FAIL`. **An absent measurement was reported as a failed one.**

The second is the more serious. Promoting `NOT_TESTED` to `PASS` is the failure this project
guards against everywhere; demoting an absent field to `FAIL` is the same substitution running the
other way, and nothing in the gate forbade it.

A third hazard was found while reading the chain, and is not hypothetical. `contracts: verify` is
a *hard* step in the frozen W5 runner: on a non-zero exit it throws, so the runner stops **before**
it writes `evidence/w5-run.json`. The previous run's passing record stays on disk. A reader that
does not tie the document to the current run reads an old success and writes it as a new verdict.

## Decision

1. **A claim names the document its measurement lives in, and reads it there.** `PH00-W2` reads
   `evidence/w5-run.json` at `steps[name='contracts: verify'].exit_code`. `PH00-W3` reads the same
   document at `runtime_test_exit_code`. Each condition record carries `evidence_reference` and
   `measurement_locator`, so the path from claim to number is in the evidence, not in the reader's
   head.

2. **Absence is `NOT_TESTED`.** A missing document, a missing step, a missing field, an unreadable
   exit code, an unreadable count and a suite that counted zero tests are each `NOT_TESTED` with a
   distinct reason code, and each sets `evidence_complete: false`. `FAIL` is reserved for a
   measurement that happened and came back negative.

3. **A delegated document must fall inside this run's window.** Before `PH00-W2`, `PH00-W3`,
   `PH00-W4` or `PH00-W5` is read, the source document's `ran_at` must lie between the W6 run's
   `bootstrap.bootstrap_started` and its `ran_at`. Outside that window the claim is `NOT_TESTED`
   with `EVIDENCE_STALE_FOR_THIS_RUN`. This uses fields that already exist; it measures nothing new.

4. **Two independent witnesses must agree for `PH00-W3`.** The exit code of the final suite step in
   the W5 record, and the TAP counts the W6 skip inventory took from its own full-suite run. A
   non-zero count of failures fails the claim whatever the exit code says; a non-zero exit code
   fails it whatever the counts say; a `runtime_test_exit_code` that contradicts its own
   `runtime: final test` step is `NOT_TESTED`, because a record that contradicts itself is not a
   reading. **A disagreement never resolves upward.**

5. **The W3 instruments are named, not assumed.** The runtime suite is a legitimate witness for
   W3 because W3's measurement lives inside it — `config.test.js`, `config-properties.test.js`,
   `policy.test.js` — and a failure in any of them fails the suite. That argument only holds if
   those files were in the executed set, so the skip inventory now records the file list it ran and
   the gate checks the instruments against it. A green total over a run that never loaded the
   instrument is not a result.

6. **The producer maps, it does not copy.** `run.ps1` writes a `delegated_measurements` block into
   `w6-run.json` naming, for each delegated claim, its owner, its source document, its locator and
   whether that document is bound to this run. It carries **no numbers and no verdicts**: a second
   copy of the same measurement is exactly how two sources of truth drift apart, which is the
   family this defect belongs to.

7. **The derivation is a pure function.** `phase-00-derivation.mjs` takes parsed evidence documents
   and returns conditions and a verdict, with no disk, no argv and no exit. `phase-00-gate.mjs`
   reads, writes and reports, and decides nothing. The gate could not be tested before because the
   only way to run it was a full native Windows run; that is why a one-line mapping error reached
   a final gate with no regression test standing in its way.

## Consequences

* Phase-00 can only be closed by a native run whose evidence satisfies every condition. This
  decision does not close it and does not promote anything: it removes a false negative and adds
  four ways for a claim to refuse to be read.
* `evidence/phase-00-final-gate.json` gains `schema_version` `1.1.0`. Each condition now carries
  `source_week`, `source_kind`, `measurement_locator`, `measurement_started` and
  `measurement_completed` alongside the fields it already had. An empty timestamp means the
  producing tool did not record one; the gate never fills one in.
* `PH00-W1` stays `CARRIED_FROZEN` and `measured_in_this_run: false`. A carried claim is never
  presented as a fresh measurement.
* Twelve regression classes now cover the gate (`runtime/tests/w6-phase-00-gate.test.ts`), driven by
  the owner-run evidence itself, kept unmodified under
  `evidence/defect-fixtures/2026-09-10-phase-00-gate-misbinding/`.

## Alternatives rejected

* **Deleting the `PH00-W2` claim, or reading contracts from the console text.** The console said
  117/117. Console text is not canonical evidence, and a claim removed to make a gate green is the
  defect this project exists to prevent.
* **Treating a missing `runtime_test_exit_code` as `0`.** That is promoting absence to `PASS`.
* **Copying the contracts and suite results into `w6-run.json`.** It would have made the original
  lookup work, at the price of two documents holding the same number with no rule about which one
  is the truth when they differ.
