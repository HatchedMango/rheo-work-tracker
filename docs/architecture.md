# Architecture

Work Inbox is one local HTTP application, a static React interface, and a future execution worker interface. No execution adapter is currently enabled. MCP is a separate stdio facade over the same authenticated HTTP API. Node/TypeScript is shared across processes; SQLite persists work and the queue.

The Mac distribution adds a small Swift/AppKit menu-bar launcher around that same application. It bundles Node and production dependencies, owns background process lifecycle, and keeps desktop data outside the app bundle. Desktop-only storage/import code lives under `src/desktop/`; reusable server startup lives in `src/server/start.ts`. Connections can generate a stable standalone MCP launcher instead of an external Node/script pair. See [desktop packaging](desktop.md) for installation, migration, and distribution limits.

## Boundaries

- `src/services/work.ts` owns authorization, transactional transitions, immutable approvals, attention, and append-only history. HTTP routes validate inputs before calling it.
- `src/services/auth.ts` issues scoped hashed credentials and creates/reuses local browser sessions automatically. Browser sessions are an origin-isolation mechanism, not an account login.
- `src/db/schema.ts` defines typed Drizzle tables; `src/db/migrations/` contains versioned SQL. The stable Drizzle 0.45 release does not include a built-in node:sqlite adapter, so this version uses its supported better-sqlite3 driver. Migrations are explicit SQL, avoiding a migration-generation dependency in the running app.
- `src/server/app.ts` defines HTTP routes and local Host/Origin checks. The normal entry point serves built UI assets and periodically reconciles expired worker leases.
- `src/worker/` retains the typed adapter/approved-request contract for future real execution. The old polling daemon and stub live only in `tests/fixtures/`, require an explicit test credential and test environment, and are excluded from the production build. The normal service rejects execution approvals, claims, and worker updates; tests opt in through an application factory option.
- `src/mcp/` exposes capture, stream/change tracking, context, output reports, and cooperative claims using an agent credential. It does not expose owner or worker commands.
- `src/services/coverage.ts` derives current scope coverage and ancestor authority; `flow.ts` validates typed prerequisite stages and computes evidence fingerprints and impact. `oversight.ts` owns human responses, unified attention and batched stream summaries.
- `web/src/` renders Streams/Needs you/Changes/Connections. Work creation is external-only: the shared service requires an agent/source scope, browser sessions cannot create work, and the UI provides no creation form. Existing work can still be clarified with context edits and notes. Work exposes Active and History views with a scoped status dropdown. Active contains open/blocked work; History contains completed/cancelled work. SQL derives current status from lifecycle, latest run, and assignment before pagination. URL query parameters preserve view/status/selection; conservative polling refreshes visible data. Native forms and plain CSS keep the UI small.

Work list/detail responses include the source actor's display name. List retrieval joins the actor before returning paginated rows rather than adding a per-item source lookup. The presentation uses title-first rows and a retained selection/detail layout. Markdown content uses react-markdown/remark-gfm with HTML escaped, HTTP(S)-only links, and embedded images replaced with text. The renderer is memoized across polling; long activity previews are plain text, and before/after history is formatted only when expanded. The desktop bundle includes license notices for frontend dependencies compiled into the UI as well as server dependencies.

## Agent onboarding

`src/services/connections.ts` manages scoped agent identities, protected per-connection credential files, generated client configuration, local checks, and revocation. `agent_connections` persists setup and last observed MCP/tool activity; no plaintext token is returned to the browser. Generated stdio launchers use absolute Node/entry/credential paths and unique server names; client configuration files are never modified automatically.

The MCP facade reports initialization and successful tool calls through an agent-only endpoint keyed by the authenticated credential. Connection rows are published only after successful tool use and explicit owner completion. Draft status uses an owner-only endpoint; cancelled drafts revoke their credential and remain outside the completed list. Only the opaque draft ID/step are stored in browser storage for refresh recovery. A local diagnostic launches the real companion and exercises `list_work` with reporting explicitly suppressed; it cannot verify the user’s agent or create work. Status distinguishes pending setup, client detection, successful tool use, and revocation without implying continuous online presence.

