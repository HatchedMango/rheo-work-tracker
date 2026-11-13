# Work Inbox

Understand what your agents are working toward, how the work connects, and where they need you.

Work Inbox is a local Mac app with streams, a work map/list, explicit prerequisites, progress and simple human requests. Agents maintain shared context through MCP while you keep working in their usual chats. Routine changes do not need acceptance in the app. Work Inbox tracks coordination; it does not run coding agents.

Current private trial: **0.8.1**, agent workflow **1.6.0**. The desktop target is **Apple Silicon, macOS 13 or newer**. Each Mac has its own inbox and agent connections; work does not synchronize between computers.

## Install on another Mac

1. Download the Apple Silicon DMG and `SHA256SUMS` from this repository's prerelease, when published. Verify the downloaded file with `shasum -a 256` against its entry in `SHA256SUMS`.
2. Open the DMG, drag **Work Inbox** into **Applications**, and open it from there. Node, npm and a checkout are not required for the app.
3. In **Connections → Connect an agent**, copy the setup prompt into your agent on this Mac. Let it configure the local MCP entry, then verify with the connected `list_work` tool and finish the connection.
4. Install the **Project workflow** from that connection's setup for a project and an explicitly selected stream/change. Review the client hooks and start a fresh chat if required. A connection alone does not install or verify lifecycle hooks.

The current trial installer is **ad-hoc signed, not notarized**. A downloaded copy may be blocked by macOS or your organization's device policy. Build from source on that Mac if permitted, or wait for a Developer ID signed/notarized release; this project does not ask you to disable macOS protections.

The [second-Mac trial guide](docs/second-mac-trial.md) covers first use, agent checks, backups, updates and known limits. Create a fresh connection on the other Mac; keep this Mac's database, protected credentials and project binding here.

## Everyday use

- **Streams** shows goals, progress and the work map. Open a stream to see its changes and feeding streams without expanding another section. Map arrows describe recorded prerequisites; missing or stale assessments are visible.
- **Needs you** contains actual questions and human actions. Answer in your agent chat; permitted agents can reconcile the exact request. A chat link is shown only when a supported reliable link exists.
- **Changes** provides a closer view and history. Agent delivery is separate from human completion; a stopped chat, expired claim or passing check never completes work automatically.
- **Connections** manages local agent access and project workflow setup. Connection verification is a successful client tool call, not continuous online presence or proof that hooks ran.

Close the window to leave local intake running. Reopen from the Dock, Spotlight or menu bar. **Quit Work Inbox** (⌘Q) stops the app and service. **Launch at Login** is optional. The Mac must be awake with Work Inbox running for agents to reach it.

Agents reuse a change and its current approach across implement/check/revise iterations. Explicit dependency reports distinguish assessed independence, prerequisites and uncertainty. Cooperative implementation claims check recorded readiness but do not grant execution permission. An external loop runner can use per-session observe mode, leaving continuation and stopping to that runner. See [agent workflow](docs/agent-workflow.md) and [synchronization](docs/synchronization.md).

## Build from source

Use the Node version in `.nvmrc` (**22.18.0**) and npm. SQLite includes a native component; a fresh installation may require compiler tools. Building the dedicated Mac app also requires Xcode Command Line Tools. From the checkout root:

```sh
npm ci
npm run setup
npm run build
npm start
```

Open **http://127.0.0.1:4310**. The source app opens in a browser with an automatic local session; no account or login is needed. Use `127.0.0.1`, rather than `localhost`, because host/origin checks are intentional. Quit the desktop app first if it already uses port 4310.

For the dedicated Mac app:

```sh
npm run desktop:build
npm run desktop:verify
```

Install `release/Work Inbox.app` in Applications, or use the versioned DMG. Launch it once from its installed location before configuring MCP. See [desktop packaging](docs/desktop.md).

For development, `npm run dev` starts the backend and Vite UI at **http://127.0.0.1:5173**. Do not run another instance on the same backend port. The application starts without sample work; `npm run demo` explicitly creates labeled examples for source testing.

## Connect agents

The app creates a separate revocable protected credential for each connection. Generated setup prompts/configurations contain its file path, never its secret value. The MCP companion starts through the client using a stable local launcher; no separate MCP daemon is needed. App and agent currently run on the same Mac.

