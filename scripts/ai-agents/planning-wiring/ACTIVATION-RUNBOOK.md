# P2b-1 Activation Runbook — READ BEFORE ANY ACTIVATION TALK

**This slice ships DISABLED + SYNTHETIC_PREVIEW only. Nothing in
this slice activates anything. There is no workflow, timer, cron,
Bridge job, or schedule registration. The job does not read
production, does not write production, and does not run on a
schedule.**

## What DISABLED means

With the host mode DISABLED, `runJob` returns before any adapter,
credential, private store, or source is touched. The counters prove
it (all zero). DISABLED is the default and the safe state.

## What SYNTHETIC_PREVIEW means

The only installed adapter is the synthetic repository: invented
rows in memory, owner- and scope-filtered like RLS, paged, with
fault knobs for the battery. A synthetic preview runs the full path
(synthetic authenticated repository → bounded snapshot → assessment
→ private item/evidence → Workbench review/decision) and nothing
else. No real project data is ever read, and no real snapshot,
report, decision, identifier, derived hash, or screenshot is ever
written to Git.

## What activation requires (all of it, later, separately)

A future live activation requires ALL of the following, and none of
it exists in this slice:

1. A separately reviewed change that adds a production read
   capability (projection-only, admitted columns only, no
   `SELECT *`, no broad board JSON, no cost fields, no mutation
   RPC, no side-effecting GET).
2. Jason's per-agent word naming: the reviewed artifact, the exact
   owner/project set, the read principal, the fields, the clock
   policy, the retention, and the cadence.
3. A host-owned registration binding every identity and the exact
   job/window pair before adapter opening (a wrong-job window
   refuses).
4. A separately reviewed decision on retention, evidence expiry,
   and the Workbench state directory for the live lane (separate
   from the synthetic preview state).

Until then, any LIVE or PRODUCTION shaped request returns
ACTIVATION_REQUIRED, and any attempt to smuggle a mode, adapter,
URL, path, query, or credential through the request refuses.

## If someone asks "is it monitoring my projects?"

No. The honest labels for this slice are WIRED_INERT,
SYNTHETIC_RUNTIME_VERIFIED, and LIVE_NOT_AUTHORIZED. Never claim
"live", "monitoring your projects", or "operational".

## Emergency stop

Set the host mode to DISABLED. The runner returns immediately with
zero accesses. There is nothing else to stop: no schedule exists to
cancel, no worker persists, no queue drains.
