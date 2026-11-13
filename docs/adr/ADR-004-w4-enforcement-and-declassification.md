# ADR-004 — W4: enforcement boundary, declassification ownership, and the Windows gap

- **Status:** Accepted
- **Date:** 2026-09-02
- **Phase:** 00 / W4
- **Supersedes:** nothing. **Extends:** ADR-001 (§3 only), ADR-003.

---

## §1 — The enforcement boundary is a separate process, and it is not AppContainer

### Context

W3 closed with one line drawn deliberately: *decision is implemented, enforcement
is not*. W4 has to cross that line for the filesystem. The obvious shortcut is:

```ts
if (decision.result === "ALLOW") fs.readFileSync(path);
```

That is not enforcement. It is a decision followed by an unguarded effect in the
same address space, with the same ambient authority, reading whatever string the
caller happened to hold.

The strongest boundary — AppContainer with zero capabilities plus a Job Object,
exactly as ADR-001 proved — requires executing Windows binaries. The session that
built W4 could not do that.

### Decision

The effect executes in a **separate process** that receives an `ExecutionGrant`
and nothing else. The grant carries a canonical **real** target path, the
canonical **real** allowed roots, a byte ceiling and a deadline. It carries no
invocation, no decision, no configuration and no policy, so the executor has
nothing to reinterpret in its own favour.

The launcher constructs the child with:

- exactly three explicit pipes and no other descriptor,
- an environment built key by key rather than inherited,
- `shell: false`, `detached: false`, `windowsHide: true`,
- a hard deadline with a kill.

The executor **re-proves containment itself** from the grant before touching
anything: it re-resolves the real path, compares it to what the grant states, and
re-checks the allowed roots. Two independent parties must agree before an effect
happens.

### What this is NOT

It is not AppContainer. It is not a Job Object. It applies no OS-level network
denial — the child blanks the ambient network globals, which is a real mitigation
and is reported as such in `host_diagnostics`, not as confinement.

`ExecutionHost.windowsConfinement` is a field, it is `false` for this adapter, it
travels into every `ToolResult`, and a test asserts it. The system says out loud
what it does not have.

### Consequences

- W4 has a real enforcement boundary with defence in depth, provable today.
- Windows capability confinement remains a W1 result and a deferred adapter.
  When that adapter lands it implements the same `ExecutionHost` port and sets
  `windowsConfinement: true`; nothing above it changes.

---

## §2 — Declassification is owned by a service; the agent may only ask

### Context

D1 and D2 turn a tainted value into a value usable for one effect. Whoever can
*issue* a declassification record can authorise anything. Whoever can *choose the
anchor* or *choose the extraction schema* can do the same thing one step removed:
an agent that supplies its own anchor has simply written itself a permit.

### Decision

Three separations, each enforced by a type or a module boundary rather than by
convention:

1. **Only the declassifier issues.** The ledger is private to
   `DeclassifierService`. The PDP receives a `DeclassificationReader` — find and
   list, no issue. No record travels inside a `CapabilityInvocationV1`, so no
   document arriving from the agent can carry a forged one.
2. **The agent never supplies the anchor or the schema.** Trust anchors and
   extraction schemas are registered by the composition root at mission start.
   The agent holds a `DeclassificationRequestPort` — two methods, both requests.
   `registerAnchors` is not reachable through that type.
3. **Declassification never permits.** It changes trust metadata. The PDP still
   decides, and it is the PDP that reads the ledger.

Purpose binding is material, not documentary: a record is keyed by
`(correlation_id, effect action, value)`, and anchors may declare
`purpose_actions`. A read anchor proves nothing for a write.

`MEMORY` and `MODEL_ASSERTION` are named in a forbidden-anchor list and rejected
by name, so the protection is testable rather than being the absence of a
`switch` case.

### Consequences

- A tainted value with no valid record is denied by the PDP with
  `TAINTED_INPUT`, not silently allowed and not silently dropped.
- Every declassification attempt — success and failure — is logged, which is what
  makes the corpus burden measurement real rather than estimated.

---

## §3 — Policy decides logical scope; the platform decides what a path *is*

### Context

W3 already refused to imitate Windows canonicalisation inside policy. W4 has to
actually open files, so someone must resolve reparse points, casing, reserved
device names and alternate data streams.

### Decision

Two stages that never merge:

