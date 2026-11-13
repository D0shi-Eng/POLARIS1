# ADR-027 — Phase-07: a store that survives, a release that says what it is

- Status: ACCEPTED
- Phase: PHASE-07
- Supersedes: nothing
- Superseded by: nothing

## Context

Phase-07 turns the governed work system of Phases 00–06 into a Windows release
candidate. The risks are no longer new capabilities but the product's life on a
real machine:

1. The local store can be damaged (crash, disk, tampering) and the user's work
   lost or silently replaced by an empty store.
2. A backup can carry more than data: a planted trigger or view runs on every
   later write once restored.
3. An upgrade can stop half way, or a newer store can be opened by an older build.
4. An update path is the classic supply-chain entry point.
5. An organisation needs limits the user cannot lift, without handing anyone a
   way to widen them.
6. A release can be described as more than it is ("signed", "enterprise ready",
   "macOS supported") without evidence.

## Options considered

| Topic | Options | Trade-off |
|---|---|---|
| Damaged store at startup | (a) fail closed always; (b) start empty; (c) quarantine and restore the newest *verified* backup, else fail closed | (a) leaves the user stuck even with a good backup; (b) hides data loss; (c) keeps every byte and recovers when it can |
| Backup verification | (a) digest only; (b) digest + integrity check; (c) digest + full integrity + schema fingerprint against the reference schema of its version | only (c) refuses a consistent backup that carries planted SQL objects |
| Restore concurrency | (a) trust the user to close the app; (b) an instance lock | (b) makes "restore under a running app" impossible, not unlikely |
| Update verification | (a) Tauri updater plugin (minisign, network); (b) own verifier, no network path | (a) adds a network update path before there is a key or a server; (b) proves the verification without any fetch |
| Managed policy | (a) a new "managed" layer with its own semantics; (b) rows in the existing security layer | (b) reuses the Phase-06 resolver: narrower-of always wins, so a policy cannot widen by construction |
| Installer | (a) MSI (WiX, needs .NET 3.5); (b) NSIS via the pinned Tauri bundler | (b) per-user, no administrator, already a pinned dependency |

## Decision

### 1. The store guards itself before it opens

- `p07::recovery::guard` runs before `Database::open`. It takes the exclusive
  instance lock if it can, checks the file (header first, then `quick_check`,
  then foreign keys), and on damage **moves** the store files to
  `quarantine/<stamp>-damaged-<id>/` and restores the newest backup that passes
  full verification. Without such a backup, or when another instance holds the
  store, nothing is moved and the store fails closed with a reason code. A
  report is written to `recovery/last-recovery.json` whenever the guard acts.
- The application holds a **shared** lock on `polaris.lock` for its lifetime;
  maintenance commands that replace the store need the **exclusive** lock and
  are refused while the application runs. Two application instances keep
  sharing the store as before.

### 2. A backup counts only after it has been read back

- `VACUUM INTO` a partial folder → full `integrity_check` of the copy →
  schema fingerprint compared with the product's reference schema for that
  version (built in memory from the same migrations) → SHA-256 → strict manifest
  (`polaris.backup/1`, unknown fields refused) → atomic rename.
- Restore verifies again, backs up the current healthy store first
  (`PRE_RESTORE`), quarantines it, places the copy under a temporary name,
  re-checks its digest, renames, and rolls back on any failure.
- Backup ids are a closed pattern; links and paths that resolve outside the
  data folder are refused.

### 3. Upgrades are the product's own path

- `migrations::apply_up_to` builds any older schema from the frozen migration
  scripts; tests and the release E2E open real v1..v4 stores through the
  product. Each step is one transaction; the pre-migration copy is kept.

### 4. Update verification without an update path

- `p07::update` verifies a signed envelope: the key is chosen by id from the
  build's list (never from the manifest), Ed25519 `verify_strict` over the exact
  manifest bytes, strict manifest, same product, strictly newer version,
  artifact name listed, size and SHA-256 equal.
- The product's trusted key list is **empty**: no release key exists, so every
  manifest is refused. There is no updater plugin and no update endpoint; the
  `advanced.auto_update` setting stays unavailable.

### 5. Managed policy is a clamp that cannot widen

- `%ProgramData%\POLARIS\policy\managed-policy.json` (`polaris.managed-policy/1`)
  is read once at startup and becomes security-layer rows that are not stored
  and cannot be written or reset away. `clamp_of` folds every security row, so
  the narrowest of build ceiling, owner limit and policy wins.
- A policy may name only editable, security-bearing settings that accept the
  security layer; anything else refuses the whole document. A present but
  unreadable or invalid policy applies the lockdown set (every boolean security
  setting at its narrow value) and says why. Absence means no policy.
- The path override exists only in the measurement build.

### 6. The maintenance tool is a separate executable

- `polaris-maint` (crate `desktop/host/maint`) exposes verify, backup,
  list/verify backups, restore, upgrade, reset (to quarantine), retention,
  policy-check and update-verify with a closed argument vocabulary and one JSON
  document per run. It is a separate crate because the core never writes to
  standard output.

### 7. Retention prunes only what can be reproduced

- Extra backups (never the last), old diagnostics files, and, only on request,
  old quarantined downloads. The audit chain, user work and quarantined stores
  are never pruned; unbounded tables are declared as such.

### 8. Windows release, stated verdicts

- Control Flow Guard is enabled for the MSVC target (`.cargo/config.toml`); the
  runner reads ASLR, DEP and CFG from the PE headers of the shipped binaries.
- The installer is a per-user NSIS package built from
  `tauri.release.conf.json` (WebView2 is not downloaded; the maintenance tool is
  bundled). The release E2E installs an older-version fixture, upgrades it with
  the release installer, and uninstalls, in owned paths.
- Signing happens only with a real certificate; otherwise the status is
  `SIGNING_READY_UNSIGNED` as Windows reports it. macOS is `FOUNDATION_ONLY`.
  The final gate writes PHASE-07, WINDOWS_RC, SIGNING, MACOS and PUBLIC_RELEASE
  separately and never "production ready".

## Evidence

`tools/p07-conformance/run.ps1` → `evidence/phase-07-*.json` and
`evidence/phase-07-final-gate.json`; tests named in
`docs/phases/PHASE-07/PHASE-07-THREAT-MODEL.md`.

## Consequences

- A damaged store is recoverable when a backup exists and never silently lost
  when it does not; the cost is a startup integrity check (quick_check) and the
  instance lock file.
- The workspace MSRV rises to 1.89 (`File::try_lock`).
- Before public release: a code-signing certificate, a release update key, and
  a decision on an update transport. Before macOS: moving the four declared
  platform conditions in the core behind ports and a native macOS run.
