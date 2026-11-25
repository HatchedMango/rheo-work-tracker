# Connected design context

## Goal and approach

Keep assumptions, scoped invariants, and acceptance-criterion evidence alongside existing work without changing legacy text criteria or introducing approval gates. Add versioned design records, explicit assumption-to-change review links, and attributed semantic history using existing work/stream events. Use the term assumption for assertions; cooperative claims remain agent work leases.

An assumption records status, evidence, invalidation conditions and references. A change explicitly reviews a particular assumption revision with a reason. Later revisions flag that change for review; they never invalidate outputs, alter delivery/lifecycle, or create a human request. A further explicit review acknowledges the current revision while retaining the source status.

Invariants have an exact stream/change scope, a named applicability, and opt-in stream-subtree inheritance. Sibling/ancestor work never inherits a child's invariant. Verification records snapshot an exact text criterion/index, checked code revision, conditions, limitations, timestamp and evidence. Changed criteria make prior records historical; a pass is attributed evidence for those conditions, not blanket proof or a delivery gate.

Only semantic record changes append history, with reason and source references; unchanged writes are no-ops. Git remains implementation history. Reads and writes are bounded and authorized, updates use expected record revisions, and retries use idempotency keys. New records participate in context freshness and are available in focused recovery and UI details.

## Verification

Test schema boundaries, idempotency/conflicts/author access, legacy migration preservation, scoped inheritance/reparenting, assumption review flags without lifecycle/count changes, criterion edits and bounded pagination. Exercise API/MCP routing, compact-context drift and UI details. Run typecheck, service suite, browser suite, formatting and repository checks. Installation and release remain separate from source implementation.

## Result and verification

Implemented as unreleased workflow 1.12 with additive migration 0017, versioned design records, explicit assumption reviews, four MCP tools and authenticated API endpoints. Stream/work details and the selected-work inspector expose scoped context, review flags and qualified criterion evidence. Existing activity shows semantic before/after changes. Independent design versions refresh focused context and open views when relevant records change.

Verification on November 25, 2026: full service/API/MCP suite 196 tests across 24 files and full Chromium suite 29 scenarios passed. After the final relation-label refinement, all 43 focused design/API/MCP/migration/sync tests and the desktop/mobile design-context browser scenario passed again. Typecheck, production build, formatting, whitespace and repository exclusions passed. Desktop/mobile screenshots were inspected; no horizontal overflow at 390px. The production bundle emits a size advisory slightly above 500 kB (approximately 154.5 kB gzip).

Migration verification compares every pre-existing fixture table and retains legacy text criteria, credentials and history. Assumption review tests preserve delivered state, recorded output and completion credit while flagging changed sources. Existing work and credentials were preserved; this change’s own tracking records were updated. The installed Mac application, client catalog, project bindings and unrelated outputs were untouched. No commit, push, installation or publication was performed. Native packaging and real-client use of the new tools remain separate checks.
