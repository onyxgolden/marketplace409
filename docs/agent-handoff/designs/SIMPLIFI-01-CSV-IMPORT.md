# SIMPLIFI-01 — Quicken Simplifi CSV Import Design

**Status:** Design complete; no implementation, schema, deployment, environment, or Production changes.

## 1. Purpose and authority boundaries

Use a landlord-exported Quicken Simplifi CSV to populate FORGE financial history while Plaid access is unavailable.

| Source | Authority in FORGE | Role |
|---|---|---|
| Rentec legacy/API | Rental operating ledger | Rent, rental expenses, tenant/property evidence |
| Simplifi CSV | Bank/card transaction evidence | Cash movement across bank and credit accounts |
| Plaid (future) | Ongoing bank/card feed | Replaces manual CSV cadence, not historical provenance |
| Manual FORGE entries | Owner attestations | Corrections and evidence-backed exceptions |

A Simplifi row must never silently create a rental payment, rent charge, Stripe settlement, or Rentec import record. The importer writes only the general financial-event/accounting domain.

## 2. Export instructions and supported input contract

Simplifi currently exports transaction activity as CSV from its web app. The owner should:

1. Select Banking or one account.
2. Select **All time** or the required date range.
3. Enable **Show split transactions** before export.
4. Include Notes in the visible/exported columns.
5. Export one or multiple accounts to CSV without editing the file.

Official Simplifi guidance confirms CSV-only export, filtered multi-account export, and that splits are omitted unless explicitly shown.

### Canonical input fields

The parser accepts case/spacing variants but maps them into this normalized model:

| Canonical field | Required | Treatment |
|---|---:|---|
| account_name | Yes | Must map to an owner-scoped FORGE account before approval |
| date | Yes | Parsed as a local calendar date; never timezone-shifted |
| payee | Yes | Trimmed; preserved as evidence |
| amount_cents | Yes | Signed integer; sign retained exactly |
| category | No | Required for automatic classification; missing fails to review |
| tags | No | Parsed as an ordered, normalized list; original retained |
| notes | No | Retained as bounded evidence; never logged |
| check_number | No | Retained as evidence |
| split_marker / split ordinal | Conditional | Needed to distinguish exported split lines when present |
| cleared/pending status | No | Pending rows are previewed but never approvable |

Unknown columns are reported in the batch summary and ignored, not persisted wholesale.

### File rules

- UTF-8 or UTF-8 BOM; reject binary, spreadsheet, executable, or archive uploads.
- Maximum size and row count are explicit server configuration, not silent truncation.
- Header mapping must be unambiguous.
- Raw CSV is parsed in memory and discarded. Store file hash, filename-safe label, row counts, and normalized evidence—not the raw file.
- Preview and approval both re-parse the same immutable uploaded artifact identified by its SHA-256. If temporary artifact retention is unavailable, approval requires re-upload and exact hash match.

## 3. Identity and idempotency

Simplifi CSV does not guarantee an immutable transaction ID, so FORGE uses two identities.

### Batch identity

`batch_hash = SHA256(exact file bytes)`

Re-uploading the same file is recognized immediately. The file hash is provenance, not proof that every row is unchanged across separately exported files.

### Row fingerprint

`fingerprint_v1 = HMAC(owner-scoped server key, version || account_mapping_id || date || signed_amount_cents || normalized_payee || normalized_category || normalized_tags || normalized_check_number || split_identity)`

Rules:

- Fingerprint version is stored.
- Use an HMAC/server-side pepper so private transaction evidence cannot be guessed from a database dump.
- Account mapping is part of identity; identical transactions in two accounts remain distinct.
- Split identity is deterministic: explicit exported split identifier if available; otherwise an ordinal assigned only among same-parent/equal-evidence rows, with the original parent evidence hash retained.
- Duplicate rows within one file use **multiset/cardinality matching**, never boolean existence matching.
- Cosmetic notes changes do not create a new financial transaction; notes contribute to an evidence hash used for drift warnings, not the primary fingerprint.

### Import result identity

Each approved event uses:

- `source_system = 'quicken_simplifi_csv'`
- `source_record_id = 'v1:' + fingerprint_v1`
- unique owner/source/source-record constraint

Reruns return `already_imported`; concurrent approvals degrade to idempotent results, never double writes.

## 4. Account mapping

Before classification, every CSV account must be mapped to an owner-scoped FORGE financial account.

Mapping captures:

- Simplifi account label
- FORGE account ID
- account type: checking, savings, credit card, loan, cash, investment, other
- business/personal/mixed scope
- last-four only if already present in the export; never require full account numbers
- active mapping version and effective dates

