# Work Inbox: first usable local version

Status: approved and implemented on November 6, 2026. Local browser access was subsequently revised at the user’s request to open directly without sign-in. See `docs/verification.md` for results and known limits.

## Product revision: external intake only

The user subsequently established that work always originates externally. Manual UI creation is removed, browser sessions cannot create work through the API, and the supported intake path is MCP/authenticated source clients. Existing context can still be clarified in the UI. Historical manual-capture steps below are superseded by this requirement; demos import labeled examples through a distinct source actor.

## Product revision: simulation retired

The user subsequently removed simulation from the normal experience. It is retained exclusively for isolated tests; production execution approval/claim/update is disabled until a real adapter is implemented. There is no normal run action or worker pairing/start command. Current use supports external capture, ownership decisions, context/notes, history, and manual completion. Historical simulation milestones below describe test coverage rather than the everyday product.

## Product revision: server-enforced inbox intake

Every new external submission must enter Inbox for the user's decision. Agents cannot select a destination or bypass review. The shared service creates assignment attention transactionally, and legacy destination fields are ignored. Historical backlog-by-default intake requirements below are superseded. Previously bypassed undecided work is recovered by a versioned migration; resolved decisions and closed work are preserved.

## Goal

Provide a dependable personal work inbox with manual capture, follow-up capture through MCP, a persistent backlog, explicit execution approval, and result review. Prove the worker contract using a safe stub.

This version is useful for recording and managing real personal work. Its stub worker demonstrates orchestration; it does not investigate a repository or solve the submitted task. The UI must make that distinction explicit.

## Starting point

- Repository directory: `/Users/you/dev/WorkInbox`.
- No existing application, dependencies, or Git repository were present during inspection. Only empty directories from initial exploration existed before this plan.
- Installed runtime observed: Node 22.18.0 and npm 10.9.3.
- Product direction: the supplied Agent-Native Work Inbox kickoff document, refined by the stack discussion in this chat.
- The user approved implementation with “lets go” after reviewing this plan.

## Architecture and stack

- TypeScript, strict mode, ESM, npm with a committed lockfile.
- Fastify HTTP server, also serving the built frontend.
- SQLite with foreign keys, WAL mode, busy timeout, and Drizzle schema/migrations. Use a supported driver compatible with the installed Node runtime; prefer built-in `node:sqlite` if the selected Drizzle release supports it. Pin compatible stable dependencies rather than silently requiring a runtime upgrade.
- React and Vite for the frontend, plain CSS and a small set of reusable components. Native accessible controls wherever possible.
- Zod contracts shared by the API, worker client, and MCP facade.
- Separate Node worker process using outbound HTTP polling and a registered stub adapter.
- Official MCP TypeScript SDK over stdio, calling the authenticated HTTP API.
- Vitest for service/API/worker tests and Playwright for a small browser acceptance suite.

One package initially, with module boundaries rather than a multi-package build system:

```text
src/
  server/          HTTP routes, authentication, static assets, startup
  services/        work, assignments, approvals, runs, attention, events
  db/              schema, database setup, versioned migrations
  shared/          contracts, enums, public DTOs
  worker/          API client, polling loop, adapter contract, stub
  mcp/             stdio tools using the API
  cli/             local initialization, credential management, demo
web/
  src/             views, components, API client, CSS
tests/             service, HTTP, worker, MCP, browser acceptance
docs/              architecture and operational notes
```

The application service layer owns transactions and permissions. Routes and MCP tools do not implement independent lifecycle rules. The worker never opens the application database.

For normal use, one server serves the UI and API; the worker is optional and independently stoppable. Development may use Vite's separate dev server with an API proxy. No Redis, container runtime, or hosted service is required.

## First-release scope

### Personal work management

