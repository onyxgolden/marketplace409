# FORGE Brain — Backlog

Steal-worthy patterns only; products, not products' marketing. Each entry is
**unscoped** until it gets a written brief (deliverable, boundaries, acceptance
criteria) and a ChatGPT review. Nothing here is authorized to build.

Source of the 2026-10-10 entries: Yardi Virtuoso Enterprise (announced Oct 5,
2026; demoed at YASC San Diego Oct 7–9). PR-level detail only — pricing,
per-market availability, and demo-vs-real status unverified. Harvest the
patterns at zero marginal cost; do not copy the enterprise product.

## B-1 — Natural-language access to live data, platform-authenticated

- **Pattern:** NL queries answered from live operational data through the tools
  users already have; auth flows through the platform so permissions follow the
  asker (tenant/owner scoping is a real rule, not a prompt).
- **FORGE mapping:** the "context window over the ledger" the Brain wants —
  an NL query layer over Brain digest/alerts/actions that enforces
  owner-scoped RLS on every read, reusing the existing Brain action-gate
  (typed CONFIRM / 409-on-drift / 403-on-insufficient-gate semantics).
- **Why steal it:** Jason's #1 Brain ask is NL over the books; permission-scoped
  NL is the missing trust layer before any tenant/owner ever touches it.
- **Status:** backlog, unscoped.

## B-2 — Month-end close agent (plain-language issue surfacing)

- **Pattern:** runs the books across ledgers (AR/AP/bank rec/rent roll/GL
  hygiene), surfaces issues in plain language with suggested next steps.
- **FORGE mapping:** exactly the shape of the Brain digest's anomaly-flag
  output — extend `buildBrainDigest()` ranking with a close-checklist pass and
  per-issue suggested actions through the existing Brain action planner.
- **Why steal it:** builds on shipped slices (digest ranking, action parser);
  "runs the books, tells you what's wrong in plain words" is the Brain's
  stated job.
- **Status:** backlog, unscoped.

## B-3 — Lease/billing audit agent (billing-gap finder)

- **Pattern:** audits leases against billings to find gaps (unbilled charges,
  wrong amounts, stale schedules).
- **FORGE mapping:** a Brain check that compares charges due vs. charges
  posted vs. payments received per tenant — Eric's October state ($1,568 due,
  partially paid) is literally a billing gap this would have flagged.
- **Why steal it:** concrete, high-value, read-only detection; feeds the
  anomaly ranker without touching payments.
- **Status:** backlog, unscoped.

## B-4 — Smart approval agent (invoice approvals)

- **Pattern:** AI-assisted invoice approval flow (coding, routing, approve/deny
  with reason capture).
- **FORGE mapping:** Brandy's Rentec-parity list item — vendor bills and
  payments; the approval flow is the gap. Extends the Brain action planner's
  gated-execution semantics (typed CONFIRM below confidence thresholds)
  from financial events to vendor bills.
- **Why steal it:** direct parity-list coverage; approval with reason capture
  is an audit trail the ledger currently lacks.
- **Status:** backlog, unscoped.

## B-5 — Maintenance triage and photo inspection

- **Pattern:** work-order triage plus photo-based inspection (condition
  assessment from images).
- **FORGE mapping:** future surface; overlaps FORGE Capture (walkthrough/SOP
  capture) + the media-library work. Triage routing could reuse the Brain
  digest's anomaly classification; photo assessment stays read-only
  annotation, never a work decision.
- **Why steal it:** inspection-from-photos is the cheapest on-ramp to
  maintenance intelligence; keep it assistive, not authoritative.
- **Status:** backlog, unscoped. Needs Jason's word before any tenant-facing
  surface (tenant boundary).

## B-6 — ROI-calculable-before-deployment framing

- **Pattern:** pitch each capability with its ROI calculable before deployment.
- **FORGE mapping:** house rule, not code — every Brain slice brief states its
  expected payoff (time saved, errors caught, fees avoided) in the brief
  itself, so Jason can price the build before approving it.
- **Why steal it:** matches his build doctrine (free-to-build + revenue
  potential moves now); makes the backlog self-prioritizing.
- **Status:** adopted as backlog convention, 2026-10-10.

---

## Origin

Seeded 2026-10-10 from Jason's "steal anything worth stealing" on the Yardi
Virtuoso Enterprise harvest list (proactive brief, main chat). Entries stay
unscoped until a brief exists; financial/tenant items additionally need Jason's
direct word per the standing self-assign boundary.
