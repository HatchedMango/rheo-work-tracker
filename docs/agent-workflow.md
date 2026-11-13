# Streams and agent workflow

Version 0.6.0 / workflow 1.4.1 keeps the stream work map tied to recorded relationships and removes the required accept/decline and approval-coverage workflow. Work is tracked directly; agents follow the user's actual authorization in chat. Historical decisions, approvals and scope proposals are retained without turning them into fresh human chores. See [synchronization](synchronization.md) for checkpoints and attributed chat responses, and [the implementation boundaries](simple-tracking-plan.md).

A **stream** is a sustained outcome that can contain feeding streams. A **change** is a bounded output with optional stream membership. Composition is separate from prerequisites. Missing links do not establish independence; agents explicitly assess dependencies. Completing changes never closes a stream.

## Human view

**Streams** shows goals, progress, related work and blockers. Open a stream for its work map or visible list. Select an item for its purpose, progress, prerequisites and direct unlocks without leaving the surrounding work. Delivered work stays visible and quieter; scope and history sit below. Groups show membership and arrows show recorded start/delivery gates, including cross-stream references and human blockers. Never invent links from names, dates or layout. Unknown/stale assessments are disclosed; satisfaction is an attributed report. Large maps disclose truncation; focus a feeding stream or browse changes. Narrow views use the list, and history pagination does not change visible work. **Needs you** contains only explicit open human questions and actions. A request card has a short ask, stream context, an immediate unlock when relevant, and an optional **Open chat** link. It has no approval or response form. Continue in the agent chat and synchronize the exact answer/action response using the existing opt-in relay permission.

New streams are active tracking records; changes have a `tracked` assignment without implying responsibility acceptance. Existing undecided records remain undecided in storage, but no longer block tracking claims or create intake chores. Old review/status/coverage flags do not create Needs you items. When input is required, explicitly record a short question or human action.

Human requests retain completion conditions, responses, dependency impact and provenance. Cancellation never satisfies a done prerequisite. Credential values stay in protected local storage. Routine change delivery leaves Active for History; it never completes the parent stream. No execution worker or scheduler is enabled.

