# Security Layer 2 — MFA & Auth Rate Limiting: Operational Runbook

Owner: Muse. Date: 2026-10-13.
Status: OPERATIONAL RUNBOOK for the Jason-authorized Layer 2 build.
Binding design: `forge-ai-drop/commands/muse/mfa-auth-ratelimit-implementation-brief-2026-10-12.md`.

> **Nothing in this runbook authorizes applying migrations or flipping
> flags.** The migration files are review artifacts. Applying them to any
> database, and every activation step below, requires Jason's explicit
> word. ChatGPT reviews the build; Jason's exact-head GO plus Muse's
> agreement check governs merge and deployment.

---

## 1. What Layer 2 is

- **MFA**: TOTP enrollment/challenge for the required cohort, one-time
  recovery codes, Jason break-glass reset, and a server-side security
  latch that independently denies old JWTs during recovery.
- **Rate limiting**: one server-only Postgres atomic admission RPC
  (`auth_admission_check`) that transactionally evaluates every relevant
  token bucket before the gateway authorizes a provider auth operation.
  No in-memory production counter, no allow-on-error fallback.

**Required cohort**: actual workspace owners/co-owners and every active
staff membership, including restricted/read-only staff. Ordinary
tenant/borrower/consumer users may opt in. Unknown or failed role
resolution **denies** privileged access — it never assumes exemption.
Client metadata, invite=email, local storage, and view-as targets cannot
change actor eligibility.

**Session state machine**: `FIRST_FACTOR` → `ENROLL_REQUIRED` or
`CHALLENGE_REQUIRED` → provider-issued AAL2 → `AUTHORIZED`. An
unverified factor grants nothing. AAL2 is necessary for new owner/staff
sessions even when the provider reports `nextLevel: aal1` (no factor
exists yet). Browser AAL checks guide UX only; the server validates
session signature/user/session identity independently.

**Non-goals** (explicitly out of scope): SMS, CAPTCHA implementation
(Layer 1), anomaly alerts (Layer 3), weakened RLS, any global
administrator backdoor, arbitrary session invalidation at rollout, real
recovery codes in fixtures, production auth traffic in tests.

---

## 2. Activation checklist

### 2.1 Preconditions

- [ ] PR merged per the exact-head GO + agreement-check process.
- [ ] Staging database has both migrations applied and the full
      migration test suite green (18/18 in PGlite; concurrency and
      staging-provider gates below run against real Postgres).
- [ ] ChatGPT review of the implementation complete; findings
      dispositioned.
- [ ] Supabase native auth rate limits documented for the project
      (they stay active — Layer 2 never replaces them).
- [ ] Trusted deployment-derived IP forwarding verified in staging
      (the limiter keys on it; a wrong IP source misattributes budgets).
- [ ] Database backup taken immediately before the production apply.

### 2.2 Migration apply order (production, on Jason's word only)

Apply in filename order; each is re-runnable (second apply is a no-op):

1. `20261013225000_auth_rate_limit_buckets.sql`
   - Tables: `auth_rate_limit_buckets`, `auth_operation_log`,
     `auth_backoff_clears`.
   - RPCs: `auth_admission_check`, `auth_record_attempt_outcome`.
2. `20261013225100_mfa_recovery_and_latch.sql`
   - Tables: `mfa_recovery_generations`, `mfa_recovery_codes`,
     `mfa_recovery_operations`, `mfa_security_latch`,
     `mfa_audit_log` (append-only), `session_grandfather_registry`.
   - RPC: `mfa_consume_recovery_code`.

Verify after apply: RLS enabled on all nine tables, exactly one policy
per table (`service_role_full_access`, roles = `{service_role}`), and
`anon`/`authenticated` hold no table or function privileges
(the migration tests assert this posture — re-run them post-apply
against a staging clone, never against production auth traffic).

### 2.3 Config flags (all default OFF — the build ships inert)

| Flag | Default | Effect when enabled |
|---|---|---|
| `AUTH_RATE_LIMIT_ENABLED` | `false` | Gateway routes call `auth_admission_check` before provider auth ops |
| `MFA_LAYER2_ENABLED` | `false` | MFA state machine enforced for the required cohort |
| `MFA_ENROLLMENT_COHORT` | `none` | `none` → `staff-canary` → `owners` → `all` |

