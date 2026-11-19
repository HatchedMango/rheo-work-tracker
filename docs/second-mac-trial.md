# Try Rheo on your other Mac

This trial targets an Apple Silicon Mac running macOS 13+. It creates separate work on that Mac. GitHub hosts the source/installer; it does not host or synchronize the inbox.

## Install and connect

1. Obtain the versioned DMG/ZIP and matching `SHA256SUMS` from the private GitHub prerelease, once published. Only people with access to the private repository can download it. Compare `shasum -a 256 Rheo-0.9.0-macOS-arm64.dmg` with its checksum entry. If all listed files were downloaded together, `shasum -a 256 -c SHA256SUMS` checks the set.
2. The trial is ad-hoc signed and not notarized. If macOS or device management blocks it, build from the private source checkout on this Mac if permitted, or wait for a Developer ID signed/notarized build. Do not disable Gatekeeper, strip quarantine flags or change work-device security policy for this trial.
3. Drag Rheo into Applications and launch it once from there. First launch creates local data under `~/Library/Application Support/Work Inbox/`; it should not display the first Mac's streams or connections.
4. Open Connections and create a new connection. Give the setup prompt to Codex or Claude with configuration access on this Mac. Preserve other MCP servers. Verify using the actual client's `list_work` tool; an initially empty inbox is expected. Finish the connection only after that succeeds.
5. Continue with **Set up existing work** below to bring in active projects. Review supported hooks in the client and reload/start a new chat as required. Keep generated manifests, skills and hook settings local. Use this Mac's project folders and fresh local connection.

There is no separate execution worker. Your usual agent executes work under your chat instructions; Rheo provides context and a human view.

## Bring your current work into Rheo

After verifying the agent connection, **Set up existing work** opens automatically for Claude Code and Codex. You can reopen it from the connection card.

1. Paste the full paths of the project folders you want to track, one per line. On a Mac, select a folder in Finder and press Option–Command–C to copy its path. Choose up to ten; Rheo validates folders and combines duplicate/symlink paths.
2. Prepare the project prompts. Open each project's existing agent chat and paste its own prompt. Using the current chat gives the agent the context it already has; Rheo does not crawl private transcript history.
3. The agent checks the actual MCP connection, reads available project context and compares existing streams/changes before creating anything. It records the current goal, unfinished work, decisions, blockers and next step, then previews/installs project tracking with explicit record IDs. It preserves existing guidance, hooks and client settings, and asks only when the goal or matching records are ambiguous.
4. Return to the setup dialog. **Context received** and **Checkpoint saved** reflect observations since setup began for that exact connection/project. A newer turn or pending writes means the latest checkpoint is still needed. Helper installation and these observations do not independently certify that every client hook has run; the agent reports remaining reload/trust steps.

Preparing or copying a prompt creates no streams, changes, completion credits or project-file edits. The agent adopts only real unfinished work; completed history stays context, and human unblock steps remain human actions. Closing/reopening resumes the local draft, which contains only project paths and the setup start time. Repeating a handoff should reconcile existing records rather than duplicate them.

This brings work already on the second Mac into its own Rheo installation. It does not transfer the first Mac's work, credentials, repositories or chats. The actual work-Mac agent/hook behavior must still be verified there.

## Try one real piece of work

Use a modest real change in another project, with the usual short approach and verification plan. Let the agent track a recognizable outcome, a bounded change and explicit start/delivery dependencies (including a justified none or uncertainty). Routine iterations should reuse that change rather than create a task per test run.

Observe and record:

- Can you recognize the stream goal and see its work and relationships immediately?
- Does a fresh chat recover the same goal, approach, useful failed attempts and next step?
- Does the actual client expose `review_dependencies`, `assess_dependencies` and `claim_change.purpose=implementation`? Advertised server capabilities and helper tests do not prove this.
- Does a real question/action appear once, then clear when answered in chat with the permitted exact-request relay? No question should be invented just to test the UI.
- After a client interruption, resume and compaction, is unfinished work still unfinished and current context recovered? Missing or conflicted checkpoints must remain visible.
- Do repeated stops avoid recurring checkpoint continuations? If an external runner owns the loop, explicitly enable helper `mode --stop-policy observe` for that native session as described in synchronization.md.
- Does closing the Rheo window leave intake available, and does explicit Quit stop it? After reopening the app/client, can the agent still list the same work?

An observation on this Mac is new evidence. Local source, SDK and native-helper tests performed on the development Mac do not establish these results.

## Back up, update and restore

Quit Rheo with ⌘Q before copying data. Copy the entire `~/Library/Application Support/Work Inbox/data/` directory to a private dated backup outside any repository, and keep the matching app version. The folder contains work and protected credentials; do not upload it to GitHub or share it in diagnostics. Use Finder's Go to Folder for the Library path.

For an update, retain that backup, replace the app in Applications, and open it. Confirm work and connections remain, then use the connected client to list work. Login registration may need re-enabling after moving/replacing the app. The existing stable MCP launcher should keep working; do not delete old source/runtime paths while clients still reference them.

For a same-Mac restore, quit the app, retain the current data folder separately, restore the **whole** stopped-data backup to its original location, and use the matching app version. Reopen and verify work/connection access. Do not merge live databases or copy only `work.sqlite` while the app runs. A migrated database cannot be downgraded by simply installing an older app. Backups can contain older credential revocations/settings: review connections after restoring. Separate Macs should retain separate backups and fresh credentials.

## Release and source verification

The bundle contains `Contents/Resources/BUILD_INFO.json`. The sibling `.build.json` records version, source commit/dirty state, Node runtime, architecture, minimum macOS, signing state and build time without local usernames, paths or credentials. `notarized:false` is intentional for this trial. Checksums identify the exact downloadable bytes; they are not a signature or independent proof of safety.

Build a release from a clean Git checkout using `.nvmrc`, `npm ci`, `npm run desktop:build`, `npm run desktop:verify` and `npm run release:check`. Publish only the versioned ZIP/DMG, matching build metadata and `SHA256SUMS`, never the application data or the whole working directory. GitHub's manually dispatched package workflow produces the same artifact set without publishing it.

Developer ID signing/notarization, actual second-Mac install/download behavior and a real agent workflow remain separate checks until observed. An Apple Development certificate is not a Developer ID distribution identity. The private trial does not decide the project's public license.
