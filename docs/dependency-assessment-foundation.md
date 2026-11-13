# Make work dependencies explicit

Implementation of foundation slice 0 from [the product plan](agent-workflow-product-plan.md), authorized by the user's “do it” after the readiness review. Scope: explicit prerequisite information and its presentation. Activity/attempt tracking, question-as-prerequisite sources and richer verification remain future work.

## Reporting contract

App 0.7.0 / workflow 1.5.0 adds `review_dependencies` and `assess_dependencies`, backed by authenticated shared services and HTTP operations. Each change or stream reports starting and delivering separately: linked, none with rationale, or uncertain with a next step. Empty edge lists alone remain unassessed. Legacy fingerprint-only reports remain readable as not fully assessed, never converted to independence.

The review includes the chosen stream subtree (default: the target's stream), or ungrouped work, plus recorded direct cross-stream sources/targets. An ancestor scope can cover related branches. Pages contain at most 100 records and 48 KB of escaped JSON, with full-record links and a correct next cursor. Complete scopes are capped at 1000 items; larger scopes remain explicitly partial/uncertain or must be focused. A submitted report names the unique IDs actually reviewed, including its target, scope ID, coverage, target revision and scope/plan fingerprints. Complete coverage requires all inventory IDs. Stage results must agree with the saved typed prerequisite set. Save plan changes before reviewing/reporting.

Material inventory snapshots include scope/hierarchy, expected outcomes/interfaces, areas/resources/base references, prerequisite endpoints, relevant output versions and source ancestor scope. New/reorganized/materially changed work or output/scope drift invalidates the report; ordinary progress notes and routine findings do not. A read/report race conflicts rather than certifying an unread state. Reports are append-only and attributed; stable idempotency keys replay the same report without another write. Unknown/stale/uncertain, coverage and prerequisite satisfaction are separate facts.

`claim_change.purpose=implementation` invokes managed preflight: complete/current reports with neither stage uncertain, satisfied start gates and ancestor start gates, plus all existing credential/session/token/revision/lifecycle/lease/resource checks. Delivery gates can remain unmet while work starts. Managed renewal rechecks assessment and start gates. Exact claim replay retains the original purpose/session/token/expiry; it is recovery, not a new readiness check. A drifted/released claim cannot change purpose through replay. Release is still possible after drift.

`purpose=collaboration` preserves planning and older clients. That path does not certify implementation readiness. These are coordination checks, never execution authority. Work Inbox cannot prove the factual completeness of an agent's reasoning or stop agents outside the protocol.

## Human presentation

Map/List cards, stream group headers and selected details distinguish links unassessed, not fully assessed (legacy), dependencies recorded, no prerequisites, links uncertain and links needing rechecking. Stage rationale, next step, reviewed scope, author and time are secondary disclosure detail. Quiet delivered work remains readable without extra card badges; selecting it still exposes its assessment. Work stays Planned until its progress is reported; a dependency report is not a scheduling decision. The older review report is labelled In review, not automatically Ready.

Arrows still represent actual start/delivery prerequisites only. No independence edges or fake loops are added. No new approval or Needs you item is generated for missing information: API validation tells the agent how to repair its report. Shared instructions and generated client skills describe the required flow. Optional new claim fields and tool names may require an existing client's MCP reload/new chat.

## Compatibility and deployment

Migration 0009 adds report and managed-claim-reference tables without rewriting existing tables, work, decisions, legacy assessments or credentials. New data is exposed alongside the old fields; current agent context summaries bound rationale separately to preserve the 48 KB package budget. No execution worker, new connection permission or remote endpoint is enabled. Existing project binding/defaults and unrelated hooks/settings must remain intact.

## Verification

Before packaging: 108 tests across 15 files, all 15 browser scenarios and typecheck pass. New cases cover schema/rationale requirements, legacy versus explicit-none, independent start with a delivery gate, cross-stream source/ancestor drift, scoped inventory changes, routine-progress stability, per-projection cache consistency, partial/uncertain reports, managed claim/replay/renewal, planning compatibility, safe reorganization, ungrouped work, escaped/paged/over-limit reviews, HTTP authority, actual stdio MCP operations and preservation of every old table in migration. Browser checks exercise Map/List/detail state agreement, none/uncertain/stale transitions, scope rationale, no false edges and narrow layouts.

Screenshots of the isolated branch fixture were visually inspected. Build/package and all six packaged native verification groups passed. The two focused map/assessment browser scenarios passed again after the final presentation and bundle refinement. Keeping the label helper separate from server schemas held the UI JavaScript bundle to about 463 KB (143 KB gzip), avoiding an unnecessary validation-library import. Existing real client hook trust/delivery, compaction, Claude/Herdr lifecycle, independent clean-machine testing and public notarization retain their previous verification limits.

## Delivered locally

Installed **0.7.0 / workflow 1.5.0** in `/Applications/Work Inbox.app`, with the previous 0.6.0 app, data and project guidance retained under `~/Library/Application Support/Work Inbox/backups/dependency-assessment-0.7.0-20261113T172649Z`.

Before any post-install agent writes, compared every original column/row in all 28 existing data tables. Old migration entries were preserved with only 0009 appended, the two new tables were added, foreign-key checks passed and protected credential/global Codex configuration metadata was unchanged. The native app reopened with all existing work and truthful legacy/unassessed states. Conflict-aware workflow preview/install/check completed without conflicts; default pilot binding and byte-identical hooks were preserved.

Reviewed all 13 real inventory items/full records in the personal-use stream. Reported explicit no-start/no-delivery prerequisites for this bounded implementation, with rationale that the existing map/storage baseline is already present and later planned synchronization/planning work does not supply a required input. Recorded only this assessment; no fake work, links or historical independence was added. Acquired a new `purpose=implementation` claim through the live API after releasing the old collaboration claim, exercising managed preflight against the real report. The existing connected MCP `get_workflow` returned 1.5.0 and `get_work` returned the current staged report and managed claim. Native Map/List and full work detail showed its rationale/scope consistently. New tool/schema round trips also passed over actual stdio in the isolated MCP test; this existing chat still needs MCP reload/new chat to expose newly registered tool names/claim fields.

This is local release evidence, not proof of independently correct agent assessments, automatic client hook/compaction delivery, Claude/Herdr lifecycle or public distribution readiness. Completeness/consistency/freshness is validated; absent real-world constraints cannot be discovered through schema checks alone. Planning/legacy collaboration remains available without certifying readiness. Activity attempts, question sources, richer verification, automatic parking/association and the rest of everyday synchronization remain future work. Prior uncommitted product plan and current source changes are preserved; no commit or push.
