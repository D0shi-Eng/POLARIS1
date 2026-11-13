# 2026-09-10 — Phase-00 final gate read the wrong run record

These eleven documents are the **exact, byte-identical** canonical evidence written by the
owner's native Windows W6 run of 2026-09-10T04:21:48Z, copied here unmodified. Nothing in this
directory may be edited to make a gate green: the whole value of the set is that it is the run
that exposed the defect.

## What the run measured

| measurement | value | where it lives |
|---|---|---|
| W6 test groups | 9 pass, 0 fail, 0 blocked, 0 inconclusive, 0 not tested, 50 tests | `w6-test-groups.json` |
| W6 dogfood | D01..D12, 12/12 PASS | `w6-dogfood.json` |
| runtime suite | 480 tests, 477 pass, 0 fail, 3 skipped | `w6-skip-classification.json` → `suite_summary` |
| runtime suite exit code | `0` | `w5-run.json` → `runtime_test_exit_code` |
| contracts verify | exit `0`, 4244 ms | `w5-run.json` → `steps[name="contracts: verify"]` |
| W4 native regression | 12/12 probes | `w4-windows-conformance.json` |
| skip inventory | PASS, 3 skips, 0 unclassified | `w6-skip-classification.json` |
| evidence byte gate | 43 checked, 0 defective | `w6-evidence-bytes.json` |
| W6 run record | verdict PASS, no reason codes | `w6-run.json` |

## What the gate wrote anyway

`phase-00-final-gate.json` in this directory is the defective output:

    PH00-W2 = NOT_TESTED   STEP_NOT_IN_RUN_RECORD
    PH00-W3 = FAIL         RUNTIME_SUITE_FAILED
    PHASE-00 = FAIL (PH00-W3)
    PHASE-01 GATE = NOT_ALLOWED

## The defect

Both claims were read out of `w6-run.json`, and neither measurement is in that document:

* `PH00-W2` looked for `steps[name == "contracts: verify"]` in the **W6** run record. W6 does not
  run the contracts step. It delegates it, deliberately and by design, to the frozen W5 runner.
  The step exists — in `w5-run.json`. Absent step, so `NOT_TESTED`.
* `PH00-W3` read the top-level field `runtime_test_exit_code` from the **W6** run record. Only the
  W5 run record carries that field. `undefined === 0` is `false`, so an **absent** measurement was
  reported as a **failed** one. That is the more serious half: a missing number was promoted to a
  negative result, which is the mirror image of promoting `NOT_TESTED` to `PASS`.

Neither W2 nor W3 was broken. The consumer read the wrong document.

## How this set is used

`runtime/tests/w6-phase-00-gate.test.ts` copies these documents into a temporary root and runs the
real gate over them. The gate must derive `PH00-W2 = PASS` and `PH00-W3 = PASS` from this exact,
unmodified input. Before the mapping fix it derived `NOT_TESTED` and `FAIL` from the same bytes.
