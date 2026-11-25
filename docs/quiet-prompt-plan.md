# Keep unchanged prompts small

The receiving-machine review found that workflow1.10 repeats its compact current-work snapshot and last checkpoint on every prompt. Retain the graph, readiness, selection, outbox, claim and recovery contracts while reducing this repeated model input.

- Emit a small unchanged-prompt heartbeat with native session/turn identity, explicit selection, session intent, checkpoint need/time and assessment state. Do not repeat work descriptions, project paths, checkpoint prose or setup instructions when unchanged.
- Compare checkpoint content privately and send its bounded summary only when changed. Keep all hashes and comparison state helper-owned; never require the model to remember a cursor or estimate whether its context was lost.
- Keep full startup/resume/compaction and semantic-drift recovery, plus the existing eighth-prompt safety recovery because client consumption is not independently acknowledged. A failed recovery does not advance the baseline, and outdated turn/selection responses remain discarded.
- Surface pending/conflicted writes and meaningful owned-lease maintenance, including failures. Do not convert an unchanged snapshot into readiness, delivery, or synchronization evidence.
- Keep both reading and tracked sessions small. Existing legacy-server fallback, Stop/Interrupt behavior, exact revisions, claim validation and daily-count semantics remain unchanged. Repository commands, notification adapters, MCP profiles and issue-provider integration are outside this correction.

Verify with heavy-field fixtures, explicit quiet-byte budgets, changed checkpoints, decisions outside clipped summaries, periodic/start/resume/compaction recovery, private-state loss, offline/conflict and turn/selection races. Run the existing service/browser regressions and an isolated packaged Mac check. Preserve unrelated local files, installed integrations, credentials and released assets; no commit, push, install or release is part of this pass.

## Result and verification

Implemented in unreleased workflow1.11. Quiet prompts emit a short heartbeat rather than repeating selected-work descriptions, project paths, setup guidance and saved checkpoint prose. The heartbeat retains current session/turn identity, explicit selection, intent, checkpoint need/time and assessment state; it remains incomplete context rather than readiness certification. Changed checkpoint text is sent once, bounded to1000characters with shortening disclosed. Re-saving identical text changes only the timestamp metadata.

The helper owns all fingerprints. Semantic or binding drift, missing comparison state, startup/resume/compaction and the existing eighth-prompt fallback still recover bounded context. A failed recovery leaves the baseline unchanged. Turn/selection fences, pending/conflict warnings, owned-lease results and older-server fallback remain in place. No graph, assessment, outbox, permission or completion-count service was changed.

On November25, all189 service/unit/integration tests across23files passed, including heavy reading/working fixtures whose quiet context is below512bytes and entire hook response below640bytes with UUID identities. Coverage includes checkpoint changes and identical-text saves, decisions beyond compact summaries, binding drift, periodic recovery, failed recovery, conflicts and unavailable freshness. All28browser scenarios and nine packaged Mac verification groups passed, including a fresh-process quiet-prompt byte assertion with the bundled runtime. Typecheck, formatting, whitespace, repository-path and source-only redacted secret checks passed.

Validation used an isolated ad-hoc-signed Mac snapshot. Installed integrations and released installers were preserved. Real client consumption is not independently acknowledged, which is why periodic recovery remains instead of asking the model to guess when it lost context. Unrelated local output files were excluded from the snapshot. No commit, push, install or release was performed as part of this pass.
