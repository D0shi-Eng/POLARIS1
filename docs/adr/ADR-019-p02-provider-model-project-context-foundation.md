# ADR-019 — Phase-02 Provider / Model / Project / Context foundation

Status: ACCEPTED (Phase-02 build decision; closed by the Phase-02 final gate)
Date: 2026-09-17
Supersedes: nothing. Extends ADR-017 (desktop operation set) and ADR-018 (host stack).

## Context

Phase-01 closed with a native desktop host that routes five read-only
`desktop.*` operations through one envelope (`IPCEnvelopeV1` 1.1), one Tauri
command (`polaris_ipc`), and one gateway. Phase-02 must add real providers,
models, projects and context without a second envelope, a generic dispatcher,
or any weakening of the Phase-00/Phase-01 invariants.

## Decisions

### D1 — `IPCEnvelopeV1` 1.1 → 1.2, additively

Nineteen operations are added to the closed `Operation` enum. Each is bound to
exactly one request payload by an `if/then` rule, as the desktop set already is.
1.0 and 1.1 documents stay valid. A 1.2 operation may not travel in a document
that declares a lower minor; the rule is enforced from the registry record
(`envelope_version`), not from a name prefix.

| Operation | Owner | Effect | Effect class |
| --- | --- | --- | --- |
| `provider.list` | ProviderRegistryService | READ_ONLY | READ |
| `provider.configure` | ProviderConfigService | SIDE_EFFECTING | WRITE_CONFIG |
| `provider.credential.set` | SecretBrokerService | SIDE_EFFECTING | SECRET_WRITE |
| `provider.credential.clear` | SecretBrokerService | SIDE_EFFECTING | SECRET_WRITE |
| `provider.refresh` | ModelDiscoveryService | SIDE_EFFECTING | NETWORK_PROBE |
| `model.list` | ModelRegistryService | READ_ONLY | READ |
| `model.configure` | ModelRegistryService | SIDE_EFFECTING | WRITE_CONFIG |
| `model.preferences.set` | ModelSelectionService | SIDE_EFFECTING | WRITE_CONFIG |
| `model.invoke` | ModelInvocationService | SIDE_EFFECTING | MODEL_INVOCATION |
| `model.cancel` | ModelInvocationService | SIDE_EFFECTING | CONTROL |
| `project.list` | ProjectService | READ_ONLY | READ |
| `project.get` | ProjectService | READ_ONLY | READ |
| `project.create` | ProjectService | SIDE_EFFECTING | CREATE_LOCAL_DATA |
| `project.update` | ProjectService | SIDE_EFFECTING | WRITE_LOCAL_DATA |
| `project.archive` | ProjectService | SIDE_EFFECTING | WRITE_LOCAL_DATA |
| `context.add` | ContextSourceService | SIDE_EFFECTING | CREATE_LOCAL_DATA |
| `context.remove` | ContextSourceService | SIDE_EFFECTING | WRITE_LOCAL_DATA |
| `context.preview` | ContextPreviewService | READ_ONLY | READ_RESOURCE |
| `context.assemble` | ContextAssemblyService | READ_ONLY | READ_RESOURCE |

There is no `provider.call`, `model.call` or `project.execute`. Every
side-effecting operation requires `idempotency_key`; the gateway replays a
repeated key and refuses the same key with a different payload.

The Phase-01 registry file is not edited. Phase-02 records live in
`contracts/registry/phase-02-ipc.registry.json`, validated by the same registry
schema, which gains `PHASE-02`, the Phase-02 owners and a mandatory
`effect_class` for Phase-02 records.

### D2 — Phase-01 version-pinned assertions are rebased, not removed

Five Phase-01 assertions pin the build to exactly 1.1 or to exactly eleven
operations (P01-CV-002, P01-CV-007, P01-IPC-002, GEN-004, the host unit test
`the_host_protocol_version_is_one_one`, the host gateway assertion on
`ipc_protocol_version`, and the W2 runner reason code `ENVELOPE_NOT_AT_1_1`).
They describe the Phase-01 build state and would fail on any additive change.
Each is rebased to the claim it protects:

* 1.1 documents remain valid and 1.1 operations remain exactly the Phase-01 set;
* a higher minor than the build supports is refused (computed from the build);
* the Phase-01 eleven are the ordered prefix of the enum, and every later
  member is declared by a later-phase registry record.

No security expectation is weakened: the set stays closed, a higher minor still
fails closed, and the lower-minor rule is now enforced for every phase.

### D3 — Provider adapters live in their own crate

