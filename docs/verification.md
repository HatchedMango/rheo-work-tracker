# First-release verification

Verified locally on November 6, 2026, using Node 22.18.0.

- TypeScript typecheck: passed.
- Production server/frontend build: passed.
- Service, HTTP boundary, queue/worker authorization, persistence, and real MCP stdio/HTTP integration: 36 tests passed.
- Chromium browser acceptance: 11 tests passed. Includes external work intake through scoped source credentials, real stub worker startup after offline queueing, progress/results, changes requested and reapproved execution, human completion, manual completion, context editing, notes, refresh persistence, mobile search/decline, safe text rendering, failed-context-edit input preservation/retry, automatic browser startup/session renewal, and rejection of another local website’s attempts to bootstrap access or submit work.
- Desktop, mobile, result-review, and error-form screenshots: inspected. No mobile horizontal overflow in the tested 390px viewport.
- Built CLI setup/repeated setup and worker/agent credential creation: passed against an isolated temporary data directory; credential files had no group/other permissions.
- Dependency audit: zero reported vulnerabilities, including development dependencies.
- Formatting check: passed.
- Normal built instance at http://127.0.0.1:4310: served frontend, rejected unauthenticated API access, and started with zero work items.

The application and its paired local stub worker were left running for the user. Opening the app directly establishes or renews its local browser session automatically; there is no sign-in step. Their processes are ordinary local processes, not OS-managed startup services; restart with `npm start` and `npm run worker` as needed.

The repository was initialized locally. No remote, license, external accounts, agent-client configuration, or real execution provider was configured.

Implementation choices relative to the plan: stable Drizzle uses its supported better-sqlite3 driver rather than a built-in node:sqlite adapter; migrations are explicitly authored/versioned SQL rather than generated through Drizzle Kit. The source and built applications share the same schema and migration directory contents.

Known limits: one local owner/workspace, loopback-only access, simulated execution only, capped recent detail history (300 events/50 attempts), references can be added through the editor but there is no individual reference-removal control, and no question/needs-input workflow, production deployment, phone access, team permissions, or OS-managed background startup. Tests did not validate other browser engines or operating systems.

The next major capability is a real execution adapter with explicit repository access, isolated execution, bounded operations, and review evidence. See the README for the rest of the adoption path.

## Local access revision

At the user's request, manual login and sign-out UI, login/logout API endpoints, login-code issuance, and the login CLI command were removed. The browser now establishes a local session automatically through a JSON POST with an exact trusted Origin, reuses valid sessions, and silently renews expired/cleared cookies. Multiple browser requests share session initialization, and writes retry only on an explicit unauthorized response before processing.

Security checks include Host/Origin validation, Fetch Metadata isolation for API requests, HttpOnly/SameSite session cookies, scoped bearer credentials, and explicit execution approvals. Worker and MCP credentials cannot be exchanged for browser owner sessions. The normal server remains bound to 127.0.0.1. Browser access intentionally trusts the local computer/user; this is not account authentication.

## External intake revision

The user established that work always originates outside the app. The New work button, creation form, destination selection, and capture prompts were removed. Empty states point to external intake; context editing, notes, acceptance, execution approval, and outcome review remain.

The shared work service now permits creation only by agent/source-scoped actors. A valid browser session cannot create work via POST /api/work. MCP remains the supported external capture interface; authenticated source clients use the same API. Browser tests submit work through a separate external source credential before exercising human decisions in the UI. The explicit demo importer attributes sample items to a distinct demo integration actor and remains idempotent. Existing work/history and worker/MCP credentials are preserved.

## UI simplification

Replaced the green palette with white/gray surfaces and charcoal controls, retaining restrained status colors for review, running, and failure. Removed taglines, workspace/profile decorations, decorative placeholder art, date/local badges, repeated instructional copy, and promotional settings tiles. The work list uses simple rows; settings has two functional sections. Important simulation labels and execution approvals remain explicit.

The production build, typecheck, and eight existing browser acceptance tests passed after updating labels. Desktop review and mobile detail screenshots were visually inspected.

## Work navigation revision

Work now has two views: Active (open/blocked items) and History (completed/cancelled items). Inbox remains unresolved attention. A native status dropdown is scoped to the selected view and combines with search. View/status persist in the URL and work with refresh/back navigation; switching views resets incompatible status filters. Existing bookmarked views map to the simplified navigation.

Filtering runs in SQLite before count/pagination and considers only the latest execution attempt, using row order to break equal timestamp ties. Failed latest attempts are shown consistently in the UI and status filter. Added service coverage for every current status, active/history membership, search/pagination, and repeated attempts; added browser coverage for the two-view navigation, scoped filter, URL persistence, and mobile fit. Desktop/mobile filter screenshots were inspected.

## Simulation retirement

