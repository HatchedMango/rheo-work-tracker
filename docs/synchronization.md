# Workflow synchronization

Introduced in 0.3.2 / workflow 1.3.0: structured checkpoints and local lifecycle adapters. Current 0.8.0 / workflow 1.6.0 adds cooperative loop guidance and lifecycle behavior to explicit dependency reports; question/action feedback remains the active flow, while legacy decision relays remain for compatibility. This implements the synchronization portion of the planning-and-decisions proposal. Explicit staged assessments use `review_dependencies` and `assess_dependencies`; ordinary progress checkpoints and older boolean assessments do not certify that contract. Immutable human-readable plan versions and the broader request/navigation redesign remain separate work.

## What synchronizes

`sync_work` saves one explicit checkpoint in a SQLite transaction: a concise summary, optional selected-change progress, optional stream summary, findings, and exact human responses. Related approval/answer/action transitions use the same services as local UI responses; attention counts and prerequisites are derived from the resulting state. If any expected revision conflicts, the whole checkpoint rolls back. Retrying the identical event ID returns its original receipt; a different payload with that ID conflicts.

Every change still needs a proportionate understanding, approach, and verification before edits. Checkpoints record what actually happened, including “no tracked changes”. A lifecycle event is never interpreted as plan approval, delivery, or completion. Only actual question/action responses belong in the current workflow; legacy acceptance/direction/scope responses remain compatibility APIs; a plan document mentioned in a summary does not become a versioned plan approval object.

Feedback is opt-in per connection: **Connections → Sync decisions from my chats**. It permits reported answers and human-action progress/completion (plus historical decision APIs for compatibility, not current approval chores) for the explicitly selected stream. It does not allow agent execution, final work/stream completion, connection administration, or arbitrary owner actions. The reporting agent remains the actor, with native client/session and optional message reference retained. A relayed access report is `reported` prerequisite evidence, not independently verified access. Plain agent API calls retain their previous owner-only restrictions.

This trusts the enabled agent to relay human statements faithfully; MCP cannot authenticate the human's chat statement independently. Revoking relay permission blocks future response transitions without removing history. Existing connections start with relay disabled, and their protected credential files are unchanged.

Local administrators can explicitly enable/disable one connection without reading its credential file:

```sh
WORK_INBOX_DATA_DIR='/absolute/application/data' node dist/cli/index.js sync-feedback CONNECTION_ID on
```

## Lifecycle adapters

Run the existing conflict-aware workflow setup from Connections. Both Codex and Claude Code get `SessionStart`, `UserPromptSubmit`, and `Stop` command hooks; Codex also gets `Interrupt`. Session startup/resume/compaction loads bounded context for the explicit selection. The first prompt also recovers full bounded context if startup delivery was missed. Later prompt hooks use a compact refresh (at most 8 KB): selected goal/progress, plan revisions, assessment state, current claim, and a bounded set of open questions/actions. It is explicitly incomplete, not a dependency review; retrieve full context/pages after relevant drift. Startup/resume/compaction always recover full bounded context, with the latest saved checkpoint. Stop checks for a saved checkpoint; a missing checkpoint can request one continuation. A private durable marker suppresses repeats across process restarts, new continuation turns, resume and compaction until a checkpoint is recorded, even when the client omits its repeat flag. Stop checks and conflicts are scoped to the native session; another chat’s pending writes do not trigger its reminder. Interrupt queues its event durably, uses a short network budget and a supported three-second Codex timeout, and never prevents the interruption or restarts work.

Codex hooks merge into `.codex/hooks.json`; Claude hooks merge into `.claude/settings.local.json`. Other integrations, including Herdr hooks, are preserved. Edited managed hooks cause setup to refuse an update/removal rather than overwrite them. Hook definitions are installed, not silently trusted; use the client's hook review controls and a fresh session. The helper works before MCP is ready. Unsupported clients retain explicit MCP workflow/context retrieval.

Hook input is reduced to lifecycle/session/turn metadata. Prompt bodies, assistant text, transcript paths and transcripts are not persisted or uploaded. The native conversation session identity used for synchronization is separate from the UUID/private token used for cooperative claims.

The project manifest provides a default explicit selection. To work on another explicitly selected item in the same chat, keep the project manifest/pilot intact and set a private per-session override:

```sh
work-inbox-workflow select --binding /PROJECT/.work-inbox/codex.json --session-id SESSION --stream-id STREAM --change-id CHANGE
```

Selection loads fresh context, clears that session's old checkpoint freshness, and grants no approval. Delayed writes for an older selection conflict rather than land on the newly selected work. Do not infer a selection from the project path.