- Create a work item with title, objective, optional acceptance criteria, priority, and source references.
- Choose an inbox request or a saved backlog item. Saving for later must not implicitly accept responsibility or grant execution approval.
- List, filter, and search work; retain completed and cancelled history.
- Open a detail view with durable context, assignment, runs, notes, and chronological activity.
- Accept or decline a proposed assignment to the local owner. Backlog items can be accepted when ready.
- Edit open work's objective, title, criteria, and priority when no run is active. Keep an event recording the change.
- Add notes, cancel eligible work, and complete accepted work manually when no run is active.
- Manual completion and stub-result approval are explicitly different actions.

### Execution and review

- Accepting work grants ownership only.
- A separate `Run with stub worker` action approves one immutable execution request and creates a queued run.
- Show the worker's online/offline state and retain approved queued work across server/worker restarts.
- A worker claims only its owner's approved runs and posts heartbeats, progress, and a structured stub result.
- Results contain a labeled simulated summary/artifact stored in the application, with no arbitrary local filesystem path or executable content.
- Request result review through the inbox. Approve the result and complete the work, or request changes with a note.
- A change request requires another explicit execution approval to queue another attempt.
- Allow cancellation of queued/running work. Reject subsequent progress or results for cancelled attempts; the stub checks cancellation cooperatively.

### Agent-facing capture

Expose four MCP tools: `create_work`, `list_work`, `get_work`, and `add_work_update`.

- Agent-created follow-ups default to the backlog, without generating an immediate assignment notification.
- Record agent identity and references on created items and notes.
- Support an idempotency key for creation; a repeated key with different content is a conflict.
- MCP credentials allow capture/read/update, not acceptance, execution approval, worker claiming, or completion.
- Updates are notes/references, not executable instructions or lifecycle authority.

## Data model and invariants

Use separate relational tables for:

- Workspaces and actors: one local workspace and owner initially; actor kinds person, agent, worker, and integration as needed.
- Work items: workspace, creator, accountable owner, objective, criteria, priority, private/workspace visibility, lifecycle, timestamps, revision.
- Source references: bounded metadata and validated HTTP(S) URLs.
- Assignments: proposed recipient and decision, separate from ownership and execution.
- Execution approvals: approver, adapter, immutable objective/criteria snapshot and work revision, timestamp.
- Execution runs: approval, owner, worker, state, claim token, lease expiry, timestamps, outcome/failure metadata.
- Attention requests: assignment, result review, and failure requiring intervention, with an explicit resolution timestamp.
- Append-only events: actor, work/run reference, event type, bounded payload, timestamp.
- Credentials and browser sessions: hashes, scope, actor, expiry/revocation metadata.
- Idempotency records: scoped caller/key, request fingerprint, resulting resource.

Work lifecycle: `open | blocked | completed | cancelled`.

Assignment states in this slice: `proposed | accepted | declined | withdrawn`. Deferral and scheduled reminders can follow.

Run states: `queued -> claimed -> running -> awaiting_review -> succeeded | changes_requested`; `failed` and `cancelled` are terminal alternatives. A completed stub attempt remains awaiting review until a person decides its outcome.

Important invariants:

1. A queued run requires an accepted assignment and explicit approval from the owner.
2. At most one nonterminal run per work item, including a result awaiting review.
3. Claiming is atomic; progress, heartbeat, and result writes require the matching authenticated worker and current claim token.
4. Lease expiry creates a failed attempt and one actionable attention request. It never automatically replays work. A new attempt requires new approval.
5. Work, assignment/run changes, events, and attention creation/resolution are committed together in a transaction.
6. Declining an assignment does not silently cancel the work. Accepting or declining resolves the assignment attention item.
7. Approving a result completes the work and resolves review attention; requesting changes leaves work open and records the review decision.
8. Completed/cancelled work cannot be dispatched. Illegal or stale transitions produce a clear conflict rather than duplicate actions.
9. Editing context does not alter an already-approved snapshot. Active work context is locked in this slice to keep review expectations clear.
10. UI rendering treats task text, updates, and worker output as untrusted text. External links use safe protocols and opening behavior.

