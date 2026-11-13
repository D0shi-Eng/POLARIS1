# tools/w6-conformance

The W6 runner and the tools it drives. One command owns the sequence:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w6-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
```

## What is here

| File | What it does |
| --- | --- |
| `run.ps1` | the single owner command. Runs the **frozen** W5 runner (which runs the **frozen** W4 runner), then the W6-owned steps, then writes `w6-run.json` and the Phase-00 gate. |
| `w6-groups.mjs` | the group and scenario definitions. One source, read by every consumer. |
| `w6-tap.mjs` | a TAP reader at the level of the individual test — names, outcomes and skip reasons. The W5 reader reads summaries; a scenario verdict needs more than a summary. |
| `w6-test-groups.mjs` | runs each W6 group once, writes one evidence record per group plus the aggregate. Reuses the W5 test-group contract unchanged. |
| `w6-dogfood.mjs` | derives the D01..D12 scenario verdicts from measurements that already ran. Runs no test. |
| `w6-skip-inventory.mjs` | runs the whole suite once and classifies every skip against `runtime/tests/w6-skip-registry.ts`. |
| `w6-repeatability.mjs` | runs the primary scenario twice in separate processes and compares outcome by outcome. |
| `w6-evidence-bytes.mjs` | the widened byte gate: every canonical evidence document, discovered by pattern, not by a hand-kept list. |
| `phase-00-derivation.mjs` | the Phase-00 conditions as a pure function of the evidence documents. No disk, no argv, no exit — so it can be tested without a native run. |
| `phase-00-gate.mjs` | reads canonical evidence, hands it to the derivation, writes the verdict. Measures nothing and decides nothing. |

## Rules these tools keep

- **Nothing is canonical without the marker.** Evidence is written under its
  canonical name only when `POLARIS_W6_NATIVE_RUN=1`, which only `run.ps1`
  sets. Every other run writes `*.adhoc.json` and says so inside the file.
- **A Linux result never becomes a Windows claim.** A native-only scenario with
  no native evidence is `NOT_TESTED`, whatever else passed.
- **`BLOCKED`, `INCONCLUSIVE` and `NOT_TESTED` are never promoted to `PASS`.**
- **Absence stays absence.** An unreadable counter is `null`, never `0`.
- **W4 and W5 are not re-implemented.** Their runners are invoked as they are.
- **Absence is not failure.** A measurement that is not in the evidence is
  `NOT_TESTED`. Reporting it as `FAIL` is the same error as reporting it as
  `PASS`: both replace a measurement with something that is not one.
- **A claim reads the document its measurement lives in.** W6 delegates the
  contracts step and the runtime suite to the frozen W5 runner, so `PH00-W2`
  and `PH00-W3` are read from `evidence/w5-run.json`, and that document must
  fall inside this run's window before it is read at all.

## Running a piece on its own

Any tool can be run directly for iteration. It writes `.adhoc` evidence, which
is not a W6 result:

```
node tools/w6-conformance/w6-test-groups.mjs --root .
node tools/w6-conformance/w6-dogfood.mjs --root .
node tools/w6-conformance/w6-skip-inventory.mjs --root .
node tools/w6-conformance/w6-evidence-bytes.mjs --root .
```

`run.ps1 -SelfCheck` proves the bootstrap and stops before any measurement. A
clean self-check is not a W6 verdict.
