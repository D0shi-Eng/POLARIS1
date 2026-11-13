# ADR-017 — The Phase-01 desktop operation set

**Status:** ACCEPTED (2026-09-15) — proposed in P01-W1 on 2026-09-10; the
acceptance rule of this ADR (`evidence\phase-01-ipc.json` records
`P01-W2 = PASS`) is met by the canonical native run of 2026-09-15.
See *Acceptance record* at the end.
**Supersedes:** nothing. **Depends on:** ADR-002 (ACCEPTED).
**Touches:** `contracts/schemas/ipc-envelope.v1.schema.json`, `contracts/src/version.ts`.

## Context

`IPCEnvelopeV1` frames every trust-crossing message between the desktop surface
and the trusted native core. Its `Operation` member is a **closed enum** of six
values, and its own description states the intent: *"an arbitrary operation name
is unrepresentable, not merely rejected at runtime."*

Phase-01 builds the desktop shell. The shell must ask the native host for a
bootstrap snapshot, for runtime status, for capability availability and for the
resolved settings view. None of those is expressible today.

Phase-00 is frozen. The question is not whether to change the contract's
*design* — it is which of its existing mechanisms applies.

## Decision

**Extend the closed `Operation` enum additively and bump `IPCEnvelopeV1` to
`1.1`.** The enum stays closed. No shape, no required field, no version rule and
no validation path is altered.

The Phase-01 additions, all namespaced `desktop.`:

| Operation | Owning native service | Side effects |
| --- | --- | --- |
| `desktop.bootstrap` | Bootstrap Service | none — read only |
| `desktop.runtime.status` | Runtime Status Service | none |
| `desktop.capability.availability` | Capability Availability Service | none |
| `desktop.settings.describe` | Settings Facade | none |
| `desktop.settings.read` | Settings Facade | none |

Every Phase-01 operation is **read-only**, so none of them enters the
`idempotency_key` conditional, which stays exactly as W2 wrote it. A
side-effecting desktop operation would have to be added to that conditional in
the same change; Phase-01 adds none.

`SUPPORTED_VERSIONS.IPCEnvelopeV1` becomes `{ major: 1, minor: 1 }`.

## Why this is use of the contract, not a redesign of it

The repository already carries a written evolution rule, in `version.ts`:

> MINOR أعلى → رفض … MINOR أدنى → قبول. التوافق الخلفي داخل نفس MAJOR مضمون
> بالإضافة فقط.

and it has been exercised twice inside Phase-00 itself:

- `PolicyDecisionV1` 1.0 → 1.1, W3 reason codes,
- `AuditEventV1` 1.0 → 1.1, the W5 event vocabulary,

each annotated *"adding enum values is an additive change: 1.0 documents remain
valid under this build."* This ADR is the third application of the same rule,
by the same mechanism, with the same compatibility direction.

## Alternatives considered

- **Tunnel desktop calls through `capability.invoke`.** Rejected. It turns a
  governed capability path into a generic dispatcher for ungoverned desktop
  reads, which is precisely the "execute anything" endpoint the Phase-01 brief
  forbids, and it would put desktop shell traffic through the PDP and the audit
  ledger for no security benefit.
- **A parallel `DesktopIPCEnvelopeV1`.** Rejected. ADR-002 exists to stop one
  boundary acquiring two definitions that drift. The envelope's own description
  already names this boundary as the one it frames.
- **Open the enum to a pattern-matched string.** Rejected outright. It converts
  an unrepresentable operation into a merely-rejected one and destroys the
  property the enum was written for.
- **Defer and hard-code a bootstrap channel outside the envelope.** Rejected —
  an undocumented IPC message type, forbidden by §7.

## Consequences

- A 1.0 receiver rejects a 1.1 document with `UNSUPPORTED_VERSION`. That is the
  accepted, already-specified semantics, not a new hazard.
- The generated TypeScript types regenerate; the drift test guards the result.
  Any hand edit to a generated file still fails the build.
- The contracts suite gains negative cases: an unknown `desktop.*` operation
  must still be rejected at the schema, and the Phase-01 native gateway must
  reject a known-but-unrouted operation independently — schema validity is not
  authorisation.
- Phase-00's own contract verification re-runs unchanged and must stay clean.
  If it does not, that is a Phase-00 regression under §1 and stops promotion.

## Reversal

Delete the five enum members and restore `minor: 0`. Nothing else in Phase-00
depends on them, because nothing in Phase-00 emits them.

## Acceptance record — P01-W2, 2026-09-10

Implemented exactly as decided, and verified against the implementation rather
than asserted alongside it. Each row names the test that proves it; all are
green in `evidence\phase-01-contract-tests.adhoc.json` (bridge measurement,
10 / 10 groups, 261 / 261 tests).

| This ADR requires | Proven by |
| --- | --- |
| `IPCEnvelopeV1` 1.0 → 1.1 | `P01-CV-002` |
| exactly the five named operations, and no sixth | `P01-IPC-002`, `P01-IPC-003` |
| the enum stays closed — no pattern, no wildcard | `P01-X-A`, `P01-X-B` |
| an unknown or arbitrary operation stays invalid | `P01-CV-005`, `P01-CV-006` |
| no generic dispatcher, and no service owning everything | `P01-X-B`, `P01-RG-007` |
| no `capability.invoke` tunnelling | `P01-RG-012` |
| no second envelope contract | `P01-X-N` |
| no side-effecting desktop operation | `P01-RG-006`, `P01-X-D` |
| 1.0 documents still accepted by the 1.1 validator | `P01-CV-001`, `P01-X-J` |
| a higher unsupported minor still rejected | `P01-CV-007`, `P01-X-K` |
| the `idempotency_key` conditional untouched | `P01-IPC-006` |
| Phase-00's own contract verification still clean | `P01-R0` — 128 / 128 |

### One addition this ADR did not foresee

The version gate accepts a **lower** minor, which is correct for backward
compatibility — and which would therefore also accept a document declaring
`1.0` while carrying `desktop.bootstrap`. The declared version would be a lie
the validator tolerates, and a real 1.0 receiver could not diagnose why it did
not understand the message.

P01-W2 closes that with a semantic rule: an operation introduced at 1.1 may not
travel in a document declaring a lower minor of the same major
(`contracts/src/semantics.ts`, proven by `P01-CV-010`). It **narrows** the
contract and cannot invalidate any document that was valid at 1.0, because no
1.0 document could name these operations. It is an addition to this decision,
recorded here rather than left implicit in code.

### Acceptance — 2026-09-15

The rule stated in the status line is met, and nothing else was changed:
`evidence\phase-01-ipc.json` is `verdict = PASS`, `measured_verdict = PASS`,
`canonical = true`, `native = true`, measured `2026-09-15T19:37:13Z` on Windows
PowerShell 5.1.26100 (ten W2 groups PASS, byte gate 12/12 clean). The decision
text above is unchanged. A later packaging defect in the desktop build
(`P01_WINDOWS_RESOURCE_ICON_MISSING`, see `PHASE-01-FINAL-REPORT.md`) is not a
W2 condition and does not reopen this acceptance.