## Queue and worker behavior

- Persist the queue in SQLite; order eligible approved runs by priority, then queue time.
- Initial concurrency: one run per worker, with atomic claims supporting multiple worker processes safely.
- Proposed defaults: idle polling every 3 seconds, heartbeat every 10 seconds, lease 60 seconds. Make tests use an injected clock.
- Server periodically reconciles expired leases and does so before issuing new claims.
- Track worker liveness independently of an active run so the UI can distinguish offline from idle.
- Retry transient polling failures with capped backoff. Do not repeat execution automatically after lease loss.
- Repeated progress/result messages use idempotency identifiers to avoid duplicate events.
- Shut down gracefully on signals. Unexpected interruption relies on lease expiry and deliberate recovery.
- Stub runs briefly, emits several progress updates, then returns a clearly simulated report. It reads no repositories, launches no subprocesses, and calls no AI provider.

## Local access and security

- Bind to `127.0.0.1` by default, with a single supported local origin and strict Host/Origin checks. Remote and phone access are a later deployment feature.
- CLI initialization creates the local workspace/owner and stores protected local state in an ignored application data directory. Restrict directory/file permissions where supported.
- Opening the app automatically establishes a local browser session through an Origin-checked JSON POST. No manual sign-in, login link, account, or sign-out flow. Expired/cleared browser sessions renew silently; scoped worker/agent credentials remain separate.
- Browser uses an HttpOnly, SameSite session cookie; state-changing browser requests require an allowed Origin and JSON content type. Do not depend on CORS alone for protection.
- Local CLI commands issue separately scoped, revocable worker and MCP credentials into permission-restricted files. No secrets in the frontend bundle, task data, committed files, or normal logs.
- Worker pairing initially means registering a worker through the local CLI and providing its credential file. UI shows worker status; a graphical pairing flow can follow.
- Validate IDs, bodies, query parameters, output limits, and external references. Set request size limits and bounded pagination.
- This is a local single-user application with explicit actor/scope checks, not a production multi-tenant security implementation. Workspace/private fields prepare the schema but do not constitute team access control.
- Do not expose this HTTP service publicly. Network deployment requires HTTPS, revisited authentication, operational hardening, and real membership enforcement.
- No external account connections, real agent execution, automatic deployment, license selection, or provider authentication in this slice.

## UI plan

Three primary views, plus a compact settings/status view:

1. Inbox: actionable assignment, failure, and review cards, with a count and clear empty state.
2. Work: searchable/filterable list with backlog, queued, running, completed, and cancelled views. These are derived views, not a single overloaded status field.
3. Detail: objective and criteria first, then current action, execution summary/results, notes, and activity. Preserve selection in the URL for refresh/back navigation.
4. Settings/status: local identity, worker liveness, stub explanation, and CLI instructions for credential management.

Creation uses a simple form. Use a list/detail layout on wider screens and a stacked navigation/detail flow on narrow screens. Include keyboard focus styles, labeled forms, readable contrast, touch targets, and accessible status/error messages. Do not use color alone to convey state.

Poll visible data conservatively and pause unnecessary polling in hidden tabs. Show loading, disconnected, empty, and error states. Preserve form input on failed requests. Disable duplicate submissions and refresh authoritative data after writes. Do not represent a disconnected worker as a running task.

## Implementation sequence after approval

### 1. Foundation and persistence

Initialize Git and ignore rules, package scripts, strict TypeScript, dependency lockfile, migrations, local configuration, and shared contracts. Add a short architecture document and setup README as the system takes shape.

Exit check: fresh initialization and migration reruns succeed, existing data survives restart, and application state is excluded from version control. Do not select a license or create a remote repository.

### 2. Work services and authenticated API

Implement scoped actors, browser bootstrap, assignments, capture/edit/notes, manual completion, events, attention, and execution approval services. Add API request/response validation and conflict handling.