### 2.4 Flag-flip sequence (canary)

1. `AUTH_RATE_LIMIT_ENABLED=true` with staging defaults (Section 6).
   Watch denied-rate and `unavailable` counts for 24h. Any `unavailable`
   spike = storage/config problem: flip back, investigate, do not
   proceed.
2. Snapshot the grandfather registry: at the moment
   `MFA_LAYER2_ENABLED` flips true, the server captures all legitimate
   existing session families (user + Supabase `session_id`) into
   `session_grandfather_registry`. Refresh of the same family preserves
   eligibility until that family ends under existing session
   lifetime/sign-out policy. New families can never join the snapshot.
   No browser timestamp or refreshed JWT `iat` determines
   grandfathering. Revoked or recovery-pending families never regain
   access via grandfathering.
3. `MFA_LAYER2_ENABLED=true`, `MFA_ENROLLMENT_COHORT=staff-canary`
   (2–3 internal staff). Confirm enrollment, challenge, recovery-code
   issuance, and one full recovery cycle in production before widening.
4. `owners`, then `all`. Each step: 48h bake-in, audit-log review.

Rollback at any step: set flags false (Section 8). Flag-off behavior is
exactly today's behavior — no partial enforcement states.

---

## 3. Enrollment flow (staff)

1. Staff member signs in with first factor → session is `FIRST_FACTOR`.
2. Eligibility resolves from actual owned workspaces / active staff
   memberships (never the rental-context primary-owner fallback, never
   client-supplied metadata).
3. State `ENROLL_REQUIRED`: gateway serves the TOTP enroll ceremony —
   Supabase `enroll(TOTP)`, QR **plus** manual key, then challenge and
   verify. The secret/QR stays transient: no logs, no analytics, no
   persistence, no third-party QR generator.
4. On successful verification, the gateway generates **ten** CSPRNG
   recovery codes (≥128 random bits each), shows them **once**, and
   requires explicit acknowledgement. Plaintext is never recorded.
   Only keyed HMAC digests (+ key version) are stored, one generation
   row + ten code rows.
5. Session becomes provider AAL2 → `AUTHORIZED`.

Rules: regeneration requires recent verified AAL2 and invalidates the
entire old generation. Factor removal and code regeneration otherwise
require recent AAL2 — **fresh password alone can never disable
mandatory MFA**. Password reset never clears MFA.

---

## 4. Recovery flow

### 4.1 Self-service (user retains first factor, lost authenticator)

1. User presents a **fresh valid first factor** plus **one** recovery
   code at the recovery gateway route.
2. The gateway mints an operation id and calls
   `mfa_consume_recovery_code(user_id, code_digest, operation_id)`.
   Atomic: exactly one concurrent winner; the UNIQUE
   `consumed_by_operation` makes replays idempotent. One code
   authorizes one reset — never more.
3. On consume success, inside one transaction the gateway:
   - inserts the `mfa_recovery_operations` row (`started` → `latched`),
   - inserts the `mfa_security_latch` row (reason
     `recovery_pending`, with the audit id),
   - deletes the user's `session_grandfather_registry` rows (a
     recovery-pending family never regains access via grandfathering),
   - appends `mfa_audit_log` entries for each step.
   The session is now `RECOVERY_PENDING`. **This is permission to reset
   enrollment, NOT proof of AAL2 and NOT workspace access.**
4. Server-only provider admin adapter: removes the lost factor,
   invalidates the recovery generation (`invalidated_at`), requests
   session revocation. Partial failures are reconciled from the
   operation row — the operation id is idempotent, steps resume rather
   than double-execute. **Never restore consumed codes or clear the
   latch merely because a provider call failed.**
5. The user enrolls and verifies a **real new TOTP factor**.
6. Only after verified reenrollment: the latch row is deleted, the
   operation moves to `completed`, audit entries appended. Privileged
   access resumes.

Concurrent recovery attempts for the same user serialize on the latch
PK and the code-consume lock — one winner, the others get generic
errors.

