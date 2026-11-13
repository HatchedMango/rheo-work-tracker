# Work Inbox

A local inbox for work arriving from agents and external workflows. Accept responsibility, clarify context, and review outcomes without losing the thread across agent sessions.

This version supports external capture through MCP, streams, progress tracking, simple human requests, context edits, search, and manual completion. **No execution worker is connected yet.** Real agent execution is a future milestone; the app does not offer a run action. The simulation is retained only as an isolated test fixture.

The proposed next phase is documented in the [streams and agent workflows plan](docs/streams-agent-workflow-plan.md): outcome-oriented streams, reviewable changes, durable agent context, and supported client setup. These capabilities are planned, not implemented yet.

## Start using it

### Mac desktop app

Open the Mac disk image, drag **Work Inbox** into **Applications**, and open it. The app bundles its runtime and database driver; Node, npm, and a repository checkout are not required. The menu-bar tray icon provides **Open Work Inbox**, **Launch at Login**, **Import Existing Data…**, **Restart Work Inbox**, and **Quit Work Inbox**.

The interface opens in a dedicated **Work Inbox** window. Closing that window leaves the service running; reopen it from the Dock, Spotlight, or menu bar. **Quit Work Inbox** (⌘Q) stops the app and service. Launch at Login is optional and off until you enable it. Your computer must remain awake for local intake to be available. Documentation and reference links open in your normal browser; the local web interface also remains available at **http://127.0.0.1:4310**.

Data and protected credentials live in `~/Library/Application Support/Work Inbox/data/`. The app can be replaced without replacing this folder. New MCP configurations use a stable launcher in `~/Library/Application Support/Work Inbox/bin/`; open Connections for the normal guided setup.

To move from the development version, quit its server, then choose **Import Existing Data…** and select its `.data` folder (the picker shows hidden folders). Import requires an empty desktop installation, copies a consistent database snapshot and connection credentials, and leaves the originals intact. Existing agent configurations still work while their original launcher/credential paths exist. Use Connections → Setup to obtain the stable desktop configuration before removing the old checkout; client settings are never silently rewritten.

The current build is for Apple Silicon. Local builds are ad-hoc signed; public downloads still require Developer ID signing and notarization. See [desktop packaging](docs/desktop.md) for building, verification, updates, and distribution limits.

### Run from source

Requirements: Node **22.18 or newer** and npm. No database service or external account is needed. The SQLite driver has a native component; unsupported Node/platform combinations may require native build tooling.

```sh
cd /Users/you/dev/WorkInbox
npm ci
npm run setup
npm run build
npm start
```

Open **http://127.0.0.1:4310**. Your local workspace opens directly; no account, password, login link, or terminal step is needed to access it. Browser sessions are created and renewed automatically behind the scenes.

The app is available on this computer only. Use `127.0.0.1`, not `localhost`, because the server validates its configured host and origin.

The application does not insert sample tasks automatically. Work arrives through MCP or authenticated source clients. To try the flow without connecting an agent, explicitly import two labeled examples:

```sh
npm run demo
```

## Everyday workflow

1. Work with your agent in its usual chat. It records goals, changes, progress, and useful context through MCP.
2. **Streams** shows what you are accomplishing and how the related work is progressing.
3. **Needs you** shows only explicit questions or human actions. An optional **Open chat** link takes you back to the relevant conversation; answer there and let the agent keep the request in sync.
4. **Changes → Active / History** provides a closer look when needed. Routine agent delivery moves to History without another acceptance step.

There is no accept/decline workflow or approval-coverage setup. Tracking and cooperative claims never authorize execution; agents still follow your instructions in chat. Idle work can be edited and manually completed under the collapsed management controls. Context edits and historical decisions retain their history.

The UI has no work-creation form. New work comes from an external agent credential through MCP or the scoped API. Brief descriptions lead, with detailed Markdown, criteria, evidence and history available on demand. HTML stays escaped and remote images are not fetched.

Requests may include a web chat URL or a local Codex existing-chat link. Links are validated and open only when clicked; no supported URL means no link. Local links require the matching app and chat on that computer. Claude Code terminal sessions do not have a guaranteed clickable chat URL; an agent should omit it rather than guess.

## Execution

