# ADR-025 — Phase-05: memory that is not truth, and web and desktop actions that pass one gateway

- Status: ACCEPTED
- Phase: PHASE-05
- Supersedes: nothing
- Superseded by: nothing

## Context

Phase-05 gives POLARIS three abilities it did not have: it remembers across
missions, it reads and acts on web pages, and it observes and acts on a Windows
desktop window. Each one widens what a model's output can reach. Four properties
had to be fixed before code, because none of them can be retrofitted:

1. What memory is allowed to be — and, above all, what it is not.
2. Where a web or desktop action may originate.
3. What content from a page or a screen is allowed to become.
4. Which window, if any, an agent may touch.

## Decision

### 1. Memory is data with provenance, never an authority

- Five types (WORKING, EPISODIC, SEMANTIC, PREFERENCE, PROJECT) and four scopes
  (MISSION, PROJECT, USER, SYSTEM), each a closed vocabulary.
- The verification vocabulary is `UNVERIFIED | EVIDENCE_LINKED | CONFLICTED`.
  There is no VERIFIED memory, in code, in the SQLite CHECK constraint, or in
  the contract. A claim is verified only by measured evidence in the Phase-03
  truth layer; the same value held in memory leaves it unverified.
- Every write is a `MemoryCandidateV1` that passes one pipeline: validation
  (bounds, secrets, raw reasoning, page dumps, scope rules), deduplication,
  lineage coalescing, conflict detection, then one transaction. A rejected
  candidate leaves a decision record and no content.
- An agent proposal is a tool call (`polaris.memory.propose`, effect
  DATABASE_WRITE) and therefore waits for a human decision; it is stored as
  MODEL_GENERATED, UNVERIFIED, whatever it claims.
- Memory reaches a model only inside the fenced block
  `MEMORY — UNTRUSTED / NON-AUTHORITATIVE`, bounded by a token budget.
- Deletion is real: content, subject, summary and sources are erased
  (`secure_delete`), and the schema itself refuses a DELETED row with content.

### 2. One gateway for web and desktop actions

Web and desktop tools are Phase-04 tools. They register in the Phase-04 registry,
are named by Phase-05 skills, and run only through `ToolGateway`. Phase-05 adds
one step to the gateway — step 5b, the policy assessment — which may *widen* a
call's effects (a form submission becomes EXTERNAL_SIDE_EFFECT; a destructive
control needs approval) and never narrow them. Capability, budget and approval
are then decided on the widened set. No IPC operation navigates, clicks, types,
executes, or raises memory trust; the renderer can list, inspect, delete a
memory, grant or revoke a window, and stop a session.

### 3. Page and screen content is untrusted data

A page observation is WEB_UNTRUSTED and a screen observation is
UNTRUSTED_CONTENT. Both are bounded, persisted as digests, and reach the next
agent only inside the fenced `OBSERVATION — WEB_UNTRUSTED / SCREEN_CONTENT`
block. Hidden page text is dropped. Instruction-shaped text is counted and
labelled, never obeyed. An executed action is recorded as ACTION_EXECUTED; only
a value actually observed afterwards can verify a claim about its outcome.

### 4. The user grants one window to one mission

The agent sees only windows the user granted to its mission through the UI. A
grant binds handle, process id, process start time and executable, so a reused
process id is a different window. POLARIS's own windows, security prompts and
credential dialogs cannot be granted. Every action is bound to the digest of the
observation it was planned on and is refused if the window changed. A grant ends
with its mission.

### 5. The browser is POLARIS's own HTTP/HTML engine

For this phase the browser is a bounded HTTP/HTML engine over the Phase-02 HTTP
client: no JavaScript, no subresources, no cookies. Every hop is checked against
the navigation policy, DNS answers are checked at connect time, and redirects are
re-checked and bounded. This is a deliberate reduction of attack surface; pages
that need scripts are outside what it can read, and the phase says so.

## Consequences

- IPCEnvelopeV1 moves 1.4 → 1.5 additively: twelve operations, a lower minor is
  still accepted, no major version.
- `unsafe` gains one named file, `desktop/host/app/src/desktop_win32.rs`
  (Win32 FFI), added by name to the Phase-02 confinement list; core still
  `forbid(unsafe_code)`.
- The SQLite schema moves to v4 (memory, browser and computer tables, the
  approval context column).
- Out of scope and not claimed: connectors, mail, cloud sync, a browser
  extension, JavaScript pages, macOS, distributed memory, arbitrary Windows
  administration.
