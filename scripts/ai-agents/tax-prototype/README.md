# Tax Agent — Phase 2 slice 1 synthetic prototype

A deterministic educational-topic classifier and cited draft assembler.
**Not a tax calculator. Not a general-purpose chatbot.** Pure Node 24
ESM, zero runtime dependencies, zero model calls, zero network.

Implements `commands/muse/ai-lab-phase2-slice1-common-contract-2026-10-12.md`
and `results/chatgpt/tax-agent-phase2-slice1-brief-2026-10-12.md` (both in
`onyxgolden/forge-ai-drop`).

## What this is

Three registered educational topics only, all via the host-injected
registry (never the request payload):

- `recordkeeping-basics` — categories of records as organizational terms
- `terminology-income-vs-expense` — conceptual income/expense vocabulary
- `depreciation-concept` — basis/life/method/convention vocabulary

No real statutory figures, current-law assertions, or computations.
Every output is labeled **SYNTHETIC EDUCATIONAL EXAMPLE — NOT TAX
GUIDANCE / DRAFT / NOT PUBLISHED.**

## Hard boundaries

- Personal financial facts or personalized-advice requests — anywhere in
  the reachable input, even under a disclaimer, a general-looking topic,
  or a claimed expert approval — force `REFUSED` / `PERSONALIZED_INPUT`
  with zero draft content and a licensed-professional referral, before
  any registry lookup.
- Situation-specific or unregistered topics (REPS qualification, passive
  loss, §179, QBI, entity selection, 1031 timing, ...) route to
  `REVIEW_REQUIRED`, never drafted.
- No file-write API, no network, no tool calls. The agent returns a
  detached advisory JSON snapshot; nothing here authorizes publication,
  filing, or real CPA identity.
- A registry entry is never trusted on matching ID strings alone. Its
  `registry_ref` is independently resolved through the same fixture
  Git-object store as claims (read-granted, hash-verified), and its
  canonical content digest (`entry_digest` — topic/jurisdiction/coverage/
  every claim's text and source pin) must equal both the entry's own
  declared digest and the digest the authenticated registration binds.
  Changing any part of an entry's content — including which registration
  it points to — invalidates its own digest before the chain is even
  checked. The common envelope's `source_refs` deterministically lists
  the verified registry ref plus every verified supporting claim ref for
  outcomes that actually resolved them; quarantined/denied sources never
  appear there.

## Run

```
TAX_APPROVED_ROOT=<digest> npm test      # unit tests + frozen battery, trust-gated
TAX_APPROVED_ROOT=<digest> npm run battery   # battery only, with the acceptance summary printed
node runner/run-manual.js recordkeeping-basics --year 2026 --as-of 2026-06-01T00:00:00Z
```

Both npm scripts require `TAX_APPROVED_ROOT` (a 64-hex SHA-256) supplied
externally by the reviewer or CI pipeline at invocation time — never by
these scripts themselves, and never read from any file in this tree.
`corpus/corpus_digest.txt` records the current digest as a reference for
whoever invokes this (it is itself one of the hashed files, so it can
never silently drift from the real corpus); it is not a trusted root on
its own. The launcher authenticates every pinned file against whatever
root was supplied, with node builtins only, before any scored code is
imported. A missing or mismatched root refuses (exit 3) before anything
runs — a candidate-controlled trust root would defeat the point of this
gate, so this package's own tree never supplies one (see TAX-001).

## Layout

- `src/` — scored agent code (`index.js` run() entry, `schemas.js`,
  `resolver.js`, `registry.js`, `injection.js`, `personal.js`,
  `canonical.js`, `markdown.js`).
- `fixtures/` — the registered-topic registry, fixture Git-object store,
  and trust chain (stewards/registrations/simulated review records).
  `make-fixtures.js` is the authoring tool that generates `store.json`
  with real recomputed Git blob hashes.
- `corpus/` — the frozen 160-case battery (`battery.json`), its
  SHA-256 manifest, and the two authoring tools (`make-battery.js`,
  `freeze-corpus.js`) that are not part of the scored path.
- `tests/` — `node:test` suites plus the battery harness/watchdog.
- `runner/run-manual.js` — standalone manual runner; not scored.

## Corpus categories (160 cases)

40 approved current drafts across all three topics · 20 historical /
obsolete / future / date / jurisdiction / year · 20 unknown-topic /
conflicting-source · 40 personalized-advice probes across topic_label,
task_id and source_refs · 20 malicious-source / self-approval /
publication / filing-request · 20 missing / hash-mismatch / span-mismatch
/ read-denied / stale-or-revoked-registry / forged-chain / budget.

## Known limitations (slice 1, honest)

- Topic classification is a closed three-ID registry, not free-text
  natural-language mapping — by design (the brief requires exact
  registered `topic_id`/`topic_label`, never an arbitrary instruction).
- The personal-advice and injection recognizers are finite seeded-pattern
  screens, not certified universal detectors; the closed topic/schema
  boundary is the primary protection, these are defense in depth.
- No live source-network watcher, no Tax Planner integration, no real
  CPA identity service — all separately gated, later phases.
