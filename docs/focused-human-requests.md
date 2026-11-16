# Make requests for input clear and easy to act on

The person should immediately see the action or question, how to handle it when useful, and a short reason. Background should not obscure the next step.

## Approach

- Add optional structured guidance to existing human actions and questions: up to five steps, copy-only text, a short reason and an optional recommendation.
- Share the presentation between Needs you and selected requests in the work map. Keep required instructions visible and background/completion criteria under Details. Legacy requests retain their full instructions; no heuristic extraction or rewriting.
- Allow the author or owner to clarify an open human action in place with revision and idempotency checks. Preserve its identity, state, response, attribution and prerequisites. Content revisions refresh the selected map inspector.
- Update agent guidance and the actual GitHub sign-in request. Copying instructions never runs them or records a human response.

## Verification

Migration 0011 adds empty JSON guidance to human actions and context entries. Migration coverage verifies prior content, identities and states survive. Service coverage checks round trips, author/owner permissions, revision conflicts, replay, legacy omitted-field retries, bounded schemas and completed-request protection. Actual stdio MCP tests exercise guided creation and in-place revision.

All 135 backend tests across 18 files and all 20 browser scenarios pass. Final build, typecheck and focused service/browser checks pass after review. Browser coverage checks visible steps/reason, raw text copying without execution, collapsed background/completion, live selected-request refresh, question recommendation and mobile layout. Desktop/mobile screenshots were inspected. The separately packaged local preview passes all seven native verification groups.

Existing chats may need to reload their MCP catalog to expose optional guidance fields and the revision tool. Stdio verification establishes server behavior, not automatic client catalog reload or hook delivery. Existing requests are only rewritten intentionally. No GitHub authentication, command execution, human completion, commit, push or publication is part of this change.

## Local preview

Installed the separate current-source 0.8.1 preview (workflow 1.6.0, uncommitted source) in `/Applications/Work Inbox.app`. Prior app, stopped data and project guidance are backed up at `~/Library/Application Support/Work Inbox/backups/focused-human-requests-20261115T015639Z`. Before post-install reporting, original columns and rows in all 32 existing tables were unchanged; only migration 0011 and empty guidance columns were added. Foreign keys were clean. Protected connection/client metadata, hook bytes and the default project selection remained unchanged after guidance setup.

The existing GitHub request was revised in place to “Sign in to GitHub,” with three steps, a copyable command and a short reason. Its ID, original author, background, completion criteria, open state, empty response and real trial dependency were preserved. Actual native map and Needs you layouts were inspected. Local generated agent guidance is current; this chat's pre-existing MCP catalog still requires reload/new chat for the new optional fields/tool. Clean private-trial release artifacts were preserved.

## Calmer request cards

Needs you cards use a soft lavender surface and a plum border, without a decorative left bar. A compact plum pill combines the hand/question icon and Needs you label; the blue selection outline stays independent of request status. Map, List, the selected-request badge and the Needs you navigation count share the palette. Request colors are separate from amber waiting/warning colors. Existing hover, keyboard focus, footer and delivered-card surfaces remain intact.

The initial visual pass passed 18 existing browser scenarios. The plum/lavender revision passed build, typecheck, formatting/diff and three relevant browser scenarios: the whole-card state matrix, focused instructions/mobile overflow, and connector geometry. The final decorative-bar removal passed build, formatting/diff and the two existing surface/request browser scenarios. Desktop/mobile screenshots were inspected. Plum label contrast is 5.82:1 on its badge and 6.62:1 on the card surface. This pass changes presentation only; request content, state and dependencies stay unchanged.

The plum/lavender preview passed all seven packaged checks. The final bar removal updates only frontend assets in a copy of that installed bundle, preserving the 59 server/runtime build files and native binaries. The updated bundle signature was verified. Latest backup: `~/Library/Application Support/Work Inbox/backups/no-bar-request-cards-20261116T155746Z`. All 32 tables and migration entries matched, foreign keys were clean, and protected file metadata was unchanged before post-install reporting. The actual native map was inspected with no left bar. No commit, push or publication.
