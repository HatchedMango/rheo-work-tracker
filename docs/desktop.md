# Mac desktop packaging

The Mac app provides a dedicated native window and menu-bar controls around the shared Fastify/React/SQLite application. It starts a private bundled Node process and displays the existing UI using macOS WebKit. The shared work rules and backend are unchanged; no execution worker or bundled Chromium is added.

## Framework decision

The initial packaging investigation considered Tauri with a Node sidecar. Tauri explicitly supports shipping a Node runtime and JavaScript resources, but it would still require the same runtime/native SQLite packaging. AppKit provides the Mac menu/lifecycle, and a WKWebView provides the dedicated window using the system WebKit engine. This keeps the native shell small and avoids adding Rust or bundled Chromium. Most download/disk size is the bundled Node runtime and production dependencies. Electron remains unnecessary for this scope. The initial browser-launcher-only version was replaced by the dedicated window at the user's request.

The packaging proof uses the exact building Node executable, production dependencies from the npm lockfile, the matching better-sqlite3 addon, built UI, and SQL migrations. Source maps, development dependencies, and other-platform native addons are excluded. The project LICENSE and NOTICE are included in Contents/Resources and the app payload; dependency licenses and the Node distribution license remain separate and are also included. Dynamic dependencies of the bundled native binaries are macOS system libraries/frameworks.

