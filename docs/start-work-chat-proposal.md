# Start new work and resume the same unfinished work

Implemented default authorized November 14, 2026. This replaces the earlier proposal to let people choose a context strategy.

## Product behavior

An unfinished change exposes **Start work** or **Resume work** on its Map/List card, in the selected-work inspector, and on change detail. The app decides the context strategy. The dialog does not offer a fresh-versus-related-thread choice.

Start prepares a fresh chat and a focused current brief. Resume uses the most recently observed active-credential session that is still explicitly selected on this exact change in its current stream, with an available project folder. A session that moved to different work is history. Disconnected, expired, moved-project or invalid option-like native identities do not become an automatic resume destination. Finished/declined/withdrawn work retains historical links without a start action.

Project folders and client defaults come from explicit workflow/session bindings in the selected stream. When the stream has no known project or spans multiple folders, the user supplies an absolute existing local project folder. The app does not infer a stream binding from a repository path. Client selection is a destination preference, not an override of the context strategy. Resume keeps its session's client and project.

## Focused brief and real activity

The bounded brief identifies the selected change/stream, goal, intended result, success criteria, scope constraints, latest reported progress, real prerequisites, current output references and (for Resume) the retained same-task handoff. It instructs the agent to reload live workflow/work context, select the change for its actual native session through the existing helper, preserve the project default binding, retrieve relevant decisions and repository evidence just in time, and follow real readiness/claim checks. It separates stored work data from instructions and explicitly discloses shortened snapshot fields. Other changes' transcripts and arbitrary stream-wide history are not inherited.

Preparing, copying or opening a handoff writes no work progress, claim, session association or completion. Those follow actual agent selection and attributed reporting. Drafts are not sent automatically. Existing lifecycle hooks and credential permissions are unchanged.

## Client handoff

Codex Start uses the documented `codex://new?prompt=...&path=...` route to open an unsent draft. The native shell permits only this narrow user-clicked route with exactly bounded prompt/path fields, alongside the existing validated thread route. Stored content links still cannot mint draft URLs, settings, plugins or command routes.

Codex Resume opens the existing validated chat. The dialog provides a refreshed brief to copy and paste because the documented existing-chat route cannot prefill its composer. Lifecycle recovery remains complementary; automatic hook delivery is not inferred from a link opening. Unsupported native identities keep the copy-ID fallback.

Claude Code supplies a safely quoted interactive start or exact-session resume command containing the brief, for the person to run in their terminal. The app never executes shell commands or changes permission modes. Clipboard failures leave selectable text available.

Primary references checked November 14: [Codex deep links](https://learn.chatgpt.com/docs/reference/commands), [Claude Code CLI](https://code.claude.com/docs/en/cli-reference). These describe supported handoff mechanisms, not a guarantee that a local client retains every historic chat.

## Verification

Service/API tests cover new-versus-same-task routing, another task's history, disconnected credentials, invalid/absent project folders, multi-project ambiguity, current brief contents, safe prompt encoding/command quoting, finished-work rejection, owner-only endpoints and Origin checks. Browser coverage verifies Start and Resume labels, unsent draft target/context, project recovery, provider handoff, copied refreshed brief, exact existing-chat link, keyboard/modal and mobile behavior, and no progress/association from preparation. Existing card-surface and connector checks remain required. The packaged native verifier exercises the actual Swift destination validator, including rejection of unrelated routes and extra query parameters.

## Delivery and observed limits

Implemented and installed in the local 0.8.1 preview on November 14. Final checks: 131 backend tests across 17 files, all 19 browser scenarios, typecheck/format/diff, the six packaged native verification groups and the additional actual-Swift destination allowlist check passed. An initial legacy concurrency test timed out during an unusually long run; it passed both an isolated rerun and the final full suite. Browser screenshots of Start/Resume and 390px layouts were inspected.

A separate source snapshot preserved the clean private-trial installers. Previous installed app and stopped data are backed up at `~/Library/Application Support/Work Inbox/backups/start-resume-work-20261114T204826Z`. Before post-install reporting, all 32 existing database tables matched, foreign keys were clean and protected connection/client-setting metadata was unchanged. No schema migration, new credential, automatic execution, commit or publication was added.

Observed the installed native work cards with automatic Start and Resume actions and a populated fresh-work handoff for the actual project. Clicked its documented draft link without sending anything. The computer-use tool refuses access to `com.openai.codex` for safety reasons, so the resulting Codex composer could not be inspected; no bypass was attempted. Actual composer rendering and Claude terminal execution remain unverified. Existing-chat composer prefilling is not supported by the documented route; Resume exposes the refreshed brief for copying/pasting rather than pretending to inject it automatically. Live lifecycle hook delivery remains a separate verification limit.
