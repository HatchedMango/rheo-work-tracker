# Try Work Inbox on another Mac

## Scope and approach

Prepare a private GitHub trial for a second Apple Silicon Mac with separate local work and a new local agent connection. Preserve this Mac's app, database, credentials, client configuration and default project selection. The user authorized completing the available preparation and publishing steps; no public release or license choice is implied.

1. Audit all Git history and the publishable snapshot for secrets/private runtime files. Put machine-specific exclusions in the shared ignore file. Keep generated binding/skill/hook files out of the source distribution.
2. Replace stale onboarding with portable current instructions, a second-Mac checklist, backup/restore/update guidance and explicit signing/verification limits. Pin the release runtime and document source ownership/licensing as undecided for this private pilot.
3. Add read-only CI for formatting/typecheck/unit/integration/browser/build checks and a manually requested Apple Silicon package verification/artifact workflow. Pin external actions and provide installer checksums and build provenance.
4. Validate a clean source snapshot with a fresh dependency installation, then tests/build/browser checks and native package verification outside the current checkout. Verify the payload contains no local state. Prepare versioned private prerelease assets and release notes.
5. Use existing authorized GitHub access where possible to create a private repository, publish the reviewed history and prerelease, and observe CI. If repository creation/release credentials or Developer ID distribution credentials are unavailable, finish the local deliverables and identify the exact remaining step. Do not substitute connector tokens, create signing credentials or make the repository public.

## Success and limits

A fresh checkout reproduces the documented build; source and installer artifacts are inspected and versioned. Existing runtime state remains outside Git/artifacts. The user can download/install on their other Mac, create a new MCP connection and try a real task with recovery, restart, backup and update checks. Actual work-laptop behavior and automatic Codex/Claude lifecycle delivery require observations on that laptop; isolated local tests cannot certify them. Shared inbox/cloud hosting and public licensing are outside this trial.