Connections shows **No execution worker connected**. This accurately reflects the current implementation: there is no real coding-agent adapter. Tracking, human requests, notes, and manual completion work independently of an execution worker.

The old simulation process has been stopped, its credential revoked, and its normal pairing/start commands removed. Simulation code lives under `tests/fixtures/` and is excluded from the production build. The normal API rejects run approvals, worker claims, and worker updates until real execution is implemented. Tests explicitly opt into a simulation-enabled application instance; the production entry point does not expose that option through environment variables or HTTP.

## Connect an agent

Open **Connections → Connect an agent**. The guided setup handles credential creation and configuration:

1. Choose **Codex**, **Claude Desktop**, or **Other MCP client**, and optionally name the connection.
2. Copy the generated **setup prompt** into an agent with local configuration access. The prompt includes the exact launcher/configuration, asks it to preserve existing settings, and tells it to verify through the connected tool. No credential secret is included.
3. If the agent cannot update local settings, expand **Manual setup** for the client-specific command/configuration. After any required restart, ask the agent: **“Use Work Inbox to list my work.”**
4. After a successful agent tool call, click **Finish connection**. Only completed connections appear in the list. A local setup check alone cannot finish setup.

Refreshing resumes your unfinished setup. Cancelling or closing a new setup revokes its credential and discards the draft; it does not leave an entry in Connections. Existing completed connections are preserved when their setup dialog is closed.

Work Inbox must stay running. The agent launches the stdio MCP companion itself; you do not start a separate MCP daemon manually. App and agent currently run on the same computer.

Each connection gets its own revocable agent credential. **Setup** reopens its configuration, and **Disconnect** revokes its access immediately. After disconnecting, remove the corresponding server entry from the client to stop launch attempts. Existing client configuration is never edited or replaced by Work Inbox.

**Having trouble? → Check local setup** launches the actual companion with that credential and checks its tools/API access. This is a local diagnostic, not evidence that your chosen agent is configured. It does not mark the agent verified or create a sample work item. Connection status records successful use, not continuous online presence.