At the user's request, simulation was removed from the everyday product. The long-running local simulation process was stopped, its paired credential revoked, and its credential file removed. The normal UI has no run action or simulation setup controls and states “No execution worker connected.” No local execution attempts existed when the change was made; work/history were preserved.

Simulation code now lives only in `tests/fixtures/`, requires an explicit test environment/credential file, and is omitted from the clean production build. Normal API/service instances reject simulation approvals, worker claims, and run updates. Tests opt in explicitly through the application factory; production startup offers no environment/HTTP switch. The normal worker pairing/start commands were removed.

Verification: 31 service/API/MCP tests and nine browser tests pass. Added a normal-instance API test verifying execution is unavailable, no run is created, and accepted work can still be completed manually. Queue/review coverage uses the isolated fixture and API setup instead of exposing a simulation button in the product. Typecheck and production build pass.

## Guided MCP onboarding

Connections now provides a three-step agent setup flow: choose a client, copy a generated setup command/configuration, and verify a successful tool call. Codex, Claude Desktop, and generic stdio setup are supported. Each connection uses a distinct scoped credential in a permission-restricted local file; browser responses contain its path and launch settings, not its secret. Configurations use unique server names and correctly encoded absolute paths. No client configuration is edited automatically.

A separate local check starts the actual stdio companion and checks tool/API access with activity reporting disabled. Only observed agent initialization/tool use updates the corresponding connection; local checks cannot verify the agent or create sample work. Disconnect revokes access immediately. Status reports last successful use, not current online presence.

Verification: 35 service/API/MCP tests and 10 browser tests pass; typecheck and clean production build pass. New checks cover file permissions, no secret in setup responses, idempotent creation, owner-only management, cross-origin rejection, per-credential activity isolation, local-check failure/success, actual generated stdio launch, verified tool use, and revoked credentials. Browser coverage exercises the complete flow, local-check distinction, live verification, disconnect, Claude Desktop configuration, and mobile layout. Generated Codex TOML also parsed successfully with quoted/space-containing paths. Desktop/mobile setup screenshots were inspected.

Client-specific setup syntax follows the official OpenAI MCP documentation and official MCP local-server guide, linked in the UI and README. Tests launch the generated stdio configuration through the SDK; they do not install or alter Codex/Claude Desktop configuration.

## Setup prompt as the primary path

Agent setup now leads with a copyable, client-specific prompt containing the exact server name, launcher, and credential-file reference. It instructs the helper agent to preserve existing configuration, keep credential contents private, and verify only through the connected MCP tool. It explicitly handles clients/environments that require a restart or lack configuration access. The full manual command/configuration is retained under Manual setup. No marketplace listing or automatic client modification is required.

Typecheck, clean production build, all 35 service/API/MCP tests, and the focused onboarding browser test pass. Prompt content and hidden/expandable manual setup are covered for Codex and Claude Desktop; existing response checks also ensure that the prompt contains no credential secret. The setup-prompt screen was visually inspected.

## Draft connection lifecycle

Unfinished setup is now kept out of the Connections list. A successful agent tool call unlocks Finish connection; only explicit completion publishes the row. Existing previously verified connections are preserved by a versioned migration. Closing/cancelling new setup revokes the temporary credential and removes its local credential file; closing setup for a completed connection preserves it. Refresh resumes the current draft using only its opaque ID and step in browser storage. Draft status polls independently of the completed-connection list.

Verification: all 36 service/API/MCP tests and 11 browser tests passed, including early-completion rejection, drafts excluded before/after verification until completion, cancellation revocation, refresh/resume, and no visible entry after abandoning setup. Typecheck and production build passed.

## Server-enforced inbox intake

Removed destination selection from the MCP capture contract. The shared work service now always creates assignment attention in the work-creation transaction; omitted destinations and legacy backlog overrides all reach Inbox. Intake data cannot set ownership, acceptance, or lifecycle. Source credentials still cannot accept, decline, cancel, or complete work. Retries preserve the original work and do not reopen decided assignments, including retries using old destination-based idempotency fingerprints.

Migration 0004 restores assignment attention for previously bypassed undecided open/blocked work, appends a system-attributed event, and increments the work revision. Existing attention, resolved assignments, and closed work remain unchanged. A protected local database backup was saved before applying the migration. The running app was rebuilt/restarted, and the connected MCP list_work tool confirmed the existing desktop-packaging task in Inbox without creating sample work.

Verification: 40 service/API/MCP/migration tests and all 11 Chromium browser tests passed. Coverage includes legacy routing overrides, unauthorized attempts to resolve incoming work, legacy idempotency, migration/restart preservation, and opening externally submitted work from the actual Inbox list on desktop/mobile. Typecheck, clean production build, and formatting checks passed.

## Mac desktop distribution

