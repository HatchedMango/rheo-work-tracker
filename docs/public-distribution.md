# Publish Rheo installers without publishing development source

The development repository `HatchedMango/rheo-work-tracker` stays **private**. `HatchedMango/rheo-downloads` is the **public downloads-only repository**. It has its own Git history and contains only `README.md`, `INSTALL.md`, `LICENSE`, and `NOTICE`. Its release assets are the versioned DMG, ZIP, build metadata, and `SHA256SUMS`.

The public documents are maintained in `distribution/`; copy the root `LICENSE` and `NOTICE` unchanged. Public releases use `docs/releases/<version>.md` as their body. Do not clone, mirror, fork, or change the visibility of the private source repository to prepare the public repository. GitHub's automatic source archives should contain only the public documents.

## Prepare a version

1. Increment the patch version in `package.json` and the root entries in `package-lock.json`; update public download links and release notes. Never replace existing versioned artifacts with different bytes.
2. Run formatting, typecheck, tests, and repository exclusions/history checks. Review the changes and commit the source; push it to the existing private remote. Check the hosted Checks result for that exact commit.
3. Using Node from `.nvmrc` and a clean source checkout, run the commands below. Release verification checks provenance, checksums, bundle privacy exclusions, project notices, and signatures. Native verification uses isolated temporary data and must pass before upload.
4. Run a redacted secret-content scan of the source history, public document staging directory, and unpacked app payload. Do not print findings containing secrets. Inspect build metadata for exact commit, `sourceDirty:false`, architecture, runtime, signing, and notarization state. Do not claim notarization or receiving-Mac verification from these checks.

```sh
npm run desktop:build
npm run desktop:verify
npm run release:check
```

## Prepare public contents

Use a separate staging directory outside the development checkout. Copy only these four files:

| Source                    | Public path  |
| ------------------------- | ------------ |
| `distribution/README.md`  | `README.md`  |
| `distribution/INSTALL.md` | `INSTALL.md` |
| `LICENSE`                 | `LICENSE`    |
| `NOTICE`                  | `NOTICE`     |

Initialize a new Git history there and verify its complete tracked file list before pushing. Keep personal data, credentials, source history, source maps, tests, internal plans, and machine bindings out. Only deliberately bundled runtime code belongs in the installer; JavaScript in a shipped app is inspectable.

For an existing downloads repository, inspect its owner, visibility, remote history, and release tags first; update it without force-pushing. Never overwrite an unrelated repository or existing release. The GitHub connector currently cannot create repositories or upload releases; the authenticated GitHub CLI is used for those operations. Do not print or copy its credentials.

## Publish and verify

Create a **draft prerelease** in the public repository at its public documentation commit. Upload exactly the four verified assets for that version. The source commit belongs in the build metadata, not as a public repository tag target. Inspect the draft and asset digests before publishing it. Retain the prerelease flag while this is an ad-hoc/non-notarized trial.

Use explicit version links in public instructions: GitHub's latest-release redirect does not select prereleases. After publication, fetch the public repository, documents, and release without authentication. Download the assets into a fresh temporary directory and compare all three manifest entries against both local and downloaded bytes. Verify the private development repository is still private and the public Git tree contains only the four allowlisted documents.

The current channel is manual and does not auto-update installed apps. For a later version, repeat the clean build, verification, public document update, and draft publication. No cross-repository publishing token or automatic release workflow is required.
