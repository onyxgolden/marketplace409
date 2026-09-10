# Private-Financing Borrower Onboarding — Mobile Verification Record

**Prepared:** 2026-09-10, closing the one gap left open by
`docs/product/private-financing-borrower-onboarding-verification.md` (Phase 1, PR #151): mobile
behavior for the invitation/claim flow had no automated evidence.

**Method:** live rendering at three representative widths — 360×800, 390×844, 412×915 — against a
real `next dev` server in an isolated worktree off `origin/main`, using a fixed-width iframe harness
(and, for cross-checks, direct browser-window resize) to get accurate CSS viewport widths independent
of this host's display DPI scaling. No real Supabase/Stripe credentials were used or copied — a local
placeholder `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` pair (not secrets; these
are the public anon-key values normal browser bundles already ship) let the page shells and the
already-clean 401-unauthenticated code path render, but does not exercise real sign-in, sign-up, or
claim success — those remain covered by the existing automated JS/SQL tests referenced below, not by
a live mobile screenshot.

## Results per required scenario

| Scenario | 360×800 | 390×844 | 412×915 | Evidence |
|---|---|---|---|---|
| Valid invitation opening (`/auth?email=...`) | Pass, with a defect (see below) | Pass | Pass | Live screenshots |
| Invited-email preservation | **Defect found at 360 only** — locked email input hard-clips text with no ellipsis; fixed this slice | Pass | Pass | Live screenshots; see fix below |
| Sign-in/sign-up return behavior | Pass (code-level) | Pass (code-level) | Pass (code-level) | The redirect itself only fires after a real Supabase session exists, which a placeholder backend cannot produce — verified instead that `onAuthStateChange`'s single-redirect logic (`src/app/auth/page.jsx`) and its existing test coverage (`page.test.js`) are viewport-independent (no layout/CSS involved in the redirect itself) |
| Invalid/already-used invitation presentation | Pass | Pass | Pass | Live screenshot of the portal's error-state layout (`PrivateFinancingBorrowerPortal.jsx`'s `state.error` branch), which is the same layout used for both cases per the existing Phase 1 doc's design note |
| Unauthorized-access denial | Pass | Pass | Pass | Live screenshot: the portal's real 401 response renders cleanly with `Retry` (83×50px) and `Use a different account` (217×48px) buttons, both well above the 44px touch-target minimum, no overflow |
| Borrower portal landing after successful authentication | Not verified live | Not verified live | Not verified live | Requires a real claimed account with real data; the account-card layout (`dl.grid gap-4 sm:grid-cols-2 lg:grid-cols-4`) collapses to a single column below the `sm` (640px) breakpoint, which covers all three tested widths by inspection, consistent with the rest of the codebase's established responsive patterns |

## Defect found and fixed

At exactly 360×800 (not 390 or 412), the disabled/locked invited-email `<input>` on `/auth` hard-clips
the invited address with no ellipsis once it exceeds roughly 24 characters — e.g.
`borrower.tester@example.com` renders as `borrower.tester@example.c` with no visual indication more
text exists. The amber banner directly above the input already shows the full address in wrapping
text, so this was not a blocker to understanding which account was invited, but the abrupt clip reads
as broken, and because the field is `disabled` there's no way to scroll or focus into it to see the
rest. Fixed by adding a `truncate` class (ellipsis instead of a hard clip) and a `title` attribute
carrying the full invited email, in `src/app/auth/page.jsx`, with regression coverage added to
`src/app/auth/page.test.js`. Verified against both a realistic invited email and a deliberately long
one at desktop width, and confirmed the fix does not affect the non-invited path (no `title`, no
behavior change).

## Other observations (not fixed — non-blocking, out of this slice's scope)

- The "Forgot password?" text-button on `/auth` measures 122×20px — below the commonly recommended
  44px touch-target minimum. It's not part of the borrower-onboarding required-scenario list and is a
  pre-existing pattern shared with the rest of the page, not something introduced by this fix — noting
  for a future, separately-scoped mobile-polish pass rather than fixing here.
- The portal's `Loading your financing account…` state could not be captured live — on a local
  network it resolves in well under 100ms, making it practically unobservable in a screenshot. Its
  markup is a single short `<p role="status">` with no layout complexity, so this is a low-risk gap.

## Test commands used

```
npx vitest run --exclude '**/.claude/**' src/app/auth/page.test.js
npx vitest run --exclude '**/.claude/**' src/app/auth src/app/api/private-financing \
  src/components/forge/rental/PrivateFinancingBorrowerPortal.test.jsx src/domains/private-financing
npx eslint src/app/auth/page.jsx src/app/auth/page.test.js
npx next build
```

All passed: 7/7 focused, 710/710 broader private-financing/auth suite, lint clean, build clean
(exit 0, `/auth` and `/forge/private-financing/portal` both prerender as static routes).
