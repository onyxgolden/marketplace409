# Human Verification — Cloudflare Turnstile: Operational Runbook

Owner: Muse. Date: 2026-11-22.
Status: OPERATIONAL RUNBOOK for the Jason-authorized proposal-bundle row 1 build.
Binding design: `forge-ai-drop/AGENT-PROPOSALS.md` (2026-10-12 Jason row, "Human-verification"),
ChatGPT's ten conditions (`results/chatgpt/public-write-human-verification-proposal-review-2026-10-12.md`),
Muse's review (`results/muse/human-verification-proposal-review-2026-10-13.md`),
Claude's Oct 12 conditions, and the Nov 22 bundled re-review
(`results/chatgpt/agent-proposals-review-2026-11-22.md`, row 1, AGREE WITH CONDITIONS).

> **Nothing in this runbook authorizes applying keys, enabling dashboard
> CAPTCHA, or flipping the flag.** Every activation step below requires
> Jason's explicit word. ChatGPT reviews the build; Jason's exact-head GO
> plus Muse's agreement check governs merge and deployment. The slice ships
> INERT (`TURNSTILE_CONFIG.enabled = false`) — merged code changes no
> behavior until the activation sequence in §4 is completed in order.

---

## 1. What this is

Cloudflare Turnstile (free tier, privacy-friendly, no puzzle friction) on
FORGE's anonymous write surfaces, so bot signups, credential stuffing, and
spam cannot hit tenant/ledger-adjacent flows unchecked.

**In scope (this slice):**

- `POST /api/auth/sign-up`, `POST /api/auth/sign-in`, `POST /api/auth/reset`
  — the three anonymous auth gateway routes. Each requires a Turnstile token
  when enabled and forwards it to Supabase Auth as `captchaToken`.
- The auth surfaces that submit through them: `/auth` (`src/app/auth/page.jsx`)
  and the workspace account panel (`src/components/WorkspaceAccountPanel.jsx`),
  which render the widget when enabled.
- A server-side Siteverify verifier (`src/lib/auth/turnstileVerify.js`) for
  FUTURE custom forms. No custom (demo/contact) form exists in the app today;
  the module ships tested and ready so a future form wires one function call.
- Cloudflare's published dummy test keys in dev/CI/tests only.

**Explicitly out of scope:**

- Signed-in users: zero new challenge inside authenticated sessions.
- Invite flows: invited users are pre-authorized, no challenge
  (`/api/rental/screening-public/[token]` is a signed-token flow — the 24-char
  token IS the authorization, with its own DB-backed per-token+IP limit —
  and stays untouched).
- Authenticated-only endpoints (e.g. DSCR submit).
- No demo/contact form exists — nothing was wired there.

**Non-goals:** replacing rate limiting (CAPTCHA is not a complete
credential-stuffing defense — the `gateAdmission` limiter stays and still
runs on every admitted request); any browser-side failure counter (progressive
tightening, if ever wanted, comes only from server-side/provider failure
counters — the `authRateLimit` failure ladder already exists); a paid tier
(Turnstile free tier only).

---

## 2. Route / flow map

```
Browser (anonymous)                     FORGE route                        Supabase Auth
─────────────────────                   ───────────                        ─────────────
TurnstileWidget ── token ──► useCredentialAuth (holds token, single-use)
        │                                   │
        │  submit blocked until a token exists (plain message, §5)
        ▼                                   ▼
gatewaySignIn/SignUp/        POST /api/auth/sign-in|sign-up|reset
  ResetPassword              ┌─ shape validation (400)
  (captchaToken in body,     ├─ requireHumanVerification: 400 MESSAGE_TURNSTILE_REQUIRED
   only when present)        │   when enabled and token missing/malformed
                             │   (BEFORE gateAdmission — no limiter budget,
                             │   no execution lease, zero provider calls)
                             ├─ gateAdmission (existing rate limit)
                             ├─ execution lease (existing idempotency)
                             └─ provider call WITH options.captchaToken
                                          │
                                          ▼
                                   Supabase validates the token
                                   (only once dashboard CAPTCHA is
                                   enabled with the same site key — §4)
```

**One verifier per token (binding rule).** A Turnstile token is single-use.
For auth flows the PROVIDER is the verification authority — FORGE must NOT
also call Siteverify on the same token (the second verification would fail).
`turnstileVerify.js` is the authority ONLY for custom forms, which have no
provider in the loop. The route code carries this comment at each call site.

**Token lifecycle on the client.** `useCredentialAuth` holds `captchaToken`
state and a `challengeKey` remount key. The token is cleared and the widget
remounted after EVERY submit attempt — success or failure — because a token
is spent either way and a fresh challenge is free in managed mode. Submit is
blocked with the plain message while enabled and no token exists yet; the
widget is never rendered while disabled (no script load, no third-party
request).