### 4.2 Jason break-glass (total authenticator loss)

Trigger: the user cannot complete self-service (lost authenticator AND
lost all recovery codes — see the tabletop in Section 9).

1. **Out-of-band identity check** (documented, never email-only): Jason
   (or a Jason-authorized operator) verifies the requester's identity
   over a known-good channel — voice/video call to a number already on
   file, in-person, or another channel Jason designated in advance.
   The check, the checker, and the channel are recorded with the audit
   id.
2. Through the **separately protected Supabase administration channel**
   (credentials kept outside the application), Jason issues a
   **single-user, short-lived, one-use enrollment-reset authorization**
   carrying: target user id, reason, audit id, expiry (minutes, not
   hours).
3. The reset follows the **same** latch → revoke → reenroll path as
   §4.1 from step 3 onward. There is no alternate path.

Prohibited: public master code, email-only claim, staff self-approval,
environment boolean, global bypass. A forged or expired break-glass
authorization is rejected and audited (acceptance gate: forged and
expired authorizations are tested).

---

## 5. Latch / revoke / reenroll sequence (reference)

```
code consumed ──▶ RECOVERY_PENDING ──▶ latch row inserted
                        │                    │
                        │                    ├─▶ old JWTs denied HERE
                        │                    │   (independent of provider
                        │                    │    revocation propagation)
                        ▼                    ▼
                 factor removed ──▶ generations invalidated
                        │
                        ▼
                 sessions revoked (provider)
                        │
                        ▼
                 user enrolls + verifies NEW totp
                        │
                        ▼
                 latch row DELETED ──▶ operation completed
```

Latch invariants:
- A latch is cleared **only** after verified reenrollment of a real
  new TOTP factor.
- Never cleared because a provider call failed, timed out, or was
  retried.
- Never cleared by rolling back the migration (rollback requires zero
  latch rows first — Section 8).
- Manual clear outside reenrollment requires Jason's explicit word
  **and** an audit entry naming the reason (see §7.2).

---

## 6. Limiter tuning

### 6.1 Staging defaults (passed as JSONB per call — no migration to retune)

| Action namespace | Buckets (capacity / window) |
|---|---|
| password sign-in | account/IP: 5 / 5 min · account-wide: 30 / 15 min · IP: 100 / 5 min |
| sign-up | IP: 20 / 10 min · account: 3 / hour |
| password-reset request | account: 3 / hour · IP: 30 / hour |
| refresh | session: 30 / 5 min · account: 120 / 5 min · IP: 1000 / 5 min |
| MFA challenge/verify, recovery | account: 5 failures / 5 min · IP: 60 / 5 min |

Backoff after repeated failures: **2, 4, 8, 16, 32, 60** seconds,
capped at 60, then bounded bucket cooldown. No permanent
attacker-triggerable account lock. Successful MFA clears the account's
failure backoff; IP token budgets are never refunded by success.

### 6.2 Key discipline (gateway)

- IP key: trusted deployment-derived IP only. Never trust arbitrary
  `X-Forwarded-For` headers.
- Account key: `HMAC(normalized account identifier)` — trim/lowercase
  email consistently with provider behavior; no Gmail-dot/plus
  collapsing.
- Session/refresh keys: verified user/session id only — never decode an
  unverified token for attribution.

### 6.3 Monitoring queries (service_role, read-only)

```sql
-- Denied-rate by action, trailing hour (spike = attack or mis-tuned bucket)
select action, count(*) filter (where outcome = 'denied') as denied,
       count(*) as total
  from auth_operation_log
 where created_at > now() - interval '1 hour'
 group by action order by denied desc;

-- Limiter unavailable incidents (must be ~zero; each is a 503, no provider call)
select count(*) from auth_operation_log
 where outcome = 'evaluating'
   and created_at < now() - interval '5 minutes';
-- (rows stuck in 'evaluating' past 5 min indicate an evaluator that died
-- mid-transaction; investigate, do not hand-edit outcomes)

-- Bucket cardinality (bounded by TTL pruning; alert if growing unboundedly)
select count(*) from auth_rate_limit_buckets;

-- Active latches (should drain to zero outside recoveries)
select user_id, latched_at, reason, audit_id from mfa_security_latch;

-- Non-terminal recovery operations (stuck recoveries need reconciliation)
select id, user_id, status, updated_at from mfa_recovery_operations
 where status not in ('completed', 'failed');
```

