# Research Training Agent — Phase 2 slice 1 prototype

A self-contained, fixture-only, pure Node 24 ESM prototype of the
Research Training Agent: it drafts lesson outlines, extractive
summaries and passage-derived short-answer quizzes over invented
source bundles. Every taught statement, question and keyed answer
carries an exact byte-span passage citation; anything it cannot prove
from the passages is a gap or an explicitly rejected key — never
taught. All output is labeled `DRAFT — NOT PUBLISHED`.

There is no model call, no network, no filesystem write, no tool
execution and no spend anywhere in this slice. No web browsing, no
LMS, no publishing, no enrollment, no real curriculum.

## Domain rules (published candidate taxonomy)

Grammar: every taught fact is an assertion in the controlled grammar
`Subject | predicate | value | scope` — literal UTF-8 tokens, no
hidden inference, no connectives across passages. An assertion is
admitted only when its quoted passage slice matches the source bytes
exactly at the claimed half-open UTF-8 offsets (re-encoding check
included) and parses back into the same four tokens.

Research v2 taxonomy, precedence **contradicted > supported >
attributed-only > unsupported**, keyed by (subject, predicate, scope).
Keys are framed tuples — ("a","bc","d") and ("ab","c","d") never
merge. Authority and evidence repairs (PER-001..004/006, 2026-10-20
retrospective audit) bind the taxonomy further:

- The authenticated principal must be non-revoked and inside its
  validity window at the context clock before any source is resolved
  or any output produced — a dead principal refuses `ACTION_DENIED`
  on every path, including the empty one.
- The grammar attests positive statements only. Polarity is part of
  an assertion and of its key, so it must be passage-proven like
  every other component: a task-supplied negative polarity is
  refused `INVALID_INPUT`, and unchanged positive bytes can never
  yield a negative key or a manufactured contradiction.
- Source resolution is keyed by the complete pin identity
  (repo|path|commit|blob|algorithm|revision). A second, different
  pin on an already-resolved path is verified on its own bytes;
  a citation never consumes another pin's verification.

- **contradicted** — admitted assertions for the key disagree on
  value. The key is blocked: no statement, no quiz, no answer.
  A contradiction note cites both sides.
- **supported** — all admitted assertions agree and the evidence comes
  from at least two independent evidence roots in at least two
  distinct provenance groups. Support counts evidence *roots* (the
  transitive closure of the host-declared `copied_from` relation),
  never passages: duplicates, known copies and citation cycles
  contribute no corroboration. A root counts only when every link
  of its chain is registered in the host provenance map — an
  unregistered source, copy link or root is unknown provenance and
  corroborates nothing. A declaration may also bind itself to exact
  consumed pins via `applies_to`; a changed pin makes it
  inapplicable.
- **attributed-only** — all agree but the evidence reduces to one
  root. Taught only as "Fixture source states…", never as established
  truth.
- **unsupported** — no admitted assertion. The topic is a gap.

Quizzes are fixed short-answer items built from the host-pinned
template registry (predicate → question form + lesson heading). There
are no multiple-choice distractors in this slice: a requested
multiple-choice task refuses `UNSUPPORTED_TASK`. Proposed answer keys
are claims, not keys: a proposal that disagrees with the
passage-derived value token is rejected `KEY_UNSUPPORTED` and never
repaired from memory. Multi-passage composites accept exactly two
distinct admitted atoms, each with its own verified citation, keyed
as an ordered pair; a missing, denied, quarantined, contradicted or
unsupported atom rejects the composite with no question emitted.

Envelope statuses: `REPORT_READY` (all requested topics taught, no
gaps), `PARTIAL` (material exists with gaps, or sources admitted but
zero valid assertions → `INSUFFICIENT_EVIDENCE`), `EMPTY` (no
topics, assertions or sources), `REFUSED` (with a diagnostic code:
`INVALID_INPUT`, `ACTION_DENIED`, `UNSUPPORTED_TASK`, `HASH_MISMATCH`,
`SOURCE_UNVERIFIED`, `SPAN_MISMATCH`, `INPUT_LIMIT`,
`BUDGET_EXCEEDED`, `OUTPUT_LIMIT`, `EXECUTION_TIMEOUT`,
`TRANSPORT_REFUSED`).

## Runtime contract

- Trust: a builtins-only bootstrap (`bootstrap.js`, held outside the
  repo in the host trust directory) authenticates the corpus manifest
  root digest — supplied externally via
  `RESEARCH_TRAINING_APPROVED_ROOT` — before importing any in-corpus
  module on official entrypoints. `node:path/posix` is used for all
  manifest paths (Windows-portable).
- Budgets (per run): 64 consulted candidate objects, 512 evidence
  spans, 256 output records, 256 KiB aggregate input, 256 KiB output,
  object-graph depth 32, 5 s watchdog. Every candidate — task fields,
  trusted-context entries (sources, grants, principal, aliases,
  criteria/templates, provenance), each source revision — is charged
  before any of its fields are read; a denied source's bytes are never
  touched.
- Injection posture: the full resolved source text (never a prefix
  slice) is scanned for seeded injection families; a hit quarantines
  the source's text and support. Fixture text is never executed and
  never treated as instructions.
- The battery oracle (`corpus/oracle.js`) is an independently
  authored reference implementation of the decision rules; it imports
  nothing from the candidate.

## Official entrypoints (behind the trust bootstrap)

```
RESEARCH_TRAINING_APPROVED_ROOT=<digest> node <trust>/bootstrap.js <proto> tests
RESEARCH_TRAINING_APPROVED_ROOT=<digest> node <trust>/bootstrap.js <proto> battery
RESEARCH_TRAINING_APPROVED_ROOT=<digest> node <trust>/bootstrap.js <proto> manual <task.json> <context.json>
```

Suites: `tests/run-tests.js` (focused node:test suite) and
`tests/run-battery.js` (128 frozen cases — 40 nominal/boundary, 30
contradiction/incomplete/duplicate, 20 injection/prohibited-operation,
28 schema/provenance/permission, 10 budget/replay/mutation — each run
3× through the guarded launcher, byte-identical).

All fixture material is invented from scratch for this prototype
(fictional machinery, protocols and names in `fixtures/`); nothing is
copied or anonymized from real material.
