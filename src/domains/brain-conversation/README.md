# FORGE Brain conversation harness

A per-owner memory layer for Brain conversations: a semantic store
(provenance + salience), an append-only episodic log, a procedural store,
per-turn retrieval with a bounded working set, a nightly consolidation
("sleep") job, and owner memory controls — all behind row-level security
isolation per owner.

## Status: DISABLED by default (gated activation)

The harness ships **disabled**. Nothing in this build turns it on:

- `BRAIN_CONVERSATION_HARNESS_ENABLED` must be exactly `"true"` for any
  route to serve (otherwise 503) and for the panel to render at all.
- Activation happens only on Jason's word, after Team Brain P8 passes.
- The migration file is authored, not applied — Jason applies migrations.

## Architecture

| Piece | File | Notes |
| --- | --- | --- |
| Config + flag | `config.js` | Decay 7 days (Q3, decided); archive window 90 days (**proposed, unconfirmed** — scope left it TBD); working set 8 (build choice, bounded) |
| Model-payload fencing | `fencing.js` | Refuses sensitivity-tagged entries and resolved record details; pointers only |
| Plain-words rendering | `plainWords.js` | Names and dates, never raw ids (A8); ids redacted even if pasted into a memory |
| Retrieval | `retrieval.js` | Relevance x recency with a novelty penalty; deterministic order |
| Preferences | `preferences.js` | Icon position (percent, draggable) + decay window validation |
| Panel drag math | `panelLogic.js` | Percent positions; moves under 4px are taps, not drags |
| Stores | `memoryStore.js`, `supabaseStore.js` | Same interface; every call scoped by ownerId; cross-owner ids read as not-found |
| Owner resolution | `requireBrainOwner.js` | Signed-in user → effective owner; 401 when signed out. **Not in the barrel** (imports next/server) |
| Consolidation | `consolidation.js` | Promote uncontested facts, merge duplicates, flag conflicts, flag inferred decay, gist + archive old episodes |
| Panel | `src/components/brain/BrainPanel.jsx` | Collapsible, draggable icon, app-wide; position persists per owner |
| Routes | `src/app/api/brain/*` | Memories, episodes, preferences, chat (no answering yet), consolidate |

## Consolidation powers (contract §4)

MAY: promote uncontested facts, merge duplicates, retire with a note
(here: flag inferred decay; nothing is deleted).

MUST NOT — enforced in code: never silently change a standing rule,
never resolve a conflict (conflicts become flags and nothing is touched),
never change `owner_stated` salience, never auto-resolve a flag, never
delete a row.

Candidate facts are structured `{ key, text }` attached to episodes at
append time. Consolidation never does free-text extraction, and the gist
is extractive (first sentences, 280 chars max) — no model is involved
anywhere in this build.

## Reference-only tenant pointers (Q5)

Memory tables store `record_type` / `record_id` pointers to rental
records only. No tenant names, emails, amounts, or other tenant details
are duplicated into memory tables, and `fencing.js` refuses any payload
that carries resolved record details.

## Archival safety catch

Archival sets the gist, the status, and the reserved storage path
(`brain-archives/<owner>/<episode>.txt`) but **retains the raw content**
until a Storage upload step is configured at activation. Deleting raw
content before the upload path exists would destroy data.

## What activation still needs (separate Jason word each)

- Migration applies (Jason applies; never applied by the build).
- Archive window confirmation (90 days is proposed, not decided).
- Storage upload wiring for archived episode raw content.
- Consolidation scheduling wiring (the route runs it on demand; no
  workflow file is added, so no PR-triggered job can pin
  `mergeable_state` unstable on unrelated PRs).
- A chat answering model adapter — the chat route today returns
  `answeringEnabled: false` with a plain-words notice and never fakes
  an answer. Any adapter needs its own authorization and must pass
  through `fencing.js`.

## Cost notes

Per-turn injection is bounded to the working set (default 8 entries).
Consolidation replays at most 50 episodes per run (70% newest, 30%
oldest). No model calls exist in this build, so there is no model cost.

## Testing

- Domain unit tests: `src/domains/brain-conversation/__tests__/`.
- RLS test: `rls.test.js` runs the shipped migration SQL in PGlite and
  proves two-owner isolation at the database layer.
- Fencing test: includes a source scan asserting no model SDK import
  and no model-endpoint string anywhere in the harness or its routes.
- Fixtures are synthetic only. No real tenant, financial, ledger, or
  scheduling data appears in any test.
