# ADR-018 — The Phase-01 desktop host stack

**Status:** ACCEPTED (2026-09-15) — proposed in P01-W1 on 2026-09-10; the
acceptance rule of this ADR (`evidence\phase-01-ipc.json` records
`P01-W2 = PASS`) is met by the canonical native run of 2026-09-15.
See *Acceptance record* at the end.
**Supersedes:** nothing. **Depends on:** ADR-001, ADR-002.

## Context

P01-W1 discovery established that **no desktop tier exists** in `D:\POLARIS`:
no `Cargo.toml`, no `package.json` outside `contracts` and `runtime`, no UI
code, no localization, no design tokens. §31 asks not to replace working
foundations; on the desktop side there are none to preserve, so the stack is
chosen rather than inherited.

The choice is architectural and not freely reversible later, so it is recorded
here rather than made implicitly by the first file created.

## Decision

**Tauri v2 as the native host, React + TypeScript + Vite as the renderer**,
under `desktop/` in the repository root:

```
desktop/
  host/          Rust — the native host: window, IPC gateway, native services
  renderer/      TypeScript — presentation, orchestration, typed IPC client
```

### Why Tauri v2 over Electron

1. **The IPC boundary is the product requirement.** §6 demands that the
   renderer never receive unrestricted native authority. Tauri v2's
   capability/permission model denies by default and requires each command to be
   granted explicitly to a window. Electron's equivalent is a hand-written
   `contextBridge` discipline that is correct only for as long as every future
   author keeps it correct. A boundary the framework enforces outranks a
   boundary a convention enforces.
2. **The native host is Rust.** Phase-00's confinement work — AppContainer,
   Job Objects, `HANDLE_LIST`, PSS enumeration — lives at the Win32 layer. A
   Rust host can call that layer directly when later phases attach the runtime;
   a Node main process would need a native addon to reach the same API.
3. **Surface area.** Tauri ships no bundled Chromium; it uses the system
   WebView2. The attack surface and the update surface both shrink, which
   matters for a product whose thesis is governed local execution.
4. **The owner's toolchain already has Rust** — `.cargo` and `.rustup` exist in
   the Windows home directory. This is a signal, not a measurement; `P01-B1`
   measures it.

### Why not Electron

Electron's advantages here are real and should be stated: a single language
across both tiers, a mature Windows packaging story, and the ability to run
`@polaris/runtime` in-process in the main process without a bridge. The third is
genuinely attractive later. It is outweighed by point 1 — an in-process runtime
in the same process as the window is the coupling Phase-01 exists to prevent —
and by point 2.

### Why not a web app or a PWA

§3 is explicit: desktop-first, local-first, with local computer control in later
phases. A browser tab cannot host that.

## Scope limits this ADR does **not** claim

- **The desktop host is not confined.** Phase-00 measures confinement of the
  *executor child process*, not of a shell. `windowsConfinement` is `false` for
  a `PolarisRuntime` mission and Phase-01 changes nothing about that. No Phase-01
  document or UI may imply the shell runs in AppContainer.
- **No macOS implementation.** §3. Tauri is cross-platform, which keeps macOS
  possible later; Phase-01 measures Windows only and claims Windows only.
- **No installer, no signing, no updater.** §5.

## Conditionality — the fork this ADR admits

This decision assumes a working Rust/MSVC/WebView2 toolchain on `DOSHI`. That is
**`NOT_TESTED`** at the time of writing and is measured by `P01-B1`
(`tools\p01-baseline\baseline.ps1` → `evidence\phase-01-baseline.json`).

- If `P01-B1` reports the toolchain present → this ADR is ACCEPTED in P01-W2
  and implementation proceeds.
- If `P01-B1` reports `cargo`, the MSVC build tools or WebView2 missing → this
  ADR is **held**, and the missing prerequisite is reported to the owner as a
  blocker with the exact install required. It is not worked around, and the
  stack is not silently switched to Electron to avoid the conversation.