**Fail closed.** Enabled + missing/malformed token → 400, no provider call.
Enabled + no keys configured → the route still requires the token and the
provider refuses it (production with no site key: `getTurnstileSiteKey()`
returns null, the widget cannot render, submits stay blocked — this is the
safe state, not a bug; fix it by completing §4, never by bypassing the gate).

---

## 3. Configuration

| Item | Value / location |
|---|---|
| Release gate | `TURNSTILE_CONFIG.enabled` in `src/lib/auth/turnstilePolicy.js` — frozen code constant, ships `false`. Flipping it is a release action, never an env boolean. Same discipline as MFA Layer 2 `ACTIVATION_CONFIG`. |
| Site key (public) | Env `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Non-prod fallback: Cloudflare's always-pass dummy `1x00000000000000000000AA`. Production with no key: `null` (widget cannot render). |
| Secret key (server-only) | Env `TURNSTILE_SECRET_KEY`, read ONLY in `src/lib/auth/turnstileVerify.js` (server-only module). Never in `turnstilePolicy.js` — that file is imported by client components and the secret must never reach the browser. |
| Dummy test keys | Cloudflare's published values (docs, updated 2026-11-05): sitekey always-pass `1x00000000000000000000AA`, always-fail `2x00000000000000000000AB`; secret always-pass `1x0000000000000000000000000000000AA`, always-fail `2x0000000000000000000000000000000AA`, timeout-or-duplicate `3x0000000000000000000000000000000AA`; dummy token `XXXX.DUMMY.TOKEN.XXXX`. A dummy secret in production refuses every check (`missing-secret`). Test secrets carry unreliable hostname/no action — the verifier skips hostname/action matching for dummy secrets (documented in the module). |
| Action label | `TURNSTILE_ACTIONS.AUTH = "auth"` — one label for all three auth surfaces (they share one form/widget). The provider validates success/hostname for auth tokens; the action is informational there. Custom forms get one fixed action each, checked by `turnstileVerify.js`. |
| Token bound | `MAX_TURNSTILE_TOKEN_LENGTH = 2048` — a longer/malformed token is refused before any provider call. Tokens are never logged. |

**Files:**

- `src/lib/auth/turnstilePolicy.js` — policy surface only (gate, site key, dummy-key recognition). No secret reader.
- `src/lib/auth/turnstileVerify.js` — server-only Siteverify verifier (5s timeout, reasons `missing-token` / `missing-secret` / `invalid-token` / `wrong-hostname` / `wrong-action` / `unavailable`).
- `src/components/TurnstileWidget.jsx` — explicit-render widget, visible failure + 44px Try again, cleanup on unmount.
- `src/app/api/auth/_lib/gatewaySupport.js` — `extractCaptchaToken`, `requireHumanVerification`.
- `src/app/api/auth/sign-up|sign-in|reset/route.js` — gate + `captchaToken` in provider options.
- `src/lib/auth/authGateway.js` — optional `captchaToken` on the three gateway calls.
- `src/lib/auth/useCredentialAuth.js` — token state, challenge rotation, submit guard.
- `src/app/auth/page.jsx`, `src/components/WorkspaceAccountPanel.jsx` — widget render sites.

---

## 4. Activation checklist (in this order — the order is the safety)

- [ ] PR merged per the exact-head GO + agreement-check process.
- [ ] ChatGPT review of the implementation complete; findings dispositioned.
- [ ] Real Turnstile keys created in the Cloudflare dashboard for the
      production hostname (free tier). **Owner setup step** — no real secret
      is ever committed; it goes in the deployment's env only.
- [ ] `NEXT_PUBLIC_TURNSTILE_SITE_KEY` set in Vercel (production env).
- [ ] `TURNSTILE_SECRET_KEY` set in Vercel (production env, secret).
- [ ] **Supabase dashboard CAPTCHA enabled with the SAME site key**
      (Authentication → Bot protection / CAPTCHA). Until this is on, the
      direct-API bypass stays open: a client calling Supabase directly
      skips the FORGE route entirely. The route-side gate alone does not
      close it — the dashboard setting does. This is the step most likely
      to be forgotten; do not flip the flag without it.
- [ ] Canary: enable on staging/preview first, sign up / sign in / reset
      through the real widget, confirm a bad token is refused and a good
      token passes, confirm signed-in flows and invite flows are untouched.
- [ ] Flip `TURNSTILE_CONFIG.enabled` to `true` (code change, its own PR,
      same review process — never an env boolean, never a hot edit).
- [ ] Post-activation watch: auth error rates, 400 `MESSAGE_TURNSTILE_REQUIRED`
      volume (a spike means the widget is failing to issue tokens, not that
      users are bots), support reports of blocked sign-ins.

**Rollback:** set `TURNSTILE_CONFIG.enabled` back to `false` (code change +
deploy) — the routes, hook, and pages return to their exact pre-Turnstile
behavior; the widget unmounts and no script loads. If the problem is a bad
key rather than the flag, rotate the key in Cloudflare + Vercel first.

---

## 5. Messages and UX (functionality-buttons checklist)

Cited checklist: `forge-ai-drop/results/muse/functionality-buttons-checklist-2026-11-20.md`
— every new control works, every form has Save + Cancel, every save confirms
in plain words, no dead-end pages, 44px targets at phone width.

- Missing token (submit blocked): `MESSAGE_TURNSTILE_REQUIRED` —
  "Please complete the human-verification check and try again." Generic,
  non-enumerating; reveals nothing about account existence. Shown in the
  form's own message surface (the same `[role="status"]` area as other
  auth feedback).
- Widget failure (script load / render / token error): visible message +
  a "Try again" button (`min-h-[44px]`) that re-renders the widget. Submit
  stays blocked until a token exists — a failed widget never degrades to
  an unguarded submit.
- Managed mode: in the normal case the user sees nothing to solve — the
  widget issues the token silently. No puzzle friction by design.
- Reset responses stay generic (`MESSAGE_RESET_SUBMITTED`) whether or not
  the account exists — the Turnstile gate does not change that.

---

## 6. Privacy and data flow

- The widget loads Cloudflare's script (`https://challenges.cloudflare.com`)
  ONLY when enabled — while off, no third-party request is made at all.