### 6.4 Pruning job

The RPC opportunistically deletes buckets idle > 24h on every admission
(a 24h-idle bucket is fully refilled for every supported window, so
deletion ≡ full refill — pruning can never be more permissive than the
configured limit). As defense-in-depth, run a daily scheduled job:

```sql
delete from auth_rate_limit_buckets
 where last_refill < now() - interval '24 hours';
```

Do not create this as a database cron in the migration — provision it
in the job scheduler of choice and alert on `auth_rate_limit_buckets`
cardinality growth instead.

### 6.5 Gateway behavior notes

- Reserve-then-call: the RPC decrements before the provider call.
  Failed-attempt recording is idempotent by operation id.
- `allowed=false, unavailable=false` → HTTP **429** with `Retry-After:
  <retry_after_seconds>`; honor `backoff_seconds` before retrying.
- `unavailable=true` → generic **503**, no provider call, no sign-out
  messaging (already-authorized sessions continue; explain retry/offline
  state without falsely reporting sign-out).
- Minimum response timing and generic success/failure messages are
  gateway responsibilities (anti-enumeration) — the RPC only supplies
  the verdict.

---

## 7. Incident response

### 7.1 Suspected bypass

1. **Contain**: insert `mfa_security_latch` rows for affected users
   (reason `suspected_bypass`, fresh audit id). Old JWTs stop working
   immediately, independent of provider revocation.
2. **Scope**: query `mfa_audit_log` (by user, by audit id) and
   `auth_operation_log` (by action/keys/time) to establish what was
   attempted and what succeeded.
3. **Vector**: check the enforcement table (§10) for the endpoint used.
   A direct-provider call bypassing the gateway is a PARTIAL-coverage
   finding, not a code bug — record which endpoint and what native
   enforcement applied.
4. **Rotate**: provider admin credentials used by the recovery adapter;
   review who holds the break-glass channel.
5. **Recover**: affected users go through §4 reenrollment. Do not clear
   latches without verified reenrollment.
6. **Record**: full timeline in the audit log; brief Jason before
   widening any cohort again.

### 7.2 Latch stuck (user reenrolled but still denied, or latch won't clear)

1. Confirm in `mfa_audit_log`: is there a `reenrolled` + new-factor
   verification entry for the current operation? If yes and the latch
   row persists, this is the stuck case.
2. Verify the new factor is genuinely verified (provider factor list
   shows a verified TOTP enrolled after the latch timestamp).
3. Manual clear **only** with Jason's explicit word: delete the latch
   row and append an audit entry
   (`action='latch_manually_cleared'`, actor, reason, audit id).
4. Never clear a latch because a provider call failed or timed out —
   that is precisely when the latch must hold.

### 7.3 Limiter unavailable spike

`unavailable=true` means new auth operations and refresh fail closed
(503). Already-authorized sessions continue. Check: database
connectivity, migration applied, `auth_operation_log` for rows stuck in
`evaluating`, recent config deploys. There is no middleware limiter on
ordinary authenticated reads/writes — only auth operations are
affected.

---

## 8. Rollback procedure (fail-closed)

Rollback is manual and forward-only (no down migrations). It is a
**Jason-authorized-only** step — never part of a routine deploy.

**Preconditions (all must hold):**
1. `AUTH_RATE_LIMIT_ENABLED=false` and `MFA_LAYER2_ENABLED=false`
   everywhere. With flags off, auth behaves exactly as before Layer 2.
2. **Zero rows** in `mfa_security_latch`. Every latched user completes
   reenrollment first — deleting the latch table with active latches
   would silently re-admit old JWTs.
3. **Zero non-terminal rows** in `mfa_recovery_operations`. Reconcile or
   fail them (with audit entries) first.

