# Stream-first oversight implementation plan

Status: implemented in the 0.3.0 source pass, November 11, 2026; local release verification is recorded in stream-oversight-verification.md. This plan implements the [agreed product direction](stream-oversight-design.md).

## Outcome and first acceptance scenario

The human sees outcomes progressing through connected streams, understands which part is waiting, and can act on a request without reviewing every underlying change.

The first complete slice is:

1. The human approves an outcome and permits agents to maintain routine work within its scope.
2. An agent adds two feeding streams and their routine changes. They appear in Streams without separate Inbox approvals.
3. The agent raises “Get API access from Bob,” linked to a prerequisite of one branch.
4. Needs you shows that request, its immediate unlock, and its effect on the larger outcome. The other branch remains visibly active.
5. The human records that access is available. Dependency evidence and affected summaries update; nothing executes automatically.
6. Agents report delivered outputs. The human can inspect the changes, but only material decisions and requested outcome review require attention. Parent completion stays explicit.

Use isolated fixtures for this scenario until real work supplies an equivalent case. Do not seed demonstration work into the live installation.

## Decisions to implement

### Streams and approval coverage

Add an optional parent to streams. One parent gives each stream a clear home; prerequisite links can cross that tree. Reject containment cycles and missing/cross-workspace references. Unrelated top-level streams remain independent.

Store stream approval as a durable owner decision with its scope revision and routine-work policy. New stream acceptance clearly includes approval of routine decomposition within that scope. Agents explicitly declare an addition as within approved scope or as a scope proposal. The server derives coverage from the owner's stored decision; agents cannot supply an accepted state or manufacture an approval record.

Routine child streams and changes may be covered by an active approved ancestor. Record their source, covering approval, and scope revision. Distinguish **covered by stream approval** from **individually accepted** in responses and history. Keep legacy individual decisions intact.

Existing streams retain their old policy during migration. Provide an explicit owner action to enable routine-work coverage on an existing stream; do not silently accept its old proposals. Enabling coverage affects future additions. Any owner decision covering existing proposals must enumerate those records and apply transactionally.

New top-level direction, unknown coverage, and declared scope expansion still enter human intake. A move within the same approval boundary is routine planning; a move across approval boundaries requires an owner decision. Revalidate affected coverage, assessment fingerprints, and claims when moving a branch or accepting a scope change. Pausing/closing an ancestor prevents new descendant claims and revokes affected active leases without resurrecting them on resume.

The app validates declared relationships and approval provenance. It does not decide whether an agent's description is semantically within scope. Reports must remain attributed, and an agent that identifies broader scope must propose it explicitly.

### Routine delivery and human acceptance

Covered changes need an agent-reported `delivered` state so routine completion does not create a second approval chore. This is separate from human lifecycle completion and independent integration observations. Preserve reported-by/time/output evidence; do not write a fake owner completion event.

Ordinary active-change queries can exclude reported-delivered work by default while retaining an inspectable history. A request for human review appears in Needs you only when explicitly raised. Reporting delivery does not close a parent stream. Keep individual acceptance/completion available for legacy or specifically reviewed work.

Give streams an attributed current progress summary/phase and an explicit outcome-available report. Allow outputs to reference their stream or change, with the same source/revision distinctions as existing output reports. A stream report is not inferred merely from child counts. Optional milestone checks are explicit evidence, not generated percentages.

Claims remain caller-selected cooperative ownership. A new claim requires individual acceptance or effective stream coverage, an active ancestor chain, and work not currently reported delivered. Resuming delivered work is an explicit attributed report with a reason. Retain private-token replay and expiry behavior; delivery never silently dispatches another agent or grants execution authority.

### Human requests

Add durable human actions with a stream, concise request, completion condition, responsible owner, optional waiting-on party, state, revision, and provenance. Start with open, in progress, done, and cancelled. Agents raise requests; the owner records completion and can reopen them. An author may withdraw an obsolete request with an explanation. Cancellation is not proof that its prerequisite was satisfied.

Keep questions distinct from actions. Extend the existing question flow so the human can save an answer and resolve it in one transaction; a resolution flag alone is insufficient evidence of the answer. Preserve actor/time and append-only history. Human responses need expected revisions and retry protection so uncertain delivery does not duplicate answers.

No general manual work-creation form is needed. The human interface focuses on responding to requests raised through external intake/MCP.

### Dependencies and impact

Generalize the current change prerequisites to typed sources and targets. Support:

| Prerequisite | Recorded condition                                      | Dependent        |
| ------------ | ------------------------------------------------------- | ---------------- |
| Change       | Output available / integrated                           | Change or stream |
| Stream       | Outcome available, reported / outcome accepted by owner | Change or stream |
| Human action | Done, with human provenance                             | Change or stream |

Retain start versus integration/delivery gates. Validate supported combinations, duplicate edges, missing entities, self-links, and impossible stage cycles. Composition does not silently create a prerequisite that every child must finish before the parent can start.

Represent unknown assessment, unsatisfied conditions, and stale evidence separately. Fingerprints include relevant scope/containment/approval versions and prerequisite/output/action revisions. A caller must submit the fingerprint it read; unrelated notes and progress wording do not invalidate planning evidence.

Compute direct blocked targets and downstream affected streams separately. Deduplicate shared requests by stable identity. Rollups describe known blocked portions and activity elsewhere; they must not label an entire parent stopped just because one child is waiting. An absence of recorded blockers is not a claim of assessed readiness.

