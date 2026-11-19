# Install Rheo on your Mac

Requires an **Apple Silicon Mac running macOS 13 or newer**. Intel Macs are not supported by this download.

## Download and install

1. Open the [Rheo 0.9.1 release](https://github.com/HatchedMango/rheo-downloads/releases/tag/v0.9.1). Download `Rheo-0.9.1-macOS-arm64.dmg` and `SHA256SUMS` into the same folder. The ZIP contains the same app as an alternative.
2. In Terminal, change to that folder and run the command below. It verifies the DMG against the downloaded manifest. Checksums identify the downloaded bytes; they are not a code signature.
3. Open the DMG and drag **Rheo** into **Applications**. Launch it from Applications.
4. The trial is **ad-hoc signed and not notarized**. If macOS or device management blocks it, wait for an approved Developer ID signed/notarized build. Do not disable Gatekeeper, strip quarantine flags, or change work-device security policy.

```sh
shasum -a 256 -c SHA256SUMS --ignore-missing
```

Confirm `Rheo-0.9.1-macOS-arm64.dmg: OK` appears. If it does not, stop and download the files again. To check every manifest entry, download all three versioned assets, then run `shasum -a 256 -c SHA256SUMS`.

## Connect Claude Code or Codex

1. Open **Connections → Connect an agent** in Rheo. Create a fresh connection on this Mac.
2. Give the setup prompt to Claude Code or Codex with configuration access on this Mac. Preserve other MCP servers and follow any client trust/reload instructions.
3. Have the actual client call Rheo's `list_work` tool. A new installation should be empty. Finish the connection after that succeeds.
4. In **Set up existing work**, add your active project folders. Paste each project's prepared prompt into that project's existing agent chat, where the context already lives.
5. Return to Rheo to check **Context received** and **Checkpoint saved**. These report what Rheo received; they do not certify that every automatic client hook has run.

Rheo includes its runtime. Node, npm, and a source checkout are not required. Each Mac owns separate work and connections; use this Mac's local project paths. Preparing prompts alone creates no work or completion credit.

Closing the window leaves local intake running. **Quit Rheo** (⌘Q) stops the app and service. The Mac must be awake with Rheo running for agents to reach it.

## Update and back up

Quit Rheo with ⌘Q. In Finder, choose **Go → Go to Folder** and open:

```text
~/Library/Application Support/Work Inbox/
```

Copy the entire `data` folder to a private dated backup outside any repository. Keep the matching old app too. The legacy folder name is intentional; it preserves existing work and connections.

Replace Rheo in Applications, open it, and confirm work and agent access remain. Never upload the data folder: it contains work and protected credentials. Each Mac needs its own backups and connections.

For a same-Mac restore, quit Rheo, preserve the current data separately, restore the whole stopped-data backup, and use its matching app version. Do not combine databases or replace just one live database file. Installing an older app alone cannot undo a database migration. Review connections after restoring an older backup.
