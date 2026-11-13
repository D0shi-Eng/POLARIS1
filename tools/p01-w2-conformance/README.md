# `tools\p01-w2-conformance` — the P01-W2 verification run

One command. It owns the whole P01-W2 sequence and writes the canonical
P01-W2 evidence.

```
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-w2-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
```

## What it does, in order

| # | Step | Owns |
| --- | --- | --- |
| 1 | `P01-B1` prerequisite | **reads** `evidence\phase-01-baseline.json`; never re-measures it |
| 2 | contracts | `npm run verify` — generate, typecheck, build, test |
| 3 | package refresh | re-materialises `@polaris/contracts` inside `runtime` (ADR-005) |
| 4 | package resolution gate | the frozen graph check |
| 5 | runtime | typecheck, build, test — the Phase-00 runtime regression |
| 6 | P01-W2 test groups | ten groups, one evidence record each |
| 7 | P01-W2 derivation | `evidence\phase-01-ipc.json` |
| 8 | evidence byte gate | every canonical P01-W2 document |

## The marker

`POLARIS_P01_W2_NATIVE_RUN=1` is set by this script and by nothing else. The
producers write canonical names only when they see it; every other run writes
`.adhoc` names and stamps a note saying so. A `.adhoc` document is never a
P01-W2 result, and the derivation refuses to record `PASS` in one — it records
what the measurement showed under `measured_verdict` and leaves `verdict` at
`INCONCLUSIVE` with `NOT_CANONICAL_RUN`.

## Files

| File | Role |
| --- | --- |
| `run.ps1` | the owner command |
| `p01-w2-groups.mjs` | group definitions — one source, several consumers |
| `p01-w2-test-groups.mjs` | runs each group, writes one record each plus the aggregate |
| `p01-w2-ipc.mjs` | derives `phase-01-ipc.json`; measures nothing itself |
| `p01-w2-evidence-bytes.mjs` | the byte contract over the named P01-W2 documents |

The group record contract is **W5's**, imported from
`tools\w5-conformance\w5-test-group-contract.mjs` and not copied. The byte
classification is `tools\evidence-contract\evidence-bytes.mjs` and not copied.

## Switches

- `-SelfCheck` — resolve the root, prove the toolchain, read `P01-B1`, stop.
  A clean self-check is not a result.
- `-SkipRuntimeRegression` — skip steps 3 to 5 while iterating on the contract
  surface. The marker is then never set, so no canonical evidence can be
  written, and the run reports `INCONCLUSIVE` by construction.

## What it never does

No Git. No download. No install beyond the local package re-materialisation
ADR-005 requires. It does not re-measure `P01-B1`, and it does not write a
Windows claim, because P01-W2 makes none: `P01-C1`, `P01-C2` and `P01-C3` are
all tier `any` in the gate matrix.