**Steps:**
```sql
-- 1. Functions (limiter first, then recovery)
drop function public.auth_record_attempt_outcome(text, text, text);
drop function public.auth_admission_check(text, text[], jsonb, text, timestamptz);
drop function public.mfa_consume_recovery_code(uuid, text, text);
drop function public.mfa_audit_log_block_mutation();
-- 2. Tables, dependency order
drop table public.mfa_recovery_codes;
drop table public.mfa_recovery_generations;
drop table public.mfa_recovery_operations;
drop table public.mfa_security_latch;
drop table public.mfa_audit_log;
drop table public.session_grandfather_registry;
drop table public.auth_backoff_clears;
drop table public.auth_operation_log;
drop table public.auth_rate_limit_buckets;
```

**Post-rollback:** if the running app version lacks Layer 2
enforcement, keep the flags off — affected new sessions fail closed
until a compatible version is restored. Rollback **must not** grant
privileged AAL1 access, **must not** restore consumed recovery codes,
and **must not** clear latches (precondition 2 guarantees there are
none). Rolling back destroys recovery capability and the audit trail —
treat it as data-destructive.

---

## 9. Synthetic tabletop: total authenticator loss

Run in **staging**, with a synthetic user. No real recovery codes, no
production auth traffic. Roles: facilitator (Muse/operator), "locked
out staffer" (synthetic), Jason (identity checker).

| # | Step | Expected |
|---|---|---|
| 1 | Staffer loses authenticator AND all ten recovery codes (simulated: codes never issued to anyone real) | — |
| 2 | Staffer attempts self-service recovery with first factor only | Denied: generic error, no information about which piece failed |
| 3 | Staffer attempts with a guessed/wrong code | Denied; `credential_failed` recorded; backoff escalates 2→4→8… |
| 4 | Attacker replays staffer's consumed code concurrently | Exactly one winner; loser gets generic denial |
| 5 | Jason performs the out-of-band identity check over the designated channel; records checker, channel, audit id | Documented |
| 6 | Jason issues single-user, short-lived, one-use enrollment-reset authorization (reason + audit id) via the admin channel | Authorization expires in minutes; second use rejected |
| 7 | Forged authorization (wrong signature) and expired authorization submitted | Both rejected and audited |
| 8 | Valid authorization submitted → latch set | Old JWTs denied immediately, **before** provider revocation completes (probe with a pre-recovery token) |
| 9 | Provider adapter removes factor, invalidates generation, revokes sessions; kill the adapter mid-run once | Operation row shows partial status; retry resumes via the same operation id — no double factor-removal, codes stay consumed |
| 10 | Staffer enrolls and verifies a real new TOTP factor | — |
| 11 | Latch cleared; privileged access resumes; operation `completed` | — |
| 12 | Audit review: every step above has an `mfa_audit_log` entry with the same audit id chain | Complete chain, no gaps |

**Pass criteria**: 8, 9, 11, 12 hold; zero recovery-created AAL2
claims at any point (recovery grants reset permission, never access);
no step leaks whether a user id, code, or generation was valid.

---

## 10. Endpoint enforcement table

Columns: **endpoint** · **FORGE admission** (custom buckets via the
gateway) · **native provider enforcement** (Supabase built-in limits on
direct calls) · **supported hook** (provider hook that can enforce
custom logic) · **residual exposure** (what a direct provider call can
still do) · **status**.

**Status rubric** (binding): `PASS` requires staging-probe evidence
that the endpoint's custom enforcement actually holds against direct
calls. `PARTIAL` = FORGE admission exists on the gateway path but
direct provider calls bypass it. `UNSUPPORTED` = no supported hook or
enforceable ingress restriction can cover the direct path. Per the
brief, unsupported custom coverage **blocks full Layer-2 activation** —
ship reviewed inert code and document the smallest provider/config
change needed. Do not invent hooks. Native caps remain active
regardless.

