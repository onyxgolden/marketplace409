# R22 screening gate — what Jason must approve before integrated reports go live

Rentec runs integrated tenant screening (credit, criminal, eviction) with
tenant-initiated options. FORGE R22 ships the **free layer** only; pulling a
real report is a hard-gated stub. This document is the decision record: what
ships today, what is gated, and the exact flip that turns it on.

## What ships today (no approval needed)

- **Screening workflow on an R21 application** (`POST/PATCH
  /api/rental/applications/[id]/screening`): status machine
  `not_requested → requested → in_progress → complete`.
- **Fail-closed consent**: a screening request is rejected (409) unless the
  application carries recorded applicant consent (R21 collects it on the
  application form) or the applicant re-confirmed it through the link.
- **Manual results**: the owner runs screening elsewhere (or reads a report
  the applicant paid for) and records the outcome — credit score (300–850)
  and/or band, criminal-history flag + notes, eviction-history flag + notes.
- **Decision support**: a neutral recommendation suggestion plus the owner's
  recorded recommendation and reasons. The actual approve/deny still goes
  through R21's decision endpoint — R22 never decides on its own.
- **Tenant-initiated link** (`/rentals/screening/<token>`): no-login page
  where the applicant provides screening info and confirms consent. The
  token is a random 24-char secret (guessing it → 404); the link is
  rate-limited (15 hits/hour per token+IP, DB-backed).
- **Audit trail**: every screening action appends a row to
  `rental_screening_events` (actor recorded; null = the applicant).
- **Compliance note**: the UI shows plain-English FCRA guidance
  (`SCREENING_COMPLIANCE_NOTE` in `screening.js`) — guidance only, not legal
  advice.

## What is gated (needs Jason's word)

`requestScreeningReport()` in `src/domains/rental-screening/screening.js`
**always returns `{ status: "not_connected", pulled: false }`** and performs
zero network I/O. Unit tests assert this for every catalogued provider,
including unknown provider keys. The owner UI lists every provider as
"Not connected — gated".

| Provider | Mode today | What going live needs |
|---|---|---|
| TransUnion | `provider_gated` | Provider account agreement; per-report fee + who pays confirmed with Jason |
| Experian | `provider_gated` | Provider account agreement; per-report fee + who pays confirmed with Jason |
| Equifax | `provider_gated` | Provider account agreement; per-report fee + who pays confirmed with Jason |
| Checkr | `provider_gated` | Provider agreement; per-report fee + who pays confirmed with Jason |

## The flip (when Jason approves a provider)

1. Jason names the provider, approves the per-report cost, and decides who
   pays: the owner (out of pocket / built into the application fee) or the
   applicant (tenant-initiated, Rentec-style).
2. Implement a per-provider adapter behind `requestScreeningReport()`'s
   interface (`{ status: "connected"|"not_connected", pulled, reason }`).
3. Credentials go through the Secure Vault flow — never chat, never env files
   in the repo.
4. Flip that provider's catalog entry; the route then pulls, stores the
   report reference (never raw report contents beyond what the owner needs),
   and audits each attempt (including the `provider_attempt_blocked` event
   for denied attempts).
5. FCRA: adverse-action notice flow must ship with the provider — a denial
   based on a pulled report without the notice is the regulated footgun.

Build-spend doctrine: free-to-build ships now; anything that costs money
waits for Jason's word. This gate is that doctrine in code.

## UI integration point (R21)

`src/components/forge/rental/ScreeningPanel.jsx` is self-contained and
expects only an `applicationId` prop. Mount it in R21's application review
(one line, e.g. inside the review drawer):

```jsx
import ScreeningPanel from "@/components/forge/rental/ScreeningPanel";
// ...
<ScreeningPanel applicationId={application.id} applicantName={applicantDisplayName} />
```

The panel's Approve/Deny buttons POST to R21's existing
`/api/rental/applications/[id]/decision` endpoint with a screening-tagged
reason — R22 does not duplicate the decision flow.
