# Stream-first oversight verification

Version 0.3.0, workflow 1.2.0, November 11, 2026.

Implemented the first coherent slice in the approved [implementation plan](stream-oversight-implementation-plan.md): owner-derived scope coverage, feeding streams, typed prerequisites, human actions and saved answers, reported delivery, unified attention, bounded agent context, and Streams/Needs you/Changes navigation. Composition and dependencies stay separate; no execution dispatch was introduced.

## Automated evidence

- `npm run typecheck`, `npm run format:check`, and `git diff --check` passed.
- `npm test`: 80 tests across 10 files passed. This includes real stdio MCP/HTTP, owner versus agent boundaries, mixed attention totals, scope/ancestry drift, private claim replay/revocation, independent and blocked branches, stage and containment cycles, responses/retries, escaped context bounds, and a real pre-0006 schema migration.
- `npx playwright test`: all 14 browser tests passed against the final built assets. The new scenario approves direction, creates two covered branches, links one human action, shows direct/ancestor impact, completes the action, preserves activity elsewhere, reports delivery without closing the parent, and drills into changes. Existing edit/history/filter/setup/connection flows and narrow layouts remain covered. Screenshots were visually reviewed.
- `npm run desktop:build` plus final `node scripts/package-desktop.mjs`: app, ZIP and DMG built; deep/strict code-sign verification passed.
- `npm run desktop:verify`: packaged Node/SQLite, actual stdio MCP, workflow helper setup/context/removal, isolated migration/persistence, stable launcher after movement, duplicate/port-conflict handling, crash recovery, and native AppKit launch/asynchronous Quit passed. The final package contains the same native/server code plus a CSS click-target fix exercised by the final browser suite.

## Installed local verification

The installed `/Applications/Work Inbox.app` was updated to 0.3.0 after stopping the old service. A private backup of the old app and data was saved under the Work Inbox application-support `backups/oversight-0.3.0-*` directory before replacement.

A canonical digest of every row and original column across all 20 existing tables matched after migration, before verification telemetry/implementation handoff writes. All three real work items survived; the migration created zero stream approvals or human actions. Foreign-key checks passed. The original protected credential and Codex configuration retained their inode, size, modification time and permissions; their contents were neither printed nor edited. The stable runtime symlink points at the installed bundle.

The native window visibly opened on Streams. Connected `list_work`, `get_workflow` and explicitly selected `get_stream_context` succeeded against the updated app; the workflow reports 1.2.0. Project guidance updated through the conflict-aware installer with no conflicts, preserving the original pilot selection. No real work was marked owner-accepted or completed to make verification pass.

## Practical limits

The current Codex MCP process retains its old tool catalog until a supported reload or new chat. Connected legacy-tool verification above is real; the new tools were exercised by the isolated stdio client, not yet exposed in this existing chat. No separate Claude Code lifecycle or real compaction test is claimed.

Existing streams keep their old policy. The owner can choose **Enable routine work coverage** for future additions and explicitly cover enumerated visible proposals. Migrating does not approve those records. No sample stream/action was seeded into the live installation.

Coverage validates declared scope and approval provenance, not the semantic truth of an agent's in-scope declaration. Output availability/integration and progress remain attributed reports. The app is bookkeeping and oversight; it neither guarantees agent behavior nor independently observes merges. The Mac build remains locally signed, without public notarization or a selected distribution license.

All source changes, including earlier work, remain uncommitted on the existing branch.
