# W4 — Windows execution adapter

Native Win32 adapter that proves two things W4 cannot prove from a POSIX host,
and cannot borrow from W1.

## Why it exists

W1 proved a **mechanism**: AppContainer with zero capabilities plus a Job Object
confines a process, and an inherited handle defeats filesystem confinement
(probe X03).

W4 must prove something different and stronger: that **the execution path W4
actually uses** respects that mechanism. Re-running W1 does not establish this.
A POSIX `/proc` descriptor scan is not Windows HANDLE evidence.

## Build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w4-windows-adapter\build.ps1"
```

Uses the in-box .NET Framework C# compiler. No Visual Studio, no packages, no
network. The P/Invoke layer is **reused from the W1 spike** rather than rewritten
into a weaker copy.

The conformance runner builds it automatically; this command is for building it
alone.

## Modes

### `--mode handle-x03` → probe **W-11**

Windows HANDLE inheritance regression, with a positive control.

| Case | Setup | Requirement |
| --- | --- | --- |
| `POSITIVE_CONTROL` | ambient inheritance, **no** handle list, one deliberately leaked inheritable handle to an out-of-scope canary file | the child **must** find the handle and read the canary through it |
| `CLEAN_ADAPTER` | same leak present in the parent, `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` with the standard streams only | the child must find **no** out-of-scope handle |
| `CLEAN_EXECUTOR` | same, but the child is the **real W4 executor** (`node host-main.js`) executing a real grant | no out-of-scope handle in its table |

The verdict is `INCONCLUSIVE` — never `PASS` — if the positive control fails to
detect the deliberate leak. A probe that cannot demonstrate its own validity
proves nothing when it finds nothing.

Enumeration uses documented Win32 only: `DuplicateHandle` against the target,
`GetFileType`, `GetFinalPathNameByHandleW`, then an actual `ReadFile` to prove
the handle is not merely present but usable. The child is created **suspended**
and scanned before it is resumed, so the result is deterministic rather than a
race.

### `--mode confined-exec` → probe **W-12**

AppContainer + Job Object integration of the real W4 executor.

Establishes: a zero-capability AppContainer profile (no `internetClient`, no
capability of any kind); explicit ACL grants for exactly what the process needs,
restored on teardown; a Job Object with `KILL_ON_JOB_CLOSE` and **no** breakaway;
creation suspended; explicit handle list; constructed environment block; job
assignment **before** resume.

Then it requires all of:

- the permitted in-scope read succeeds from inside the container,
- the out-of-scope read is refused,
- no out-of-scope handle was in the child's table at start,
- the job reports no survivors after teardown.

If the executor cannot start inside the AppContainer, the adapter reports
`BLOCKED` with the failing stage and the Win32 error. `BLOCKED` is not a pass, is
not a skip, and the harness exits non-zero on it. W1's mechanism result is
explicitly **not** accepted as a substitute.

### `--mode handle-child`

Internal. The child that scans its own handle table and reads what it finds.
Exists so the positive control is real.

## Evidence

| File | Written by |
| --- | --- |
| `evidence\w4-windows-x03.json` | `--mode handle-x03` |
| `evidence\w4-windows-confined-exec.json` | `--mode confined-exec` |

Each carries the probe id, both process ids, the handle setup mode, the
positive-control result, the clean-launch result, the canary result, Win32 error
codes, and a verdict of `PASS` / `FAIL` / `BLOCKED` / `INCONCLUSIVE`.

## What guards it

`runtime/tests/w4-windows-adapter.test.ts` asserts, on the source rather than on
prose, that every confinement invariant is still present: the explicit handle
list, suspended creation, job assignment before resume, handle scan before
resume, zero capabilities, no `internetClient`, no breakaway, and that
`BLOCKED` / `INCONCLUSIVE` can never be recorded as a pass.

Those are static guards against silent weakening. They are not a substitute for
the native run, which is what issues the verdict.
