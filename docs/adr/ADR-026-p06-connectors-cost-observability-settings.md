# ADR-026 — Phase-06: connectors behind two gateways, honest cost, observable operation, one settings control plane

- Status: ACCEPTED
- Phase: PHASE-06
- Supersedes: nothing
- Superseded by: nothing

## Context

Phase-06 lets agents reach services outside POLARIS through connectors, and
makes the product operable: what was used and what it cost, whether each part
is healthy, what happened, and how every behaviour is configured. Each of these
can mislead or leak if it is designed loosely:

1. A connector call is an external side effect reachable from model output.
2. A credential must work for the call and be invisible everywhere else.
3. A retry of a write can create a second effect.
4. A cost can be invented, mixed with an estimate, or converted silently.
5. Health from a previous start can be shown as present.
6. A project or mission setting can widen what security allows.

These properties were fixed before code.

## Decision

### 1. Connectors are tools, and every call passes two gateways

- A connector registers typed operations: a fixed method, a fixed path template
  on a fixed base address, and typed arguments. An agent chooses among them; it
  never names a URL, a path or a header.
- Each operation is a Phase-04 tool `connector:<id>:<operation>` under the
  dynamic skill `polaris.skill.connector-operator`, so the Phase-04 tool gateway
  applies its full order (registry, skill binding, arguments, Phase-06 policy
  overlay, adapter assessment, effects, capability, budget, approval).
- Beneath it, the connector gateway enforces what is connector-specific:
  enabled, argument validation, privacy and egress, side-effect policy,
  credential presence, the per-mission external-call limit, idempotency, budget
  reservation, the local rate limit, bounded retries, and normalisation into a
  bounded, labelled summary of untrusted data.
- Every action other than READ is an EXTERNAL_SIDE_EFFECT and waits for a bound
  approval with a host-written summary (action, target, risk, arguments).
- No IPC operation runs a connector operation. The renderer registers,
  configures, tests health, starts the host's own credential prompt, imports an
  OpenAPI document as a proposal, and approves operations.
- A connector is registered disabled; enabling is a separate decision.
- Connector egress is the reviewed network policy `CONNECTOR_EGRESS_POLICY`;
  private, link-local and metadata destinations are refused at registration and
  at connect time; redirects are never followed.

### 2. Secrets are referenced, never carried

A credential lives in the Windows credential store, referenced as
`secret://connectors/<id>/default`, or in an environment variable whose name
starts with `POLARIS_CONNECTOR_` when security settings allow it. It is resolved
inside the gateway for one request and dropped. The contract has no value field;
the renderer and settings show only configured, source, reference and last
update. OAUTH2 is part of the vocabulary and refused: this build has no official
OAuth 2 flow, and scraping a user's subscription is not an option.

### 3. Exactly once, or honestly unknown

- A side effect carries an idempotency key: the agent's explicit key or one
  derived from mission, task, connector, operation and payload. The same key and
  payload replays the stored result without contacting the service; a different
  payload conflicts. The key the ledger uses is the key the service receives.
- An operation is retry-safe only if it is a read or declares header
  idempotency. A 5xx or a timeout after send on an unprotected write is never
  retried: the call ends OUTCOME_UNKNOWN, and a call in flight at a restart is
  recovered as OUTCOME_UNKNOWN and never replayed.
- 429 and Retry-After are honoured only within a configured bound; backoff is
  bounded; cancellation stops the call and its retries.
- An HTTP success is not a verified outcome. A returned resource identifier can
  verify a claim; what the service did not show stays unverified.

### 4. Cost carries its provenance, and no price is invented

- Every token count and cost is PROVIDER_REPORTED, LOCALLY_MEASURED, ESTIMATED
  or UNKNOWN. UNKNOWN has no amount; ESTIMATED names its pricing source.
- POLARIS ships no price. A price exists only when the user enters it with its
  source; costs computed from it are estimates.
- Totals are kept apart by currency and provenance; no currency is converted and
  an estimate is never summed into a report. A connector's self-reported cost is
  validated and a fake one (negative, absurd) is refused.
- Budgets per mission, project, UTC day, provider and connector, over cost,
  model tokens or external calls, SOFT (warn and permit) or HARD (refuse before
  the call; a hard cost budget also refuses a call it cannot price).
- Every model call passes an invocation guard installed in the Phase-02
  invocation service: locality, input limit and budget before the call, usage
  after it.

### 5. Four records, kept apart

The audit ledger (who did what), structured events (codes, components and
timings only; labelled diagnostic, not audit), bounded metrics since this start,
and mission evidence are separate stores with separate purposes. Health is
Unknown until measured in this session. Alerts are local. The diagnostics export
is local, bounded, redacted and its detail follows a privacy setting. No
telemetry leaves the device.

### 6. One settings control plane

- A catalogue of typed settings in nineteen sections; each names the host
  component that reads it.
- Effective value = defaults, then user, project, mission; the security layer
  applies last and cannot raise the build ceiling. A project or mission value
  that would widen a security-bearing setting is refused on write and ignored on
  read, and every value names its source.
- Persistence is versioned; a newer config schema fails closed to defaults and
  refuses writes.
- The Phase-01 settings contract stays frozen; the control plane uses its own
  `config.*` operations, and the frozen host view remains at `/settings/host`.

### 7. Additive integration with closed phases

Phase-06 adds extension points without changing behaviour when they are absent:
an invocation guard (Phase-02), a mission lookup for an invocation (Phase-03), a
tool policy overlay and an activity observer (Phase-04), dynamic tool sync and
mission approval expiry (Phase-04). Envelope `IPCEnvelopeV1` moves 1.5 → 1.6
additively (28 operations). The store moves to schema 5.

## Consequences

- Connectors are measured against a deterministic loopback TEST FIXTURE; no real
  external service or credential is a condition of closing the phase.
- Connector memory is WORKING memory tagged UNTRUSTED_CONTENT with trust class
  MODEL_GENERATED, because the Phase-05 V4 vocabulary has no EXTERNAL trust class.
- Webhooks and polling are declared false in this build.
- This is usage accounting, not billing.
