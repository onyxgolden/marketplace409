# PR #671 fix-round build report — P671-001 (expired-session refresh lost on excluded public pages)

Submitted by: Muse (fix-round builder)
Date: 2026-10-23 (America/Chicago)
PR: onyxgolden/marketplace409 #671 — perf(S3): one auth check per request
Branch: `perf/s3-single-auth-check` (updated in place)

## Heads

- Reviewed head (NEEDS CHANGES): `8b38c5b62dd1665bf5239a564793315df77ea72b`
- Rebase base (current main, after PR #673 / S1 merged): `0779fad6b656c1c10b93555144755566265bff73` (API-verified before branching; PR head API-verified still `8b38c5b6` at start)
- New head (code/evidence head): `eaef83c4675fef03db48dcc7704f784271008a99` (API-verified: PR #671 open, head == this SHA, base `0779fad6`; tree `b7975aa` verified identical local ↔ remote by push.sh). The copy of this report committed on the branch lands as one further report-only commit on top; it changes no code.

The branch was rebased onto the new main first (single S3 commit replayed clean, no conflicts — S1 touched only the four page files). Per ChatGPT's verdict, the fix is reviewed on this integrated tree: S1 made `/privacy`, `/terms`, `/community`, `/forge/download` force-static, which changes the layout/session picture on those routes (no server session read executes for them at request time).

## The correction (verdict's smallest safe option)

Design chosen: **restore matcher coverage for every page route while keeping the no-cookie shortcut** — the first option the verdict names. The alternative (re-engineering the shared layout's session initialization) was not taken: it has a much larger blast radius (every page's first paint depends on the layout-provided identity) and the verdict's option A closes the finding completely, as the probe replay below shows.

What changed:

1. **`src/proxy.js` — matcher.** The S3 allowlist of authenticated sections is replaced with the original catch-all pattern (verbatim from pre-S3 base `6eae30db`): `/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)`. Only requests that never render the layout are excluded (Next statics, image optimizer, favicon, image files). Every page request is matched again, so any session refresh happens in the proxy — where the SSR cookie adapter's writes persist to both the forwarded request and the response — before RootLayout reads the session.
2. **`src/proxy.js` — body: unchanged.** The createServerClient/getUser/setAll refresh body is byte-identical to the reviewed head, including the no-cookie shortcut: a request presenting no Supabase auth cookie returns the passthrough response before the client is even constructed — zero network validation. That shortcut is S3's surviving performance win, and it is where the audit's measured cost was (a network `getUser()` on every non-static path, including anonymous hits and would-be 404s). Cookie-bearing requests now validate/refresh exactly once in the proxy on every route, which is precisely the pre-S3 base behavior for those requests. Page authorization checks are untouched; no session claim was replaced with an unverified one.
3. **`src/proxy.js` — header comment rewritten** to state the new contract and the P671-001 reason coverage is broad, so the next editor does not re-derive the disproven assumption.
4. **`src/app/layout.js` — comment only, no behavior change.** The old comment claimed the layout's `getSession()` was a "cookie read, no network" — the false premise P671-001 disproved. It now states that the proxy has already validated/refreshed and persisted any rotation, and why the matcher must stay matched for every page route.
5. **`src/proxy.test.js` — updated to the new matcher contract.** The previously excluded public paths now assert *matched*; the exclusion list asserts only static assets (favicon, image extensions, `_next/static`, `_next/image`). One body test added: an anonymous request on a public page (`/post`) performs zero validation (client never constructed). The other body tests — protected-route passthrough equivalence, refresh cookie writes to request + response, chunked/PKCE cookie handling — are unchanged and still pass. Total went from 52 to 60 tests because the two matcher lists were re-partitioned (47 path cases before, 55 now) plus the one new body test.
6. **`src/proxy.refresh-propagation.test.js` — NEW, the frozen request-level regression** the verdict required. Detailed below.

## Frozen regression (verdict requirement)

`src/proxy.refresh-propagation.test.js` (6 tests) replays the request pipeline with the **real** `@supabase/ssr` 0.12.3 / auth-js 2.110.5 client and the **real** layout session path — `createClient()` from `src/lib/supabase/server.js`, the exact call RootLayout makes — against a synthetic provider (injected fetch stub; no real keys/accounts/network). `next/headers` is modeled with Server Component semantics (writes throw; the real adapter in `server.js` catches and swallows them, and the attempts are recorded). Cases:

- **Expired cookie on `/post`** (previously excluded public page) **and on `/forge/rental`** (protected positive control): refresh occurs in the proxy phase (POST `/auth/v1/token` + GET `/auth/v1/user`); the layout phase adds **zero** provider calls and **zero** cookie-write attempts (the refresh is asserted as having occurred in the proxy — never described as "deferred"); the rotated refresh token is present in the response Set-Cookie (decoded) **and** in the forwarded request jar and the layout's own session read; the stale token is gone from the jar.
- **Denied refresh on `/post`** (provider returns 400 `refresh_token_not_found`): exactly one refresh attempt, in the proxy; the outcome propagates — the response carries a session-clearing Set-Cookie for the auth cookie, the forwarded jar no longer holds the dead token, the layout session is null, and the layout makes no second doomed refresh attempt.
- **Anonymous `/post`**: zero provider calls in either phase, no Set-Cookie — the S3 shortcut, frozen.
- **Valid (unexpired) session on `/post`**: proxy validates (GET `/auth/v1/user`) with no token POST and no Set-Cookie churn; layout reads the session locally.

**Why `/post` and not `/privacy`:** ChatGPT's probe used `/privacy` and `/post`. On the integrated tree `/privacy` is force-static (S1), so no server session read executes for it at request time and the P671-001 mechanism cannot occur there. `/post` remains a dynamic route under the shared layout, so it is the primary excluded-page case; `/forge/rental` is the unchanged positive control, as in the review.

## Probe replay (ChatGPT's reviewer probe, extended)

Replayed `results/chatgpt/pr671-reviewer-refresh-probe-2026-10-23.mjs`, adapted to three proxy variants (base `6eae30db`, broken reviewed head, fixed head) × five scenarios (`/post` expired, `/forge/rental` expired, `/post` denied, `/post` valid, `/post` anonymous), with per-phase call recording and decoded cookie inspection. Full output: `~/workspace/pr671-probe-replay/results.json` (script alongside it). Two harness-model notes: the ancestor adapter records-and-swallows writes (matching the real `server.js` adapter, as in ChatGPT's original); an earlier draft of this replay let the write throw into the SDK, which distorted only the broken variant's layout-phase readings — corrected and re-run.

Results — **the fixed head is observably identical to base on all 15 rows**:

| Scenario | Base | Broken head | Fixed head |
| --- | --- | --- | --- |
| `/post` expired | proxy POST+GET; 1 Set-Cookie (rotated); layout 0 calls/0 writes; layout session = rotated | proxy skipped; **layout POSTs, write swallowed; 0 Set-Cookie; jar keeps old cookie** | = base |
| `/forge/rental` expired | proxy POST+GET; 1 Set-Cookie (rotated); layout idle | = base (positive control) | = base |
| `/post` denied | proxy POST once; 1 clearing Set-Cookie; jar cleared; layout session null | **denied refresh in layout; clearing write swallowed; 0 Set-Cookie; browser keeps dead cookie** | = base |
| `/post` valid | proxy GET only; no Set-Cookie | layout reads locally (no refresh needed) | = base |
| `/post` anonymous | proxy runs, 0 provider calls | proxy skipped, 0 calls | matched, **0 provider calls** (shortcut) |

The broken-head `/post` expired row reproduces ChatGPT's filed observations exactly (layout token POST, one swallowed write attempt, 0 Set-Cookie, root holds rotated token, request jar retains the old cookie).

## Test evidence (CI-mode JSON reporter, logs on persistent disk)

Environment note: donor `node_modules` copies on this VM carried Next 16.3.0, but the branch lockfile pins **16.4.1** (post-#669). Both worktrees below were aligned to the lockfile first (targeted `npm install next@16.4.1 --no-save`; lockfiles verified byte-identical by md5 between base and head trees) so all results below are at the target versions: Next 16.4.1, @supabase/ssr 0.12.3, @supabase/auth-js 2.110.5. No run was killed by the environment; no numbers come from background streams.

- **Proxy suites (fixed head):** `src/proxy.test.js` **60/60 passed**; `src/proxy.refresh-propagation.test.js` **6/6 passed**. (Log: `~/workspace/pr671-evidence/proxy-suites-head.json`.)
- **Affected auth/identity/session surface, identical commands, base vs fixed head** — `vitest run src/app/auth src/app/api/auth src/app/api/preferences src/lib src/hooks supabase/ src/components/SWRIdentityBridge.test.jsx`:
  - Base `0779fad6`: 386 suites / 1,304 tests — 1,108 passed, **0 failed**, 196 pending; 6 suites failed at suite level.
  - Fixed head: **386 suites / 1,304 tests — 1,108 passed, 0 failed, 196 pending; 6 suites failed at suite level. Failed-suite sets identical; zero deltas in either direction.**
  - The 6 suite-level failures are the known environment-bound ones, identical at base: `supabase/migrations/__tests__/` migration suites (20261001030000 charge-period parity, 20261001080000 r19 depreciation assets, 20261012000000 scheduled-send ledger, 20261013000000 scheduled-send ledger atomic attempt, 20261013225000 auth rate-limit buckets, 20261013225100 mfa recovery and latch) — they require a live database / host trust root this sandbox does not provide. (Logs: `~/workspace/pr671-evidence/chunk-{base,head}.json`.)
  - The two proxy suites are head-only new coverage (they do not exist at base — S3 created `proxy.test.js`), so they are reported above rather than in the base comparison.
- **ESLint** on all four changed/added files: clean (exit 0).
- **`next build` (Next 16.4.1, fixed head):** **succeeded** (exit 0; compiled successfully; TypeScript check ran and finished clean). The build exercises the compiled proxy: the output lists `ƒ Proxy (Middleware)`, and the route table (398 rows) shows the integrated picture the verdict required reviewing — `/post` ƒ (dynamic, the regression's primary case), `/forge/rental` ƒ (dynamic control), and S1's `/privacy`, `/terms`, `/community`, `/forge/download` ○ (static). The restored catch-all matcher compiles under Next 16.4.1's real request pipeline, not just pattern-string compilation. (Log: `~/workspace/pr671-evidence/next-build-head.log`.)

## What did not change

- No page authorization check removed or weakened; the proxy still never gated access (pages do), exactly as at base.
- Authenticated proxy-plus-page `getUser` deduplication remains unimplemented (as the verdict notes, this PR is not measured as achieving one validation for every *authenticated* request — the win is: anonymous requests validate zero times, and refresh correctness is restored everywhere).
- S1's static pages are untouched; on those routes there is no server session read to protect.

## Merge sequencing note

Per the verdict, the **S1 → S4 → S3** order stands. This fix round only moves PR #671's branch to the new head above; nothing was merged or deployed.
