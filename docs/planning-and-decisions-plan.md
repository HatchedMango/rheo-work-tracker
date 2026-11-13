# Planning, decisions, and conversation continuity

Superseded direction, November 12, 2026: the user requested removing app acceptance/decline for now, keeping only simple explicit human requests and optional chat links. See [simple-tracking-plan.md](simple-tracking-plan.md). The approval-centric portions below are historical proposals, not the current workflow or authorization to implement them. Immutable plans and automatic closeout remain unimplemented.

Status: remaining work planned and parked as of November 12, 2026; no implementation is underway. The synchronization subset was delivered in 0.3.2, committed in f493782, and retained in installed 0.3.3; see [synchronization.md](synchronization.md). Immutable plan versions and the broader attention/navigation redesign remain unimplemented. The user has also agreed to agent-owned routine closeout and quiet parking on focus changes; that direction is recorded below, without treating discussion agreement as implementation approval. This document refines `stream-oversight-implementation-plan.md`; existing composition, prerequisites, output reporting and visual design remain the foundation.

## Product behavior

Work Inbox helps the human understand outcomes, progress, relationships, and where their input matters. The human normally collaborates with agents in their existing conversations. The app remembers those decisions and provides an overview, with optional responses at meaningful checkpoints.

Every piece of work has an approach before implementation. Planning depth varies; planning itself is universal. Showing an approach and requiring another explicit approval are separate concerns.

| Situation                                                  | Agent behavior                                                                                       | Human attention                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| New stream or independent request                          | State the intended outcome and brief approach; develop the plan within the authorized planning scope | Approve the implementation plan and boundaries before implementation                         |
| Small fix within approved scope                            | Record and present understanding, approach, and verification before editing                          | No additional acceptance unless requested by the human or required by an existing checkpoint |
| Larger covered change or feeding stream                    | Record a proportionate plan, outputs, dependencies, and verification                                 | Continue within the approved boundaries; raise unresolved decisions explicitly               |
| Material change to outcome, constraints, risk, or approach | Propose a revised plan and explain the difference                                                    | Approve the changed portion before proceeding with it                                        |
| Human prerequisite                                         | Ask for one concrete action or answer and link what it unlocks                                       | Respond in chat or in the app; resolve the same request                                      |
| Routine output delivered                                   | Attach evidence and update progress                                                                  | Visible in progress/history; no automatic acceptance request                                 |

For a small fix, a sufficient plan might be: “The filter is omitted when returning from detail. Preserve it in the URL; check back navigation and reload.” A separate document, research phase, or approval form would add no value here.

For substantial work, the plan includes outcome, approach, boundaries, proposed outputs/substreams, sequencing and independent branches, uncertainties, human prerequisites, and verification. Full detail can remain in the repository or another existing document; Work Inbox stores the concise summary and an identifiable revision/reference.

## Closeout and focus changes

Agents maintain routine closeout without requiring the human to announce they are done. Report delivery when implementation and the required verification support it; preserve evidence and remaining limitations. Delivery remains separate from human acceptance and stream outcome completion.

When focus moves, reconcile the previous work: report delivery if justified, park unfinished work with a concise handoff if it is no longer being pursued, retain actual prerequisite blockers, and leave a human request only for a specific consequential decision. A topic switch or silence does not establish approval or completion. Required checks remain gates; future improvements and additional validation must not silently broaden the original change forever.

The current app has no parked state: for the manual project cleanup, planned progress plus an explicit parked handoff retains unfinished work without claiming implementation is in progress. Planned work still appears in Active and proposed work can still appear in Needs you. A future implementation must distinguish parked/planned work from current activity and defer its attention without accepting or declining it.

## End-to-end flow

1. The human asks an agent to investigate or plan an outcome. Record that planning authorization from the conversation, without another kickoff click.
2. The agent records its initial approach, investigates, and proposes a plan. Draft decomposition is allowed during planning, but carries no implementation coverage.
3. The agent presents the concrete plan in chat and creates one matching decision request: “Approve the plan for …”. The app can show the summary, exact revision, boundaries, and source conversation.
4. Approval in that chat or in the app resolves the same request and records implementation coverage for that plan/scope. “Create a plan” never counts as “implement it”. If a reviewed brief approach and explicit implementation authorization already exist together, do not manufacture another checkpoint.
5. Agents maintain covered substreams and changes, each with its own proportionate approach. Their ordinary creation and delivery do not create human chores.
6. Human questions, prerequisites, selected checkpoints, and material proposed changes surface when needed. Resolution updates the recorded prerequisites and affected branches.
7. Delivery reports show evidence. Outcome review occurs only when requested or part of the agreed checkpoints. Delivery does not silently close a parent stream or claim human acceptance.

This works at any stream depth. A feeding stream does not need a separate approval merely because it is a stream; it needs one when it introduces direction outside the approved boundary or an agreed checkpoint calls for it.

## Model and validation

### Plans and authorization

Add lightweight, immutable plan versions attached to a stream or change. A version contains:

- Understanding/outcome, approach, and verification, with optional constraints, uncertainties, output outline, and document reference.
- Author, creation time, predecessor, and reason for revision.
- Relationship to an existing implementation approval, or to a pending decision request.

Do not reuse the existing `planRevision` counter as a human-readable plan identity: it currently participates in dependency assessment and claims. Keep those concurrency/fingerprint semantics intact.

Record planning authorization separately from implementation approval. Planning may investigate and draft decomposition; it does not grant covered implementation claims. Add an explicit planning-purpose claim where cooperative ownership is needed, checked against planning authorization. Existing implementation claims continue to require accepted/currently covered work and a recorded approach. Distinguish plan creation from executing its proposed changes.

Bind implementation approval to an immutable plan version plus the approved scope and boundaries. Routine task-plan refinements can reference that baseline without requiring its reapproval. Material revisions create a new decision request; they do not overwrite the approved version. Unchanged, authorized branches may continue unless the proposed change explicitly makes them unsafe or the human pauses them. Reject claims for the changed, unapproved portion.

The agent supplies the scope/materiality assessment and reason. The app validates identities, revisions, coverage, and state transitions; it cannot independently judge whether an approach is sensible or semantically within scope. Missing or uncertain coverage must not become implicit approval.

### Explicit decisions and requests

Introduce stable decision requests for planning kickoff when needed, implementation plan approval, material revisions, and selected reviews. Each carries a target, exact plan/scope revision, concise requested decision, reason, and affected work. Keep questions and non-coding human actions as their existing domain records; adapt them to a common attention/read model rather than duplicating their state in another inbox table.

Requests have explicit pending, resolved, cancelled, or superseded state. A replacement plan supersedes its old pending approval request; a response to that stale request cannot approve the replacement. One response resolves one identified request and performs its relevant transition atomically. Approval of a plan must not also complete unrelated access requests or accept all historical work.

Use shared service methods for UI and conversation responses so coverage, history, impact, and badge counts agree. Derive attention from unresolved requests rather than raw `proposed`, `review`, or delivery statuses. New unapproved direction still gets an actionable decision request; removing status-driven prompts must not hide it.

### Feedback from conversations

Add a narrow MCP operation to relay explicit human feedback for an identified request. Require request ID, expected request/plan revision, response kind and content, source client/session, an event/message reference when available, and an idempotency key. Record the reporting agent and receipt time separately from the claimed human source and its timestamp.

Support answers, plan decisions, selected review responses, and reports that a human action is done. Preserve the difference between “the human says access is ready” and “the agent verified access works”; prerequisites can retain that evidence distinction. A relay cannot grant general owner powers, alter connections/settings, reopen arbitrary history, or broaden the approved target through extra fields.

Enable relay permission once per trusted connection through local owner-controlled setup, with a clear “Sync decisions from my chats” setting. Existing credentials are not silently promoted. The protected credential file can remain unchanged; store the capability in server-side connection permissions. Revocation prevents future relays without deleting history. The normal flow must not require confirming every relayed response in the app.

This is an explicit trust boundary: a normal MCP agent cannot cryptographically prove that a human said something in another client. The app can prevent stale, duplicate, mismatched, and unauthorized transitions, but a permitted agent still reports the conversation faithfully. Label such events “Reported from Codex/Claude …”, distinct from a direct local owner response. Do not promise automatic observation of all conversations or perfect semantic correctness.

Refresh bounded context with pending requests and recent resolutions first. Agents reconcile feedback before raising a new request or resuming related work. A retry after a successful response returns the existing result; conflicting concurrent responses require reconciliation. App failure must be reported as unsynchronized feedback, never as a saved decision.

### Conversation origin

Store client type, native conversation/session ID, and optional machine/project/workspace context on requests and decision events. A stream may involve several conversations; preserve the relevant origin per request rather than one global chat URL. Accept missing origin metadata gracefully.

Generate return actions from validated client metadata. Do not accept arbitrary shell commands or custom URI schemes supplied in work content. Opening a conversation is a user action and never sends a message, starts implementation, or starts another agent.

## Interface changes

**Streams:** lead with the outcome and concise progress. Add a compact current approach/plan summary and its approval state: planning, awaiting plan decision, or implementation authorized. These describe different dimensions from blocked/delivered. Show human requests with their immediate unlock and downstream impact. Keep detailed changes collapsed.

**Stream detail:** outcome and progress, current approach/plan with reference and revision, unresolved human requests, feeding streams and relationships, outputs, then changes/activity. Preserve readable history of prior plans and decisions without turning the app into a document editor.

**Needs you:** show the specific question, action, or decision first, then why it matters and what it unlocks. Provide “Open conversation” when supported. Keep a compact optional app response for users already there. Remove blanket change-acceptance rows and duplicate review prompts when an explicit request is the same decision. Do not surface an item merely because an agent reported delivery.

**Change detail:** show its short understanding/approach/verification and the scope covering it. Preserve output links, evidence, provenance, and direct legacy URLs. No general manual work creation screen is added.