No fuzzy automatic account selection. Suggested matches are review-only. Approval is blocked for unmapped accounts.

## 5. Classification pipeline

Every normalized row receives exactly one terminal preview classification.

| Classification | Meaning | Approvable? |
|---|---|---:|
| safe_missing | New cleared transaction with deterministic category and no overlap | Yes |
| already_imported | Exact Simplifi fingerprint already exists | No-op |
| duplicate_in_file | Excess duplicate beyond source/file cardinality | No |
| overlap_rentec | Same cash movement is already represented by Rentec evidence | No |
| overlap_plaid | Same cash movement is already represented by Plaid evidence | No |
| transfer_pair | Two mapped owner accounts show opposite sides of one transfer | Yes, as linked non-income/non-expense movement |
| card_payment_pair | Bank outflow and credit-card inflow are a payment pair | Yes, linked; excluded from expense |
| refund_or_reversal | Reverses or refunds a prior transaction | Review unless deterministic link exists |
| owner_contribution | Owner money into business | Yes, equity—not income |
| owner_draw | Business money to owner | Yes, equity—not expense |
| personal | Personal activity in a mixed account | Review/exclude from business reports |
| pending | Not cleared/final | Never |
| ambiguous | Multiple plausible overlaps/mappings/categories | Never bulk approve |
| conflict | Contradictory evidence or source drift | Never |
| unsupported | Unknown schema/category/account type | Never |

### Category policy

Use an explicit versioned mapping table. Unknown categories fail closed. Preserve Simplifi category/tags separately from FORGE’s normalized category and tax treatment. Category changes require a reviewed mapping-version change.

## 6. Rentec overlap rules

Rentec remains authoritative for rental operations. Simplifi confirms the bank movement but must not duplicate income or expense.

Candidate overlap requires the same owner and compatible direction, then scores:

1. exact amount;
2. date within a configurable settlement window;
3. mapped property/account evidence;
4. compatible normalized category;
5. payee/payer evidence when available;
6. unused cardinality slot.

Outcomes:

- One high-confidence Rentec match → `overlap_rentec`; link evidence, do not create a second P&L event.
- Multiple plausible matches → `ambiguous`.
- Conflicting amount/direction/property → `conflict`.
- No match → continue through normal Simplifi classification.

Never match by tenant/payee name alone. Never collapse multiple equal-dollar Rentec rows onto one bank deposit. Batch deposits require an explicit many-to-one reconciliation group whose member amounts equal the deposit.

## 7. Future Plaid transition

Plaid does not overwrite or delete Simplifi history.

- Plaid rows use their own source identity.
- Matching uses account mapping, amount, date window, pending-to-posted semantics, merchant/payee evidence, and cardinality.
- A confident Plaid match attaches a `supersedes/duplicates evidence` link to the existing Simplifi event; reports count the economic event once.
- Ambiguous matches remain visible for review.
- Simplifi imports can be disabled per account from a landlord-selected Plaid cutover date.
- Historical Simplifi provenance remains immutable for audit.

## 8. Transfers, credit-card payments, splits, and refunds

### Transfers

Opposite signed rows between two mapped owner accounts, same amount and close dates, become one linked transfer group. Neither side affects income/expense.

### Credit-card payments

Checking outflow + card-account inflow is a liability payment, not spending. Original card purchases remain expenses. A single unpaired payment is review-only until account/category evidence is sufficient.

### Splits

Each split becomes a separate accounting line while retaining a shared parent group. Split cents must sum exactly to the parent amount. If the export includes both parent and children, the parent is a container and never separately counted.

### Refunds/reversals

Link to the original event when amount, account, category, payee, and timing establish one deterministic candidate. Otherwise classify `refund_or_reversal` for review. A refund reduces its original category; it is not generic income.

## 9. Preview and approval workflow

### Preview (zero writes to financial events)

1. Upload CSV.
2. Validate file and headers.
3. Map accounts.
4. Parse and normalize.
5. Load owner-scoped existing Simplifi, Rentec, Plaid, and manual evidence.
6. Classify using multiset-safe matching.
7. Display counts and dollars by classification, year, account, property, and category.
8. Show reconciliation equation: opening evidence + inflows − outflows = computed movement.
9. Produce immutable `preview_hash` over parser version, mapping versions, file hash, and classifications.

Preview may persist only a quarantined batch/audit record if needed; it never creates financial events.

### Approval

Client submits batch ID, preview hash, and selected safe identifiers only. Server:

1. Reloads the exact file artifact or requires byte-identical re-upload.
2. Reloads account/category mapping versions and all overlap evidence.
3. Recomputes classification fresh.
4. Rejects drift, missing rows, changed mappings, truncated scans, and non-safe selections.
5. Writes in one transaction through an owner-authenticated, security-invoker RPC.
6. Returns applied/already-imported/rejected counts.
7. Preserves an immutable audit record.

