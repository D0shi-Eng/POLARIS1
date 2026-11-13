# tools/p01-conformance

The Phase-01 verification instrument. One command owns the whole phase.

```
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
```

Nothing in Phase-01 is a closed result until this has run on Windows and put its
marker on the evidence.

## What is here

| File | What it does |
| --- | --- |
| `run.ps1` | the single run: eleven stages, in dependency order |
| `desktop-native.ps1` | the native measurement stages, dot-sourced by `run.ps1` |
| `build-mode.mjs` | packaged-frontend guard: static config/runner checks, and the real cargo `cfgs` after each build |
| `csp-guard.mjs` | product CSP guard (P01_STARTUP_REPORT_ABSENT): no string evaluation in the policy, no run-time Ajv compiler in the renderer, none in the built bundle |
| `frontend-lane.ps1` | affected lane for P01-NATIVE-ASSET-001: product built with `custom-protocol`, launched with no dev server |
| `ascii-discipline.mjs` | the class guard for the defect that stopped P01-W2 |
| `p01-groups.mjs` | the test-group declaration and the shared constants |
| `p01-test-groups.mjs` | runs every lane and reads its exact counts |
| `p01-native.mjs` | turns the raw native observations into two canonical documents |
| `p01-claims.mjs` | the gate matrix, as data that executes |
| `p01-facts.mjs` | the structural facts, measured from the tree |
| `p01-stride.mjs` | the STRIDE review, as data |
| `p01-derive.mjs` | writes the five derived evidence documents |
| `p01-evidence-bytes.mjs` | the byte contract gate, in two passes |
| `app-icon.mjs` | reads, validates and deterministically builds the Windows `.ico`; the `P01-ASSET-*` guard |
| `make-app-icon.mjs` | regenerates `desktop\host\app\icons\icon.ico` from `icon.png`; `--check` proves no drift |
| `tests\app-icon.test.mjs` | the `P01-ASSETS` lane: P01-ASSET-001..004 plus rejection cases |
| `tests\test-groups.test.mjs` | the `P01-ASSETS` lane: the test-summary reader reads Windows spec/CRLF output and the reporter flag precedes the files |
| `p01-final-gate.mjs` | the 41 conditions, and the Phase-02 decision |

## Stages

```
 0  bootstrap              root, toolchain, P01-B1 read and honoured
 1  ascii discipline       every .ps1 under tools\, executable lines only
 2  P01-W2 closure         calls the W2 runner; stops if W2 is not PASS
 3  renderer               install, generate, drift guard, typecheck, build, test build
 4  native host            asset guard, then cargo build: the product binary, then the measurement binary
 5  test groups            every lane, with exact counts
 6  native measurement     launch, window, three device scales, restart, exit
 7  Phase-00 regression    snapshot the gate document, then re-run the frozen runner
 8  derivation             the five derived documents
 9  byte gate              first pass
10  final gate             the matrix
11  byte gate              second pass, including the final gate itself
```

Stage 2 is a call, not a copy. `evidence\phase-01-ipc.json` belongs to P01-W2 and
this runner reads what W2 wrote.

## Switches

* `-SelfCheck` — resolve the root, prove the toolchain, read `P01-B1`, stop.
  Writes no evidence and is not a result.
* `-SkipNativeMeasurement` — skip stage 6. Windows claims stay `NOT_TESTED`.
* `-SkipPhase00Regression` — skip stage 7. Same rule.

Either skip switch makes the run report `INCONCLUSIVE` and exit non-zero. That is
deliberate: a convenient run is not a clean one.

## Running a piece by hand

Every tool takes `--root` and can be run alone, in this order:

```
node tools\p01-conformance\ascii-discipline.mjs   --root D:\POLARIS
node tools\p01-conformance\p01-test-groups.mjs    --root D:\POLARIS
node tools\p01-conformance\p01-native.mjs         --root D:\POLARIS
node tools\p01-conformance\p01-derive.mjs         --root D:\POLARIS
node tools\p01-conformance\p01-evidence-bytes.mjs --root D:\POLARIS
node tools\p01-conformance\p01-final-gate.mjs     --root D:\POLARIS
node tools\p01-conformance\p01-evidence-bytes.mjs --root D:\POLARIS --include-final-gate
```

Run this way the marker is absent, so every document is written with an `.adhoc`
suffix and the gate reports `BLOCKED / NOT_CANONICAL_RUN` no matter how green the
measurement is. The measurement is still published under `measured_verdict`.

## What this instrument installs, downloads or touches

It runs `npm install` inside `desktop\renderer` and `cargo build` inside
`desktop\host`, both of which fetch declared dependencies. It touches no Git, no
network beyond those package managers, and nothing outside `D:\POLARIS` except
the temporary report files it writes under `evidence\p01-native\`.

## The ASCII rule

Every executable line in every `.ps1` under `tools\` must be ASCII. Arabic belongs
in comments. This is not style: an em dash inside a quoted string is what stopped
P01-W2, because Windows PowerShell decodes a BOM-less file with the local code
page and the last byte of that dash is a character it accepts as a closing quote.
`P01-W2-RUNNER-PARSER-REMEDIATION.md` has the full account.
