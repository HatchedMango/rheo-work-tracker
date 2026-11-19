# Rheo identity and upgrade compatibility

Rheo (REE-oh), formerly Work Inbox, keeps work streams, progress and agent context connected. The user chose the name and a professional mark of three flowing paths joining into one. Animal explorations were discarded.

The mark is defined in `src/shared/brand.json`. The web sidebar uses its vector geometry directly; AppKit uses the same geometry for the Dock and template menu-bar icon. Vite generates the browser favicon from the same source; there is no separately maintained SVG copy. Tile radius, mark inset and integer sRGB palette are shared by the favicon and Mac icon. The Mac canvas adds platform-sized transparent margins; the sidebar uses the existing accent tint, and the menu bar uses a resolution-independent monochrome template for system light/dark treatment. The deep blue tile fits the existing restrained interface; no model/provider identity is implied.

## Public identity

The web title/sidebar, connection/setup copy, native window/menus/errors, new managed workflow guidance and packaging use Rheo. The app is `Rheo.app`; distributable names begin `Rheo-`. Existing historical work, system actor names and activity are not rewritten. Fresh installations seed the system display name as Rheo.

## Stable compatibility contracts

This is a display/packaging rename, not a data migration. Retain:

- `~/Library/Application Support/Work Inbox/`, including data, protected connection files, logs, backups and the atomic current-runtime pointer.
- Bundle ID `com.workinbox.desktop`, its show-instance notification and existing window preferences. Login registration remains associated with the same app identity; it may need re-enabling after replacement/movement.
- `WORK_INBOX_*` environment keys, package/MCP machine IDs, `work-inbox-mcp` and `work-inbox-workflow` stable launcher names.
- `.work-inbox` bindings, managed section markers and skill/plugin IDs. Existing client configuration and project selection remain valid. Generated text updates through the normal conflict-aware workflow installer, not a global edit of user settings.
- The existing private-repository name/path and old trial artifacts. Renaming/publishing that repository is outside this change.

## Existing Mac upgrade

Quit Work Inbox. Back up the old app, whole stopped data folder and local project guidance. Install Rheo in Applications and remove the old active app only after retaining the backup, so two names do not compete for the same bundle identity. Start Rheo against the same support root. Verify all original table rows/migration records and protected credential/client metadata before making new work reports. Check an actual existing MCP connection through its unchanged launcher, then inspect the native UI and menu.

Packaging verification exercises the renamed app, old support-root layout, imported legacy work/credentials, real stdio MCP, moving the app and restarting through the original stable launchers. The migration fixture explicitly retains the old system actor name to check historical attribution.

No SQL migration, credential regeneration, client permission expansion or repository publication is needed. Name research established meaning and noted existing software uses; no domain/trademark clearance is asserted.

## Verified local preview — November 17, 2026

The Rheo app is installed in `/Applications/Rheo.app`. Before replacement, the old app, stopped data and project guidance were backed up in `~/Library/Application Support/Work Inbox/backups/rheo-branding-20261117T152311Z`. All 34 existing table contents and migration records matched immediately after launch, foreign keys were clean, and protected connection/global client metadata was unchanged. The old active Work Inbox bundle was removed only after backup; existing history remains intact.

Validation: 145 backend tests, 24 browser scenarios, typecheck, formatting and diff checks passed. The final color adjustment also passed 17 relevant browser scenarios. All seven packaged verification groups passed, covering native routing, import/credentials/real stdio MCP, workflow lifecycle, duplicate/port isolation, app movement/recovery, AppKit Quit and clean setup. An existing connected tool call and the original installed stdio launcher both returned the Rheo workflow after upgrade. The installed native window, sidebar mark, daily goal and stream map were visually inspected.

The normal project workflow installer refreshed managed display text without conflicts and retained the explicit binding and protected credential path. Hook trust/automatic hook delivery is not established by this update. This is a local ad-hoc signed preview from uncommitted source, not a published or notarized release; prior clean trial artifacts are untouched. No commit or push was made.

## Logo quality pass

The approved silhouette and visual weight are retained; the original strokes are now combined into one filled outline. The favicon and Mac tile now share their interior layout. Dock icon artwork sits within an 824px tile on the 1024px canvas, with matching proportional margins for every representation. The menu-bar image draws vectors at the destination resolution rather than capturing a single display backing scale. Native icon export uses an explicit sRGB canvas and exact pixel dimensions at 1×/2×. The mobile sidebar mark now has a square 19×19px box; desktop remains 26×26px.

The polished preview was installed after backing up the prior app/data at `~/Library/Application Support/Work Inbox/backups/rheo-logo-quality-20261117T162700Z`. All 34 existing tables and migration records matched immediately afterward; foreign keys and protected connection/client metadata remained unchanged. Typecheck, build, formatting, focused desktop/mobile browser verification, all ten raster size checks and all seven packaged native groups passed. Generated favicon geometry/layout and packaged source/assets matched. Desktop/mobile sidebar and native app icon artwork were visually inspected. System tinting of the vector menu-bar template uses AppKit; separate dark-mode OS inspection was not performed.

## Center-join correction

A user screenshot exposed a small-size seam missed by the initial pass: separately painted strokes overlapped at the confluence. The canonical mark is now one closed, filled outline, with no internal stroke edges or overlapping paint operations. The outline was derived from the approved round-capped strokes, preserving the silhouette. Web SVG, generated favicon and native rendering fill that same outline once. The join was inspected at 19, 20, 26 and 64 points at both 1× and 2×, plus the 512px icon. This continues the same logo-polish change; reopening and redelivery do not earn another daily credit.

The corrected app was installed with a stopped-data/app backup at `~/Library/Application Support/Work Inbox/backups/rheo-center-join-20261117T163507Z`. All 34 existing tables/migrations and protected/client metadata were preserved. Typecheck, build, formatting, the desktop/mobile browser check and all seven packaged native checks passed. The installed sidebar was inspected; served favicon and native geometry match the single outline. Changes today stayed at three after redelivery.
