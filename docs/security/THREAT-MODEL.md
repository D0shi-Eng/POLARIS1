# PHASE-07 — Threat Model (release candidate hardening)

Scope: what Phase-07 adds or exposes — the local store and its recovery, backups
and restore, schema upgrades, the maintenance tool, the managed policy, the
update verifier, and the Windows installer. Earlier phases' threat models
(connectors, browser, computer control, providers) stay in force and are
re-verified by the Phase-00..06 regression inside the Phase-07 run.

## Assets

- The user's local store (`polaris.db`): projects, missions, evidence, audit chain, settings.
- Backups and quarantined stores in the data folder.
- The security limits of the settings control plane, including a managed policy.
- The integrity of what gets installed or would be installed as an update.

## Actors and trust boundaries

| Actor | Can | Boundary |
|---|---|---|
| The user | run the app and `polaris-maint`, edit settings | the app's own validation |
| A local process running as the user | write files in the user's data folder, start `polaris-maint` with any arguments | everything read from the data folder is untrusted input |
| A local non-admin user of the same machine | create files under `%ProgramData%` (default ACL) | a managed policy can only narrow |
| A network attacker | serve a forged update manifest or installer | only a trusted key's signature over exact bytes counts |

## Threats, controls and the tests that prove them

Every row names the control and the tests that must run and pass in the
canonical Phase-07 run; `P07-S1` in the final gate re-checks each name against
the executed test list.

| ID | Threat (STRIDE) | Control | Tests |
|---|---|---|---|
| T-01 | Tampering: a backup resealed with a planted trigger runs attacker SQL on every later write | backups are compared object by object with the reference schema of their version (schema fingerprint) | tests: p07_redteam_a_resealed_backup_with_a_planted_trigger_is_refused_by_the_schema_fingerprint, p07::schema::tests::an_added_trigger_is_a_schema_mismatch |
| T-02 | Tampering: a backup file is altered or replaced by a non-database | SHA-256 and size from the manifest, full integrity check, SQLite header check | tests: p07_restore_a_tampered_backup_is_refused_before_anything_moves, p07_redteam_a_text_file_posing_as_a_backup_is_refused |
| T-03 | Elevation: a backup id or manifest climbs out of the data folder | closed backup-id pattern, manifest names its own id, size-limited strict manifest | tests: p07_redteam_backup_ids_and_manifests_cannot_climb_out_of_the_data_folder, p07::layout::tests::a_backup_id_is_a_closed_name_that_cannot_climb_out |
| T-04 | Tampering: a backup folder is a symlink or junction to another place | links are refused and paths must resolve inside the data folder | tests: p07_redteam_a_backup_folder_that_is_a_link_to_another_place_is_refused |
| T-05 | Denial of service / data loss: a damaged store silently replaced by an empty one | quarantine (never delete), restore the newest verified backup, otherwise fail closed and leave the file | tests: p07_recovery_a_corrupt_store_is_quarantined_and_the_latest_verified_backup_restored_at_startup, p07_recovery_a_damaged_store_without_a_backup_fails_closed_and_is_left_untouched |
| T-06 | Data loss: the process dies in the middle of a transaction | SQLite WAL atomicity; committed rows survive, the open transaction does not | tests: p07_recovery_a_process_crash_keeps_committed_rows_and_loses_only_the_open_transaction |
| T-07 | Tampering: the store is replaced under a running application | shared instance lock held by the app; restore and reset need the exclusive lock; recovery does not touch a store another instance holds | tests: p07_restore_is_refused_while_the_application_runs, p07_recovery_a_store_damaged_while_another_instance_runs_is_not_touched, storage::lock::tests::two_shared_holders_coexist_and_block_an_exclusive_request |
| T-08 | Data loss: an upgrade stops half way | one transaction per migration step and a copy of the old store before migrating | tests: p07_migration_a_failed_step_leaves_the_older_store_and_its_rows_intact, storage::migrations::tests::a_failed_migration_leaves_no_partial_schema |
| T-09 | Tampering: a newer-schema store or backup is opened by an older build | newer schemas fail closed and are left untouched | tests: p07_redteam_a_resealed_backup_claiming_a_newer_schema_is_refused, storage::db::tests::a_newer_schema_fails_closed_and_is_left_untouched |
| T-10 | Spoofing: an update manifest signed by another key, or a key named in the manifest itself | keys come only from the build's list, Ed25519 strict verification over the exact manifest bytes, the product list is empty | tests: p07_update_a_changed_manifest_or_a_foreign_signature_is_refused, p07_update_the_product_build_refuses_every_manifest_until_a_release_key_exists |
| T-11 | Tampering: a rollback to an older, vulnerable version | an offered version must be strictly newer than the installed one | tests: p07_update_a_downgrade_or_the_same_version_is_refused |
| T-12 | Tampering: an installer that is not the one the manifest describes | name listed, size and SHA-256 must match; strict, size-limited envelope; artifact names cannot climb | tests: p07_update_an_altered_or_unlisted_artifact_is_refused, p07_update_malformed_or_oversized_envelopes_are_refused |
| T-13 | Elevation: a forged managed policy widens a limit or opens a locked setting | the policy is a security-layer clamp: narrower-of wins; locked, unknown or above-ceiling settings refuse the whole policy | tests: p07_redteam_a_forged_policy_can_only_narrow_or_lock_down, p07_policy_a_policy_cannot_widen_what_the_owner_narrowed |
| T-14 | Tampering: the user removes a managed limit | managed rows are not in the store and cannot be written or reset away | tests: p07_policy_the_user_cannot_raise_or_remove_a_managed_limit |
| T-15 | Denial of control: a broken policy file is ignored (fail open) | an unreadable or invalid policy applies the lockdown set and says why | tests: p07_policy_an_invalid_policy_file_locks_down_instead_of_being_ignored |
| T-16 | Elevation: argument injection into the maintenance tool | a closed vocabulary of commands and flags; duplicates and unknown flags are usage errors | tests: p07_redteam_maintenance_arguments_are_a_closed_vocabulary |
| T-17 | Integrity: retention deletes user work, the audit chain or quarantined stores | retention touches only reproducible files, dry run first, validated counts | tests: p07_retention_a_dry_run_counts_and_an_applied_run_prunes_only_reproducible_files, p07_retention_a_policy_that_would_delete_everything_is_refused |

