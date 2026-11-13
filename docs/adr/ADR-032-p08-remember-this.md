# ADR-032 — Phase-08: "remember this" and the memory page

- Status: Accepted (2026-10-01)
- Extends: ADR-031. Touches the Phase-05 memory policy (ADR for Phase-05 memory) without relaxing it.

## Context

Measured in the owner's real database on 2026-10-01:

- There were 12 active memories. All of them were automatic mission records
  (`Mission "…" ran to COMPLETED …`).
- No memory about the user and no project memory existed.
- No agent had ever proposed a memory.

The memory system's governance was in place: validation, a secret filter, type and scope rules, conflict
detection, true deletion, and access logs. However, the user had no way to tell it anything. The memory page
was a technical filter table.

Phase-05 deliberately exposes no `memory.write` to the renderer, and the forbidden list says so by name.
The renderer is an untrusted caller, and a free memory write would let it plant typed, scoped,
trust-upgraded entries.

## Decision

1. **A third candidate source, `USER`.** It records text the user wrote themselves.
   - Policy: the user may write about themselves (USER scope, PREFERENCE or SEMANTIC) or about an active
     project (PROJECT scope, PROJECT or SEMANTIC). The user may not write to mission working memory or to
     the system scope.
   - Stored as: `USER_DERIVED`, `UNVERIFIED` (a statement is not evidence), `USER_APPROVED_WRITE`.
   - The same validation applies as for any candidate: bounds, the secret filter, raw-reasoning and
     page-dump checks, duplicates, and conflict detection.
2. **`memory.remember`** (Phase-08, CREATE_LOCAL_DATA, idempotency REQUIRED) takes these fields:
   - `text`;
   - `scope` (USER or PROJECT);
   - `project_id`, required and active for PROJECT;
   - optional `mission_id`, recorded as a source reference.

   It returns the host's decision and reason as they are. It is not `memory.write`, which stays on the
   forbidden list: it accepts no free type, no system scope and no trust or verification field.
3. **Schema v10.** It rebuilds `memory_decisions` with the same columns so that its `source` check admits
   `USER`. Every row is copied inside the migration transaction.
4. **Retrieval folds Arabic spelling** for matching:
   - hamza forms → alef;
   - ta marbuta → ha;
   - alef maqsura → ya;
   - diacritics and tatweel removed;
   - the definite article stripped.

   «الرياض» therefore matches «رياض». `normalise` and content digests are unchanged, so duplicate
   detection of existing rows is unaffected.
5. **Renderer.**
   - "Remember this" appears under each user message. Its dialog starts from the message text and offers
     "about me" or "about this conversation's project".
   - The memory page shows the layers by their real names: about you (USER), projects (PROJECT), the
     automatic task log (MISSION, folded), and the old technical view (folded). Each item shows its source:
     written by you, proposed by an agent and approved, or an automatic record.
   - The page's wording states the real budget: up to 12 items within 700 tokens by default, ranked per
     task.

## Consequences

- The Phase-08 registry grows from 41 to 42 operations, all in envelope 1.7.
- What is still not done, stated plainly:
  - There is no automatic extraction of facts about the user from conversations.
  - Retrieval is lexical (token overlap with Arabic folding), not semantic embeddings.
  - Specialists have no separate memory of their own; all agents share the same scoped memory.