`conversationUrl` is optional on `record_context` and `request_human_action`. It accepts HTTP(S) with no embedded credentials or `codex://threads/UUID` with no query/fragment. These local existing-chat links follow the [documented desktop deep-link form](https://learn.chatgpt.com/docs/reference/commands#deep-links); new-chat, settings, plugin, command and arbitrary application schemes are rejected. The native window opens allowed destinations only after a link click. Do not derive a link from a claim UUID or invent a Claude terminal URL. Omit unavailable links. This does not guarantee a chat exists, an app is installed, or remote-host navigation works. A stale MCP catalog requires client reload or a new chat to expose new optional fields.

## Writing work for the human

Name the goal the person is trying to accomplish, using a verb and their vocabulary. Keep the stream recognizable across many changes. Describe changes by their useful effect and report meaningful progress toward that goal. The title and update should make sense without the agent chat; a category name plus an implementation log does not do that. The existing card structure is sufficient when agents supply useful content.

| Field          | Weak wording                          | Useful wording                                                               |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| Stream title   | Work Inbox agent workflow             | Get Work Inbox ready for everyday personal use                               |
| Change title   | Implement persistence layer           | Keep unfinished work when the app restarts                                   |
| Progress       | Migration 0008 applied; 23 tests pass | Your work now survives app restarts; agent reconnection still needs checking |
| Human request  | Configuration dependency              | Get API access from Bob                                                      |
| Technical goal | Backend improvements                  | Support PostgreSQL for hosted installs                                       |

These are wording examples, not reports of implemented work. Prefer one short sentence; add context when it helps a real decision. Human requests should state the exact action or choice and what it unlocks when useful. Reconcile existing chat answers under the normal permission rules rather than creating repeat requests. Do not request routine acceptance just to report delivery, or replace a genuine unresolved question with a generic approval prompt.

Include technical details when directly related to the ask, or needed to explain behavior, a tradeoff, risk, limitation or decision. Precision is useful for technical goals; forced benefit language can obscure them. Routine file lists, commands, test counts, IDs and execution logs belong in findings/evidence. Material uncertainty and verification limits stay visible. Concision must never imply completion, approval or independent verification without evidence.

`humanFacingGuidance` in `src/shared/streams.ts` is included in MCP startup instructions, `get_workflow`, and generated project/plugin skills. Its short reminder is reused in managed project instructions and lifecycle context/checkpoint prompts. Tool help reinforces the relevant rule at submission, reporting and human-request entry points. Updating project guidance uses the existing conflict-aware installer; it does not silently rewrite old stream scope or titles.

## MCP protocol

Use `get_workflow` for the maintained instructions. The server also supplies startup instructions through MCP. These support client setup; they do not guarantee that a model will follow them.

| Tool                                                     | Purpose                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `submit_stream`                                          | Submit title/outcome/constraints/context with an idempotency key for human intake                                          |
| `list_streams`, `get_stream`                             | Discover streams; read full scope or bounded context/history pages                                                         |
| `create_work`                                            | Submit a change; optional `streamId`, `expectedOutput`, and legacy optional `scopeIntent` metadata                         |
| `list_work`, `get_work`, `add_work_update`               | Original tools; listing also accepts `streamId` or `ungrouped`                                                             |
| `update_stream`                                          | Update current context or `scope` directly using the stream revision; legacy `proposedScope` is retained for compatibility |
| `update_change`                                          | Maintain tracking, dependency assessment, areas/resources/base, and reported progress using the metadata revision          |
| `record_context`, `get_context_entry`, `resolve_context` | Persist decisions/findings/questions/constraints; agents resolve only their own entries                                    |
| `record_output`                                          | Report an MR/document/finding/release link, artifact revision, and available/integrated state                              |
| `claim_change`, `update_claim`                           | Cooperatively claim a caller-selected open undelivered change; renew/release the same credential/session lease             |
| `get_stream_context`                                     | Bounded current summaries for an explicit stream/change; without selection, returns choices                                |

Never infer a stream from a repository path. A project binding supplies explicit IDs. If several streams could apply, ask. Open human actions and human-directed questions precede routine entries in their context collections. Context packages cap their serialized payload at 48 KB including JSON escapes, mark summaries and include dependency/output counts, and provide independent `entries`, `changes`, `humanActions` and `children` nextOffset cursors. Pass those back as `entryOffset`, `changeOffset`, `actionOffset` and `childOffset`; a finished collection can use its total as its offset. `get_stream`, `get_context_entry`, and `get_work` retrieve full records on demand. `get_work` also accepts `part: events` or `part: outputs` for pages beyond the default detail limits.

Tracking revisions are separate from human work revisions. Notes/progress do not invalidate prerequisite assessments. Relevant scope, plan, dependency, or upstream output changes do. An assessment is **unknown**, **current**, or **stale**; assessed independence is different from missing assessment. A current agent assessment is not an application guarantee of conflict-free execution. Save plan changes before assessing. Read the updated change/context, then submit its `tracking.assessmentFingerprint` as `assessmentFingerprint`, alongside `assessDependencies: true` and the metadata revision. If scope, prerequisites, or output evidence changed since that read, the server rejects the assessment. Plan edits and assessment cannot be combined in one write; the plan-update response includes current context for the follow-up assessment. Reordering the same dependency set does not change the plan.

The legacy change-only dependency format records `requiresId`, `stage` (`start` or `integrate`), `condition` (`output_available` or `integrated`), and a reason. Relationships can cross streams. Validation considers start → output → integration stages, rejecting impossible cycles while allowing implementation against an available output before integration. Satisfaction is based on attributed reports; independent SCM observation is not implemented.

`set_prerequisites` replaces typed dependencies with `{target:{id,kind}, revision, dependencies:[{source:{id,kind},stage,condition,reason}]}`. Targets are streams or changes; sources may also be human actions. Stages are `start` or `deliver`. Conditions are change output available/integrated, stream outcome available/accepted, or human action done. Combined stage cycles and containment cycles are rejected independently. Legacy `update_change.dependencies` replaces only change-sourced edges, preserving human/stream gates.

`request_human_action`, `get_human_action` and `withdraw_human_action` maintain requests; agents may withdraw only their own open request with an explanation. `report_stream` records phase/summary/outcome availability using `streamRevision`; legacy review flags do not raise attention. `move_stream` permits reorganization within the same approval boundary, with owner-only cross-boundary moves. `record_stream_output` records stream-level evidence. `get_stream` supports paged `overview`, `human-actions` and `outputs` parts as well as the original parts. Human response, coverage and lifecycle endpoints are not MCP owner tools. The narrow `sync_work` checkpoint operation can relay specific human responses when that connection has the separate chat synchronization permission; the agent remains the attributed actor.

Output creation/revisions use idempotency keys. Revising an existing report for the same source/link also requires its current output `revision`. Reports from different sources remain distinct. Stale metadata/output/scope writes return a conflict and current revision; reload and reconcile.

Claims require an explicit UUID `sessionId`, a caller-generated private `token` (32–120 URL-safe characters), the current metadata revision, and an open undelivered change that was not declined or withdrawn (with open, unpaused ancestors). The default lease is ten minutes, bounded to 1–30 minutes. An immediate SQLite transaction and unique index give one winner per change; exact exclusive-resource names also conflict. File/area overlap is informational. Generate and retain that random token before sending the request. If its response is lost, replay with the same credential/session/token to recover the same claim and expiry, even if routine metadata has since changed. A replay never extends the lease, restarts a released/expired attempt, or gives another credential/session access. Use a new token for an explicit new attempt. Keep the claim token private; it is stored hashed, omitted from lists/details, and only that credential/session can renew/release it. Expiry, revocation, or a human closing the work never starts, retries, fails, or completes execution. Claims cannot stop nonparticipating agents.

## Project setup

In **Connections → Setup → Project workflow**, copy the workflow prompt to your agent after configuring MCP. It gives exact helper/credential paths without exposing credential contents. The helper supports `preview`, `install`, `check`, and `remove`. All require an explicit project and client. A selection is optional; use `--stream-id ID` or `--change-id ID` only when explicitly chosen.

Desktop installs provide `~/Library/Application Support/Work Inbox/bin/work-inbox-workflow`, backed by the bundled Node runtime. No project Node installation is required. For source development, use `node dist/workflow/index.js` and pass `--helper-node /absolute/path/to/node` as well as `--helper /absolute/path/to/dist/workflow/index.js`.

Setup owns a marked instruction section, skill files, a local binding manifest, and local lifecycle hooks for Codex and Claude Code. It preserves unrelated project instructions, servers, permissions, and hooks. Edited managed content produces a conflict instead of being overwritten. Remove restores only managed content; it preserves unrelated edits. The local `.work-inbox/` manifests contain machine paths and selection, never credential bytes; keep that directory out of shared repository commits.

| Client                     | Installed workflow                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex                      | `.agents/skills/work-inbox/SKILL.md`, managed `AGENTS.md` block, local binding; SessionStart, UserPromptSubmit, Stop and Interrupt hooks in `.codex/hooks.json` |
| Claude Code                | `.claude/skills/work-inbox/SKILL.md`, managed `CLAUDE.md` block, local binding, SessionStart, UserPromptSubmit and Stop hooks in `.claude/settings.local.json`  |
| Claude Desktop / other MCP | Existing connection setup, MCP server instructions, and retrievable workflow/context; no unsupported hook promise                                               |

Codex setup also generates an optional skills-only plugin under `.work-inbox/codex-plugin/`, with portable and compatibility manifests and an onboarding skill. It reuses the existing MCP connection; it does not register another server. This bundle is not automatically enabled or published to a marketplace. The project guidance/skill fallback works without plugin installation. Project setup now installs Codex lifecycle hooks; review/trust and observed delivery are separate checks.

Lifecycle hooks use the local helper because MCP may not be ready at startup. The helper records lifecycle metadata, retries queued writes, retrieves bounded context and checks for an explicit structured checkpoint. It does not capture prompts/transcripts, launch work, or infer completion. An unavailable app is never reported as an empty successful context load. See the synchronization guide for recovery and per-session selection.

Setup follows [Codex skills](https://learn.chatgpt.com/docs/build-skills), [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [Claude Code skills](https://code.claude.com/docs/en/skills), and [Claude Code hook documentation](https://code.claude.com/docs/en/hooks), checked November 11, 2026. Capability and loading behavior still need live-client pilots; installed files alone are not proof of delivery.

## Verification and limits

Connection tool activity, installed/current guidance, configured hooks, and last observed context retrieval are separate evidence. Connections shows the last context retrieval when one was observed. Local setup diagnostics suppress MCP connection telemetry and context-read telemetry. A helper/API request proves retrieval, not delivery to a model; a successful SDK client is not proof that the user's Codex or Claude Code session loaded guidance.

Automated checks cover existing-data migration/idempotency, authority, stage cycles, stale writes/assessments, claim exclusivity/expiry/revocation, bounded pagination, safe project setup/removal, HTTP/MCP, browser/mobile flows, and packaged helper/runtime behavior. The stdio pilot saves a decision/question/output/progress/claim, disconnects, then retrieves them from a new SDK client session.

The real local Codex pilot now records project guidance/skill loading, connected workflow/context retrieval, accepted-work claims and releases, pinned dependency assessments, durable findings, and recovery in a second fresh chat without prior chat history. The reconnected development chat also retrieved that saved evidence through the new tools. The pilot exposed ambiguity between work and tracking revisions and between change and claim IDs. Remaining release evidence: actual Codex compaction recovery and real Claude Code startup/resume/compaction. No public marketplace, independent MR synchronization, automatic execution, multi-user hosting, or notarized distribution is included.

## Legacy approval compatibility

Historical accept/decline, coverage and result-review records and owner endpoints remain for compatibility and audit history. They are not part of the current UI or required agent workflow. No migration accepts or declines old work, applies unconfirmed scope, or invents approval evidence. Explicit output/lifecycle prerequisites retain their existing meaning; removing intake chores does not silently satisfy a recorded blocker.
