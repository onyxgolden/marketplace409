# Private-Financing Borrower Onboarding — Verification Record

**Prepared:** 2026-09-10, during Phase 1 of `FORGE_PRODUCTION_USER_FEEDBACK_AND_ACTIVATION_PLAN.md`.

## Why this doc exists

The plan's Phase 0 audit reported (Finding A) that borrower-invitation onboarding was blocked by two
divergent, unmerged fix branches. Before reconstructing a fix per that finding, this was independently
re-verified against current `origin/main` — the finding was **stale**. `origin/main` already carries a
complete fix, merged **before** the Phase 0 audit ran:

- PR #88, `fix(private-financing): carry the invited email through borrower onboarding`, merge commit
  `c64b07912`, merged 2026-09-02T00:03:40Z.
- Per its own description, it is a **fresh implementation**, not a merge of either stale branch
  (`feat/financial-assets-foundation` or `fix/private-financing-borrower-invitation-onboarding`) — both
  of those branches' versions of `portal/route.js` predate the identity-scoped membership query
  (`0ece6452c`) and the replay/projection engine (`c33c2c5e0`) that are live on `main`; merging either
  wholesale would have reintroduced both regressions.

No new fix work was implemented as part of Phase 1. This doc records what was actually checked.

## Verification against the six required scenarios

| Scenario | Status | Evidence |
|---|---|---|
| Claim-link preservation | Covered | Invite route embeds `?email=` in the portal link (`src/app/api/private-financing/accounts/[accountId]/borrowers/invite/route.js`); tested (`invite/route.test.js`: "carries the invited email as a ?email= query param"). |
| Invited-email handling | Covered | `/auth` page locks the email field and shows an explanatory banner when `?email=` is present; portal API and frontend both thread `invitedEmail`/`mismatched`. Tested in `src/app/auth/page.test.js` ("locks the email field...") and `src/components/forge/rental/PrivateFinancingBorrowerPortal.test.jsx` ("forwards the invited email..."). |
| Sign-in/sign-up return behavior | Covered | `/auth` uses a single `onAuthStateChange`-driven redirect covering sign-in, sign-up, and PKCE auto-recovery from a confirmation-email click. Tested: `page.test.js` "redirects once onAuthStateChange reports a session -- covering sign-in, sign-up, and a confirmation-link auto-recovered session alike". |
| Invalid/already-used link | Covered, with a design note | This system has no time-based invitation token/expiry — a borrower row plus a membership `status` (`invited`→`active`). "Already used" (reopening a claimed invitation) is idempotent and tested at both the JS layer (`portal/route.test.js`: "is exact on retry: a second call with nothing new to claim still returns the same active accounts") and the SQL layer (`private-financing-borrower-claim-hotfix.migration.test.js`: "activates only invited memberships owned by the claimed identity"). "Invalid" (never invited / wrong email) falls through to an explicit no-match message in the frontend rather than an error. There is no separate time-expiry state to test because none exists by design. |
| Unauthorized access denial | Covered | The claim RPC (`claim_private_financing_borrower_portal`, `supabase/migrations/20260901000500_harden_private_financing_borrower_claim.sql`) is `security definer`, scoped strictly to `auth.uid()`, requires a confirmed email, and serializes via an advisory lock; broader private-financing RLS/RPC coverage was confirmed passing in Phase 0. The frontend explicitly avoids exposing another account's data on mismatch (tested: "explains a mismatched email without exposing another account's data"). |
| Mobile behavior | **Not verified by automated evidence** | The `/auth` and borrower-portal layouts are simple single-column, `max-w-md`/responsive Tailwind forms, consistent with the rest of the codebase's mobile-safe patterns — but no screenshot or device check was run against them in this session. Recommend a targeted mobile-viewport check (the existing `scripts/ui-improvement-manager/screenshot-evidence` tooling can do this) as a fast, separate follow-up, or fold it into the Phase 3 mobile-usability pass the plan already schedules. |

## Test commands used to verify

```
npx vitest run --exclude '**/.claude/**' \
  src/app/api/private-financing/portal/route.test.js \
  src/app/api/private-financing/accounts \
  src/app/auth/page.test.js \
  src/components/forge/rental/PrivateFinancingBorrowerPortal.test.jsx \
  src/domains/private-financing/__tests__/private-financing-borrower-claim-hotfix.migration.test.js
```

## Housekeeping recommendation

Both stale branches — `feat/financial-assets-foundation` (borrower-invitation portion superseded; the
branch also carries 15 other unrelated commits and is 94 behind `origin/main`) and
`fix/private-financing-borrower-invitation-onboarding` (fully superseded, 81 behind `origin/main`, no
open PR) — are safe to retire once Jason confirms no other in-flight work depends on them.
