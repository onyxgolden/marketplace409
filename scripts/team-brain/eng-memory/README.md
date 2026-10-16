# Team Brain eng-memory — engineering memory capture & recall adapter (slice 1)

Synthetic, metadata-only intake/recall adapter for the existing Team Brain
contract. This is **not** a second memory system: it reuses Team Brain's
episode/source identities, UTC-ISO validation, typed error codes, and
repository-adapter interface shape, and it persists pointers plus typed
coordination metadata only. It never dereferences source bodies.

Binding scope: `onyxgolden/forge-ai-drop` →
`briefs/agent-infra/engineering-memory-capture-recall-slice1-scope-2026-10-16.md`
(ChatGPT, Jason-approved build 2026-10-16).

Production baseline mapped (first acceptance step):
- Team Brain production brief, forge-ai-drop blob
  `deaadfdabbf29cc40d7563079416c3adcbf07cb2` — the production service
  (Supabase `team_brain` schema, persistent worker) is a separate,
  separately-gated build. This slice is the synthetic adapter that proves
  the capture/recall contract against a fake store; "production adapter
  availability is a dependency, not permission to apply its schema."

## Reused components (existing implementation)

| Reused | From |
|---|---|
| `TeamBrainError` / `fail` typed-error pattern | `ledger/errors.mjs` |
| `assertUtcIso` strict UTC timestamps | `ledger/validation.mjs` |
| Source-binding identity shape (repo/path/commit/blob/head) → repo/path/pin | `ledger/validation.mjs` (`assertSourceBinding`) |
| `stableStringify` canonical serialization (episode identity hashing, battery reports) | `report/stableStringify.mjs` |
| Repository-adapter factory shape (host-injected config, `createX(db, opts)`) | `ledger/repository.mjs` |
| Handoff conformance semantics: exact replay idempotent (AC-19) → duplicate-replay cases | `__tests__/handoffs.test.mjs` |

## Gaps this slice does not close

- No durable adapter: the fake store (`store.mjs`) is in-memory and
  single-process. The production Postgres adapter is a later, separately
  approved slice.
- No consolidation, no queue projection over episodes, no worker, no Git
  transport — those belong to the production brief's slices.
- No embeddings, no LLM extraction, no provider calls, no global hooks —
  forbidden by the scope's absolute data boundary.

## Layout

| Path | Responsibility |
|---|---|
| `admission.mjs` | Descriptor-based admission: own data only, zero accessor invocation, unknown fields refused before value reads, `__proto__`/depth/key-count bounds, scalars proven primitive (getter-bearing objects/arrays/cycles refused with zero invocations) |
| `schemas.mjs` | Closed event/query/denial schemas, pin validation, host-config validation (exact-literal paths, no globs), registered tasks, exact source-tuple registrations, bounded authority registrations, caller binding, forbidden-data scan |
| `errors.mjs` | `ENG_CODES` (reuses `TeamBrainError`/`fail` from `../ledger/errors.mjs`) |
| `budget.mjs` | `ConsultationBudget`: per-phase 64-unit charge-before-inspect budgets (host-config, capture validation, recall) |
| `store.mjs` | Fake in-memory store, repository-adapter-shaped (episodes append-only and detached on every boundary; idempotent retention reviews) |
| `capture.mjs` | Intake: admit → byte budget → schema + caller binding → forbidden scan → registration/authority checks → deny/revoke → idempotent persist / conflict-preserving persist |
| `recall.mjs` | Read-only recall: charge-before-inspect (64), 5s watchdog (sync cooperative clock + `recallAsync` real-timer host entrypoint), 20-result cap, 256KiB payload accounting, deterministic epoch-ms ranking, conflict flags, uncertainty + truncation reporting, read-permission revalidation |
| `leakage.mjs` | Forbidden-content scanner over outputs/logs/persisted artifacts |
| `battery.mjs` | Import-safe battery core (100 frozen cases + 5 gold queries + leakage scan over full actual outputs) |
| `runBattery.mjs` | CLI: 3-run byte-identical determinism check → JSON report |
| `fixtures/generateBattery.mjs` | Deterministic generator for `fixtures/battery-cases.json` (+ pinned `.sha256`) |
| `__tests__/engMemory.test.mjs` | 79 unit/adversarial/determinism tests |

## Data contract

Capture input (closed — unknown fields refused):
`eventId` (strict opaque-ID syntax), `taskId` (must be a host-registered
engineering task), `source{repo, path, commit?, pin{algo: git-blob-sha1|sha256, id}}`
(must match a host source registration: exact repo/path tuple with optional
commit and pin bindings — never a repo/path Cartesian product), `principal`
(host-registered), `eventAt` (UTC-ISO, compared as integer epoch-ms),
`kind`, `status`, `attribution{actor, authorityRef}` (bound to a host
authority registration for this principal/actor, action, task/source scope,
validity window, and revocation state).

