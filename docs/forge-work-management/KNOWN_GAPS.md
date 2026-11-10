# Known gaps — Work Package Planner

Per `docs/BUILD_CONTRACT.md` §4/§5 (forge-ai-drop drop repo): a disabled control or an
unimplemented feature is an honest status, not a completed feature, and is recorded here
rather than silently left as a mismatch between what a control promises and what it does.

## Milestones tab — NOT IMPLEMENTED, disclosed

**Status:** NOT IMPLEMENTED. **Owner's word:** disclosed in the tab's own on-screen copy
since the 8-tab UI-density redesign (PR #758); re-confirmed as a disclosed, not-fixed gap
by the 2026-11-10 Planner audit (finding D20), which explicitly instructed not to build it
in that fix batch.

The "Milestones" tab on a Work Package's detail view is a placeholder paragraph with no
controls. Milestone tracking (the 14-milestone timing backbone, per-package planned/actual
dates, percent complete, the ±7-day late flag) arrives with slice 9. Nothing to fill in
until that slice lands.

## Activity / Audit tab — partially implemented

**Status:** PARTIAL. Fixed 2026-11-10 (Planner audit finding D20) to show the package's
status-transition history (moved from the Overview tab, where it was real but misplaced)
instead of showing nothing but the Danger zone card.

**What's still missing:** a full field-level audit log — every edit to the package record,
every link created/removed, every attestation, every scope-baseline freeze/change decision —
is not captured in one place today. Each of those events is individually tracked in its own
table (transitions, attestations, baselines/scope changes, links), but there is no unified
per-package activity feed joining them chronologically. Building that is a larger, separate
piece of work than this fix batch's scope (a UI-bug sweep, not a new feature); it is recorded
here as a real gap rather than claimed as closed by the status-history fix above.

**Next action:** scope a proper package-level activity feed (likely a view or RPC that unions
the four source tables by timestamp) as its own slice, when prioritized.