`desktop/host/providers` (`polaris-host-providers`) owns provider domain types,
the loopback/remote endpoint policy, the HTTP/1.1 client, the adapters, error
normalisation and the secret value type. `polaris-host-core` depends on it and
never implements provider-specific behaviour or names a model. The Phase-01
fact `no_model_name_is_hard_coded` keeps its scope (core + renderer), with the
single token refinement in D11; Phase-02 adds its own scan over the providers
crate for model names.

### D4 — HTTP: a small HTTP/1.1 client over `std::net`, TLS from the OS

No HTTP SDK. The client speaks HTTP/1.1 with `Connection: close`, never follows
a redirect, caps every body, and registers its socket with a cancellation token
so that `model.cancel` shuts the socket down — cancellation actually aborts the
request. Response heads are parsed with `httparse`. TLS is `native-tls`
(SChannel on Windows — the operating system's certificate store and TLS stack;
no cryptography is implemented here).

### D5 — Network classes

* `LOOPBACK_PROVIDER_ACCESS`: local providers; the host connects only to the
  literal addresses 127.0.0.1 or ::1 (`localhost` is mapped, never resolved).
  No LAN address, no port scan, no discovery beyond the configured endpoint.
* `REMOTE_EGRESS`: remote providers; `https` only, host fixed by the provider
  descriptor (not configurable), and every resolved address must be public.
  Remote invocation passes an egress decision (locality preference + project
  context policy) before any byte is sent.

### D6 — Secrets

Secrets are entered only in a native Windows credential prompt owned by the
host (`CredUIPromptForWindowsCredentialsW`) and stored in Windows Credential
Manager (`CredWriteW`) under `POLARIS/provider/<provider_id>`. The official
environment variable of a provider (`OPENAI_API_KEY`, …) is the second source.
No payload field can carry a secret; the renderer only learns
`configured` and the source kind. The FFI lives in the app crate
(`app/src/credentials.rs`, compiled on Windows only), the only place in the
host allowed `unsafe`. Every buffer that held the key is zeroed before it is
released.

### D7 — One SQLite database

`rusqlite` (bundled SQLite) at `<app local data>/polaris.db`, overridable by
`POLARIS_DATA_DIR`. Versioned with `PRAGMA user_version`; a newer schema fails
closed; an existing database is copied before a migration.

### D8 — Asynchronous transport command

`polaris_ipc` becomes `#[tauri::command(async)]` and runs the gateway on a
blocking worker, so a model call cannot freeze the window and `model.cancel`
can arrive while `model.invoke` is in flight. It is still the only product
command. The Phase-01 fact that counts product commands is widened to
recognise the async attribute — the previous pattern would have missed an
async command entirely, which is a detection gap, not a stricter rule.

### D9 — Provider outcomes are results, not boundary errors

The nine boundary categories are unchanged. A provider timeout, auth failure or
routing denial is a typed field in the operation result (`status`,
`error.code`), so the error mapping stays closed and nothing provider-specific
crosses as an IPC error.

### D10 — Context is data

Project files enter a model request only as delimited `UNTRUSTED_CONTENT`
items inside a user-role message. They cannot select a model, change routing,
touch credentials or settings, or add sources. Routing is decided before
context is read. The renderer cannot add `SYSTEM_CONTEXT` or
`WORKSPACE_ROOT` sources.

### D11 — The Phase-01 model-name scan stops matching the provider name `ollama`

The Phase-01 fact `no_model_name_is_hard_coded` does a lower-case substring
search for `llama` (among others) across the core and renderer sources.
Phase-02's contract names the provider kind `OLLAMA`, and the generated
renderer types and host tests carry it, so the scan would match the provider's
product name as if it were the `llama` model family. The fact now removes the
exact token `ollama` before matching. Every other occurrence of `llama`
(`llama3`, `codellama`, …) still fails the fact, and every other listed name is
unchanged. Provider-specific code stays in the providers crate (D3); display
names reach the renderer from the host, never from a renderer catalog. The
Phase-02 conformance runner adds its own scan for model family names across
the providers crate.

### D12 — A Phase-01 lint fix

`core/src/time.rs` carried `(i64 expression) as i64`, which current clippy
reports as `unnecessary_cast` under the crate's `deny(clippy::all)`. The cast
is removed; behaviour is identical.

## Consequences

* The host binary grows by SQLite and native-tls.
* Streaming is used inside adapters (OpenAI-compatible SSE, Ollama NDJSON) for
  first-byte timing and cancellation between chunks; the renderer receives the
  completed result. Live token streaming to the UI is not part of Phase-02.
* Tool definitions, OAuth and LAN providers are modelled only as future values.
