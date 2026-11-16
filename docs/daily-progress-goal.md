# See daily completed changes against a personal target

The daily goal counts Work Inbox changes reaching done. It needs no GitHub/GitLab connection and covers code, documents, research and other tracked changes. The user explicitly approved using the existing Delivered milestone instead of merged MRs; manually marking a change Complete is also a finishing milestone.

## Counting rule

Each distinct change earns one credit at its first Delivered or Completed milestone. Repeated reports, subsequent manual completion, reopening and redelivery never create another credit, even on a later day. Reopening does not erase historical credit. This measures first completions, not the number of currently closed cards or verified repository merges.

Migration 0012 adds `change_completions` and target preferences. The pending MR-provider migration was never installed and was replaced before release. The completion ledger uses the change ID as its primary key; SQLite triggers insert the credit in the same transaction as the milestone. Rollbacks cannot leave a credit behind. Backfill takes the earliest explicit saved completion evidence: tracking events, timestamps retained in reopening history, manual-completion events and known delivery timestamps. It does not guess dates for records lacking evidence or rewrite existing work.

The browser's IANA timezone defines the local calendar day, including daylight-saving transitions. The count is complete even though the detail list shows at most 30 changes. Target changes use expected revisions. The default target is 5 and can be edited in the app.

## Presentation

Daily progress stays prominent in the desktop sidebar and becomes a compact horizontal card on mobile. The main ring fills toward the target. An outer ring plus exact percentage and “+N over goal” show additional progress; counts and percentages remain uncapped beyond multiple goals. At 8 against 5, the display shows 160% and +3. The outer ring fills from 100% to 200% and stays full thereafter, so additional completions never make the ring shrink. Totals and percentages continue increasing.

The card reads current local data every three seconds while visible, on returning to the app, and at midnight. Offline rollover clears yesterday's display. The goal dialog explains the counting rule, edits the target and links to today's completed changes. Concurrent edits preserve the draft and show a revision conflict instead of silently overwriting another target.

The counting source remains separate from the visual and settings through a small internal function. There is no provider setup, remote authentication, general goal engine or counting-strategy menu. The earlier hosting-service question was answered through the enabled attributed chat relay with the user's chosen direction.

## Verification

Service/API coverage checks delivered/manual completion, repeated reports, reopen/redelivery across days, local dates, immutable historical credit, atomic rollback, owner privacy, target bounds/revisions, the limited detail list versus full totals, DST and offset timezones, and uncapped over-goal totals. Migration coverage preserves old rows, recovers the earliest known delivery through reopening history, preserves manual completions and excludes ambiguous dates.

Browser coverage uses actual local create/deliver APIs to verify automatic progress, target persistence, over-goal totals, completed-change links and mobile overflow. It also checks offline midnight rollover (retaining the saved target) and concurrent target edits. Screenshots use isolated test data.

Initial delivery passed all 145 backend tests across 20 files and all 23 browser scenarios. Build, typecheck, formatting/diff checks and all seven packaged native verification groups pass. Desktop/mobile screenshots and the actual native card/goal dialog were inspected.

## Installed local preview

Installed the separate current-source 0.8.1 preview (workflow 1.6.0, uncommitted source). Backup: `~/Library/Application Support/Work Inbox/backups/daily-progress-20261116T194652Z`. Before post-install reporting all original rows in all 32 existing tables matched. Only migration 0012 and the two goal/completion tables were added; all 19 completion credits matched independently recovered earliest known evidence. Foreign keys were clean, protected connection/client metadata was unchanged, and the default target was 5. Clean private-trial release artifacts were preserved. No GitHub/GitLab authentication, new permissions, execution worker, commit, push or publication.

## Appearance and wording review

The card now says Changes today, with one done count, a Goal button and short remaining/over-goal labels. Removed the repeated footer and retained a readable refresh notice only when needed. Zero progress has no colored dot. Large totals scale to fit the ring, including the narrow mobile layout. The goal dialog uses consistent goal wording, explains the first-completion rule and local midnight reset, and focuses/selects the number on opening. Concurrent-edit feedback preserves the draft and explains saving it again.

Review verification: build, typecheck, formatting/diff checks, eight relevant service/API tests, five focused browser scenarios (including the new zero/exact/far-over-goal and 320px checks), and all seven packaged verification groups pass. The broader browser pass also passed the other 19 scenarios. Fixed percentage rounding so unfinished work cannot read 100%. Actual installed Mac card and named goal dialog inspected, including automatic number selection.

Updated the separate local preview; backup: `~/Library/Application Support/Work Inbox/backups/goal-polish-20261116T204214Z`. Before reporting, every row in all 34 original tables matched; migration rows, protected metadata and saved target were unchanged, and foreign keys were clean. The reopened task retained its one existing completion credit. No migration or counting-policy change.
