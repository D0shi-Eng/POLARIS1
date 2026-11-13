# tools\p01-baseline — P01-B1

The Phase-01 toolchain baseline. One measurement, one evidence document.

## What it does

Probes the Windows host for the toolchain Phase-01 needs and writes
`evidence\phase-01-baseline.json` through the sanctioned evidence writer.

| Probe | Requirement | Why |
| --- | --- | --- |
| `node`, `npm` | REQUIRED | the existing packages and the renderer build |
| `rustc`, `cargo` | REQUIRED | the native host — ADR-018 |
| `rustup` | OPTIONAL | active toolchain, for diagnosis |
| `msvc_build_tools` | REQUIRED | the Rust MSVC linker on Windows, via `vswhere` |
| `webview2_runtime` | REQUIRED | the render host; absence is a blank window, not a build error |
| `windows_sdk` | OPTIONAL | ships with MSVC; recorded for diagnosis |
| `tauri_cli` | OPTIONAL | installed as a project dependency, not a global tool |

## What it does not do

It builds nothing, installs nothing, downloads nothing, and touches no file
except the evidence document. If a required tool is missing it reports that and
exits `2`. It does not install it, and Phase-01 does not proceed around it.

## Serialization contract

`P01-W1` found the instrument dying at `exit 1` with
`System.ArgumentException: Argument types do not match` before it measured
anything: `@($probes)` over a PSObject-wrapped `List[object]` throws in
`PSToObjectArrayBinder`. A generic collection is now an accumulator during
measurement and never a value in the evidence document — it is copied to a true
`System.Object[]` by `ICollection.CopyTo` first. The evidence writer was not
changed.

`tests\serialization.tests.ps1` (SER-001 … SER-020) proves it, under Windows
PowerShell 5.1 only; a PowerShell 7 pass alone is reported as
`NOT_WINDOWS_POWERSHELL_5_1`. See
`docs\phases\PHASE-01\P01-W1-BASELINE-POWERSHELL51-REMEDIATION.md`.

## Command

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-baseline\tests\serialization.tests.ps1" -RepositoryRoot "D:\POLARIS"
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-baseline\baseline.ps1" -RepositoryRoot "D:\POLARIS"
```

Exit `0` — verdict `PASS`, every required tool present.
Exit `2` — verdict `FAIL`, `P01_TOOLCHAIN_INCOMPLETE`; the missing ids are named
on the console and in `summary.missing_ids`.
