# ADR-031 — Phase-08: managing conversations and projects from the task menu

- Status: Accepted (2026-10-01)
- Extends: ADR-029 (conversation operations), ADR-030 (specialist catalog). Uses ADR-021's mission store unchanged.

## Context

Measured on the owner's machine on 2026-10-01:

- The task menu ("⋯") offered no rename, pin, favourite, archive, delete or move-to-project. None of these
  operations existed in the host.
- The sidebar showed a filter icon next to "Tasks" that was decoration with no function.
- The project page was a tab sheet (overview, context, model, settings), not the Manus project page.

The Manus desktop app was opened on the same machine to observe its task menu, project page and dialogs.
It was viewed only: nothing was sent or changed.

## Decision

1. **A conversation is managed as a whole.** It is the first turn plus its follow-ups. Every change
   applies to all of its missions.
2. **Schema v9** adds `p08_conversation_state (thread_id, pinned, favorite, archived_at, renamed_at,
   updated_at)`. This is purely additive. A conversation without a row is not pinned, not a favourite and
   not archived.
3. **`conversation.update`** (WRITE_LOCAL_DATA, idempotency REQUIRED) handles these changes:
   - **Title:** 1–120 characters on one line. It sets `renamed_at`, and the planner's proposed title
     (`retitle`) never overrides a user's title.
   - **Pin, favourite and archive:** archive hides a conversation; it does not delete it.
   - **Project:** a conversation moves into an active project, or out of one with `null`. Follow-ups
     inherit the root's project, as before.
4. **`conversation.delete`** deletes for real.
   - **What goes:** turns, narration, missions, tasks, agents, claims and evidence, tool calls and
     approvals, browser and desktop sessions, outputs and their share and publication rows, attachments,
     mission memory, and mission-scoped settings and budgets. Then the conversation's workspace folders go.
   - **What is detached:** accounting and observability rows (usage, observability events, connector
     invocations, memory decisions, schedule runs) are kept but lose their mission reference. Deleting
     them would falsify totals that are not the conversation's alone, and none of them holds its text.
   - **The audit chain** is not touched, since removing a link breaks the chain. It records
     `CONVERSATION_DELETED` with counts only, no title or text.
   - **Refusal:** the host refuses with `CONFLICT` while a turn is working or waiting for a decision.
   - **Guard:** `p08/purge.rs` holds an explicit rule for every table. A test walks the live schema and
     fails if any table with a mission or project column has no rule. A future table therefore cannot
     silently keep the text of a deleted conversation.
5. **`project.delete`** deletes a project's own data:
   - its instructions and context sources;
   - project memory;
   - project-scoped settings and budgets.

   Its conversations are **not** deleted; they leave the project. Schedules that created missions in it
   drop the project from their template rather than fail later on a missing reference. It is refused
   while a mission in the project is working.
6. **Project instructions** are a `USER_INSTRUCTION` context source. These already existed in Phase-02
   and are not new. The assembler places them in every model call of the project's missions, between
   «[PROJECT INSTRUCTIONS FROM THE USER]» markers. Notes and files stay untrusted data. The default
   context policy keeps project context away from remote models unless the owner allows it
   (`p02/egress.rs`).
7. **Renderer.**
   - **The "⋯" menu** appears in the sidebar rows, in the task header and on the project page's task list.
     Its items are: rename, pin, favourite, move to project (with "new project"), archive, and delete with
     an explicit confirmation.
   - **The sidebar:**
     - pinned conversations come first;
     - archived ones are hidden;
     - a project's conversations sit under the project and do not repeat in the task list;
     - the filter is real: none, favourites or archived.
   - **The project page** follows Manus's layout: header and menu, composer, task list with dates, and
     cards for instructions, files and sources, and scheduled tasks. The schedule form gains a project
     selector. Editing a schedule no longer drops its template's project and model; that was a defect found
     while doing this work.
   - **Not shown:**
     - Manus's per-project connectors, skills and website cards, and its "Share" item: the host has no
       per-project binding or share service for them, and a card without an effect would be a false
       promise.
     - The technical controls (start, stop, resume, refresh) now appear with "Details" instead of under
       "⋯".

## Consequences

- The Phase-08 registry grows from 38 to 41 operations, all in envelope 1.7. The registry schema's
  `maxItems` rises from 40 to 64.
- Deletion is irreversible by design. The renderer asks first, and the host refuses while work is
  running.
