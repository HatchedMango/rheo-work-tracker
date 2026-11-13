# Try Work Inbox on your other Mac

This trial targets an Apple Silicon Mac running macOS 13+. It creates separate work on that Mac. GitHub hosts the source/installer; it does not host or synchronize the inbox.

## Install and connect

1. Obtain the versioned DMG/ZIP and matching `SHA256SUMS` from the private GitHub prerelease, once published. Only people with access to the private repository can download it. Compare `shasum -a 256 Work-Inbox-0.8.1-macOS-arm64.dmg` with its checksum entry. If all listed files were downloaded together, `shasum -a 256 -c SHA256SUMS` checks the set.
2. The trial is ad-hoc signed and not notarized. If macOS or device management blocks it, build from the private source checkout on this Mac if permitted, or wait for a Developer ID signed/notarized build. Do not disable Gatekeeper, strip quarantine flags or change work-device security policy for this trial.
3. Drag Work Inbox into Applications and launch it once from there. First launch creates local data under `~/Library/Application Support/Work Inbox/`; it should not display the first Mac's streams or connections.
4. Open Connections and create a new connection. Give the setup prompt to Codex or Claude with configuration access on this Mac. Preserve other MCP servers. Verify using the actual client's `list_work` tool; an initially empty inbox is expected. Finish the connection only after that succeeds.
5. Use Project workflow setup for a project you want to try. Select its stream/change explicitly, review supported hooks in the client and reload/start a new chat as required. Keep generated manifests, skills and hook settings local. Do not reuse the first Mac's protected credential file or absolute paths.

There is no separate execution worker. Your usual agent executes work under your chat instructions; Work Inbox provides context and a human view.

## Try one real piece of work

Use a modest real change in another project, with the usual short approach and verification plan. Let the agent track a recognizable outcome, a bounded change and explicit start/delivery dependencies (including a justified none or uncertainty). Routine iterations should reuse that change rather than create a task per test run.

Observe and record:

- Can you recognize the stream goal and see its work and relationships immediately?
- Does a fresh chat recover the same goal, approach, useful failed attempts and next step?
- Does the actual client expose `review_dependencies`, `assess_dependencies` and `claim_change.purpose=implementation`? Advertised server capabilities and helper tests do not prove this.
- Does a real question/action appear once, then clear when answered in chat with the permitted exact-request relay? No question should be invented just to test the UI.
- After a client interruption, resume and compaction, is unfinished work still unfinished and current context recovered? Missing or conflicted checkpoints must remain visible.
- Do repeated stops avoid recurring checkpoint continuations? If an external runner owns the loop, explicitly enable helper `mode --stop-policy observe` for that native session as described in synchronization.md.
- Does closing the Work Inbox window leave intake available, and does explicit Quit stop it? After reopening the app/client, can the agent still list the same work?

An observation on this Mac is new evidence. Local source, SDK and native-helper tests performed on the development Mac do not establish these results.

## Back up, update and restore

Quit Work Inbox with ⌘Q before copying data. Copy the entire `~/Library/Application Support/Work Inbox/data/` directory to a private dated backup outside any repository, and keep the matching app version. The folder contains work and protected credentials; do not upload it to GitHub or share it in diagnostics. Use Finder's Go to Folder for the Library path.

For an update, retain that backup, replace the app in Applications, and open it. Confirm work and connections remain, then use the connected client to list work. Login registration may need re-enabling after moving/replacing the app. The existing stable MCP launcher should keep working; do not delete old source/runtime paths while clients still reference them.

For a same-Mac restore, quit the app, retain the current data folder separately, restore the **whole** stopped-data backup to its original location, and use the matching app version. Reopen and verify work/connection access. Do not merge live databases or copy only `work.sqlite` while the app runs. A migrated database cannot be downgraded by simply installing an older app. Backups can contain older credential revocations/settings: review connections after restoring. Separate Macs should retain separate backups and fresh credentials.

## Release and source verification

The bundle contains `Contents/Resources/BUILD_INFO.json`. The sibling `.build.json` records version, source commit/dirty state, Node runtime, architecture, minimum macOS, signing state and build time without local usernames, paths or credentials. `notarized:false` is intentional for this trial. Checksums identify the exact downloadable bytes; they are not a signature or independent proof of safety.

Build a release from a clean Git checkout using `.nvmrc`, `npm ci`, `npm run desktop:build`, `npm run desktop:verify` and `npm run release:check`. Publish only the versioned ZIP/DMG, matching build metadata and `SHA256SUMS`, never the application data or the whole working directory. GitHub's manually dispatched package workflow produces the same artifact set without publishing it.

Developer ID signing/notarization, actual second-Mac install/download behavior and a real agent workflow remain separate checks until observed. An Apple Development certificate is not a Developer ID distribution identity. The private trial does not decide the project's public license.
