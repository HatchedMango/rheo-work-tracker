# Check linked merge requests without changing work reports

In **Connections → GitLab evidence**, enter your GitLab HTTPS URL and a token with `read_api` access, preferably scoped to the relevant project. The host is configurable: GitLab.com and company-hosted GitLab use the same adapter. Hostnames and tokens are installation data, not product defaults or repository content. The first version supports one configured GitLab origin per Mac.

Saving access stores it in protected local application storage; it does not claim the token has been verified. Link an MR as a change output through the normal agent workflow, then select that change and choose **Check GitLab** beside the output. The app only makes `GET` requests for that explicitly linked MR. It does not crawl projects, modify GitLab, follow redirects, or send access credentials to a different host. GitLab access does not change existing agent/feedback permissions.

The inspector and change details keep two separate facts:

- **Reported evidence:** the actor's output state, timestamp and code revision.
- **GitLab observation:** MR state, matching head pipeline status, checked time and observed revision.

Checks are snapshots, not live guarantees. An edited output or different pinned code revision makes an older observation historical. Failed/unavailable checks show that failure without overwriting the output report. Output edits, disconnected/replaced access and revoked agent credentials during a request cause that response to be discarded. Observations cannot mark a change delivered, satisfy its existing reported integration gate, answer a human request, or add daily completion credit.

Access can be updated or removed in Connections. The token is held in a mode-600 file under the app's private `integrations` directory; it is never returned by the API, stored in work records or browser persistence, or included in installer artifacts. Removing local access does not revoke the token at GitLab; revoke it there when appropriate.

Administrators can instead set `RHEO_GITLAB_CONFIG` to an absolute private JSON file containing `origin` and an absolute `tokenFile` reference. Both files must be private regular files outside any repository; file permissions alone do not prevent commits. `tokenFile` contains only the token. An externally managed configuration is read-only in Connections. Use an HTTPS origin such as `https://gitlab.example.com` without a path, query or embedded credentials.

The local workflow helper's `evidence --binding BINDING --session-id SESSION` reads the selected change's evidence. Add `--output-id OUTPUT_ID` to check that specific MR using the same configured adapter. The low-level output-reporting APIs remain unchanged. Other hosting providers and multiple simultaneous GitLab access profiles can be added without changing graph or delivery semantics.

References: [GitLab merge requests API](https://docs.gitlab.com/api/merge_requests/), [GitLab REST authentication](https://docs.gitlab.com/api/rest/authentication/).