Caller identity (injected, never derived from request contents): every
capture/deny/revoke call takes a separately injected `opts.caller` that must
equal the claimed principal — knowing a registered principal string is not
the same as being that principal.

Host authentication (injected, never derived from request contents):
`approvedRepos`, `approvedPaths` (exact literals, never globs),
`registeredPrincipals`, `registeredAuthorities`, `registeredTasks`,
`sourceRegistrations`, `authorityRegistrations`, `deniedSources`,
`revokedSources`, `prohibitedValues` (canary tokens). Retention reasons are
normalized safe codes (`assertReasonCode`), never arbitrary text.

Recall output: source-bound episode IDs, exact provenance, uncertainty
(`NONE` only for exact task-ID hits / `NO_MATCH` / `AMBIGUOUS_CUES` for
broad cues), capped at 20 with `truncated` + coverage counts, deterministic
ranking (`eventAtMs` desc, `episodeId` asc), 256KiB returned-payload
accounting, and a non-authoritative notice. `recallAsync` is the host
entrypoint with a real-timer watchdog; the sync `recall` core keeps a
cooperative clock. Retrieved candidates are metadata, never
truth/approval/queue-completion/instructions.

Absolute boundary: tenant, ledger/financial, and scheduling data are forbidden
in inputs, buffers, indexes, logs, and outputs. Refuse, never redact-and-keep.
Diagnostics carry reason codes and safe IDs only.

## Commands

```bash
# Unit suite (79 tests)
npx vitest run scripts/team-brain/eng-memory

# Full team-brain regression (slice-1 + eng-memory)
npx vitest run scripts/team-brain

# Frozen battery: 100 cases + 5 gold + leakage + 3-run determinism
node scripts/team-brain/eng-memory/runBattery.mjs --out /tmp/eng-battery.json

# Regenerate frozen fixtures (byte-identical when the generator is unchanged)
node scripts/team-brain/eng-memory/fixtures/generateBattery.mjs

# npm script
npm run forge:team-brain:eng-memory -- --out /tmp/eng-battery.json
```

## Invariants (enforced in code)

1. Admission never invokes accessors and never reads unknown fields' values;
   throwing sentinels in tests prove denied bodies are never read. Scalars
   must be primitive: getter-bearing objects, arrays, and cycles at scalar
   positions are refused with zero invocations, before serialization.
2. Capture persists pointers + typed metadata only; source bodies are never
   dereferenced (there is no body read anywhere in this module).
3. Replay identity (repo/path/pin/attribution + task/kind/principal/time) is
   distinct from canonical content (identity components + status):
   byte-identical replays are idempotent (`DUPLICATE_REPLAY`); changed
   material content under the same identity is preserved as a separate
   immutable conflicting episode (`CONFLICT`), never first-wins silent
   success. Crash/retry yields one logical event per content version.
4. The separately injected caller identity must equal the claimed
   principal (`MISSING_CALLER` / `CALLER_PRINCIPAL_MISMATCH`); identity
   fields are registry-bound (`UNREGISTERED_TASK`, exact source tuples,
   staged authority binding with action/task/source scope, validity
   window, and revocation). The forbidden-data scan runs before all
   registration checks.
5. Recall charges each candidate before inspection; budget/watchdog
   exhaustion refuses the whole task with no partial domain output. The
   async host entrypoint (`recallAsync`) terminates hung/slow async
   iterators via a real timer.
6. Revocation/denial suppresses retrieval and records one idempotent
   retention-review request per (trigger, source); the denied/revoked set
   is updated before the review write, so suppression survives a
   review-write failure (reported as `*_REVIEW_PENDING`, never as fully
   completed). History is never deleted.
7. Read permission is revalidated at recall time against the current host
   config; removing an approved read path suppresses retrieval.
8. Contradictory episodes coexist with explicit conflict flags.
9. Timestamps are validated and compared as integer epoch-ms; only exact
   task-ID hits are `NONE` certainty; broad cues are `AMBIGUOUS_CUES`;
   truncation is reported with coverage counts; returned payloads are
   capped at 256KiB.
10. Store boundaries detach on insertion and every outward read: callers
    can never rewrite stored provenance through a result alias.
11. Outputs never contain forbidden values: the leakage scan fails the
    battery on any canary or forbidden key fragment, scanning full actual
    capture/recall results — not projections.

## Explicit non-capabilities

This slice does not: create a MEMORY.md authority, database, or global agent
hook; install the agentmemory runtime; touch production data, Supabase, or
live Team Brain state; send anything; run a daemon/scheduler; make network
or model calls; or merge/authorize anything. Synthetic fixtures only.
