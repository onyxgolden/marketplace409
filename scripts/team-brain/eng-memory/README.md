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
| `admission.mjs` | Descriptor-based admission: own data only, zero accessor invocation, unknown fields refused before value reads, `__proto__`/depth/key-count bounds |
| `schemas.mjs` | Closed event/query/denial schemas, pin validation, host-config validation (exact-literal paths, no globs), forbidden-data scan |
| `errors.mjs` | `ENG_CODES` (reuses `TeamBrainError`/`fail` from `../ledger/errors.mjs`) |
| `store.mjs` | Fake in-memory store, repository-adapter-shaped (episodes append-only; retention reviews) |
| `capture.mjs` | Intake: admit → byte budget → schema/host auth → forbidden scan → deny/revoke → idempotent persist |
| `recall.mjs` | Read-only recall: charge-before-inspect (64), 5s watchdog, 20-result cap, deterministic ranking, conflict flags, uncertainty, revocation suppression |
| `leakage.mjs` | Forbidden-content scanner over outputs/logs/persisted artifacts |
| `battery.mjs` | Import-safe battery core (100 frozen cases + 5 gold queries + leakage scan) |
| `runBattery.mjs` | CLI: 3-run byte-identical determinism check → JSON report |
| `fixtures/generateBattery.mjs` | Deterministic generator for `fixtures/battery-cases.json` (+ pinned `.sha256`) |
| `__tests__/engMemory.test.mjs` | 35 unit/adversarial/determinism tests |

## Data contract

Capture input (closed — unknown fields refused):
`eventId`, `taskId`, `source{repo, path, pin{algo: git-blob-sha1|sha256, id}}`,
`principal`, `eventAt` (UTC-ISO), `kind`, `status`, `attribution{actor, authorityRef}`.

Host authentication (injected, never derived from request contents):
`approvedRepos`, `approvedPaths` (exact literals, never globs),
`registeredPrincipals`, `registeredAuthorities`, `deniedSources`,
`revokedSources`, `prohibitedValues` (canary tokens).

Recall output: source-bound episode IDs, exact provenance, uncertainty
(`NONE`/`NO_MATCH`/`AMBIGUOUS_CUES`), capped at 20, deterministic ranking
(`eventAt` desc, `episodeId` asc). Retrieved candidates are metadata, never
truth/approval/queue-completion/instructions.

Absolute boundary: tenant, ledger/financial, and scheduling data are forbidden
in inputs, buffers, indexes, logs, and outputs. Refuse, never redact-and-keep.
Diagnostics carry reason codes and safe IDs only.

## Commands

```bash
# Unit suite (35 tests)
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
   throwing sentinels in tests prove denied bodies are never read.
2. Capture persists pointers + typed metadata only; source bodies are never
   dereferenced (there is no body read anywhere in this module).
3. Duplicate identity (repo/path/pin/attribution + task/kind/principal/time)
   is idempotent: crash/retry yields one logical event.
4. Recall charges each candidate before inspection; budget/watchdog
   exhaustion refuses the whole task with no partial domain output.
5. Revocation/denial suppresses retrieval and records a retention-review
   request; history is never deleted.
6. Contradictory episodes coexist with explicit conflict flags.
7. Outputs never contain forbidden values: the leakage scan fails the
   battery on any canary or forbidden key fragment.

## Explicit non-capabilities

This slice does not: create a MEMORY.md authority, database, or global agent
hook; install the agentmemory runtime; touch production data, Supabase, or
live Team Brain state; send anything; run a daemon/scheduler; make network
or model calls; or merge/authorize anything. Synthetic fixtures only.