- What Cloudflare receives: the challenge interaction (browser signals used
  for the bot assessment), the site key, and — for custom forms via
  `turnstileVerify.js` — the caller's IP as `remoteip` in the Siteverify
  round-trip. No FORGE user data, email, or account identifiers are sent.
- What FORGE stores: nothing. Tokens are held in memory for one attempt and
  cleared; they are never written to a database, a log, or local storage.
- The secret key never leaves the server. The site key is public by design.
- Turnstile's privacy posture (no cookies for the challenge in managed mode,
  no tracking) is why it was chosen over reCAPTCHA — see the proposal row.

---

## 7. Content Security Policy note

There is currently NO CSP in `next.config.mjs`. If/when one is added, it
must allow the Turnstile script and challenge endpoints or the widget will
fail to load (and submits will stay blocked, per §2 fail-closed):

- `script-src https://challenges.cloudflare.com`
- `frame-src https://challenges.cloudflare.com` (the challenge iframe)
- `connect-src https://challenges.cloudflare.com` (Siteverify is
  server-to-server and does not need a browser connect-src entry, but the
  widget's own calls do)

Verify the widget still issues tokens after any CSP change; a CSP that
blocks the script is indistinguishable from a Cloudflare outage at the
submit button.

---

## 8. Test evidence (at merge)

100/100 across 8 files (vitest 4.1.9):

- `src/lib/auth/turnstilePolicy.test.js` — 7 (inert default, explicit-config
  override, site-key env/dummy/prod-null, dummy-secret recognition).
- `src/lib/auth/turnstileVerify.test.js` — 13 (mocked fetch: success posts
  secret+token+remoteip; missing/over-long token → no call; prod no-secret
  and dummy-secret-in-prod → `missing-secret`; invalid token; wrong
  hostname; wrong action; fetch throw / bad JSON → `unavailable`).
- `src/components/TurnstileWidget.test.jsx` — 4 (render, token/expiry/error
  callbacks, retry UI, null siteKey → failure UI, no render call).
- Route tests — 30 (sign-up 9, sign-in 14, reset 7), each with a Turnstile
  block: disabled = exact pre-existing behavior, token ignored/not
  forwarded; enabled + missing token → 400 with ZERO provider calls and
  ZERO admission checks; enabled + malformed token → 400; enabled + token
  → forwarded as provider `captchaToken`. Reset keeps its generic response.
- `src/app/auth/page.test.js` — 32 (incl. 6 new: widget absent while
  disabled; widget renders with site key when enabled; submit blocked with
  the plain message and no request when no token; token sent with the
  gateway sign-in and reset requests; token cleared after a submit — a
  second submit without a fresh challenge is blocked).
- `src/components/WorkspaceAccountPanel.test.jsx` — 14 (unchanged behavior
  while disabled).

Pre-existing main defect (not a gate for this PR): `npm run build` fails at
base during page-data collection for `/api/call-shield/cases…` — unrelated
to this slice.

---

## 9. Owner follow-ups (not part of this slice)

1. **Real Turnstile keys + Supabase dashboard CAPTCHA** — §4. Owner setup;
   nothing in this PR touches production config.
2. **First custom form** — when a demo/contact form (or any anonymous write
   form) is built, wire it through `turnstileVerify.js` server-side and the
   same widget client-side; do not invent a second verification path.
3. **CSP** — when a CSP is added, allow `challenges.cloudflare.com` (§7) and
   re-verify the widget issues tokens.
4. **Progressive tightening** — if credential-stuffing pressure grows, add
   server-side/provider failure counters (the `authRateLimit` ladder exists);
   never a browser-side counter.