The connection wizard preserves unfinished setup while it is open. Finish after a successful connected client tool call; cancelling a new setup revokes its draft credential. Disconnecting revokes access immediately; remove the corresponding server entry from the client afterward.

**Check local setup** is a diagnostic, not client verification. Project setup installs managed instructions, skills and supported lifecycle hooks without replacing unrelated settings. Generated bindings contain local paths and selection, stay out of Git, and must be recreated on each machine. New tool schemas may require reloading the MCP connection or starting a new chat.

Advanced source commands:

```sh
npm run mcp:credential          # write a protected source credential file
npm run credentials             # show IDs/scopes, not secret values
npm run revoke -- CREDENTIAL_ID
```

For source MCP setup, use the absolute Node executable and `dist/mcp/index.js`, with `WORK_INBOX_CREDENTIAL_FILE` referencing the generated protected file. `npm run --silent mcp` is suitable for direct stdio use; avoid npm banners on a client's protocol stream. CLI-created credentials remain usable but do not become guided UI connections.

Agent tools include work capture, stream/context retrieval, explicit dependency review/reporting, progress/output reporting, cooperative claims and checkpoints. Agents cannot grant execution authority or declare human completion. Question/action chat feedback is separately opt-in per connection. See [the maintained workflow](docs/agent-workflow.md) for contracts and [human presentation](docs/human-presentation.md) for wording.

## Data, backup and updates

Desktop data and protected credentials: `~/Library/Application Support/Work Inbox/data/`. Source data: `.data/` in the checkout, unless `WORK_INBOX_DATA_DIR` selects another directory. Logs and stable desktop launchers live outside the app bundle under the same Application Support root.

For a manual desktop backup, quit Work Inbox and copy the **entire data directory** to a private location. For source use, stop the server and copy the entire `.data` directory. A live SQLite file alone may omit WAL contents. Backups include private work and credentials; keep them outside Git and shared artifacts.

To update, back up, quit the app, replace its bundle in Applications, and reopen it. Data and connections remain outside the bundle; the stable launcher pointer is refreshed. Migrations run on startup. Database downgrades are unsupported: a rollback needs the previous app **and its matching stopped-data backup**. The [trial guide](docs/second-mac-trial.md) gives restore steps.

To import source data into an empty desktop installation, quit the source server, choose **Import Existing Data…** and select its `.data` folder. Import preserves originals and refuses to overwrite populated desktop data. Obtain the stable desktop configuration through Connections before removing an old checkout/runtime. This is a local migration feature, not cross-Mac synchronization.

| Variable                     | Source default     | Purpose                                     |
| ---------------------------- | ------------------ | ------------------------------------------- |
| `WORK_INBOX_DATA_DIR`        | `.data`            | Database and source credential directory    |
| `PORT`                       | `4310`             | Loopback server port                        |
| `WORK_INBOX_CREDENTIAL_FILE` | explicit file path | MCP credential; keep its contents protected |

Use matching data/port settings for setup and server commands. Existing credential files retain their original URL; create replacement credentials if changing the port. The service binds to loopback and validates origins, sessions and credential scope. HTML is escaped and remote images in work content are not fetched. The execution simulation exists only in isolated tests.

## Checks and releases

```sh
npm run repo:check -- --history
npm run format:check
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
```

Tests use isolated data and ports; they do not seed the personal inbox. Keep traces/logs private because temporary session data may appear in failure diagnostics. To audit secret content, install Gitleaks and run `gitleaks git --redact=100 --log-opts=--all .`; the repository path check complements that scan rather than replacing it.

GitHub **Checks** runs source checks and browser tests. **Mac trial package** is manually dispatched and verifies an Apple Silicon package before retaining installer files, checksums and build metadata as private workflow artifacts. Neither workflow publishes a release automatically. See [publishing steps](docs/publish-private-trial.md), [private release preparation](docs/private-mac-trial-plan.md) and the [trial guide](docs/second-mac-trial.md).

The project license remains undecided; no open-source license is granted by this private trial. Dependency/runtime notices are included in the Mac bundle. Choose the project's license before public distribution.

Architecture and historical plans are in [docs/architecture.md](docs/architecture.md). Historical verification notes describe observations at their original versions; independent second-machine behavior, actual Codex/Claude automatic hooks and notarization are not certified by local helper/packaging tests.