| Endpoint | FORGE admission | Native provider enforcement | Supported hook | Residual exposure | Status |
|---|---|---|---|---|---|
| `POST /api/auth/sign-in` (password) | sign-in namespace: account/IP 5/5 min, account-wide 30/15 min, IP 100/5 min; backoff 2–60s ENFORCED on allowed verdicts; credential_failed/succeeded outcomes recorded; **L2-007 execution lease** (`auth_claim_execution`) claimed before the provider call — duplicate in-flight requests defer (429) without a second provider execution; ambiguous provider failures record `uncertain` | Supabase native auth rate limits apply to direct calls | password-verification hook exists but is sign-in-scoped; reject semantics must be tested — must not sign out legitimate sessions | Direct `signInWithPassword` bypasses FORGE buckets; native limits only | PARTIAL |
| `POST /api/auth/sign-up` | sign-up namespace: IP 20/10 min, account 3/hour; **L2-007 execution lease** before the provider call | Native limits | None — the verification hook is not a signup hook | Direct `signUp` bypasses custom buckets | PARTIAL |
| `POST /api/auth/reset` (request) | reset namespace: account 3/hour, IP 30/hour; **L2-007 execution lease** before the provider call | Native limits | None | Direct `resetPasswordForEmail` bypasses | PARTIAL |
| `POST /api/auth/reset` (update) | password-update namespace via gateway | Native limits | None | Direct `updateUser` bypasses | PARTIAL |
| `POST /api/auth/refresh` | refresh namespace: **per-credential abuse bucket** 30/5 min (keyed on HMAC(refresh_token) — a ROTATING credential, not a stable session; honestly labeled), IP 1000/5 min; **account-level refresh budgeting NOT YET IMPLEMENTED** (the account is unknown until the provider validates the token; an unverified token is never decoded for attribution); HMAC-key misconfiguration fails closed (503); missing trusted IP fails closed; **L2-007 execution lease** before the provider call; the browser wrapper preserves gateway 429/503 + Retry-After (retryable) instead of mapping to 401 | Native limits | None | SDK silent refresh bypasses unless routed through the gateway (wiring exists, disabled by default via NEXT_PUBLIC_LAYER2_GATEWAY_REFRESH) | PARTIAL |
| `POST /api/auth/mfa` (enroll/challenge/verify/list_factors/status/issue_recovery_codes) | **TWO-PHASE, deliberately separated (L2-008)**: phase 1 debits ONLY the pre-verification abuse reservation (`mfa_{challenge,verify}_pre`: IP 60/5 min, separate namespace) — the full verified budget (account 5 failures/5 min, IP 60/5 min, session 30/5 min) is debited exactly once in phase 2, so one MFA op never double-charges IP; **L2-007 execution lease** before enroll/challenge/verify provider calls; wrong-code verify records `mfa_failed` (drives the backoff ladder); **L2-003**: the verify response adapts the REAL SDK top-level token shape (no invented `data.session`); **L2-004**: `issue_recovery_codes` requires verified recent AAL2 + recent enrollment ceremony (403 otherwise) and replaces the generation via the atomic `mfa_replace_recovery_generation` RPC (one transaction; failure preserves the old generation); **L2-006**: verify with a latch completes recovery through phased RPCs (begin → mark_factors_removed → finalize) with new-factor binding (verified TOTP created after the operation started) — partial failure is never reported ok | Native limits | None | Direct MFA API calls bypass | PARTIAL |
| `POST /api/auth/recovery` | TWO-PHASE admission (IP, then verified account+session); recovery namespace: session 30/5 min, account 5/5 min, IP 60/5 min; ATOMIC consume+latch (one transaction); **L2-006**: the fresh-ceremony clock is the **AMR first-factor method timestamps** (never `claims.iat` — a current iat with a day-old password AMR does NOT consume; missing/future timestamps refused); **L2-007 execution lease** before the consume RPC; **L2-006**: completed/failed operations replay their terminal disposition without re-latching | Native limits | None | Provider admin factor deletion is server-only by construction | PARTIAL |
| Direct Supabase Auth REST (any path) | None — not routed through the gateway | Native limits only | TBD by staging probe | Full custom-bucket bypass on every direct path | TBD |
| Alternate auth methods / callbacks (OAuth, magic link, etc.) | TBD by staging probe | Native limits | TBD by staging probe | TBD by staging probe | TBD |
| Storage / Realtime / RPC data surfaces | **NOT YET IMPLEMENTED**: no additional restrictive predicate is wired on Storage/Realtime/RPC surfaces today. The rental-route wiring below covers the rental API routes only. Per the brief, unsupported custom coverage blocks full Layer-2 activation — ship reviewed inert code and document the smallest provider/config change needed. | Provider RLS | None | TBD by staging probe per surface | UNSUPPORTED |