1. **Syntactic, pure, platform-free.** Windows path rules reject every ambiguous
   shape by name — traversal, UNC, `\\?\`, ADS, reserved device names, trailing
   dot or space, 8.3 short names, wildcards, control characters. An ambiguous
   path is refused, never guessed.
2. **Real, filesystem-backed.** `realpath` resolves links on both the root and
   the target, and containment is decided on the resolved pair. A path that is
   logically inside but really outside is reported as `SYMLINK_ESCAPE` — a named
   outcome, not a swallowed difference.

Policy keeps its own conservative logical containment for the decision. The PEP
and the platform adapter own the final word before an effect.

### Consequences

- Junction and symlink escapes are caught by construction rather than by pattern
  matching.
- The authority reports `nativeWindowsSemantics`, and it is `false` off Windows.
  Every Windows-shaped claim carries that flag with it.

---

## §4 — The Windows gap is declared, not papered over

### Decision

Five claims are classified `REQUIRES_NATIVE_RUN` and are **not asserted** by W4:

1. Windows reparse-point (junction) escape detection
2. Windows case-insensitive folding against a real volume
3. Windows reserved device names and alternate data streams against a real volume
4. Windows HANDLE-table inheritance — the X03 regression on Windows
5. AppContainer zero-capability confinement and Job Object containment

`tools\w4-windows-conformance\run.ps1` is one runnable step that settles the
first four. The fifth stays with W1 and a future adapter.

**A harness that cannot start is not a result.** The first Windows attempt failed
at parameter binding — the runner derived its root inside a `param()` default
from `$PSScriptRoot` alone, and that variable is empty whenever the engine has no
script *file* context. Worse, in some hosts the binding error did not stop the
script, so it continued with an empty root and would have reported failures that
tested nothing.

That is classified `WINDOWS_RUNNER_BOOTSTRAP_DEFECT` and is explicitly **not** a
conformance result. Bootstrap therefore has its own contract: no computed
parameter defaults, an ordered and labelled candidate list, defensive reads of
every automatic variable, marker validation before acceptance, and a typed loud
failure that states no security claim was tested. Nothing about a security
expectation was changed to make the runner pass.

The equivalent POSIX proofs *were* run: symlink escape is detected for real, and
the X03 handle-hygiene regression runs with a **positive control** — a
deliberately leaked descriptor is detected first, so the launcher's clean result
means something.

### Consequences

W4 cannot be a full `PASS` while an acceptance criterion depends on a run that
did not happen. The verdict is `CONDITIONAL_PASS`, and the condition is one
script.

---

## §5 — A constructed environment on Windows requires naming what the runtime copies

### Context

The first native Windows run showed eight ambient variables inside a child that
was launched with an explicitly constructed environment. POLARIS had not added
them and Windows had not added them.

libuv's `make_program_env` (`src/win/process.c`) carries a `required_vars` list
and copies each of those names **from the parent process** whenever the name is
absent from the environment the caller supplied. Node's `spawn` therefore cannot
produce a strictly explicit environment on Windows through `options.env` alone.

The run was its own controlled experiment: the three names POLARIS did pass were
not copied; the eight it did not pass were.

### Decision

Scrubbing after arrival is not isolation — arrival is arrival. Instead, the
allowlist **declares every name the runtime would otherwise copy**, so no absent
name is left for it to fill:

- identity names (`USERNAME`, `USERDOMAIN`, `LOGONSERVER`) carry POLARIS values,
  never the user's;
- home- and temp-shaped names point at a POLARIS-owned path;
- `PATH` is minimal and deterministic — the executor is launched by absolute
  path and needs none of the user's;
- `SystemRoot`, `windir` and `SystemDrive` carry real system values, because the
  Windows loader needs them. That is a documented, enumerated exception, not
  inheritance.

Verification is **by value, not by name**: the executor receives the environment
contract in its grant and classifies every variable as
`EXPLICITLY_CONSTRUCTED`, `AMBIENTLY_OVERRIDDEN` or `AMBIENTLY_INHERITED`. Two
positive controls back it — a canary that must never arrive, and a canary placed
in a *declared* name that must arrive as the POLARIS value.

### Consequences

- The security goal is stated correctly: not "the child has no environment", but
  "no ambient value reaches it unless POLARIS declared it".
- Matching names can no longer be mistaken for construction.

---

## §6 — Windows confinement is proven of the W4 path, not borrowed from W1

### Context

W1 proved a mechanism. It is tempting to treat that as W4's answer. It is not:
a mechanism that works says nothing about whether *this* execution path uses it.

### Decision

`tools\w4-windows-adapter` launches the **real W4 executor** under ADR-001
semantics — zero-capability AppContainer, Job with `KILL_ON_JOB_CLOSE` and no
breakaway, suspended creation, explicit handle list, constructed environment,
job assignment before resume — reusing W1's P/Invoke layer rather than a weaker
copy of it.

Two consequences follow, and both are deliberate:

1. **Handle hygiene becomes an enforced precondition.** The adapter scans the
   suspended child's handle table and refuses to resume it if an out-of-scope
   file handle is present. Not a report after the fact — a gate before it.
2. **A probe that cannot show its own validity proves nothing.** W-11 returns
   `INCONCLUSIVE`, never `PASS`, unless the positive control first detects a
   deliberately leaked handle.

`BLOCKED` is a first-class outcome with its stage and Win32 error. It is not a
skip, not a pass, and the harness exits non-zero on it.

### Consequences

- W-11 and W-12 are implemented and guarded against silent weakening by static
  tests over the adapter source.
- They are **implemented, not observed**. W4 stays `CONDITIONAL_PASS` until a
  native run reports them.