## External loops and session state

Use one useful change across implement/check/revise iterations, a proportional saved approach, and one retained private cooperative claim identity. Renew the claim while participating; reassess when relevant context changes, not for every tool call. Save meaningful results, verification evidence, useful failed approaches and a next step in existing checkpoint/findings/output fields. A stopped loop, runner limit, interruption or expired claim never delivers work or creates a human request.

For a session controlled by an external runner, explicitly enable observe mode **before starting its loop**:

```sh
work-inbox-workflow mode --binding /PROJECT/.work-inbox/codex.json --session-id SESSION --stop-policy observe
```

Substitute `claude-code.json` for Claude Code. The mode applies only to that native session and survives resume; other sessions keep their own policy. To restore the ordinary reminder, set `--stop-policy checkpoint-once`. Observe mode records events and warns about unsynchronized progress, without emitting `decision`, `continue` or Stop additional context that could restart a client. Neither mode emits `continue:false`; the client/runner keeps control of continuation, budgets, retries and stop reasons. Rheo does not discover runners or configure them automatically. It adds no execution runner or task per iteration.

Private state lives in per-session hashed files with atomic writes and a short cooperative lock; legacy `sessions.json`/`selection.json` are read as migration fallbacks and preserved. Native turn IDs are retained; Claude sessions without native turn IDs receive a synthetic ID per prompt. Older turn Stop/Interrupt notifications do not roll back current local/server state. An interrupted helper can leave a durable queue; queued does not mean saved.

`get_workflow.capabilities` advertises required tools and fields. Once per actual client session, the agent checks its connected catalog for `review_dependencies`, `assess_dependencies`, and `claim_change.purpose=implementation` alongside context and claim-update tools. Missing schemas require a reload/new chat; legacy collaboration does not silently certify managed readiness. Server metadata, standalone SDK probes and helper tests cannot establish what that chat has loaded or whether trusted lifecycle hooks automatically ran.

## Pending writes and recovery

Both the MCP tool and local helper write events to a private local outbox before sending them. Directories are mode 700; files are mode 600, written atomically after flushing file contents. Credentials remain in their existing protected file; queues contain no token. Default storage is `~/.local/state/work-inbox/sync/`, partitioned by credential path, project and client. Tests can override `WORK_INBOX_SYNC_HOME`.

Each invocation makes a bounded flush. Connection failures/timeouts retain writes for the next lifecycle/tool invocation; a successful server write with a lost response replays safely. A flush lock prevents concurrent sends; dead helper locks are recoverable. Closing the client does not run an independent retry daemon: queued writes resume on the next invocation or explicit retry.

Validation/permission/revision conflicts are retained as `.conflict` files and reported as needing reconciliation. They are not retried against a newer revision automatically. Inspect the explicit request and current work, then submit a corrected checkpoint with `reconciles: [EVENT_ID]` and an explanation in its summary. Only after that checkpoint is saved does the local helper archive the original event as `.resolved`. Another session's conflicts cannot be cleared that way.

```sh
work-inbox-workflow outbox --binding /PROJECT/.work-inbox/codex.json
work-inbox-workflow retry --binding /PROJECT/.work-inbox/codex.json
```

If a current chat has an older MCP tool catalog, save the checkpoint object in a private temporary JSON file and use the same adapter:

```sh
work-inbox-workflow checkpoint --binding /PROJECT/.work-inbox/codex.json --input /PRIVATE/checkpoint.json --session-id SESSION
```

For source use, replace `work-inbox-workflow` with `node dist/workflow/index.js`. A minimal input is `{"summary":"Approach reviewed; implementation has not started."}`. A progress update also needs `change: {revision, progress, note}` for the selected change. Never reuse a human work revision for its tracking revision. Check `recorded`, `pending` and `conflicts` in the result; queued or rejected is not synchronized.

## Freshness and limits

Connections and stream detail distinguish last context retrieval, last saved progress checkpoint, and an update needed for the latest observed turn. Pending counts are explicitly “at last check”: the server cannot see an offline client's new queue until that client reconnects. MCP verification means connectivity, not current progress. Stored checkpoint summaries are agent reports, not a guarantee that all real-world work was reported.

Hook support follows [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) and [Claude Code hooks documentation](https://code.claude.com/docs/en/hooks), checked November 13, 2026. Local adapter tests prove protocol and recovery behavior; actual client trust/loading and fresh-session delivery must be verified separately. No Herdr focus adapter, transcript observer, background execution worker, or automatic Git/SCM observation is introduced.
