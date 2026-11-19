# Bring existing project work into Rheo

The user wants to begin on a work Mac with projects already in progress. This flow adopts their available current context through their usual agent, rather than requiring a new task list or transferring another Mac's data.

## User flow

After a successful Claude Code or Codex connection, the existing-work dialog opens. It is also available on verified connection cards. The user selects up to ten explicit full project-folder paths. Preparation validates directories, resolves aliases and combines duplicates; it only produces project-specific handoff prompts.

The user pastes each prompt into that project's existing chat. The agent checks connection availability, compares current project/chat evidence with existing Rheo records, reuses matching streams/unfinished changes, and captures a focused handoff. Ambiguous goals/matches need a focused question. Completed history stays context; onboarding creates no fake deliveries or human-action change credits. The prompt previews the exact quoted project path with the existing workflow helper before installing explicitly selected IDs, preserving guidance, hooks, credentials and other MCP servers.

The dialog polls for **Context received** and **Checkpoint saved** from the exact credential, client and canonical project since setup began. The checkpoint must match the latest turn and context, with no pending writes. It reports observations, not automatic-hook certification or proof that an agent followed every instruction. A manual context read can show context received while the fresh-session checkpoint remains outstanding. Existing tool/session APIs provide all evidence; no new tracking table is required.

Closing/reopening resumes a browser-local draft containing only paths and the setup start time. Prompts and credential contents are not saved in that draft. Preparation and status APIs are owner-only and require a completed, non-revoked Codex/Claude Code connection. They never execute shell commands or edit project files.

## Compatibility and verification

This pass found a pre-existing incompatibility: the UI/schema offered Claude Code, but the original SQL CHECK rejected it. Migration `0013_claude_code_connections.sql` expands that CHECK by rebuilding only `agent_connections`, preserving every column and row, including credential IDs, file paths, completion and verification state. Nothing references that table; workflow/session permissions continue to reference unchanged credential IDs. A legacy migration fixture checks existing rows/credentials and foreign keys.

Validation covers owner authorization, unsupported/pending/disconnected clients, explicit valid folders, symlink duplicates, prompt scoping and quoting, no preparation side effects/credit, fresh per-project/per-connection evidence, pending writes and superseded checkpoints. The browser scenario uses a real stdio MCP test client to observe context/checkpoints, reload the draft and check narrow layout/keyboard focus. Packaged native verification creates a Claude Code connection and prepares an existing-project handoff using the bundled runtime and stable launchers.

Independent use on the work Mac and actual Claude Code hook loading are still to be observed there. No transcript crawler, repository modification, execution worker, cloud sync or cross-Mac credential transfer is added. The local preview remains ad-hoc signed and unpublished.

## Local verification — November 17, 2026

149 backend tests pass. The 24 existing browser scenarios passed; the new onboarding scenario then passed alongside the daily-progress scenarios after correcting an isolated-fixture assumption about an initially empty work list. Typecheck, formatting and diff checks pass. All eight packaged verification groups pass, including Claude Code setup with the bundled runtime, existing-project preparation, lifecycle/recovery and stable launchers. Desktop/mobile layouts and the installed AppKit/WebKit project-selection/handoff screens were inspected.

The installed preview is `/Applications/Rheo.app`, built in an isolated snapshot of the current uncommitted source. Backup: `~/Library/Application Support/Work Inbox/backups/rheo-existing-work-20261117T165936Z`. Once startup was ready, all 34 original tables retained their exact prior rows, including all existing connection rows and migration records; the only added migration record was `0013_claude_code_connections.sql`. Foreign keys were clean and protected credential/global client metadata was unchanged. The native UI preview prepared one handoff for this project without running it or modifying work/project files. No commit, push or publication was performed; previous clean trial artifacts remain untouched.
