# Rheo

Keep work streams, agent context, and daily progress connected.

Rheo (REE-oh) is a local Mac app that helps you see what your agents are working toward, how the work connects, and what needs your attention. Continue working in your usual Claude Code or Codex chats; Rheo keeps the goals, decisions, unfinished changes, and handoffs together.

**Private trial 0.9.0 · Apple Silicon · macOS 13+ · Agent workflow 1.6.0**

## Install

Download the [Rheo 0.9.0 private trial](https://github.com/HatchedMango/rheo-work-tracker/releases/tag/v0.9.0). Repository access is required.

1. Download the **macOS arm64 DMG** and **SHA256SUMS**. Compare `shasum -a 256 Rheo-0.9.0-macOS-arm64.dmg` with its checksum entry.
2. Drag **Rheo** into **Applications** and launch it. The app includes its runtime; Node, npm, and a source checkout are not required.
3. Open **Connections → Connect an agent**. Give its setup prompt to Claude Code or Codex on this Mac, then verify a real client tool call and finish the connection.
4. Continue into **Set up existing work** to bring your active projects into Rheo.

The trial is ad-hoc signed and not notarized. macOS or work-device policy may block downloaded copies. Build from source where permitted, or use a Developer ID signed/notarized build when available. Keep device protections enabled.

## Bring your current work with you

Choose **Set up existing work** on a verified connection and add your active project folders. Paste each project's prompt into its existing agent chat.

Your agent uses the current chat and available project context to capture the goal, unfinished work, decisions, blockers, and next step. It checks existing Rheo records before creating anything and installs project tracking while preserving other instructions and settings.

Return to see **Context received** and **Checkpoint saved** for each project. Setup can be closed and resumed. These signals reflect what Rheo received; actual client hook loading and any reload/trust steps still need verification in the client.

Each Mac owns its own work and agent connections. Create a fresh connection on the work Mac and use its local project paths. There is no cross-device sync or automatic import of old chat history. See the [second-Mac guide](docs/second-mac-trial.md).

## Follow progress throughout the day

- **Streams** groups work around concrete goals. Active work appears in a map, with finished work in a compact list below it. Select either to follow its related chats and context. Arrows show active prerequisites; finished cards have no outgoing arrows, and recorded relationships remain in the details.
- **Needs you** focuses on the exact question or action, with steps, a copyable instruction, and a short reason when useful. Answer in your agent chat; permitted agents can reconcile the response.
- **Start / Resume** prepares new work with focused context or returns to the chat for the same unfinished change. Opening a chat does not mark work started or done.
- **Changes today** counts each change once at its first delivery or manual completion. Set a daily target and see exact progress above it. Answering questions, signing in, and other human unblock steps do not earn change credit. [Counting details](docs/daily-progress-goal.md).
- **Connections** manages local agent access and project tracking. A successful connection is separate from observing fresh context and saved checkpoints.

Rheo records shared context and progress. Agents execute work through their usual chats and permissions. Group membership expresses contribution; prerequisite arrows express actual ordering or required outputs.

Close the window to keep local intake available. **Quit Rheo** (⌘Q) stops the app and service. **Launch at Login** is optional. The Mac must be awake with Rheo running for its agents to reach it.

## Back up and update

Data and credentials live outside the app bundle. Before updating, quit Rheo and back up the **entire data directory**, then replace the app and reopen it. Existing work, connections, and stable launchers are preserved. Retain the matching prior app and stopped-data backup for rollback; a migrated database cannot be downgraded by replacing the app alone.

See [storage and packaging](docs/desktop.md), [backup and restore](docs/second-mac-trial.md#back-up-update-and-restore), and [upgrade compatibility](docs/rheo-branding.md). Keep private data, credentials, and machine-specific project bindings outside Git and shared artifacts.

## Develop

Use Node **22.18.0** from `.nvmrc` and npm. Building the Mac app also requires Xcode Command Line Tools; SQLite includes a native component.

```sh
npm ci
npm run setup
npm run build
npm start
```

The source app runs at **http://127.0.0.1:4310**. Quit the desktop app first if it uses that port. `npm run dev` starts the development UI at **http://127.0.0.1:5173** with the same backend. Source installs start empty; `npm run demo` explicitly creates labeled examples.

Build and verify the standalone Mac app:

```sh
npm run desktop:build
npm run desktop:verify
npm run release:check
```

Artifacts include `release/Rheo.app`, versioned ZIP/DMG files, build provenance, and checksums. Release verification requires a clean Git checkout and matching runtime. See [desktop packaging](docs/desktop.md) and [private publishing](docs/publish-private-trial.md).

Run the source checks:

```sh
npm run repo:check -- --history
npm run format:check
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

Tests use isolated data and ports. GitHub **Checks** runs source/browser validation; the manually dispatched **Mac trial package** workflow verifies and retains a private installer artifact set. Neither workflow publishes releases automatically. Use a redacted secret-content scan in addition to the repository path check before publishing.

## Guides

- [Existing-work onboarding](docs/existing-work-onboarding.md)
- [Agent workflow and reporting](docs/agent-workflow.md)
- [Lifecycle checkpoints and recovery](docs/synchronization.md)
- [Desktop storage, import, and packaging](docs/desktop.md)
- [Architecture](docs/architecture.md)

The private trial grants no open-source license. Dependency/runtime notices are included in the Mac bundle. Local automated checks do not establish fresh-machine installation, work-device policy, or real-client automatic hook behavior; those remain trial observations to collect.
