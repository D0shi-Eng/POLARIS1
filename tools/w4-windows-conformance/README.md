# W4 — Windows native conformance harness

## Why this exists

The session that built W4 could not execute Windows binaries. Everything in W4
that depends on **real Windows path and link semantics** is therefore classified
`REQUIRES_NATIVE_RUN` until this harness has actually run on Windows.

W4 does not claim a Windows result it did not observe.

## Run it

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w4-windows-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
```

Diagnose the bootstrap alone, without running any test:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w4-windows-conformance\run.ps1" -RepositoryRoot "D:\POLARIS" -SelfCheck
```

It performs three steps and stops at the first failure:

1. `contracts\` dependencies — `npm ci` through `npm.cmd`, **only** where the
   tree is absent, unreadable, or stamped by another operating system
2. `contracts\` — `npm run verify`, which builds the package `runtime` consumes
3. `runtime\` dependencies — `npm ci`, which **packs** `..\contracts` and installs
   it as an ordinary package. This must come after step 2: the pack takes
   whatever is on disk, and a package packed before the build has no entry point.
4. **package resolution gate** — `tools\package-resolution\check-package-graph.mjs`
5. `runtime\` — `npm run verify` (the whole W1/W2/W3/W4 suite, on Windows)
6. `tools\w4-windows-adapter\build.ps1` — the native adapter
7. `tools\w4-windows-conformance\windows-probes.mjs` — the Windows-only probes

Evidence is written to `evidence\w4-windows-conformance.json`, the bootstrap
record to `evidence\w4-windows-runner-bootstrap.json`, and the package-graph
record to `evidence\w4-package-resolution.json`.

The whole run is also transcribed to `evidence\w4-windows-run-transcript.log`
via `Start-Transcript`, so a step that fails *before* the structured evidence is
written can still be diagnosed. A failure that leaves no trace is not a result.

A dry run on any non-Windows host writes
`evidence\w4-windows-conformance.local-dryrun.json` instead: the canonical
filename is reserved for a run that really happened on Windows. The package
gate follows the same rule with `evidence\w4-package-resolution.local.json`.

## Package resolution gate

`runtime` depends on `@polaris/contracts` as `file:../contracts`. By default npm
realises that declaration as a **link** inside `runtime\node_modules\@polaris\`,
and that link is a filesystem object written by whichever operating system last
ran an install. `D:\POLARIS` is reachable from two of them, and neither can read
the other's: a Linux symlink is untraversable from Windows, and a Windows
junction does not even report as *existing* from Linux (`EIO`). Native run 3
failed exactly that way — `tsc` reported `TS2307 Cannot find module
'@polaris/contracts'` in eleven files, with five cascading `TS7006` behind it,
while the dependency tree looked installed.

`runtime\.npmrc` therefore sets **`install-links=true`**. npm packs the contracts
directory and installs the result as an ordinary `node_modules` package: plain
files, no reparse point, nothing for either operating system to traverse. Which
operating system wrote the tree stops mattering to *resolution*. See
`docs/adr/ADR-005-cross-os-local-package-materialisation.md`.

The tree as a whole is still host-owned — `.bin` shims are `.cmd` on Windows and
symlinks elsewhere — so the runner writes `node_modules\.polaris-host.json` after
every install and reinstalls when the stamp is missing or names another platform.
Ownership is measured, not inferred from a link that failed to open.

Revision 1.4 of the runner:

- treats a tree as healthy only when every declared dependency is readable **and**
  the host stamp matches this platform;
- removes a dependency tree with `rmdir /s /q`, which deletes a link instead of
  following it, and refuses to continue if the contracts package disappeared;
- installs `contracts`, **builds** it, and only then materialises `runtime`;
- runs the gate before `runtime` is verified, the adapter is built, or any probe
  runs;
- repairs once with `npm ci` from the lockfile when the gate reports a repairable
  code, then re-measures;
- reads the gate's **exit code**, never its output. Revision 1.3 wrote
  `& node ... ; return $LASTEXITCODE` inside a function, so the command's stdout
  joined the return value: the caller received an `Object[]`, `-ne 0` filtered it
  instead of comparing, and a passing gate was reported as a failure. The gate's
  output now goes to the host, only an `[int]` is returned, and the caller throws
  if it ever receives anything else;
- fails with `WINDOWS_PACKAGE_RESOLUTION_BOOTSTRAP_DEFECT`, exit code `2`, and
  says plainly that no security claim was tested and that W-11 and W-12 remain
  `NOT_EXECUTED_THIS_RUN`.

The gate proves resolution independently at each layer, because none implies the
others: the dependency is materialised as a packed package (`PACKED_PACKAGE`),
its export surface is byte-identical to the contracts build, **Node** imports it
from inside `runtime`, and **TypeScript** resolves the declarations with the
runtime's own `NodeNext` settings. A `tsconfig` alias would satisfy only the
last. The regression guard is `runtime/tests/w4-package-resolution.test.ts`
(REG-PKG-001 … REG-PKG-012), and the Phase-00 records
records the root cause.

## Bootstrap contract

`$PSScriptRoot` is populated **only** when the engine has a script *file*
context. It is empty — or, under `Set-StrictMode`, undefined — when the script
text is evaluated without one: piped to `powershell -Command -`, passed through
`Invoke-Expression`, dot-sourced from a string, run in an ISE immediate window,
or executed by a wrapper host that does not set it.

Revision 1.0 of this runner derived the repository root inside a `param()`
default from that variable alone. When it was empty the failure happened during
**parameter binding**, before the body ran — and in some hosts the binding error
did not stop the script, so it continued with an empty root and reported step
failures that were never really tested.

Revision 1.1 therefore:

- takes **no computed parameter defaults at all**;
- tries an ordered list of root sources, each labelled:
  1. `-RepositoryRoot` (authoritative — a wrong explicit value fails, never falls back)
  2. `$PSScriptRoot`
  3. `$PSCommandPath`
  4. `$MyInvocation.MyCommand.Path`
  5. `$MyInvocation.MyCommand.Definition` (only when it names a real file)
  6. `$env:POLARIS_ROOT`
  7. the current directory
  8. `D:\POLARIS`, the mandated workspace — last, and still validated;
- reads every automatic variable through `Get-Variable` so an *undefined* one is
  not an exception under `Set-StrictMode`;
- validates each candidate against POLARIS repository markers and canonicalises
  the winner;
- fails with `WINDOWS_RUNNER_BOOTSTRAP_DEFECT`, exit code `2`, listing every
  candidate and why it was rejected — and says in the output that **no security
  claim was tested**, so a bootstrap failure is never mistaken for a confinement
  result.

`windows-probes.mjs` follows the same contract: `--root`, then its own module
location, then `POLARIS_ROOT`, then the working directory.

The regression guard is `runtime/tests/w4-runner-bootstrap.test.ts`. Where a
PowerShell interpreter is available it executes this script under every
invocation mode, **including the one that produced the defect**; where none is
available it still enforces the structural contract.

## What the probes prove

| Probe | Claim |
| --- | --- |
| W-01 | The path authority reports native Windows semantics |
| W-02 | A reserved device name (`NUL`) is refused |
| W-03 | An alternate data stream (`file:stream`) is refused |
| W-04 | A trailing dot or space is refused |
| W-05 | An 8.3 short-name form is refused |
| W-06 | Containment folds case, as Windows paths really do |
| W-07 | A **directory junction** that leaves the root is caught as `SYMLINK_ESCAPE` |
| W-08 | The walking skeleton completes natively with real read and write effects |
| W-09 | Every tool parameter was declassified before its effect |
| W-10 | An out-of-scope read is denied at the PDP with `RESOURCE_OUT_OF_SCOPE` |

## What the probes deliberately do NOT prove

| Probe | Non-claim |
| --- | --- |
| W-11 | Windows **handle inheritance**. The `/proc` descriptor probe has no Windows equivalent in W4. The X03 inherited-handle regression on Windows belongs to the W1 spike (`tools\confinement-spike`), which owns the native HANDLE-table check. |
| W-12 | **AppContainer or Job Object confinement.** W4 ships a separate-process execution host with an explicit environment, explicit stdio and a hard deadline. That is a real boundary, but it is not Windows capability confinement. The W1 result stands on its own; a W4/W5 Windows adapter is deferred. |

Both non-claims are emitted as `SKIPPED` with their reason, so the evidence file
records the gap rather than hiding it.