Implemented and verified locally on November 9, 2026, on Apple Silicon macOS. The native Swift/AppKit menu-bar app bundles Node 22.18.0, the matching SQLite addon, production dependencies, migrations, and the existing web UI. The packaging investigation selected AppKit over a Tauri sidecar for this Mac-only browser-based utility; the framework decision is documented in desktop.md.

Verification: all 45 service/API/MCP/storage-migration tests and 11 Chromium browser tests passed, along with typecheck, formatting, production build, nested code-signature verification, and DMG checksum validation. The actual packaged native executable passed isolated checks for bundled runtime/SQLite, an imported fixture and unchanged source snapshot, owner-only credential permissions, real stdio MCP calls, duplicate launches, an unrelated service on the port, clean Quit, orphan cleanup after a native crash, relaunch/persistence, stable MCP commands after moving the app, and a clean installation with no work. It ran with a system-only PATH and a working directory outside the repository. No sample work was added to the user's installation.

Installed the app at /Applications/Work Inbox.app and launched it through Launch Services. Its native parent is managed independently of the Codex shell. The former source server was stopped after a protected SQLite backup. Existing work and connection credentials were imported into ~/Library/Application Support/Work Inbox/data/; the original .data folder and client settings were preserved. The existing connected Codex list_work tool successfully returned the desktop task from the desktop-managed service. The new stable MCP launcher was verified separately with the SDK; the existing Codex configuration still references its original launcher until explicitly migrated through Connections → Setup.

Artifacts: release/Work Inbox.app (about 210 MB on disk), release/Work-Inbox-macOS-arm64.zip (about 58 MB), and release/Work-Inbox-macOS-arm64.dmg (about 84 MB). This is a local ad-hoc-signed build, not a notarized public download. Launch at Login was left off. Native accessibility inspection timed out; interactive menu/picker and login registration still need manual UI validation. No second macOS account/machine, Intel hardware, or Gatekeeper/notarization flow was tested. See desktop.md for the remaining distribution checks.

## Dedicated desktop window (0.1.1)

At the user's request, the desktop app now opens its own AppKit window containing the existing UI in the system WKWebView. Open/reopen routes restore the retained window rather than opening the browser. The app has a Dock presence while the window is open, standard File/Edit/Window commands, persistent frame/site data, native confirmation sheets, and a single-origin navigation policy. External HTTP(S) links require a user click and open in the normal browser. There is no native JavaScript bridge. Closing the window retains the service; explicit Quit stops both.

The installed app was updated with a protected data backup and previous bundles retained for rollback. Native UI inspection now succeeds: the dedicated window displayed the existing Inbox/task, navigation to Connections and back worked, and cancellation displayed a native confirmation sheet that was dismissed without changing the work. Close/reopen and Quit were exercised through the native controls/shortcuts. The current connected Codex list_work still succeeds against the updated desktop-managed service. No sample work was created.

The update exposed a signal-triggered shutdown deadlock in the old launcher: AppKit's deferred termination was entered within a serial main-dispatch callback, blocking child-exit completion. Signal handling now schedules Quit through the main run loop outside that callback. Packaged verification adds a native AppKit background-process shutdown regression alongside the headless lifecycle/MCP checks; all pass. All 45 backend/MCP/storage tests, typecheck, formatting, native compilation, and production/bundle build pass. Public signing/notarization, independent Mac/account testing, and login-registration validation remain release work.

## Work presentation (0.1.2)

Updated both the work list and detail view. The unselected list uses the available width; selected work opens alongside a compact list with its own scrollable detail. Rows lead with the title and preview, followed by source/status metadata. Pending assignments say Needs decision. Detail headers show the source, date, and decision controls before the body. Removed redundant assignment/readiness copy, blank normal-priority space, and the empty selection panel. Details and numbered Done when criteria use a consistent reading width/line height.

Descriptions, criteria, result summaries, and activity support Markdown, including lists, code, and tables. HTML remains escaped, unsafe link schemes are disabled, and embedded images render as text without network requests. Long activity entries have accessible Show more/less controls. Context history shows readable Before/After values on demand instead of raw JSON. Stable text components are memoized across polling, and source names are joined into list results without per-row lookups. The desktop bundle also retains license notices for frontend dependencies compiled by Vite.

Verification: all 45 backend/MCP/storage tests and 12 Chromium browser tests passed; affected workflow/presentation cases were rerun after final rendering refinements. Coverage includes source attribution, decision control placement, escaped script text, Markdown/code/tables, unsafe links, no embedded-image requests, expandable notes/history, and mobile overflow. Desktop/mobile screenshots were inspected. Typecheck, formatting, clean production/app builds, and packaged lifecycle/MCP checks passed. Built and installed 0.1.2 after a protected data backup and clean app shutdown. Native window inspection verified the existing task's new list/detail layout and activity expansion/collapse without changing work. No sample work was added to the user's installation.
