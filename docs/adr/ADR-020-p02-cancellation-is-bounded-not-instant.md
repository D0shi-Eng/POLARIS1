# ADR-020 — Provider cancellation is bounded by a read slice, not by socket shutdown

Status: ACCEPTED (Phase-02)
Date: 2026-09-17
Supersedes: nothing. Amends the cancellation mechanism introduced with the provider transport in ADR-019.

## Context

`CancelToken` (desktop/host/providers/src/net/cancel.rs) was written on the premise stated in
its own header comment: cancellation is real because `cancel()` closes every registered socket
from another thread, so a pending read returns at once. The flag alone was judged insufficient,
"because a pending read on a socket does not look at a flag".

That premise is POSIX semantics. It was never measured on Windows, which is the platform
POLARIS targets first, because the provider group had never completed a native canonical run.

## Problem

The first native canonical Phase-02 run (2026-09-17) executed `P02-PROVIDERS` for the first
time. `net::cancel::tests::cancel_unblocks_a_pending_read` failed: 52 of 53 tests passed.

The failure was then re-measured three consecutive times natively
(evidence/p02-native/cancel-confirm.local.log):

- attempt 1: FAILED, finished in 3.00s
- attempt 2: FAILED, finished in 3.00s
- attempt 3: FAILED, finished in 3.00s

Three identical 3.00s runs against a fixture whose server thread sleeps exactly 3s means the
read was never interrupted; it returned only when the peer closed. The sibling test
`registering_after_cancel_closes_immediately` passed every time.

Measured conclusion: on Windows, `shutdown()` on a duplicated socket handle does not wake a
`recv` that is already blocked on another handle to the same socket. It does affect reads
issued afterwards, which is why the sibling test passes. This is a platform difference, not a
flake and not a test defect.

Production impact, by inspection of the read paths:

- Response body and head reads go through `GuardedConnection`, which sets a 250ms
  `READ_SLICE` per read and re-checks the cancel flag between slices. These were already
  bounded on every platform and never depended on shutdown.
- The TLS handshake in `establish()` did not. It ran over the raw `TcpStream` with the read
  timeout set to the whole remaining deadline. A request cancelled during the handshake was
  therefore not observed until the deadline expired on Windows.

So the defect is real and narrow: cancellation was unbounded during the TLS handshake on the
primary target platform.

## Options

1. Make `cancel()` truly interrupt a blocked read on Windows, via `CancelIoEx` on the socket
   handle. Keeps the original test's assertion intact.
   Trade-off: requires `unsafe` and a raw handle stored outside its owner's lifetime.
   `CancelIoEx` cancels I/O issued on the handle passed to it, and the blocked read belongs to
   a different handle than the registered duplicate, so the mechanism is not established to
   work here; adopting it would mean shipping `unsafe` on an unproven premise.

2. Stop depending on platform shutdown semantics: never issue a read without a ceiling. Apply
   the slice-and-check discipline already proven in `GuardedConnection` to the whole connection
   lifetime, including the TLS handshake.
   Trade-off: the guarantee becomes "cancellation is observed within one slice" rather than
   "immediately". The guarantee must be stated instead of implied, and the test that asserted
   the POSIX wake-up must be corrected to assert the guarantee the system actually makes.

3. Leave it and declare the provider lane BLOCKED on Windows. Rejected: the defect is fixable
   and the phase cannot close around an unmeasured cancellation claim.

## Decision

Option 2.

`SlicedStream` (net/sliced.rs) wraps the TCP socket and bounds every read by `READ_SLICE`,
checking the cancel flag and the absolute deadline between slices. `Connection` is built on it,
so the TLS handshake, the head read and the body read all inherit the same ceiling on every
platform. `CancelToken::cancel()` keeps its `shutdown` call as a best-effort accelerator — it
does wake POSIX readers immediately, and on Windows it makes subsequent reads fail — but no
correctness claim rests on it any more.

Writes are deliberately NOT sliced. A blocking send that times out mid-write reports an
indeterminate number of bytes written, and retrying it would corrupt the request. Writes keep
the full-deadline timeout. This is a known, accepted residual: cancellation during a blocked
write is bounded by the deadline, not by a slice. It requires a full TCP send buffer to occur,
which the small request bodies here do not produce.

## Consequences

- The cancellation guarantee is now explicit and platform-independent: **a cancelled request
  stops issuing I/O within one `READ_SLICE` (250ms) of `cancel()`, on Windows and on POSIX.**
  It is not instantaneous, and no claim of "immediate" cancellation may be made.
- `cancel_unblocks_a_pending_read` measured a POSIX-only side effect on a raw socket with no
  read timeout — a configuration production never uses. It is replaced by
  `cancel_is_observed_within_a_slice`, which measures the guarantee above through
  `SlicedStream`, and by `registering_after_cancel_closes_immediately`, kept unchanged.
  This is a correction of what is asserted, not a relaxation of the bar: the new test fails if
  cancellation is not honoured, on either platform.
- The unmeasured-claim rule stands: had the slice discipline not existed, this would have been
  a BLOCKED lane, not a rewritten test.