`web/src/Connections.tsx` implements client selection, copyable configuration, and verification. Supported setup guides cover Codex TOML/CLI, Claude Code CLI/JSON, Claude Desktop JSON, and generic stdio clients. Project workflow setup is described in [agent workflow](agent-workflow.md).

## Durable model

Work has its own lifecycle, structured objective, criteria, provenance, revision, and timestamps. Assignment decisions, execution approvals, execution runs, attention requests, references, and events are separate rows.

Accepting responsibility sets ownership. Approving execution creates an immutable snapshot and one queued run in the same transaction. A database partial unique index prevents overlapping nonterminal runs for a work item, including a result awaiting review.

The inbox is unresolved attention, not a feed of every event. Assignment decisions resolve assignment attention. Results create review attention; expired claims create failure attention. Manual completion, review approval, and cancellation resolve the appropriate attention transactionally.

Every new external submission creates assignment attention in the same transaction as the work. Agents supply content, not routing or acceptance decisions. The capture schema exposes no destination; legacy destination fields are stripped, and the shared service enforces inbox intake for HTTP, MCP, and direct callers. Retries remain idempotent, including fingerprints from the old destination-based contract. A versioned migration restores inbox attention for previously bypassed, still-undecided work without reopening resolved assignments or closed work.

Events cannot be updated/deleted through ordinary SQL because triggers reject those operations. This is application audit history, not tamper-proof storage against someone controlling the local database. Context edits retain before/after data. Lease expiry is attributed to the Work Inbox system actor rather than falsely recording a human decision.

## Claims and recovery

Claims use a SQLite `BEGIN IMMEDIATE` transaction. They filter by the credential's owner, accepted/approved queued work, and priority then queue order. Each worker has at most one claimed/running attempt. The returned claim token is scoped to that attempt and never included in work-list/detail responses.

Worker messages require the authenticated worker identity, owner, matching claim token, and a current lease. Heartbeats and progress extend the lease. Message IDs deduplicate identical progress/results, and changed payloads under the same ID conflict. Duplicate execution approvals are rejected by revision/state checks rather than creating another run.

Expired claimed/running attempts become failed, generate one attention request, and are never put back on the queue automatically. New attempts require explicit approval. Pending approved queued work survives offline workers and server restarts. A lost result response may leave a successful persisted result awaiting review; the worker does not blindly repeat execution.

Run states are queued, claimed, running, awaiting_review, succeeded, changes_requested, failed, cancelled. Work completion is a separate human decision. The `blocked` work lifecycle value is reserved; no question/needs-input adapter behavior is exposed in this stub release.

## Local security

The installation has one owner and one workspace. Locally issued agents and workers are delegated actors with distinct scopes. Workspace/visibility fields are structural preparation, not implemented team authorization.

The server binds only to 127.0.0.1 and rejects unexpected Host/Origin values. The browser bootstraps its session through POST /api/session with an exact trusted Origin and JSON content; it reuses a valid session or silently renews a cleared/expired one. The endpoint rejects bearer credentials so scoped worker/agent tokens never become owner sessions. Browser writes require an allowed Origin and JSON content. Cross-site API requests and untrusted same-site requests are rejected using Fetch Metadata in addition to Host/Origin checks. Session cookies are HttpOnly and SameSite Strict. Tokens are stored hashed in the database; plaintext worker/agent files and database directories receive restrictive permissions. Input is validated and bounded; output lists/events/runs are capped. React renders task content and artifacts as text and validates all external links as HTTP(S).

Local processes and people who can use this computer remain inside the trust boundary: there is intentionally no account authentication for the local UI. A local process with access to the owner's files remains inside that boundary. Public deployment, protection from malicious same-user processes, advanced rate limiting, credential pruning, and multi-user security are outside this version.

