# ADR-028 — Phase-08: real work, inside the walls that already exist

- Status: ACCEPTED
- Phase: PHASE-08
- Supersedes: nothing (it amends declared lists of ADR-027, see §9)
- Superseded by: nothing

## Context

Phases 00–07 built a governed, auditable agent runtime whose only way to act was a
small set of read-mostly tools. Phase-08 makes it do real work: run code, drive a
real browser, produce real files, run on a schedule, and use a real local model —
without opening a route around the controls that Phases 00–07 measured:

1. The renderer must stay unable to execute anything (Phase-01 invariant).
2. Every effect must pass the tool gateway: schema, capability, policy, budget,
   approval bound to the exact arguments, audit (Phase-04).
3. Web content is data, never authority (Phase-05).
4. Nothing leaves the machine without a decision the user sees (Phase-06).
5. The release stays honest about what it is (Phase-07).

## Options considered

| Topic | Options | Decision and reason |
|---|---|---|
| Where code runs | (a) child process of the host; (b) container/VM; (c) AppContainer + Job Object (ADR-001) | (c): measured in Phase-00, no admin, per-mission identity, kernel-enforced file and network denial, kill-on-close |
| Python | (a) the user's interpreter in place; (b) an owned copy prepared on request | (b): the AppContainer can read only what it is granted; an owned copy is granted, the user's install is not touched |
| Browser | (a) keep the Phase-05 HTML engine; (b) embed a WebView; (c) headless Edge/Chromium over CDP with every request intercepted | (c): JavaScript works; `Fetch` interception sends every request through the Phase-05 navigation policy and the host HTTP client; a dead proxy stops anything that escapes interception |
| Artifacts | (a) call Office/LibreOffice; (b) write the formats directly and re-open them | (b): no external dependency; every artifact is re-opened and verified before it is reported |
| Model routing per mission | (a) global default only; (b) a per-mission preference port | (b): `MissionModelPreference` binds manual routing for one mission without changing Phase-03 contracts |
| Scheduler | (a) OS scheduler; (b) in-host tick | (b): a schedule starts an ordinary mission; approvals are never pre-granted (`WAIT_FOR_APPROVAL` or `FAIL_ON_APPROVAL`) |
| OAuth | (a) embedded web view login; (b) system browser + PKCE + loopback redirect | (b): the host never sees a password; tokens go to the credential store, never over IPC |
| Skill packages | (a) executable plug-ins; (b) declarative manifests | (b): a package names existing tools; it is recorded UNTRUSTED and grants no authority |

## Decision

1. **Execution** — `polaris.execution.command` (Windows PowerShell 5.1) and
   `polaris.execution.python` run only through `ExecutionService` → `SandboxPort`.
   On Windows the port is `Win32Sandbox` (AppContainer SID per mission, Job Object
   with memory/process/CPU limits, kill-on-close, explicit environment, no
   network capability unless an approved network run adds it). The classifier
   widens effects (network, package install, system configuration, running a
   downloaded file, privilege elevation) and requires a human approval; the
   sandbox denies what the classifier cannot see (files outside the workspace,
   network without the capability).
2. **Workspace** — every mission has `inputs/` (attachments, read-only to tools),
   `work/`, `outputs/`, `downloads/` (quarantine). Paths are normalised and
   confined; `..`, absolute paths and reparse points are refused.
3. **Browser** — `BrowserService` owns one headless Edge per mission inside a Job
   Object, with a throw-away profile under the data folder. Every request is
   paused by CDP `Fetch`, judged by the navigation policy (private networks,
   metadata addresses and redirects to them denied), fetched once by the host
   HTTP client, and fulfilled; writes (POST, uploads) need a per-origin approval
   (`polaris.browser.permit_write`); password fields are refused; downloads land
   in `downloads/` and are never opened. Page content reaches the model labelled
   `WEB_UNTRUSTED`.
4. **Artifacts** — DOCX, XLSX (with charts), PPTX, PDF (Latin standard fonts;
   Arabic with an embedded system font and logical-order extraction), HTML,
   Markdown, CSV, images and code files. Each is re-opened and verified; the
   verification result travels with the artifact.
5. **IPC** — the envelope moves to 1.7 with 32 named Phase-08 operations. None of
   them executes, navigates, writes a workspace file, returns a token or approves
   a schedule; twelve such names are guarded by name.
6. **Composite skill** — `polaris.skill.agentic-work` bundles up to 32 built-in
   tools (other skills keep the limit of 8). It holds no capability the tools do
   not declare.
7. **Work profile** — a user-chosen profile (tool calls 64, tool runtime 20 min,
   network calls 48, external side effects 6) written in the USER layer by an
   explicit action in Settings → Execution. The MISSION layer never widens a
   security limit (Phase-06 invariant, measured: the first design wrote these in
   the MISSION layer and every write was refused `WIDENS_SECURITY`, leaving tasks at
   four tool calls). The Phase-06 defaults are unchanged; only the ceilings were
   raised so a user-chosen profile fits a real task. The measurement harness applies
   the profile through the same `config.set` operation the Settings action uses.
8. **Measurement** — `polaris-p08-native` (not shipped) builds the real host with
   the real Windows ports and measures the sandbox, Edge, every artifact format,
   the real local model, a 24-task benchmark with Missions A–E, the scheduler,
   cancel and restart. It plays the trusted runtime for probes, never the user
   for approvals inside the gateway: approvals are answered through the same IPC
   operation the UI uses.
9. **Declared lists (amends ADR-027)** — the Windows adapters live in a separate
   crate, `desktop/host/win`. The Phase-07 hardening lists now declare
   `win/src/process.rs` and `win/src/sandbox.rs` as the only new `unsafe` FFI
   files and `win/src/process.rs` as the only process launcher (the Job-Object
   launcher for the sandbox and Edge). The measurement harness is not shipped and
   is not scanned as product code, like the test suites.

10. **Agent loop (measured with the real local model)** — an agent that proposes only
    observation tools (list, read) sees their results even without asking; a dependent
    task receives what its predecessors reported (as unverified agent messages); an
    interim reply may omit its summary; a malformed reply is repaired once, with the
    parse error shown and the extra call reserved from the same budget. No product code names a model family (the Phase-01 model-name scan, re-measured). Fixture
    models of Phases 03–07 keep their closed behaviour (all new hooks default to off).

## Consequences

- Real work runs, and the same gateway, approvals and audit apply to it.
- The product depends on Microsoft Edge (present on Windows 11) for the real
  browser; without it the browser tools report `BROWSER_UNAVAILABLE`.
- A local model is optional; without one, model-dependent measurements are
  `BLOCKED_ENVIRONMENT`, never PASS.
- macOS remains a foundation only: the ports exist as traits, not as adapters.
- Voice transcription needs a local server the user configures; there is no
  always-on microphone and no remote transcription.