### 10.1 Rental-route security-assurance wiring (L2-002)

Every `requireRentalPermission` / `requireTeamManager` call site in the
rental API routes now receives `security: await buildSecurityContext(authenticated)`.
`buildSecurityContext` is the TRUSTED server-side wiring: it reads the
activation flag from the module (not from caller input) and builds
`{ supabaseAdmin, session }` from the SSR client's cookie session.

- **Disabled (default)**: `buildSecurityContext` returns `null`;
  `enforceSecurityAssurance` is inert — behavior is EXACTLY as before
  (no guard call, no extra work).
- **Activated**: a missing/incomplete security context FAILS CLOSED (403)
  instead of being skipped. A caller-supplied `config` can never opt out —
  activation is trusted server state.

Wired call sites (12 route files, 15 call sites):

| Route file | Wired calls |
|---|---|
| `src/app/api/rental/financial-event/route.js` | `requireRentalPermission` |
| `src/app/api/rental/manual-financial-event/route.js` | `requireRentalPermission` |
| `src/app/api/rental/team/audit/route.js` | `requireRentalPermission` |
| `src/app/api/rental/team/preview/route.js` | `requireTeamManager` |
| `src/app/api/rental/team/route.js` | `requireRentalPermission` ×3 |
| `src/app/api/rental/transactions/batch/route.js` | `requireRentalPermission` |
| `src/app/api/rental/transactions/route.js` | `requireRentalPermission` ×2 |
| `src/app/api/rental/transfers/route.js` | `requireRentalPermission` |
| `src/app/api/rental/vendor-bills/[id]/route.js` | `requireRentalPermission` |
| `src/app/api/rental/vendor-bills/route.js` | `requireRentalPermission` |
| `src/app/api/rental/vendor-payments/[id]/route.js` | `requireRentalPermission` ×2 |
| `src/app/api/rental/vendor-payments/route.js` | `requireRentalPermission` |

NOT wired (explicit):

- `src/app/api/rental/team/permissions/route.js` — calls
  `getActorRentalAuthorization` directly (not a `require*` wire point);
  it does not take a security context. If the guard must cover it, the
  route needs an explicit `enforceSecurityAssurance` call — tracked as
  not-yet-implemented.
- `src/app/api/tenant-payments/*` — mentions the functions only in
  comments; no authorization call sites to wire.
- Storage / Realtime / RPC data surfaces — see the endpoint table above
  (UNSUPPORTED: no restrictive predicate wired).

**No endpoint is PASS today.** PASS is earned per endpoint by the
staging provider probes (direct sign-in/signup/reset/refresh, every
alternate auth method/callback, MFA endpoints, password reset): the
probe must demonstrate the claimed enforcement against a real direct
call, or the endpoint stays PARTIAL/UNSUPPORTED and full activation
stays blocked.

---

## 11. Files and provenance

- Migrations:
  `supabase/migrations/20261013225000_auth_rate_limit_buckets.sql`,
  `supabase/migrations/20261013225100_mfa_recovery_and_latch.sql`
- Migration tests (PGlite, 18/18):
  `supabase/migrations/__tests__/20261013225000_auth_rate_limit_buckets.migration.test.js`,
  `supabase/migrations/__tests__/20261013225100_mfa_recovery_and_latch.migration.test.js`
- Binding brief:
  `forge-ai-drop/commands/muse/mfa-auth-ratelimit-implementation-brief-2026-10-12.md`

Schema-convention note: the brief suggested an `auth_security`
schema; the repo keeps security tables in `public` with prefixed
names (`auth_*`, `mfa_*`, `session_*`). These migrations follow the
repo convention; isolation is enforced by restrictive RLS
(service-role-only, no client policies) rather than schema separation.

The 100-concurrent-requests atomicity gate and the staging provider
probes require real migrated Postgres and run in staging — PGlite
proves the single-transaction atomicity they rest on, not the
concurrency itself.