## Consequences

- Two toolchains in the tree: npm/TypeScript (existing) and cargo/Rust (new).
  `P01-B1` records both.
- The renderer consumes `@polaris/contracts` for its generated types, so the
  IPC client and the native gateway validate against one source of truth.
- The Rust host needs its own view of the same schemas. It reads the schema
  files, exactly as ADR-002 anticipated: *"A future Rust core consumes the same
  schema files; nothing in this decision is TypeScript-specific."*
- Test execution grows a `cargo test` lane alongside `node --test`. §25 caps
  parallelism on the owner's machine; both lanes run bounded.

## Reversal

Before P01-W3 the reversal is deleting `desktop/`. After the native shell exists
the renderer tier survives a host swap largely intact, because it speaks
`IPCEnvelopeV1` over a thin transport adapter rather than a framework API — that
adapter is the single seam a host change would touch, and it is written to be
that seam deliberately.

## Acceptance record — P01-W2, 2026-09-10

### The conditional clause did not fire

`P01-B1` ran natively on `DOSHI` and is canonical:
`evidence\phase-01-baseline.json`, run `8a943f4e-2905-4786-bedb-4d2e8456719f`,
measured `2026-09-10T18:14:08Z`, `verdict PASS`, `required_missing 0`.

| Prerequisite this ADR names | Measured |
| --- | --- |
| `cargo` | `1.97.1` — PRESENT |
| MSVC build tools | `17.14.37531.7`, `VC.Tools.x86.x64`, VC tools `14.44.35207` — PRESENT |
| WebView2 runtime | `152.0.4191.66`, Evergreen Runtime — PRESENT |
| `rustc` (implied) | `1.97.1` — PRESENT |

`cargo-tauri` is absent. It is `OPTIONAL` in `P01-B1` and this ADR does not
require it; a missing optional probe never changes a verdict. The hold clause
therefore does not apply, and the stack is not silently switched to avoid a
conversation — there is no conversation to avoid.

### The stack decision still matches what will be built

Tauri v2 native host, React + TypeScript + Vite renderer, under
`D:\POLARIS\desktop\` with `host\` and `renderer\`. `PHASE-01-ARCHITECTURE.md`
§2 describes the same six layers, and P01-W2's contract surface is written to
that boundary: the renderer's only route downward is the typed IPC client into
the native gateway, and the registry records `RENDERER_TO_NATIVE_HOST` as the
one trust boundary for every operation (`P01-RG-008`).

### What P01-W2 deliberately did not do

**It did not create `desktop\`.** Not the tree, not a placeholder directory, not
an empty `Cargo.toml`. No contract fixture needed one, and a directory created
"to be ready" is P01-W3's work taken early. The reversal clause of this ADR —
"before P01-W3 the reversal is deleting `desktop/`" — is still trivially true,
because there is nothing to delete.

The consequence this ADR names — *"the Rust host needs its own view of the same
schemas; it reads the schema files, exactly as ADR-002 anticipated"* — is
confirmed as the chosen strategy. P01-W2 wrote **no** handwritten Rust structs
and no second semantic definition. The schemas stay authoritative and the Rust
side reads or generates from them, with a drift guard, in P01-W3.

### Acceptance — 2026-09-15

The rule stated in the status line is met, and nothing else was changed:
`evidence\phase-01-ipc.json` is `verdict = PASS`, `measured_verdict = PASS`,
`canonical = true`, `native = true`, measured `2026-09-15T19:37:13Z` on Windows
PowerShell 5.1.26100 (ten W2 groups PASS, byte gate 12/12 clean). The decision
text above is unchanged. A later packaging defect in the desktop build
(`P01_WINDOWS_RESOURCE_ICON_MISSING`, see `PHASE-01-FINAL-REPORT.md`) is not a
W2 condition and does not reopen this acceptance.