## Measured outside the table

- Network surface (`P07-S3`): one socket opener in the product, every HTTP
  user declared with its guard, no network API in the renderer, `connect-src`
  limited to the IPC origin, no telemetry address.
- Binary hardening (`P07-H3`): ASLR, DEP and Control Flow Guard read from the PE
  headers of the shipped binaries.
- Webview lockdown (`P07-H4`), unsafe confinement and process spawning (`P07-H5`),
  write sites and data-folder ACL (`P07-H6`).
- Installer safety (`P07-X2`): the user's real POLARIS data and registration are
  hashed before and after the release E2E and must be unchanged.

## Accepted and residual risks

- **Unsigned binaries.** Without a code-signing certificate Windows SmartScreen
  and users cannot verify the publisher. Public release stays blocked on signing.
- **No release update key.** The verifier is tested with per-run TEST keys; until
  a release key exists the product refuses every update manifest (fail closed).
- **Policy placement under `%ProgramData%`.** A non-admin local user can create
  the policy file on a machine where no administrator did. Because a policy can
  only narrow, the worst outcome is a stricter configuration (denial of
  functionality), never a widening. Registry-based (HKLM) policy is not in this
  build.
- **Installer process handling.** The NSIS installer may stop a running process
  with the product's executable name when it replaces files; the release E2E
  runs with no POLARIS process open.
- **macOS.** No macOS build or run exists; nothing here is claimed for macOS.
