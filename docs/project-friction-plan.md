# Keep tracking quiet and MR evidence useful

Apply the November 19 receiving-machine feedback as generic product behavior, with no company domains, project scripts or repository-specific policies.

1. Quiet unselected prompt/stop hooks. Recover selection guidance at startup/resume/compaction; selected sessions retain current context, exact revisions, outbox recovery and conflict handling.
2. Persist an optional project checkpoint policy, preserving the existing checkpoint-once default and explicit session overrides. Observe mode still records unsynchronized state; it never claims progress is saved or disables another hook.
3. Extend explicit read-only MR checks with GitLab's mergeability, draft, conflict and blocking-discussion fields. Missing/checking fields stay unknown. Provide agent guidance to check a linked MR at review/delivery milestones without interpreting repository scripts or running a background poller.
4. Retain bounded safe failure codes, HTTP status and fixed next-step messages. Never store response bodies, credentials, or provider error text. Preserve old observations and all existing work graph/daily completion rules.
5. Default new app-managed GitLab tokens to macOS Keychain through a small native Security-framework bridge. Pass secrets over stdin, never process arguments or environment. Keep legacy/external private-file configuration compatible; failed Keychain access must not silently fall back to a plaintext token file. Other platforms retain explicit private-file support.
6. Keep visible guidance branded Rheo while preserving old package, skill, application-data and launcher identifiers for compatibility.

Validate unselected/selected lifecycle behavior, project/session precedence across restart/setup, stale and failed MR responses, partial/unknown readiness, credential-update races, Keychain rollback/removal, and unchanged graph/sync/daily-count regressions. Inspect desktop and narrow evidence UI; compile and verify an isolated Mac package. Real client trust/loading, real remote access and machine policy remain distinct observations. No release, installation, commit or push is implied.

## Result and verification

Implemented in unreleased workflow 1.8.0. Context injection after compaction stays on the clients' supported `SessionStart(source=compact)` path; no extra PostCompact hook is installed. An explicitly invoked PostCompact adapter only invalidates local freshness. Existing MCP tools and compatibility identifiers remain; the added `check_output` tool needs an actual client reload before use.

On November 19, 172 service/unit/integration tests, all 27 browser scenarios and nine isolated Mac verification groups passed. Additional focused checks cover the final lifecycle correction, legacy-file-to-Keychain updates, denied Keychain writes without file fallback, delayed MR checks and visible HTTP-401 guidance. Desktop/narrow screenshots were inspected. Typecheck, formatting, repository-path checks and a source-only secret scan passed. Native Keychain write/read/delete verification uses a disposable test keychain, not the user's login keychain; production helpers do not contain its test-only path override.

No company host was contacted or embedded. The source remains uncommitted and the installed app, private project binding and published installers remain unchanged. Actual Claude/Codex trust/loading, access to a real GitLab instance, Keychain access policy on the receiving Mac and distribution signing/notarization are separate checks.