Reuse the current shared tokens, badges, controls, and elevation. Amber continues to mean unresolved human attention; green does not imply that an agent-reported outcome was independently verified.

## Implementation sequence

### 1. Plans and explicit requests

Add the next additive migration after `0006`, schemas, plan versions, decision requests/responses, planning authorization, and connection relay capabilities. Extend stream coverage to reference the approved plan without rewriting historical approvals. Implement shared transitions and concurrency/idempotency checks first.

Connect a small UI slice: show the approach, request its approval, and respond locally. Prove that planning can proceed without granting implementation coverage, and that approval covers routine descendants. Existing accepted work remains valid; missing historical plans appear as “not recorded”, with an approach required before the next implementation claim rather than invented retroactive plans.

### 2. Conversation synchronization

Expose narrow MCP plan/request/feedback operations and return pending request IDs in context. Add source metadata, capability checks, and attributed decisions. Update workflow instructions and generated Codex/Claude guidance: plan every change, present approaches before edits, reconcile explicit human responses, avoid duplicate requests, and escalate material changes.

Use the existing conflict-aware setup installer; preserve unrelated instructions, hooks, servers, and credentials. Existing Herdr hooks must survive setup. Tool-catalog reload may be needed; verify through the actual connected client before claiming this workflow works there.

### 3. Attention and stream presentation

Switch the shared attention predicate, counts, stream summaries, and detail views to the explicit request model. Add the compact plan/authorization presentation and affected-branch links. Keep one request visible once across rollups, while preserving its full impact.

The first usable vertical slice includes steps 1–3: plan in chat, approve there, create covered work, resolve a real human prerequisite from chat, and see the app update without duplicate acceptance.

### 4. Return to the right conversation

Implement Codex return-to-chat first, validating support in the installed client and restricting the native navigation handler to the supported conversation URL shape. Provide Claude Code session identity and a copyable resume action; add direct opening only where the actual client supports it. Opening an existing session must not silently launch a duplicate.

Preserve optional Herdr origin metadata now. Defer an active Herdr focus adapter until tested against the user's actual Herdr variant and its native session identity. Pane status alone never resolves a Work Inbox request. Missing/remote/stale origins get an honest fallback rather than a broken “Open chat” button.

### 5. Legacy reconciliation and release

Migrate pending legacy approvals into explicit requests without duplicating existing scope/review decisions. Preserve old decision events and reported outputs. Do not automatically accept proposals because they were delivered, or because current chat contains an unrelated go-ahead.

For this installation, reconcile the known desktop, stream-oversight, and visual-pass records against the specific earlier chat authorizations. Append attributed historical decision evidence and resolve only the matching obsolete acceptance requests through the new service. Where no immutable historical plan exists, label the record as historical authorization rather than manufacturing plan approval. Do not claim final acceptance or completion from permission to implement.

Package and verify the native app, back up installed app/data, and preserve original work and connection files during update. Keep the existing pilot manifest binding and its completed validation history intact; record new implementation work separately when implementation is authorized. Preserve the uncommitted visual pass. No commit or publication is part of this plan.

## Acceptance checks

- A tiny covered fix records and presents an approach before edits, then proceeds without an extra app acceptance step.
- A new stream can be planned without implementation coverage. Plan approval authorizes its bounded implementation and ordinary descendants.
- A changed plan cannot reuse an old pending response or silently expand coverage. Routine decomposition does not invalidate the whole stream's approval.
- Feedback in chat resolves exactly the same request shown in the app, updates blocking relationships/counts, and remains visibly attributed to the relay source.
- Duplicate delivery/retry is harmless; wrong request/revision/connection, disabled relay permission, superseded plans, and conflicting concurrent responses are rejected or reconciled without corrupting history.
- One access request can block several branches; resolving it leaves other prerequisites and unrelated branches accurate. Reported action completion remains distinguishable from verified technical readiness.
- Routine delivery remains visible without a new human chore. Parent completion stays explicit.
- Return-to-chat targets the intended session; missing clients, invalid links, stale identities, and unsupported Claude/Herdr contexts have usable fallbacks.
- Existing work, historical approvals, dependency fingerprints, claim replay/expiry rules, legacy routes, and protected connection files survive migration/update.

Use focused service/API/MCP/migration tests and browser scenarios for these behaviors, then typecheck/build and native runtime/lifecycle checks. Validate chat synchronization through the real connected MCP client, including recovery in a fresh session; a standalone launcher check is insufficient. Prototype/test data stays out of the live inbox. If real-client feedback tests cannot run, state that limitation rather than declaring the connection workflow verified.

## Scope boundary

First release: proportional plans, meaningful approval checkpoints, explicit requests, attributed chat feedback, a simpler overview, Codex navigation, and honest Claude fallbacks.

Later: active Herdr navigation, authenticated client event adapters, automatic chat observation, optional external runners/dispatch, hosted/team permissions, and marketplace distribution. Keep their seams available without making them prerequisites.

Work Inbox continues to record and validate coordination. Approval, coverage, and claims do not grant execution, Git, publishing, or messaging authority. Agents and their client configuration remain responsible for those actions.