Exit check: service/API tests cover the normal lifecycle, illegal transitions, role boundaries, idempotency, and transactional rollback.

### 3. Minimal usable UI

Implement inbox, work list, capture, details, manual workflow, responsive styles, connection/error states, and session handling.

Exit check: create, save for later, accept/decline, edit, add notes, search, manually complete, and reopen history work through the browser. No sample records are inserted into the normal database implicitly.

### 4. Durable worker and review

Add worker registration, polling/claims, heartbeats/leases, safe stub adapter, progress/results, cancellation, review, and deliberate retries.

Exit check: approved work queued while the worker is stopped is claimed after it starts; two workers cannot claim the same attempt; lease loss fails visibly without replay; stale workers cannot modify a reassigned/terminal attempt.

### 5. MCP capture

Add stdio tools and scoped API client. Document an exact local-client configuration using absolute paths and credential-file references. Test through an actual MCP client transport without modifying the user's agent configuration.

Exit check: MCP creates an idempotent follow-up, reads it, and adds a note; it cannot grant execution authority or access worker routes.

### 6. End-to-end verification and handoff

Finish setup scripts and optional demo data, run all required checks, start the built app and worker, inspect desktop/mobile layouts, and demonstrate the full flow. Document limitations and recovery/backup instructions. Leave only documented useful processes running and report their URLs/status.

Exit check: the first-run instructions work from a clean data directory, browser acceptance passes, and the real local data directory is not populated by tests.

## Verification checklist

- Typecheck and production frontend/server build.
- Database migration, persistence/restart, foreign-key, and transaction tests.
- Capture -> accept -> approve execution -> claim -> progress -> result -> human review -> completed.
- Save for later -> MCP note -> manual completion, without running a worker.
- Decline, cancellation, request changes, subsequent separately approved attempt.
- Queue survives worker offline periods and application restart.
- Concurrent claims, expired leases, revoked/wrong-scope credentials, stale claim tokens, cross-worker writes, duplicate requests/results.
- Automatic browser startup/renewal, rejected cross-site session creation, unauthorized API access, rejected foreign origins/hosts, and safe rendering of malicious task text/links.
- MCP transport round trip for all four tools.
- Browser tests for the main workflow and a narrow viewport; visual inspection of empty, populated, error, and review views.

## Expected commands and deliverables

Final command names may be adjusted to match the implementation, but the intended interface is:

```text
npm ci                     install pinned dependencies
npm run setup              migrate and initialize local identity
npm run dev                start API and Vite for development
npm run build              produce deployable local application assets
npm start                  serve the built UI/API locally
npm run worker:pair        register worker and save scoped credential file
npm run worker             run the stub worker
npm run mcp:credential     issue an agent capture credential file
npm run mcp                run the stdio MCP server (not a web service)
npm run demo               add labeled sample work only when requested
npm test                   service/API/worker/MCP tests
npm run test:e2e           browser acceptance tests
npm run typecheck          static checks
```

Deliver README, architecture notes, exact demo commands, test results, application URL, local data/credential paths, known limitations, and the next highest-value improvements. MCP startup must emit protocol traffic only to stdout; diagnostics go to stderr.

## Deliberately deferred

- Real Codex/Claude execution, repository access, sandboxing, worktrees, and provider-specific permissions. This is the next major milestone after the worker contract is proven.
- Accounts, invitations, multi-user authorization, hosted sync, remote phone access, and notifications outside the app.
- Jira/GitHub/Slack ingestion or synchronization.
- Attachments, arbitrary filesystem artifacts, threaded chat, rich text, recurring tasks, scheduling intelligence, and automatic retries.
- PWA installation/offline writes, push notifications, native mobile apps, streaming terminals, and complex dashboards.

## Approval boundary

The approved stack discussion establishes technical direction. This document proposes the concrete first-release scope. The user has approved and requested implementation. Routine implementation choices within this scope can proceed without repeated confirmation.
