# FORGE Brain — Backlog (developed for the blitz session)

Steal-worthy patterns only; products, not products' marketing. Each entry is
**developed but unscoped** — the blitz session builds them in order, one at a
time, blockers skipped not stared at (Jason 2026-10-10).

Source of the 2026-10-10 entries: Yardi Virtuoso Enterprise (announced Oct 5,
2026; demoed at YASC San Diego Oct 7–9). PR-level detail only — pricing,
per-market availability, and demo-vs-real status unverified. Harvest the
patterns at zero marginal cost; do not copy the enterprise product.

Blitz order: B-1 → B-2 → B-3 → B-4 → B-5. B-6 is adopted convention, not a build.

## B-1 — Natural-language access to live Brain data

**Problem.** The Brain's value is locked behind fixed surfaces (digest,
action bar). Jason's #1 Brain ask: ask questions in words, get answers from
the live books.

**Shape.** A query box on Brain surfaces that parses NL into constrained
query specs (not free SQL), executes against read models with owner-scoped
RLS, and returns the answer plus provenance (which records it came from).
Start: `/forge/financial`. Later: everywhere the digest appears.

**Data in/out.** In: NL question + signed-in owner context. Out: answer,
record-level provenance, the query spec it ran. Reads: ledger events, digest
items, alerts, actions.

**Boundaries.** Read-only. Every read enforces owner RLS in the query layer
as a real rule — provable in tests, not a prompt instruction. Any action the
answer suggests routes through the existing gated execution (CONFIRM < 0.8,
409 on drift, 403 on bad gate) — no new execution authority. No
tenant-facing surface.

**Acceptance sketch.** RLS matrix: owner A cannot reach owner B's rows through
any NL phrasing (adversarial fixtures). 20-question fixture suite with exact
expected answers. Latency budget stated in the build brief.

**Depends on.** Nothing. First in the blitz.

## B-2 — Month-end close agent

**Problem.** Close is a manual checklist across ledgers; issues surface late
or not at all.

**Shape.** A close-check runner: runs the books (rental ledger, PF ledger,
bank rec, rent roll, GL hygiene), produces an issue list in plain language,
each with suggested next steps mapped onto existing Brain actions. On demand
plus scheduled. Output feeds the digest's anomaly ranker — no double-flagging.

**Data in/out.** In: owner + period. Out: issue list (severity, plain-language
explanation, suggested action or "informational").

**Boundaries.** Read-only detection. Suggestions only — no auto-posting, no
ledger writes, no new execution authority.

**Acceptance sketch.** Fixture books with planted issues (unreconciled bank
line, missing rent-roll entry, GL imbalance): all found, zero false positives
on clean books. Every suggestion traceable to a real Brain action or marked
informational.

**Depends on.** Ideally B-1's query layer; can build standalone against read
models if B-1 slips.

## B-3 — Lease/billing audit agent

**Problem.** Lease-terms vs posted-charges drift goes unnoticed until it
compounds.

**Shape.** Per-tenant / per-loan comparator: canonical lease terms against
charges posted. Flags: wrong amount, missing recurring charge, stale schedule
after a change. Read-only flags feed the anomaly ranker.

**Data in/out.** In: owner + tenant/loan. Out: mismatch list with
term-vs-posted evidence per flag.

**Boundaries.** Flags only — no dunning, no collections actions, no tenant
contact, no payment changes. (Correction, ChatGPT PR #604 review: a partially
paid charge is a payment/collections state, NOT a billing error. B-3 never
treats collection states as billing gaps.)

**Acceptance sketch.** Fixture leases with planted mismatches (unreflected
renewal increase, stopped recurring fee): all flagged; clean leases silent.
Precision favored over recall.

**Depends on.** Canonical term sources identified in the build brief. Standalone.

## B-4 — Smart invoice-approval agent

**Problem.** Brandy's Rentec-parity gap: vendor bills and payments have no
approval flow and no audit trail.

**Shape.** Bill inbox: coding, routing, approve/deny with reason capture.
Extends the Brain's CONFIRM-gate semantics from financial events to bills.
Reason capture is the audit trail the ledger lacks.

**Data in/out.** In: bill (ingest TBD in brief), approver context. Out:
decision + reason, immutable audit row.

**Boundaries.** Approval flow and reason capture only. NO payments executed,
no ledger writes in this lane. Implementation needs Jason's direct word
(financial lane) — the blitz builds the flow; the money movement stays gated.

**Acceptance sketch.** Full approve/deny lifecycle on fixtures; audit trail
complete per decision; proof that no path executes a payment.

**Depends on.** Bill ingestion source (decided in build brief). Standalone.

## B-5 — Maintenance triage + photo inspection (assistive core)

**Problem.** Triage is manual; photos sit unassessed.

**Shape.** Two assistive tools: (1) triage classifier suggesting
category/routing for a work item; (2) photo annotator producing condition
notes from images. Suggestions and annotations only.

**Data in/out.** In: work item / photo (media library first). Out: suggested
category + routing; condition annotation.

**Boundaries.** Assistive and read-only. Photo assessment never makes a work
decision; triage never assigns or dispatches. Tenant-facing surface
explicitly out — separate Jason approval.

**Acceptance sketch.** Labeled fixture set; accuracy thresholds stated in the
build brief; zero autonomous decisions in tests.

**Depends on.** Media-library photo access. Standalone.

## B-6 — ROI-calculable-before-deployment (convention, not a build)

House rule, adopted 2026-10-10: every Brain slice brief states its expected
payoff (time saved, errors caught, fees avoided) in the brief itself, so the
build is priced before approval. Makes this backlog self-prioritizing.

---

## Origin

Seeded 2026-10-10 from Jason's "steal anything worth stealing" on the Yardi
Virtuoso Enterprise harvest list (proactive brief, main chat). Developed the
same day for the blitz session. Financial/tenant items need Jason's direct
word per the standing self-assign boundary, even in the blitz.