Client setup follows [official OpenAI MCP documentation](https://developers.openai.com/codex/mcp) and the [official local MCP/Claude Desktop guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers). The generic option provides stdio settings in `mcpServers` JSON format; adapt the enclosing structure for clients with another schema.

### Advanced CLI setup

The original `npm run mcp:credential` command remains available for scripted setup. It writes `.data/agent.json`; configure a client to launch the absolute `dist/mcp/index.js` path with the absolute Node executable and `WORK_INBOX_CREDENTIAL_FILE` pointing at that file. CLI-created credentials remain usable but do not appear as managed connections in the guided flow. Use the UI for per-client setup and verification.

The original tools remain available. See [streams and agent workflow](docs/agent-workflow.md) for stream intake, dependencies, outputs, cooperative claims, bounded context, and project setup.

Tools:

- `create_work`: title, objective, optional criteria/priority/references/idempotencyKey. Always submits to Inbox for your decision. Legacy `destination` fields are ignored by the server.
- `list_work`: optional view, status, q, limit (1–100), and offset. `active` includes open/blocked work excluding reported-delivered changes; `history` includes reported delivery and completed/cancelled work. Reported delivery is separate from owner completion. `status` filters the current display state before counting/pagination. Legacy views remain supported for existing clients.
- `get_work`: work UUID; returns context, up to 50 recent runs, and 300 recent events.
- `add_work_update`: work UUID, message, and optional references.

Example `create_work` arguments:

```json
{
  "title": "Refactor date picker later",
  "objective": "Follow up on the date parsing duplication discovered during the current task.",
  "idempotencyKey": "date-picker-follow-up-1",
  "references": [{ "system": "context", "url": "https://example.com/context" }]
}
```

Agent credentials cannot accept assignments, approve execution, claim execution jobs, review results, or complete work. Cooperative change claims are separate bookkeeping and grant no execution authority. Notes and task content never become execution authority. To run the source stdio server manually, use `npm run --silent mcp`; do not use a wrapper that writes npm banners to stdout in your MCP client.

## Credentials and configuration

```sh
npm run credentials             # IDs/scopes only; no secret values
npm run revoke -- CREDENTIAL_ID # revoke a worker or agent credential
```

Issuing an agent credential again writes a new credential file and identity; it does not silently revoke older credentials. Revoke the prior ID if replacing an agent. Credential files are local secrets; task payloads never contain them.

Environment:

| Variable                     | Default                                                                         | Purpose                               |
| ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| `WORK_INBOX_DATA_DIR`        | `.data` relative to working directory                                           | Database and CLI credential directory |
| `PORT`                       | `4310`                                                                          | Loopback application port             |
| `WORK_INBOX_CREDENTIAL_FILE` | UI: `.data/connections/`; CLI: `.data/agent.json`; tests: explicit fixture file | Worker/MCP credential file            |

Use the same data-directory/port settings for setup and the server. If changing the port, reissue agent files for the new server URL. Existing agent credential files retain their original URL. Always start commands from the project root unless setting absolute paths.

Local state is excluded from Git and initialized with restrictive directory/database permissions. The browser automatically obtains an HttpOnly/SameSite session cookie through a same-origin JSON request. Session creation and browser writes require an exact trusted Origin; cross-site API requests and untrusted same-site requests are rejected. Data endpoints still require a session or a scoped worker/agent credential. Expired or cleared browser cookies renew silently. These controls isolate the API from other websites; they are not account authentication or protection from processes running as your local user. Server logs redact authentication headers/cookies.

This is a single-owner, loopback-only release, not a multi-tenant or publicly deployable service. It has workspace/visibility fields for future evolution but no team access model, HTTPS hosting, external accounts, repository permissions, or production operations. Do not expose its port through a public proxy.

Workflow synchronization, lifecycle hook setup, chat response permissions and pending-write recovery are documented in [synchronization](docs/synchronization.md).

## Development and checks

```sh
npm run dev           # Fastify :4310 and Vite :5173
npm run typecheck
npm test              # services, HTTP boundaries, worker rules, actual MCP stdio/HTTP integration
npm run build
npx playwright install chromium  # once for browser tests
npm run test:e2e       # built UI, isolated test server/simulation fixture, desktop/mobile
npm audit
```

For development, open `http://127.0.0.1:5173` directly. The Vite API proxy forwards to :4310; automatic browser access works on both supported origins. The standard development configuration uses these ports; custom development ports require matching proxy/origin configuration.

Guided connection setup stores only credential-file paths in client configuration. The actual files are permission-restricted; connection management routes require the local owner. Agent telemetry is tied to its authenticated credential, so one connection cannot verify another.

Tests isolate application data. Browser tests use a fresh temporary database and protected test credentials under `.data/e2e`, with a separate server on :4318. They never seed `.data/work.sqlite`. The test server and worker shut down afterward. Screenshots/traces are in ignored `test-results/`; a failed test's trace can contain its temporary session information.

## Backup and recovery

Persistent state lives in `.data/work.sqlite`; SQLite can also create adjacent `-wal` and `-shm` files. CLI credential files live alongside it; guided agent credentials live under `.data/connections/`.

For a simple consistent backup, stop the application, then copy the **entire `.data` directory** to a private location outside the repository. Protect that backup: it includes credential files and private task content. Never copy just a live database file and assume it includes uncheckpointed WAL data.

To restore, stop the application, replace the data directory with the complete backup, then start the application. Review interrupted runs and approve retries deliberately. Opening the app automatically restores browser access. To replace a lost agent credential, issue a new one and revoke the old credential ID.

Schema migrations run transactionally on setup/startup, are recorded in `schema_migrations`, and can be run repeatedly. New schema changes require a new versioned SQL migration plus corresponding Drizzle schema changes; do not edit an applied migration.

## Architecture and next steps

See [architecture](docs/architecture.md), the [first-release implementation history](docs/implementation-plan.md), and the [streams and agent workflows plan](docs/streams-agent-workflow-plan.md).

Version 0.6.0 / workflow 1.4.1 opens streams directly into a selectable work map/list, with recorded prerequisites, feeding streams and quieter delivered work. Tracking has no acceptance chores; human requests have optional chat links; see [usage and verification limits](docs/agent-workflow.md).

1. Real Codex and Claude Code session pilots, including resume/compaction and parallel handoffs.
2. Refine the human view and bookkeeping from daily use.
3. Optional independent MR status integrations and managed hosting after the personal workflow is useful. Execution adapters remain separate future work.

No license has been selected, and no external service or remote repository has been configured.
