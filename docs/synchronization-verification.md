# Synchronization verification

Version 0.3.2 / workflow 1.3.0, November 11, 2026.

Implemented the synchronization subset described in [synchronization.md](synchronization.md): atomic checkpoints and attributed feedback for existing requests, local Codex/Claude lifecycle adapters, durable pending writes/reconciliation, private per-session selection, and distinct context/checkpoint freshness. The broader immutable plan-version/request/navigation design remains unimplemented.

## Evidence

- 89 tests across 12 files pass, including HTTP/real stdio MCP, owner boundaries, whole-checkpoint rollback, stale/duplicate responses, reported prerequisite evidence, selection changes, offline recovery, lost acknowledgements, private file modes, conflict quarantine/reconciliation, and bounded stop continuation.
- All 14 browser scenarios pass. Extended onboarding uses the actual stdio `sync_work` tool, toggles the connection permission, relays direction approval and an answer, observes the request disappear, and checks checkpoint freshness plus a narrow stream layout.
- Typecheck, formatting, diff checks and production build pass. Mobile synchronization presentation was visually inspected.
- The Mac app/ZIP/DMG were built and locally signed. Packaged verification passes for bundled Node/SQLite, MCP, setup/check/context/remove, actual lifecycle/checkpoint helper calls, persistence, duplicates/port conflicts, crash cleanup, native background launch/quit and clean first launch.

## Installed application

Installed `/Applications/Work Inbox.app` was updated to 0.3.2. Backup: `~/Library/Application Support/Work Inbox/backups/sync-0.3.2-2026-11-12T02-21-24-975Z/`, containing the prior app, data and a consistent pre-update SQLite snapshot.

Before recording release telemetry/decisions, every original row and column across the 26 prior tables matched its pre-update digest (migration history adds the new migration). All five real work items survived; foreign-key checks pass. Credential file and Codex configuration inode/size/mtime/permissions were unchanged; credential contents were not printed or embedded. The update did not create sample work.

Connected original `get_workflow` succeeds and reports 1.3.0. Project guidance/hooks were updated with no ownership conflicts, preserving the original pilot stream/change binding and all unrelated client settings. A private native-session selection points this chat at the synchronization work instead of the pilot. Chat feedback is enabled only for the existing `work-inbox-4633a26c` connection. That already verified connection was still an unfinished setup draft; its normal setup-completion transition now makes it visible in Connections.

The new helper successfully loaded current context and relayed the three specifically recorded historical implementation go-aheads for desktop packaging, stream oversight and visual polish. Their obsolete acceptance requests disappeared. Events retain the reporting agent and native Codex source; no outcome was marked human-completed. This exercises the running application's adapter/API; it does not prove automatic delivery by Codex hooks.

## Remaining client validation

Project hook files are installed, but client review/trust and a fresh Codex session are still required to establish automatic loading and checkpoint enforcement. This environment disallows computer control of the Codex app, so its hook review screen could not be inspected or operated. The current chat retains its older MCP tool catalog; the local checkpoint helper works without a catalog reload. No fresh Codex chat was created as a substitute for the user's next session, and no actual Claude Code/Herdr session was run.

Queue counts are last reported observations. An offline queue cannot be observed live by the server. No public notarization, automatic execution worker, transcript observer, Git commit or push is included.
