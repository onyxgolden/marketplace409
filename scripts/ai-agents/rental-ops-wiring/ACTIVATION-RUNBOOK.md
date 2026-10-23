# Rental-ops wiring — activation runbook (P2a-1)

Status of this build: **WIRED_INERT / SYNTHETIC_RUNTIME_VERIFIED / LIVE_NOT_AUTHORIZED.**

Nothing in this slice can run against live data. The mode enum is
closed (`DISABLED`, `SYNTHETIC_PREVIEW`); production-live execution is
unconditionally `ACTIVATION_REQUIRED`, and there is no toggle, flag,
request field or UI path that changes that. The deployable read
adapter refuses to exist without an injected authorized read
capability, and no capability is provisioned, no credential is read,
and no scheduler registration exists anywhere in this slice.

## What a future activation requires (all of it, in order)

1. Jason's explicit activation word naming: the agent (Property
   Manager — an approval for it does not activate Maintenance
   Manager), the owner/portfolio, the field allowlist version, the
   read principal, the retention settings, the clock policy and the
   schedule.
2. A separately reviewed code change that enables live mode (the
   activation word alone does not flip this release).
3. A live qualification run proving, with minimal access: permission
   isolation, source coverage, status/date mapping fidelity against
   the real schema, real-portfolio capacity within the invocation
   budget (over-cap portfolios currently produce a bounded
   BUDGET_EXCEEDED report — partitioning is deferred scope), and
   private storage behavior on the production host.
4. Host placement where the live source and the runtime are
   co-located behind the authorized read boundary. Rental items and
   decisions never enter Git or the drop's `workbench/items` store;
   the private store lives in an operator-owned state directory
   outside any clone. A host layout that cannot satisfy this is an
   activation blocker, not permission to put data in the drop.
5. Retention defaults proposed by the brief until Jason rules
   otherwise: raw normalized snapshots 24 hours; reports/decisions
   30 days; access restricted to Jason; no backups/export.

A failed qualification leaves the agent DISABLED and produces a fix
slice. These agents never become the rent/payment/maintenance
execution path; Workbench decisions are review metadata only —
"accept" means "accept this assessment", never dispatch, spend,
contact, close, collect, waive or authorize.
