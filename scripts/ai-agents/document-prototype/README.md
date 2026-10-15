# Document Agent — Phase 2 slice 1 prototype

Synthetic, fixture-only prototype for document-set integrity: inventory,
exact-duplicate detection, version-conflict register, checklist coverage,
cross-reference map (with cycle detection), and cross-document assertion
conflicts. Pure Node 24 ESM, zero runtime dependencies, zero model calls,
zero network access. Advisory only — no file-write, no edits/deletion, no
conflict resolution, no fetch of external pointers, no production
integration.

## Layout

- `src/` — the scored agent: `index.js` (entry, budget-charged
  orchestration), `schemas.js` (strict runtime validation), `resolver.js`
  (fixture Git-object resolution + the per-task budget), `injection.js`
  (seeded directive-family recognizer), `integrity.js` (pure analysis:
  duplicates, version conflicts, checklist, reference graph + cycles,
  cross-document conflicts), `canonical.js` (hashing/canonical-JSON
  helpers).
- `fixtures/make-fixtures.js` — authoring tool; writes `fixtures/store.json`
  (the trusted fixture Git-object store used by both the battery and the
  unit tests).
- `corpus/make-battery.js` — authoring tool; authors `corpus/battery.json`
  (160 independently specified cases) against an oracle re-derived from
  this slice's brief, never from `src/*`.
- `corpus/freeze-corpus.js` — authoring tool; recomputes
  `corpus/manifest.json` + `corpus/corpus_digest.txt` (the pinned-file
  SHA-256 manifest and its digest).
- `tests/` — `run-tests.js` / `run-battery.js` (trust-authenticating
  launchers — see below), `*.test.js` (focused `node:test` unit tests),
  `harness.js` / `watchdog.js` / `case-worker.js` (battery runner
  infrastructure).
- `runner/run-manual.js` — standalone manual runner, not part of the
  scored path.

## Trust model

The approved corpus digest (`DOC_APPROVED_ROOT`) is a **separately
trusted host input** — supplied by the reviewer or CI pipeline as an
environment variable at invocation time. It is never embedded in
`package.json`'s own scripts or any other file in this candidate tree
(that would be exactly the self-certification this model forbids — see
the Tax Agent's TAX-001 finding elsewhere in this program). Both
launchers recompute the full manifest digest from disk with
`node:fs`/`node:crypto` only and refuse (exit 3) before importing any
scored file, test, or helper if it doesn't match.

```sh
node corpus/freeze-corpus.js        # prints the digest after any corpus change
DOC_APPROVED_ROOT=<printed digest> npm test
DOC_APPROVED_ROOT=<printed digest> npm run battery
```

## Budget model (see `src/index.js` for the full rationale)

Every top-level candidate — the checklist source, the document-set
source, each document record, each assertion record, and each distinct
resolved content blob — is charged via `budget.countObject()` as the
first statement before any of its fields are read. Byte-span
verification (sections, markers, assertion passages) against resolved
content is a separate, dedicated budget line (`countSpan()`). Both are
monotonic and fail closed: attempt 65 (object) or 513 (span) refuses
before that candidate is inspected at all, never after a partial read.

A scoping note for the reviewer: a document's own nested sections,
markers, and references are charged together with their owning document
record as ONE candidate — this prototype does not model them as
independently resolvable fixture objects. This mirrors the precedent set
by this program's Customer Success build under the identical common-
contract clause.

## Known limitations (slice 1, stated plainly)

- Checklist coverage is evaluated at the **document-set level**
  (does any admitted document anywhere satisfy each required section /
  companion), not per-document. The brief's "required companion logical
  IDs" language is compatible with either scoping; this is the simpler
  one.
- Checklist required-section/companion matching does not independently
  parse the checklist document's own prose for the actual requirement
  list — `required_sections`/`required_companions` come from the
  trusted, host-injected `context.criteria` fields directly. The
  checklist source is still resolved and injection-scanned before any
  evaluation proceeds.
- A document with injected content is still inventoried (doc_id,
  logical_id, revision are structural facts, not quoted content), but
  its sections/markers/metadata-verification are forced to
  not-present/unverifiable, and any assertion it owns is excluded from
  cross-document-conflict consideration — a hostile document cannot
  manufacture a checklist-satisfying section or a trusted citation.
- An out-of-bounds section/marker span (declared past the end of the
  actually-resolved content) is silently treated as not-present /
  unverifiable rather than surfaced as its own diagnostic — stated here
  rather than over-built under this slice's scope.