The browser isolation approach follows [OWASP’s Origin and Fetch Metadata guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Scaling path

SQLite and synchronous queries are appropriate for the current local, low-volume workflow. Migrations and foreign keys establish a real relational model. PostgreSQL would require a driver/schema/migration conversion and revisiting queue locking; Drizzle does not make that automatic. Keeping worker access behind HTTP allows the database implementation to change without rewriting worker transport.

A real adapter must be designed separately: supported provider invocation/authentication, allowlisted resources, isolation, execution limits, cancellation, and review evidence. Task content remains untrusted even after a person accepts the assignment.

## Streams and cooperative tracking

`src/services/streams.ts` adds immediate-transaction stream intake/scope decisions, structured context, typed change prerequisites, output reports, and cooperative session claims. `src/services/stream-data.ts` supplies sanitized tracking and content-based assessment fingerprints. Metadata and plan revisions remain separate from work lifecycle revisions; routine notes and reports do not invalidate plan assessments. Scope/output changes can stale downstream assessments. Phase-specific graph validation permits start-after-output/integrate-after-consumer relationships while rejecting impossible cycles.

Migration 0005 is additive. Existing work receives unknown, ungrouped metadata. Human acceptance/completion and legacy execution tables retain their boundaries. Proposed streams/scope revisions and explicitly human-directed questions contribute stream rows to Inbox, independently of work attention. Stream closure is an explicit owner decision. Output integration and progress are reports with provenance, not independently observed SCM facts.

Cooperative claims are not worker leases. The caller selects a change; an immediate transaction reserves it and exact exclusive-resource names. Tokens are hashed and sanitized from ordinary responses. Credential/lifecycle revocation and expiry are visible as inactive claims, without scheduling or execution effects. Stream context returns bounded summaries and independent collection cursors rather than entire transcripts.

`src/workflow/` builds one canonical workflow into client skills/guidance. The scoped installer records managed hashes and refuses edits; it merges one Claude startup command hook while preserving unrelated settings. The desktop installs a stable workflow helper next to the MCP launcher. Local context retrieval uses the protected credential file and a short timeout. Codex receives a project fallback and optional onboarding plugin assets; automatic Codex hooks and marketplace registration remain out of scope.

The 0.2.1 review fixes bind dependency assessments to the exact `assessmentFingerprint` returned with a consistent context snapshot. Plan writes precede assessment; an upstream edit between read and write conflicts. Dependency comparison sorts semantic edges, so array order cannot invalidate an assessment or disrupt an active claim.

A cooperative claim now requires the caller to retain a private token before submission. Only its original actor/credential/session/token can replay a lost response; the server stores only the hash and returns the same lease without extending it. Finished attempts do not restart on replay. Context summaries budget serialized JSON escapes, retain full-record links/counts, and trim oversized output summaries as needed. Open human-directed questions sort before routine findings in both UI and agent pages.

## Stream-first oversight (0.3.0)

Migration 0006 adds parentage, immutable scope approvals, coverage references, reported delivery, human actions/answers, typed flow edges and stream output reports. The assignments table is rebuilt transactionally to add a distinct covered state, preserving every existing row. No old stream gains coverage automatically. New stream acceptance explicitly approves routine decomposition; an owner can separately enable this on a legacy active stream. Explicit within_scope intake derives coverage server-side. Missing declarations and expansion remain proposals.

Composition has one parent, while start/deliver prerequisites can cross the tree. Flow gates distinguish reported output/outcome availability from human action completion and outcome acceptance. Cancellation is not satisfaction. Fingerprints version relevant plans, scopes, ancestry, approvals and evidence; progress wording and context notes stay outside them. Legacy change dependency writes synchronize only change-sourced flow edges. Assessments from older fingerprint formats remain attributed and become stale.

One typed attention predicate supplies the total, badge and list. Impact uses a batched relationship index and deduplicates shared requests/ancestors. The overview reads a consistent snapshot and aggregates descendant inventory/activity without recursive card queries. Detail collections and context have pagination; bounded context clips escaped serialized text and preserves IDs, counts, links and independent cursors. Pausing an ancestor, invalidating coverage or reporting delivery revokes claims; resume never revives revoked leases.

Reported delivered changes move to inspectable history without changing the human lifecycle or closing parents. Human questions save an answer and resolution together; action responses require revisions/idempotency and owner provenance. None of these records grants execution or Git authority.
