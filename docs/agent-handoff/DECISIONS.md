# FORGE Architecture & Product Decisions

Durable decisions only — not branch status, not task tracking, not credentials. See
`docs/agent-handoff/CURRENT.md` for current operational state, and git history for the full record of
how a decision was implemented.

---

## 2026-08-23 — Rentec financial-history import uses composite `{transactionId}:{splitId}` identity

**Decision:** `financial_events.source_record_id` for Rentec-API-sourced rows is always
`"{rentec transaction_id}:{rentec split_id, or the literal 'none'}"`, never the transaction id alone.

**Rationale:** A Rentec transaction can be split into multiple rows sharing one `transaction_id` but
distinct `split_id`s. Using `transaction_id` alone as the identity would silently collapse separate
splits (different categories, different amounts) into a single financial_events row via the existing
`(owner_id, source_system, source_record_id)` unique index, losing real financial detail.

**Consequences:** Any future Rentec-API-sourced import or reconciliation logic must preserve this
composite scheme. A transaction with no split still gets a stable id (`"{id}:none"`), so the scheme
never needs a second code path for split vs. non-split rows.

---

## 2026-08-23 — Rentec-API-sourced imports use `source_system = 'rentec_api'`, distinct from the legacy CSV import's `'rentec'`

**Decision:** The new live-API-based financial-history importer writes `source_system: 'rentec_api'`,
never `'rentec'` (which is reserved for rows written by the original CSV-based historical import).

**Rationale:** The legacy CSV import's `source_record_id` format
(`"rentec-{date}-{csvRowIndex}-{income|expense}"`) has no relationship to Rentec's real
`transaction_id`/`split_id` — it cannot be compared by identity, only by evidence (property, date,
amount, direction, category). Keeping the two source systems distinct preserves that legacy data's
provenance and keeps the new importer's exact-ID idempotency check (safe, cheap) separate from its
evidence-based overlap check (used only against the legacy rows).

**Consequences:** Any future reporting or reconciliation logic that reads `financial_events` by
`source_system` must account for both `'rentec'` (legacy CSV, historical, frozen) and `'rentec_api'`
(live API, ongoing) as two distinct provenance lineages describing the same underlying Rentec account.

---

## 2026-08-23 — Rentec financial-history import fails closed on unmapped categories

**Decision:** The importer classifies a transaction as `unsupported` (never imported) if its Rentec
category isn't a direct key in `CATEGORY_MAP`. It does not call
`categoryNormalizer.normalize()`, whose own fallback silently classifies anything unmapped as
`{normalizedCategory: "other", transactionKind: "expense"}`.

**Rationale:** Real Rentec category names include several not present in `CATEGORY_MAP` (e.g.
"Advertising", "Internet Services", "Phone", "Gear", "Tenant Reimbursed Expense", "Uncategorized").
Silently defaulting these to a generic expense would misclassify real income or misrepresent the
transaction's actual nature. Financial data correctness takes priority over import completeness — an
`unsupported` row is surfaced for human review and category-map extension, not silently miscategorized.

**Consequences:** Extending `CATEGORY_MAP` to cover a new Rentec category is a deliberate, reviewable
change (a new entry with an explicit `transactionKind`/`normalizedCategory`/tax treatment), not a
side-effect of running the importer. Expect a nonzero `unsupported` count on every real preview run
until the map is extended to match Rentec's full category vocabulary.

---

## 2026-08-23 — Rentec import approval always re-fetches and recomputes server-side; never trusts client-submitted financial facts

**Decision:** The approval endpoint (`POST /api/rental/rentec-financial-history-import-approve`)
accepts only a list of `sourceRecordId` values from the client. It re-fetches Rentec and
`financial_events` fresh, re-runs the same preview classifier, and only imports rows the **fresh**
computation confirms as `safeMissing`. Ambiguous/conflict rows can never be approved through the bulk
action, regardless of what the client requests.

**Rationale:** Same pattern already established by `approve_rentec_payment_import` for the payment
reconciliation workflow — a stale or forged approval request must never be able to write financial
data. This also means concurrent approvals, or a client working from a stale preview, degrade
gracefully (rejected, not silently misapplied) rather than corrupting `financial_events`.

**Consequences:** Any future Rentec-derived write endpoint on this project should follow the same
shape: client requests are opaque identifiers only; financial facts always come from a fresh
server-side computation immediately before the write.


---

## 2026-08-23 — Simplifi CSV is bank/card evidence; Rentec remains rental authority

**Decision:** Simplifi CSV imports populate the general financial-event/accounting domain only. They
never create or mutate rent charges, rental payments, Stripe settlements, or Rentec import records.
When one cash movement is represented by both sources, Rentec remains authoritative for the rental
operation and the Simplifi row is linked as bank evidence rather than counted as a second income or
expense event.

**Rationale:** Rentec describes the rental obligation and property context; Simplifi describes the
bank/card movement. Treating both as independent P&L entries would double-count the same money.

**Consequences:** Overlap matching is owner-scoped, cardinality-safe, and never based on a tenant or
payee name alone. Batch deposits require explicit many-to-one reconciliation whose members sum to the
bank deposit.

---

## 2026-08-23 — Simplifi CSV identity uses versioned owner-scoped fingerprints

**Decision:** Because Simplifi CSV does not promise immutable transaction IDs, approved rows use a
versioned HMAC fingerprint over account mapping, date, signed amount, normalized payee/category/tags,
check number, and split identity. File SHA-256 identifies the import batch; it is not the row identity.

**Rationale:** A plain hash leaks guessable transaction evidence and account-agnostic matching can
collapse identical transactions from different accounts. Boolean existence checks also lose valid
duplicates, so matching must preserve multiset cardinality.

**Consequences:** `source_system='quicken_simplifi_csv'`; fingerprint version is stored; account
mapping and split identity are mandatory parts of row identity; cosmetic note changes produce drift
evidence rather than a second financial event.

---

## 2026-08-23 — Plaid supersedes Simplifi automation, not Simplifi provenance

**Decision:** When Plaid becomes available, a confident Plaid match links to and supersedes the
existing Simplifi evidence for reporting without deleting or overwriting the historical Simplifi
record. Ambiguous matches remain review items.

**Rationale:** Plaid is the future ongoing feed, while the manually exported CSV is historical audit
evidence. Replacing provenance would make prior approvals unauditable; counting both would duplicate
money.

**Consequences:** Simplifi can be disabled per account from an explicit Plaid cutover date. Reporting
counts one economic event while preserving both source lineages.
