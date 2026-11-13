# Publish the private Mac trial

The intended first repository is `HatchedMango/WorkInbox`, **private**. The connected GitHub app can read account/repository data but cannot create repositories or upload release assets. GitHub CLI and browser sign-in are separate. Finish the local checks and commit before publishing; never copy a connector token or credential into commands/chat.

## Authenticate and create the repository

On this Mac, sign the GitHub CLI into the intended account:

```sh
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth status
```

Complete the browser/device authorization yourself. The additional `workflow` scope is needed to push the prepared GitHub Actions workflow files; review the requested repository/workflow access in that authorization. If GitHub proposes permissions or account changes beyond what you intend, stop rather than accepting them automatically. Do not paste tokens into this repository or chat.

After authentication, first check whether the intended repository already exists:

```sh
gh repo view HatchedMango/WorkInbox --json nameWithOwner,visibility,url
```

Only if it genuinely does not exist, create it without README/license initialization:

```sh
gh repo create HatchedMango/WorkInbox --private --description 'Local work context and progress for agent workflows'
```

If a repository exists, confirm it is the intended private repository and inspect its history before pushing; do not overwrite a conflicting repository or force-push. Do not change an existing public repository's visibility automatically. No organization access, collaborators or public visibility are needed for this trial.

## Push the reviewed source

From the clean source checkout, inspect `git remote -v`. If origin is absent, add the intended URL; if it differs, resolve that conflict before proceeding:

```sh
git remote add origin https://github.com/HatchedMango/WorkInbox.git
gh auth setup-git
git push origin HEAD:main
gh repo edit HatchedMango/WorkInbox --default-branch main
```

This preserves the local working branch and publishes its reviewed commit as the new remote main. Do not use `--force`, push unrelated branches or upload local work/credentials. Verify the remote commit and private visibility, then watch Checks finish. A local validation run does not prove GitHub-hosted CI passed.

## Publish the prerelease

Build and verify from the same clean commit, following `.nvmrc`. The release checker requires matching source provenance and inspects packaged files/signatures/checksums:

```sh
npm ci
npm run repo:check -- --history
npm run desktop:build
npm run desktop:verify
npm run release:check
```

Run a redacted all-history Gitleaks scan before uploading. Inspect `release/Work-Inbox-0.8.1-macOS-arm64.build.json`; sourceDirty must be false. Check that no `v0.8.1` tag/release conflicts with an existing artifact. Keep the repository private, and publish only these files:

```sh
gh release create v0.8.1 \
  --repo HatchedMango/WorkInbox \
  --target "$(git rev-parse HEAD)" \
  --prerelease \
  --title 'Work Inbox 0.8.1 — private Mac trial' \
  --notes-file docs/releases/0.8.1.md \
  release/Work-Inbox-0.8.1-macOS-arm64.dmg \
  release/Work-Inbox-0.8.1-macOS-arm64.zip \
  release/Work-Inbox-0.8.1-macOS-arm64.build.json \
  release/SHA256SUMS
```

Do not replace an existing release or artifact blindly. Verify the release's prerelease flag, tag target and downloadable file checksums. The installer remains ad-hoc signed/not notarized; publication is not Gatekeeper validation. The manually dispatched Mac trial package workflow also creates a verified private artifact set but never publishes a release automatically.

## Signing and the other Mac

Only an Apple Development identity was available during preparation. Developer ID distribution and notarization require the appropriate developer account/certificate and notarization credentials; none were created, read or uploaded. See `docs/desktop.md` for that separate distribution step. A private pilot can instead build locally from source where device policy permits. Follow `docs/second-mac-trial.md` and record actual observations on the work laptop before claiming fresh-machine or real-client verification.
