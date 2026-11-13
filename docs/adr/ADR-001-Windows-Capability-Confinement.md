# ADR-001 — Windows Capability Confinement

**Status:** ACCEPTED — CONDITIONAL, on evidence from the W1 spike
**Phase:** 00 / W1
**Date opened:** 2026-09-01
**Date decided:** 2026-09-01
**Verdict:** `PASS_PARTIAL`
**Evidence:** `evidence/w1-results.json` (212 rows), `docs/phases/PHASE-00/W1-RESULTS.md`, `docs/phases/PHASE-00/W1-FINAL-REPORT.md`
**Run environment:** Windows 11 build 26200.9168 (25H2), AMD64, elevated

---

## Context

POLARIS runs agent-initiated code on the user's own machine. Every tool call the agent
makes may launch a child process that reads files, spawns further processes, and opens
network connections. The Trust Plane of the product depends on one assumption:

> when POLARIS says a process is confined to a scope, the operating system actually
> enforces that scope.

If that assumption is false, every downstream guarantee — permissions, auditability,
provenance, capability tokens — is decoration over an unenforced boundary. Nothing above
this layer can be stronger than what Windows itself will enforce.

Windows 11 offers several confinement primitives with very different strength profiles,
and public documentation describes their intent rather than their measured behaviour under
adversarial use. The gap between "documented intent" and "observed enforcement" is exactly
where a false Trust Plane would be built.

This ADR is therefore blocked until a spike produces evidence from an actual execution run.

## Decision Question

**How does POLARIS actually enforce file, network, and process effects on the processes
that the agent launches on Windows 11?**

Sub-questions that must be answered with evidence, not with documentation:

1. Can a launched child be confined to an explicit filesystem scope, and does that scope
   survive traversal, junction, symlink, case, extended-path and NT-namespace tricks?
2. Does the process tree stay inside the boundary across child and grandchild generations,
   and does the boundary collapse cleanly with zero survivors?
3. Can egress be denied by default, and can specific destinations be allowed while others
   are denied?
4. Which of the above are enforced by the OS, which are best effort, and which are unknown?

## Candidate A — AppContainer + Job Objects

AppContainer gives the process a token whose security identifier holds no access to
anything by default; access exists only where an ACE explicitly grants the container SID.
Network access is expressed as capabilities (`internetClient`, `privateNetworkClientServer`)
enforced by the Windows Filtering Platform. Job Objects bound the process tree, forbid
breakaway, cap active process count, memory and CPU, and terminate everything when the job
handle closes.

Attractions: no reboot, no optional feature, no Administrator required to create a profile,
process start cost close to an ordinary `CreateProcess`, suitable for frequent tool calls.

Suspected weaknesses to be tested, not assumed:

- `ALL APPLICATION PACKAGES` ACEs on system directories may grant broad read access that
  the confinement scope never intended.
- Capabilities describe a network *category*, not a *destination*, so a hostname or IP
  allowlist may be inexpressible at this layer.
- Handles opened by the launcher before the drop may remain usable after inheritance.
- DNS resolution goes through a service over ALPC rather than a socket, so name resolution
  may succeed while sockets are denied — which would make a naive network test pass for the
  wrong reason.

## Candidate B — Windows Sandbox

A disposable Hyper-V based VM with a separate OS instance, explicit folder mapping and an
option to disable networking entirely. Isolation strength is far above Candidate A.

Concerns to be measured: startup cost, file mapping semantics, whether state can persist at
all, and whether the cost model can survive frequent agent tool calls or is viable only for
a high-risk execution lane. Enabling the feature is a permanent system change requiring a
reboot, which this spike will not perform.

## Candidate C — Strong isolation fallback

If A proves partial and B proves too costly for routine use, POLARIS needs a documented
fallback: a dedicated VM or an isolated runtime for high-risk execution, plus a
POLARIS-owned enforcement component for whatever the OS cannot express. The most likely
such component is a **Network Broker / Egress Policy Enforcement Point**, because
destination-level control appears to be outside AppContainer's vocabulary. This candidate
is recorded here so that a partial result does not silently become a claim of full
confinement.

## Test Criteria

The spike must produce, from a real run:

- **Filesystem:** allow inside the granted scope; deny outside it; deny under traversal,
  junction, symlink, UNC, case-normalisation, extended-path and NT-namespace variants.
- **Process:** children and grandchildren remain inside the boundary; breakaway refused;
  zero survivors after teardown; an unrelated process cannot be opened for termination;
  process, memory and CPU limits observable.