Use indexed relationship queries and a batched traversal over the relevant subtree/dependency neighborhood. Avoid a recursive database lookup per card. Read summaries and fingerprints from a consistent snapshot; bound context payloads with counts, omission markers, and cursors.

Build one typed attention query covering approval decisions, human questions/actions, and requested outcome reviews. Use the same query rules for the badge, total, and paginated Needs you list, so combining entity types does not create mismatched counts or duplicate requests.

## Implementation sequence

| Slice                          | Concrete output                                                                                                                                           | Acceptance evidence                                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation and policy       | Additive schema/contracts for nesting, owner approval coverage, reported delivery, human actions, and typed edges; central authorization/coverage helpers | Existing IDs/history/credentials survive; no retroactive acceptance; agents cannot grant coverage or expand authority; individual and covered work remain distinguishable                                   |
| 2. Relationships and requests  | Transactional services for parentage, dependencies, human responses, scope moves, and impact summaries                                                    | Cross-stream prerequisites work; cycles fail atomically; direct/transitive impact is deduplicated; action completion updates evidence and stales affected assessments; an independent branch remains active |
| 3. Agent protocol              | Scoped HTTP/MCP operations and bounded stream context for the new model, with maintained workflow guidance                                                | A participating client creates covered routine work without attention spam, raises a human request, sees its resolution and impacted branches, and recovers the same facts after handoff                    |
| 4. Human view                  | Streams overview/tree, Needs you, stream detail, and change drilldown                                                                                     | The initial acceptance scenario works in the native window and narrow layout; no per-change approval chore, fabricated percentage, or compulsory graph canvas                                               |
| 5. Migration and local release | Compatibility checks, documentation, packaged build, protected backup, and installed-app verification                                                     | Legacy intake stays accessible; existing MCP settings/credentials work; desktop lifecycle/runtime checks pass; real data is preserved; no sample records are introduced                                     |

Implement these on the current stack. Keep policy/coverage and graph queries in dedicated services consumed by work intake, claims, attention queries, and context retrieval. Shared predicates must prevent the UI and MCP from applying different approval rules. Do not add a parallel scheduler or execution system.

Connect a small usable UI to slices 1–3 early so policy and model behavior can be reviewed through the real flow. Complete the slice before treating the new presentation as shipped.

## Human interface details

- **Streams** is the normal landing view. Show outcome, an attributed progress summary, current waiting portions, and human attention. Expand feeding streams; keep changes collapsed until requested.
- **Needs you** contains direction/scope decisions, unanswered human questions, human actions, and requested outcome reviews. Each row leads with the request, then what it unlocks and the affected stream. Routine reports and covered additions are absent.
- **Stream detail** orders outcome/context, human requests and their impact, feeding streams, delivered outputs, then changes and activity. Use explicit milestone evidence if available; change counts remain inventory.
- A blocker opens a focused dependency path/list with links to affected streams. A whole-workspace graph is optional future exploration.
- Human actions provide a small response/completion form and clear waiting-on state. Do not solicit credential values into task content; the action records access availability and where the agent can use it.
- Preserve direct links to work and old view URLs through aliases. Ungrouped legacy work stays discoverable and keeps its existing decision flow.

## Compatibility and migration

Use new migrations after `0005_streams.sql`; never edit that applied migration. Add matching Drizzle definitions and explicit indexes. Preserve legacy change-dependency semantics while introducing typed edges. Maintain old tool names and old create/list/get/update behavior where possible; optional new fields must not change existing idempotency fingerprints when omitted.

New operations use explicit `streamId`, `changeId`, `claimId`, and revision names rather than ambiguous generic fields. Preserve existing aliases with validation during the transition; do not accept conflicting aliases. Advance the workflow/schema version and update managed guidance through the existing conflict-aware installer.

Keep historical assessments and their attribution. If a new fingerprint version invalidates an old assessment, show it stale for agent refresh rather than rewriting it as a current assessment. Routine stale bookkeeping does not become a human approval request.

Keep the original pilot binding/report intact. Plan and track this implementation separately from the completed Codex workflow-validation work; do not make a new activation experiment a prerequisite to development.

## Focused verification

Service/API/MCP regressions must cover:

- Covered versus individually accepted versus undecided work, including absent/forged approval references and idempotent retries after a policy change.
- New child streams, same-root reorganization, cross-root moves, ancestor pause/close/reopen, and claim revocation without lease resurrection.
- Separate containment and stage cycles; legitimate parallel branches and cross-stream dependencies.
- One human action blocking several targets, partial blockage, deduplicated ancestor counts, cancellation, completion, reopening, and concurrent responses.
- Assessment drift between read and write, no-op dependency reordering, private claim replay, and bounded escaped/Unicode context containing human requests before routine history.
- Agent-reported delivery without owner completion, explicit human review requests, and a parent that stays open after planned children finish.

Browser checks should exercise the complete initial scenario, readable nested navigation, change drilldown, human answers/actions, and narrow layouts. Packaging checks should cover the bundled runtime/helper, migration and persistence, normal shutdown, and original MCP connectivity.

After those pass, exercise the feature in ordinary development. Record actual friction and fix demonstrated problems; another artificial implicit-activation pilot is not a release gate. Human approval and claims remain bookkeeping, not authority to execute code or Git operations.

## Ready-to-start boundary

No further product decision is required for the first pass. The approved direction resolves the central approval-policy choice. Exact SQL layout and component boundaries are implementation choices within the behavior above.

Deferred: autonomous planning/dispatch, critical-path scheduling and estimates, automatic SCM observations, multiple parents for composition, mandatory workspace-wide graph navigation, shared-team authentication, and hosted deployment.