Bulk approval is permitted only for `safe_missing`, deterministic transfer/card-payment pairs, and explicitly confirmed equity classifications. Ambiguous/conflict/unsupported/pending rows require correction and a new preview.

## 10. Proposed persistence

### `simplifi_import_batches`

Owner, batch ID, file hash, safe filename label, parser version, row counts, preview hash, status, created/approved timestamps. No raw CSV.

### `simplifi_account_mappings`

Owner, normalized Simplifi account label hash/display label, FORGE account ID, account/scope type, effective dates, mapping version.

### `simplifi_import_rows`

Owner, batch, row fingerprint/version, evidence hash, normalized bounded evidence, classification, linked source evidence IDs, approval result. No full bank/card numbers.

### Existing `financial_events`

Approved events only, with `source_system='quicken_simplifi_csv'`, fingerprint source ID, normalized category, signed amount, account/property references, and minimal provenance metadata.

RLS is forced and owner-scoped. RPCs are security invoker. No service-role browser path.

## 11. UI flow

Place under Financial FORGE → Import → **Simplifi CSV**.

1. **Upload** — drag/drop, export instructions, privacy notice.
2. **Map accounts** — explicit account cards with business/personal/mixed scope.
3. **Preview** — metallic Workspace 2.0 summary cards and a year/account/category breakdown.
4. **Resolve** — grouped ambiguous/conflict/unsupported rows; no raw identifiers in default view.
5. **Approve** — clear accounting totals, source-overlap exclusions, and confirmation.
6. **Receipt** — applied/no-op/rejected totals, downloadable sanitized audit summary.

The UI must explain why Rentec-overlap and card-payment rows are excluded from income/expense so users do not “fix” correct deduplication.

## 12. Required fixtures

Commit synthetic, non-personal fixtures only:

1. single checking account, ordinary income/expense;
2. multi-account export;
3. identical repeated rows proving cardinality;
4. parent + split children;
5. transfer pair and unmatched transfer;
6. credit-card purchase + bank payment pair;
7. refund/reversal;
8. owner contribution/draw;
9. Rentec deposit overlap, including many-to-one batch deposit;
10. existing Plaid overlap with pending→posted transition;
11. unknown category/header;
12. missing required field, invalid date/amount, oversized file;
13. same file re-upload;
14. changed notes vs. changed financial evidence;
15. personal/mixed-account rows.

## 13. Test gates

- Parser/header/date/sign/split tests.
- Fingerprint version, HMAC boundary, account isolation, and multiset/cardinality tests.
- Category fail-closed tests.
- Rentec/Plaid overlap and many-to-one reconciliation tests.
- Transfer/card-payment/refund/equity tests.
- Preview proves zero `financial_events` writes.
- Approval proves fresh recomputation, preview-hash drift rejection, owner isolation, RLS, idempotency, and concurrent safety.
- Reporting proves transfers/card payments/duplicates do not affect P&L.
- Accessibility/responsive tests for upload, mapping, review, and error recovery.
- Production build and existing financial/rental suites.

## 14. Implementation sequence

1. Commit synthetic fixtures and parser contract.
2. Build pure parser/normalizer/fingerprint library.
3. Build account mapping persistence and UI.
4. Build read-only preview with overlap engine.
5. Review real sanitized preview totals; extend explicit category mappings.
6. Build migration/audit tables and approval RPC.
7. Build approval route with fresh server-side recomputation.
8. Add Plaid supersession hooks without enabling Plaid writes.
9. Preview deployment only; no Production import until Jason separately approves sanitized totals.

## 15. Decisions required before SIMPLIFI-02

1. Export one multi-account CSV (recommended) or one file per account?
2. Should personal transactions be imported into FORGE but excluded from business reports, or excluded entirely? Recommended: import with personal scope so net-worth views remain possible.
3. Temporary immutable file retention for approval, or require the same CSV to be uploaded again? Recommended: encrypted short-retention artifact with automatic deletion after approval/expiry.
4. Initial scope: banking/credit only; exclude investment transactions and historical balance snapshots? Recommended: yes.
5. Approve all deterministic safe rows per batch or allow row-level selection? Recommended: both, with ambiguous/conflict never selectable.

## 16. Non-goals

- No scraping or reverse-engineering Simplifi.
- No Simplifi credential storage.
- No raw CSV in logs or permanent object storage.
- No mutation of Rentec, Stripe, rental charges/payments, or Plaid connections.
- No automatic category guessing.
- No Production import as part of implementation.
