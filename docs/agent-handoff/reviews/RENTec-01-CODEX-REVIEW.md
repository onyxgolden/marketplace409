# RENTEC-01 Codex Review

Reviewed: 2026-08-23 UTC  
Reviewer: Codex  
Implementation branch: `feat/rentec-financial-history-resume`  
Reviewed commit: `f4ab9d01b`

## Outcome

Changes required before migration, deployment, or Production preview approval.

The route/RPC separation, authenticated owner scoping, fresh server-side re-fetch, composite transaction/split identity, unique-index idempotency, and confinement to `financial_events` are sound. The existing test/build results do not need to be repeated until the fixes below are made.

## Material findings

### 1. Legacy overlap matching is not cardinality-safe

The classifier evaluates each Rentec row independently against the same legacy CSV evidence list.

Example:

- Rentec contains two legitimate transactions with identical property/date/amount/direction/category.
- The legacy CSV contains one matching `financial_events` row.
- Both Rentec rows see exactly one match and both become `alreadyRepresented`.
- One real missing transaction is therefore suppressed.

The inverse case also behaves poorly: two Rentec rows and two equivalent legacy rows make every Rentec row ambiguous even when the group cardinalities reconcile.

Required correction:

- Reconcile legacy overlap as evidence groups/multisets, not independent existence checks.
- Include every defensible discriminator already available.
- For truly indistinguishable same-value rows, reconcile counts deterministically: at most the existing group count may be classified represented; excess source rows remain safe-missing or review-required according to the documented rule.
- Add regression tests for 2-source/1-existing, 1-source/2-existing, 2-source/2-existing, split rows, and stable ordering.

### 2. The 50-page safety cap silently accepts incomplete data

Both preview and approval stop after page 50 even if Rentec still reports `moreRecords=true`. That can produce an incomplete preview and, worse, approval can act on a partial source snapshot without saying so.

Required correction:

- If page 50 still reports more records, fail closed with a clear bounded-pagination error.
- Never return a normal preview or perform approval from a truncated source fetch.
- Share the bounded-fetch helper between preview and approval so the two paths cannot drift.
- Add boundary tests for final page exactly at the cap and overflow beyond the cap.

### 3. Re-run totals omit prior `rentec_api` imports

`existingSafeTotalsByYear` defaults include `rentec` and `forge_rental_payment` for income, and `rentec` and `manual` for expenses, but omit `rentec_api`.

After the first approved import, a subsequent preview classifies those rows as represented while excluding their dollars from existing and expected post-import totals. The preview report will therefore understate history on every rerun.

Required correction:

- Include `rentec_api` in the relevant existing income and expense source sets.
- Add a rerun test proving expected totals remain unchanged after previously imported API rows are present.

## Residual note, not a branch blocker

The RPC can be called directly by an authenticated owner with arbitrary structurally valid rows labeled `rentec_api`. That is possible because the pre-existing `financial_events` INSERT policy already allows the owner to insert arbitrary owner-scoped events, so this branch does not create a new cross-owner or privilege escalation. It does mean Rentec provenance is not cryptographically authoritative at the database boundary. Track this as broader provenance-hardening work; do not expand RENTEC-01 unless the product requires tamper-resistant source labels now.

## Completion gate

Claude should amend the feature commit with the three required corrections and their focused regression tests, rerun only the affected/focused suite plus build and `git diff --check`, then update `TASKS.md` for one final review. Do not migrate, deploy, import, or change environment variables.
