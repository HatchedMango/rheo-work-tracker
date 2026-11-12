# Visual system

Work Inbox 0.3.1 keeps the minimal interface while adding depth and meaningful state cues. The app uses the existing system font, Lucide icons and plain CSS; no UI framework or dependency was added.

`web/src/tokens.css` owns the palette, surfaces, spacing, corner radii and shadows. `web/src/UI.tsx` owns shared status badges and worker presence. Screen layouts and responsive rules remain in `styles.css`. Avoid introducing per-screen status colors or implicit unclassified button styles.

## Surfaces and controls

Use a quiet off-white canvas and white reading surfaces. Stream cards receive a soft two-part shadow and slight hover lift. Human requests use a restrained amber edge, request icon and shared response button. Dense changes and feeding streams remain flat rows; dialogs use the stronger overlay shadow. Secondary controls use one shared size/radius treatment; primary actions stay charcoal. Inline navigation, selection and focus use blue.

Cards use 12px corners, controls 6px, and compact containers 8px. Spacing comes from the shared 4px scale. Supporting text stays at least 11px; it remains readable rather than fading into decorative gray. Status labels use sentence case. Icons accompany labels rather than replacing their meaning.

## State semantics

- **Blue:** active/moving work, selected navigation, current agent assessment and attributed output/delivery reports. Stream coverage is blue and labeled explicitly; it is distinct from individual acceptance.
- **Amber:** human decisions/questions/actions, blockers, pending verification and stale assessment.
- **Green:** verified MCP setup, owner-accepted/completed outcomes and a worker currently reported online by the status API.
- **Red:** failures, error messages and destructive actions.
- **Neutral:** inactive, unknown, disconnected, paused or cancelled states. Cancellation is not success or failure evidence.

A verified MCP connection gets a green check and retains last-activity text. It is not a continuous-presence claim. Worker dots use the status API's live `online` result; the production app currently has no execution worker and retains the neutral absent-worker indication. This visual pass does not enable execution, change heartbeat policy or invent availability.

## Accessibility and verification

Text/status foreground-background pairs meet at least 4.5:1 contrast in the light palette; the lowest checked pair is 4.58:1. Color is paired with labels and, where helpful, icons. Keyboard focus uses a visible blue outline. Reduced-motion preference removes card lift/transition and smooth prerequisite scrolling. Coarse-pointer controls use 44px targets and readable input sizing. Layout was inspected at desktop, 390px and 320px widths.

Validation for this pass: 80 existing service/API/MCP/workflow tests, all 14 browser scenarios (including truthful worker status), typecheck, formatting and diff checks; additional isolated checks exercised keyboard navigation/focus, reduced-motion hover, human response layout and all four main screens at 320px. Packaged native/runtime/MCP/lifecycle checks passed. Final small CSS refinements were also exercised against built assets. Test fixtures stayed isolated from real work.

The installed `/Applications/Work Inbox.app` was updated to 0.3.1 and visually checked in its native window. A private app/data backup was saved under the application-support `backups/visual-0.3.1-*` directory. All 26 persisted tables and four real work items matched their pre-update digests before verification telemetry/handoff writes. Protected credential and Codex configuration metadata remained unchanged; their contents were not read or printed. The original connected `list_work` and `get_workflow` calls succeeded after replacement. No sample data was added to the live installation, and the source changes remain uncommitted.