References: [Tauri Node sidecars](https://v2.tauri.app/learn/sidecar-nodejs/), [Apple menu-bar items](https://developer.apple.com/documentation/appkit/nsstatusitem), [Apple login services](https://developer.apple.com/documentation/servicemanagement/smappservice).

## Build and verify

Build on macOS with Node 22.18+, npm, and Xcode/Command Line Tools installed:

```sh
npm ci
npm run desktop:build
npm run desktop:verify
```

Artifacts are `release/Rheo.app`, versioned architecture-specific ZIP/DMG files, a sibling `.build.json` provenance file, and `release/SHA256SUMS`. The bundle also contains `Contents/Resources/BUILD_INFO.json` with the source revision/dirty state, runtime, architecture, version and signing status; it contains no local paths or credential values. The current verified architecture is arm64; the bundle targets macOS 13+. Intel builds require a matching Intel Node runtime, native addon, and validation on Intel hardware. Build output is ignored by Git.

The desktop verification script launches the actual native executable with a system-only PATH, temporary data, and a working directory outside the repository. It imports isolated fixtures, calls the real packaged MCP tool, checks scopes/permissions, duplicate prevention, port conflicts, graceful shutdown, parent-crash cleanup, persistent work, clean first launch, and an unchanged MCP command after moving the app. It also exercises AppKit background launch and deferred shutdown to catch native event-loop deadlocks. It never submits sample work to the user's installation. This simulates a clean installation; it does not replace testing on another macOS account/machine or validate Gatekeeper/notarization.

## Lifecycle and storage

- `desktop/main.swift` owns menu-bar behavior, optional login registration, and the child process. `desktop/InboxWindow.swift` owns a single retained AppKit/WKWebView window. Closing the window leaves the service running; opening the app again restores the same window and navigation state. The window appears in the Dock/⌘Tab when opened and supports normal Edit shortcuts, ⌘W, ⌘Q, and ⌘R. Background/login launches do not open a window until requested.
- The embedded view loads only the exact loopback origin. User-clicked HTTP(S) references and documentation open in the default browser. Other navigation schemes, programmatic external navigation, and external content inside the window are blocked. There is no native JavaScript message bridge. The view uses WebKit's persistent site-data store; automatic local sessions still come from the existing origin-protected API. JavaScript confirmations use native window sheets. ATS allows local networking without permitting arbitrary insecure remote loads.
- A kernel advisory lock prevents duplicate native processes for the same application data directory. A separate backend PID lock prevents duplicate direct host launches and detects stale processes. An unrelated service on the configured port produces an error; it is never adopted or killed.
- `src/desktop/host.ts` owns desktop storage preparation and starts the shared server. A pipe tied to the native parent stops Node when the launcher crashes. Normal Quit signals the server to close HTTP and SQLite before the launcher exits. Startup failures remain visible through the menu; Restart can retry.
- `src/server/start.ts` is shared with the ordinary headless server. Loopback binding, origin isolation, automatic local sessions, source scopes, and server-enforced Inbox intake remain in place.
- Data: `~/Library/Application Support/Work Inbox/data/`. Logs: `logs/service.log` beneath the same application-support root (rotated above 2 MB). Directories are owner-only, and databases/credentials/logs are not group/world readable.
- The stable MCP executable is `bin/work-inbox-mcp` beneath that root. A private atomic `current` symlink points to the running app resources. Launching an updated/moved app refreshes the pointer; generated client commands do not change. The shim clears inherited Node injection options and sets its fallback data directory. Credentials are referenced by protected file path, never embedded in commands/configuration.
- Launch at Login uses the operating system's login service, is opt-in, and may require approval in System Settings. Moving/replacing an app may require re-enabling that registration. Login launches are handled in the background; an explicit Open action opens the dedicated window.

Do not run the source server and desktop app on port 4310 simultaneously. The launcher intentionally refuses that conflict. The app must be launched once from its final installed location before using its MCP command. Removing the app makes the launcher unavailable but does not delete work or credentials. Back up the data folder while the app is stopped, or use a consistent SQLite online backup.

## Import existing local data

Quit the previous server. Import Existing Data selects the folder containing its work.sqlite. Import refuses to overwrite a destination with work, source credentials, or managed connections. A staged SQLite online snapshot is migrated using the current SQL migrations, and managed credential files are copied with their tokens unchanged and paths updated in the copied database. Any missing active credential aborts before the destination is replaced. The complete data directory is swapped together; a private recovery marker handles interruption between renames. The prior empty destination is retained under backups. Original data and credentials are never modified or deleted.

Existing MCP configurations deliberately remain unchanged. The old bridge still authenticates against the copied database on the same local port, so existing clients can continue using it. Before deleting the old repository/runtime, use Connections → Setup and migrate that server entry to the stable desktop command and protected credential path. Follow the client's configuration/reload procedure and verify with its actual list_work tool. Do not infer client verification from a standalone packaging check.

For automated isolated checks, the native executable supports `--headless`, `--background`, and a one-time `--import-data <folder>` argument. `WORK_INBOX_DESKTOP_HOME` and `WORK_INBOX_DESKTOP_PORT` isolate tests; these are not needed for normal installation. The original source/server `WORK_INBOX_DATA_DIR` behavior is unchanged.

## Updates and public distribution

Quit the app, replace it with the new bundle, and open it again. Work and connections stay outside the bundle, and the stable MCP pointer is refreshed. Current SQL migrations run on startup. Back up before schema-changing upgrades; downgrading a migrated database is not supported. This version uses manual replacement and does not fetch/install updates automatically.

Without `MAC_SIGNING_IDENTITY`, builds are ad-hoc signed for local development. The build verifies the nested signatures. For public distribution, supply a Developer ID Application signing identity, sign with hardened runtime (Node JIT entitlements are provided), submit to Apple's notarization service, staple the ticket, and verify Gatekeeper on a clean Mac. No signing credentials are embedded or uploaded by the build. An Apple Development certificate alone is not a public Developer ID distribution credential. Notarization/release automation and an independent clean-machine run remain release work; the generated local bundle must not be advertised as notarized.

The private Apple Silicon trial, checksum verification, separate local agent connection and same-Mac backup/update/restore checklist are documented in [second-Mac trial](second-mac-trial.md). Builds from archives without Git record unknown source provenance; publish from a clean Git checkout. `npm run release:check` inspects the payload, provenance and checksums before upload.
