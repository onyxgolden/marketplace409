# Customer Success Agent — Phase 2 slice 1 prototype

Deterministic ticket triage (taxonomy classification + priority), two
inert fixed-template response drafts per eligible ticket, and
independently recomputed support metrics over a fixture-only ticket
bundle. **Not** a helpdesk integration, not a sender, not a calculator
of account actions.

Pure Node 24 ESM. Zero runtime dependencies. Zero model calls. Zero
network. Zero filesystem/shell/browser/send capability inside `src/` —
the agent returns a detached advisory JSON snapshot; the host test
launcher reads fixtures and may save reports to an explicit scratch
directory, but the agent itself has no such API.

## Layout

```
src/            scored agent code (zero I/O; see zerotools.test.js)
fixtures/       make-fixtures.js (authoring tool) + store.json (generated)
corpus/         make-battery.js (authoring tool) + battery.json / manifest.json / corpus_digest.txt (generated)
runner/         run-manual.js — manual, not scored
tests/          node:test suite + battery harness + trust bootstrap
```

## Commands

- `npm test` — bootstraps trust (see below), then runs the full
  `node:test` suite.
- `npm run battery` — bootstraps trust, then runs all frozen corpus
  cases and prints the acceptance summary.

Both require `CS_APPROVED_ROOT` as an externally supplied environment
variable — see **Trust model** below. Regenerate fixtures/corpus after
any change:

```
node fixtures/make-fixtures.js
node corpus/make-battery.js
node corpus/freeze-corpus.js
```

`freeze-corpus.js` prints the new corpus digest — that is the value a
reviewer/CI supplies as `CS_APPROVED_ROOT` for the next run.

## Trust model

The approved corpus digest is a **separately trusted host input**,
never a value this package's own scripts can supply to themselves
(mirrors the Tax Agent prototype's TAX-001 finding and fix in this same
program): `package.json`'s `test`/`battery` scripts do not embed
`CS_APPROVED_ROOT`, and `corpus/freeze-corpus.js` never writes to
`package.json`. `tests/run-tests.js` and `tests/run-battery.js`
recompute the full corpus digest with `node:fs`/`node:crypto` only and
compare it against the externally supplied `CS_APPROVED_ROOT` **before**
importing any scored test, helper, or agent module. Any mismatch — a
missing root, a wrong root, a tampered pinned file, an unlisted new
file — refuses closed (exit 3) before a single line of scored code runs.

## Deliverable

- Taxonomy v1 classifier: category precedence
  `ACCOUNT_CLOSURE > BILLING > TECHNICAL > FEATURE_REQUEST > OTHER`;
  every other recognized tag (including a primary tag that lost
  precedence) is retained as a secondary category; unrecognized tags
  are named `unknown_tags`, never guessed into a category. Priority:
  `TECHNICAL`+`OUTAGE` → `HIGH`; `ACCOUNT_CLOSURE` or `BILLING`+
  `NEGATIVE` sentiment → `MEDIUM`; `FEATURE_REQUEST`-only → `LOW`; else
  `NORMAL`. Sentiment is always the ticket's own structured field,
  never inferred from free text.
- Two fixed-template drafts per eligible ticket — `acknowledgment` and
  `clarification`, both labeled `DRAFT — NOT SENT`. Templates insert
  only verified fixture/topic labels (the classified category, the
  ticket ID) — **never** the ticket's own subject/body/notes, a contact
  detail, a refund promise, an SLA guarantee, or any claim that an
  account action occurred. A missing verified topic (`OTHER` with no
  recognized secondary tag either) or quarantined free text suppresses
  both drafts with a named `suppression_reason`; classification still
  proceeds from the clean structured fields either way.
- Support metrics (Metrics v1), every sum/mean an **exact rational**
  (`{num, den}` as decimal strings — never a floating-point
  accumulation, so repeat runs are byte-identical and no display
  rounding can decide an equality): response/resolution time in
  continuous UTC minutes, SLA response compliance (inclusive threshold)
  with pending/invalid/total population shown separately, CSAT mean and
  CSAT positive-share as two separate measures. `header_comparisons`
  checks any task-supplied claimed figures against the identical exact
  values the metrics themselves were built from.
- Citations: every ticket's classification cites the exact quoted
  policy-document sentences (category precedence, priority rule) it
  applied — independently re-verified Git blob SHA-1 and exact byte
  span on every call, never trusted from a cached/declared pin.

## Budget discipline

One monotonic 64-object budget per task, shared by the two fixture-
source resolutions (policy document, ticket bundle) and **one charge
per ticket**, charged strictly before that ticket's own fields are read
— attempt 65 refuses before that ticket (or any ticket after it) is
inspected at all. This is the exact bug class that bounced the Tax
Agent and the Financial Manager Agent prototypes earlier in this
program (a cap enforced only after the candidate set had already been
walked); `tests/budgets.test.js` includes a Proxy-spy regression that
proves ticket 65+ in a 65-ticket bundle is never read.

## Authority

`context.principal` is a host-authenticated mock request principal
(Jason, or his registered Muse relay) — arbitrary actor strings, paths,
or "approved" prose in task content never carry authority. A revoked or
expired principal refuses the whole task before any fixture is touched.

## Non-goals

No real tickets, no PII, no helpdesk integration, no sending, no
account actions/refunds, no business-calendar SLA engine, no freeform
sentiment inference, no model calls, no activation.
