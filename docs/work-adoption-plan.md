# Make Rheo easier to adopt without weakening its work graph

The user authorized this sequence on November 19, 2026. Reduce setup and agent bookkeeping while retaining the existing graph, authorization, concurrency and synchronization contracts. Work remains explicitly selected; Rheo does not gain execution or Git authority.

## Guarantees and regression evidence

| Guarantee                                                                                                                                 | Existing evidence to preserve                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Membership is separate from prerequisites; start and delivery gates remain distinct; missing/stale/uncertain assessments never mean ready | `dependency-assessments.test.ts`, `work-map.test.ts`, `work-map-layout.test.ts` |
| Claims retain scope, private identity, purpose, replay and concurrent-edit checks                                                         | `dependency-assessments.test.ts`, `streams.test.ts`                             |
| Checkpoints are atomic; exact attributed answers cannot cross selections; delayed events cannot overwrite current work                    | `sync.test.ts`                                                                  |
| Offline writes replay once; conflicts are quarantined; stopping/expiry never delivers work                                                | `sync-hooks.test.ts`                                                            |
| Work associations and handoffs survive selection changes, restart and recovery                                                            | `sync.test.ts`, `sync-hooks.test.ts`                                            |
| Human unblock steps, observations, session endings and retries do not create completion credit                                            | `daily-progress.test.ts`, `daily-progress-api.test.ts`                          |
| Setup preserves other integrations and refuses edited owned content                                                                       | `workflow.test.ts`, packaged workflow verification                              |

Baseline: 153 service/unit/integration tests pass before edits. Add meaningful failure/race coverage at each changed boundary. Real client lifecycle observations remain separate from helper/SDK checks.

## 1. Personal setup

New installs default to personal scope. Existing bindings without a scope retain their shared-guidance strategy until explicitly migrated. Personal setup uses the existing trusted lifecycle hook output to bootstrap Rheo guidance, plus local skills/bindings. It creates no `CLAUDE.local.md`, so it does not change the client's shared `AGENTS.md`/`CLAUDE.md` discovery precedence.

Use Git's checkout-local exclude file for precisely owned artifacts; never edit the team's `.gitignore` or ignore shared instructions. Reject already tracked personal files rather than pretending ignore rules hide them. Resolve the real Git metadata path for linked worktrees and nested projects. Retain local exclusions on removal because other worktrees may use the same Git metadata.

`preview/check/install/remove` retain ownership, hash, symlink and rollback checks. An explicit personal migration removes only an unchanged owned shared section; other instructions and hooks survive. No graph/storage schema changes in this slice. Tests must establish unchanged tracked files and Git status, lifecycle bootstrap/recovery, legacy compatibility, tracked conflicts, nested projects and worktrees. Installed hooks still require actual client trust/loading verification.

## 2. Simpler agent operations

Add convenience operations over the existing services and helper; retain current APIs and their validation. Move mechanical revision lookup, stable retry IDs, paging and private lease storage into the helper. Keep dependency judgments and explicit reviewed scope with the agent: no automatic `none`, fabricated review receipt or claim from unread/stale context.

Compare old/new success, conflict, duplicate, stale-scope, permission and offline outcomes. Reuse the same atomic checkpoint and session fencing paths. Store work data as bounded attributed context; retrieved notes never grant permission, run commands or resolve a request by themselves.

## 3. Observed output evidence

Introduce read-only observations for explicitly linked GitLab MRs, using owner-configured host/credential access. Never send credentials to a host chosen by stored work text. Preserve source, time, output version and observed code revision; failed/unavailable observations remain unknown rather than overwriting reports.

Agent-reported delivery and observed merge/pipeline state remain separate. Neither observation nor a green pipeline automatically delivers work, satisfies a reported integration gate or changes daily completion counting. Verify stale-output races, changed MR revisions, authorization, host/redirect constraints and failure behavior.

## Separate follow-ups

An Obsidian view should be a deliberate read-only projection/reference integration rather than a second editable work-state store. Developer ID signing/notarization and real receiving-Mac policy/client tests remain separate distribution outputs. Do not bundle those with graph/sync protocol changes or claim them complete from local regression tests.

## Implementation and local verification

Implemented in unreleased workflow 1.7.0. All existing MCP tools, graph prerequisites, staged dependency assessments, checkpoint outbox behavior and daily completion rules remain in place. GitLab access is installation-specific, with one configurable HTTPS origin per Mac; no company hostname is built into the product.

Local verification on November 19: 167 service/unit/integration tests pass; all 27 browser scenarios pass (26 in the full run, then the new MR scenario after correcting its fixture). Browser coverage includes changing selections during a delayed MR check, reported evidence details, desktop/narrow layouts and the existing dependency graph/synchronization scenarios. Typecheck, formatting, repository-path checks and a source-only secret scan pass. An isolated Mac package build and all eight packaged verification groups pass, including personal setup preserving shared instructions while installed, lifecycle bootstrap, checkpoint recovery and removal.

These checks do not establish actual Claude Code hook trust/loading, access to a real GitLab instance, or receiving-machine policy compatibility. The installed app, existing real-project bindings and published installers have not been replaced. Workflow setup remains conflict-aware; existing project-scope installations are not silently migrated to personal scope.