- **Network:** default deny provable; loopback behaviour documented exactly; a wanted
  destination distinguishable from an unwanted one, or an explicit statement that it is not.
- **Attribution:** every denial must be reproduced against an uncontained control run. A
  denial that also occurs without confinement is not evidence of confinement.

Verdict vocabulary is fixed in advance: `PASS_STRONG`, `PASS_PARTIAL`, `FAIL`. A partial
result must name what is enforced, what is best effort, and what needs an additional
component.

## Known Unknowns — resolved and remaining

**Resolved by the run:**

- Windows 11 build 26200.9168 (25H2). AppContainer, Job Objects, LPAC attributes and
  `CheckNetIsolation` are all present and functional on this build.
- A .NET Framework process **does not start** inside a Less Privileged AppContainer here: it
  exits immediately with `0x80131702` and produces no output.
- Handle discipline is **ours, not the OS's**. `X03` read a denied file through an inherited
  handle while `F03` in the same process was denied. AppContainer does not revoke
  pre-existing handles.
- Loopback can be exempted with `CheckNetIsolation` and the exemption can be removed cleanly,
  but it requires Administrator.
- Windows Sandbox is **not enabled** on the target machine, so Candidate B is unevaluated.
- The machine had working outbound connectivity: the uncontained control reached every
  destination, so every network denial recorded is attributable.

**Still unknown:**

- Whether LPAC closes the `ALL APPLICATION PACKAGES` system-read hole. Requires a native,
  non-managed adversarial child.
- Every property of Windows Sandbox: startup cost, isolation strength, mapping semantics,
  network default, integration complexity, and whether it is viable for frequent tool calls
  or only for a high-risk lane.
- Behaviour of non-file, non-socket channels — named pipes, ALPC, shared sections, clipboard,
  window messages. Out of W1 scope and not claimed to be blocked.
- Container lifecycle under crash, reuse, and many concurrent containers.

## Final Decision

**ADOPT Candidate A — AppContainer + Job Objects — for the Tier-0 routine execution lane,
conditionally.**

What the operating system proved it enforces:

- filesystem scoping that survives `..`, junctions, directory symlinks, case changes, `\?\`,
  `\?\GLOBALROOT\??\` and UNC, with listing and traversal rights separable
- process-tree containment across three generations, breakaway refused, zero survivors on
  teardown, no reach into unrelated processes, and enforceable process-count, memory and CPU
  limits
- default-deny egress including DNS, reported unambiguously as `WSAEACCES` on TCP

What it proved it does **not** enforce:

- **destination, port or protocol control over egress.** With `internetClient` granted, the
  endpoint we wanted to allow and the endpoint we wanted to deny behaved identically. The
  capability is a single switch over the entire internet.
- protection of world-readable system files, which `ALL APPLICATION PACKAGES` grants
- anything about handles the launcher opened before the drop

### Binding conditions

This decision is void if any of these is not met:

1. **A POLARIS-owned Network Broker / Egress Policy Enforcement Point is mandatory.** No
   confined container is granted `internetClient`. All egress terminates at the broker.
   Until it exists, POLARIS may state "no network" but may never state "may reach only X".
2. **Launcher hygiene is an invariant**: no out-of-scope handle open during a confined
   launch, an explicit `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`, and a purpose-built environment
   block rather than an inherited one. `X03` becomes a permanent regression test.
3. **The system-read exposure is accepted in writing or removed via LPAC.** It is not to be
   treated as absent.
4. **The AppContainer private temp is declared as part of the task scope**, or `TEMP` is
   redirected into the granted directory.
5. `KILL_ON_JOB_CLOSE` always set; `BREAKAWAY_OK` never set; ACL grants applied per task and
   reverted on completion.

### Candidate B

**Deferred, unevaluated.** No claim about Windows Sandbox may be made from this ADR. A
high-risk execution lane remains an open design question.

### Candidate C

**Retained and partly activated.** The Egress PEP moved from contingency to confirmed
requirement. A VM-based high-risk lane stays on the table pending a Candidate B evaluation.

### Language discipline

On this evidence POLARIS may say "confined to this filesystem scope", "cannot escape the
process tree" and "no network". It may not say "sandboxed", and it may not describe egress as
policy-controlled, until the Egress PEP exists and is itself tested.

**W2 Gate: ALLOWED**, subject to the five binding conditions above.
