# ASSETS-01 — FORGE Investments & Other Assets Design

**Owner:** Codex  
**Status:** Design complete; implementation not started  
**Scope:** Stocks, bonds, mutual funds/ETFs, crypto, precious metals, and manually valued assets.  
**Non-goal for v1:** Trading, custody, moving money, tax filing, or replacing a brokerage.

## Product boundary

FORGE is the consolidated record, analytics, and planning layer. Custodians, exchanges, banks, and
wallets remain authoritative for cash, positions, and execution. FORGE imports evidence, reconciles
positions, calculates performance, and includes verified values in net worth without silently
fabricating holdings or prices.

Rental real estate remains authoritative in the Property domain. An investment holding may link to a
property or LLC, but must not create a second copy of the same asset in net worth.

## Navigation

Financial FORGE gains an **Investments & Assets** workspace with four primary views:

1. **Overview** — total value, cost basis, unrealized gain/loss, realized income, allocation, liquidity,
   and data freshness.
2. **Holdings** — position-level table with account, asset, quantity, price, value, basis, gain/loss,
   income, and last-valued timestamp.
3. **Activity** — buys, sells, dividends, interest, fees, transfers, contributions, withdrawals,
   splits, staking rewards, and adjustments.
4. **Other Assets** — precious metals, vehicles/equipment, collectibles, private-company interests,
   notes receivable, and other appraised/manual assets.

Required filters: household/business entity, account, taxable/retirement, asset class, 1M/3M/YTD/1Y/
3Y/5Y/All Time, and as-of date.

## Core model

### investment_accounts

- owner_id
- id
- household_or_entity_id
- name
- institution_name
- account_type: taxable_brokerage | ira | roth_ira | 401k | pension | crypto_exchange |
  crypto_wallet | metals_vault | private_investment | other
- tax_treatment: taxable | tax_deferred | tax_exempt | unknown
- currency_code
- source_system
- source_account_id
- status
- opened_at / closed_at
- last_reconciled_at
- created_at / updated_at

### instruments

Canonical security/asset definition:

- id
- instrument_type: stock | etf | mutual_fund | bond | option | cash_equivalent | crypto |
  precious_metal | private_equity | note_receivable | vehicle | equipment | collectible | other
- symbol, name, description
- identifiers: CUSIP/ISIN/FIGI/contract address where applicable
- exchange/network
- quote_currency
- sector, industry, asset_class, subclass
- maturity_date, coupon_rate for bonds
- metal_type, form, fineness/purity for bullion
- metadata_json for type-specific facts

Instrument matching must use stable identifiers when available; never ticker alone across exchanges.

### investment_transactions

Immutable source evidence:

- account_id, instrument_id
- source_system, source_record_id, source_file_hash
- transaction_type: buy | sell | dividend | interest | fee | tax | transfer_in | transfer_out |
  contribution | withdrawal | split | merger | spin_off | staking_reward | crypto_send |
  crypto_receive | adjustment
- trade_at, settle_at
- quantity, unit_price, gross_amount, fees, taxes, net_amount
- currency_code, exchange_rate
- linked_transfer_id
- source_payload_hash
- review_status and provenance
- created_at / updated_at

Idempotency is owner + source_system + source_record_id. CSV sources without immutable IDs require
versioned owner-scoped fingerprints and multiset cardinality, following the Simplifi decision.

### tax_lots

- account_id, instrument_id
- acquisition transaction/date
- original and remaining quantity
- original and adjusted cost basis
- basis_method: specific_id | fifo | lifo | average | unknown
- disposition linkage
- wash-sale adjustment
- source/verification status

Unknown basis stays unknown. FORGE must never present an invented zero basis.

### position_snapshots

Daily/as-received reconciliation evidence:

- account_id, instrument_id, as_of_at
- quantity
- reported_market_value
- reported_cost_basis
- source_system/source_record_id
- reconciliation_status and variance

Current positions are computed from transactions and compared with reported snapshots. A mismatch is
a review item, not silently corrected.

### price_snapshots

- instrument_id
- priced_at
- price, currency_code
- source_provider
- market_status
- confidence/freshness
- manual_override flag and evidence

Historical values remain reproducible. Manual valuations never overwrite provider prices; they create
a separate evidenced snapshot.

### other_asset_records

For non-market assets:

- instrument_id / owner entity
- quantity and unit
- acquisition_date and acquisition_cost
- current_condition
- storage_location (coarse; never expose sensitive vault detail in ordinary UI)
- valuation_method: purchase_cost | appraisal | market_comparable | spot_price | manual_estimate
- appraiser/provider, effective_date, expiration/review date
- supporting_document_id
- notes

Precious metals require metal, form, count, gross weight, fine weight, purity, and unit. Value =
verified fine weight × selected spot price, with optional premium/discount shown separately.

## Accounting integration

Investment activity posts into the existing financial-event/accounting layer through explicit mappings:

- Contributions/withdrawals and account-to-account transfers: balance-sheet movement, not income/expense.
- Purchases/sales: asset exchange; sale recognizes realized gain/loss only when basis is known.
- Dividends/interest: investment income.
- Advisory, custodial, and transaction fees: investment expense.
- Unrealized gains/losses: valuation change, excluded from operating cash flow and rental NOI.
- Crypto transfers between owned wallets: transfer, not disposal; network fee handled separately.
- Staking/mining/rewards: separate income treatment requiring reviewable policy.
- Metals purchases: asset acquisition, not operating expense.

Every economic event is counted once even if evidenced by Simplifi, Plaid, a custodian CSV, and a
brokerage statement. Source records are linked, never deleted.

## Analytics

### Executive cards

- Investable assets
- Total return
- Unrealized gain/loss
- Realized income
- Estimated annual income
- Liquid vs. illiquid
- Data freshness / unreconciled accounts

### Charts

- Portfolio value and net contributions over time
- Income, realized gain/loss, and fees
- Asset allocation and target-allocation drift
- Account/tax-treatment allocation
- Performance vs. selectable benchmark
- Maturity ladder for bonds/CDs
- Crypto and metals exposure
- Net-worth composition including property without double counting

Performance calculations:

- Money-weighted return (XIRR) for the owner's actual experience
- Time-weighted return for manager/strategy comparison
- Clearly separate market return from deposits/withdrawals
- No return percentage when required price or cash-flow evidence is incomplete

## Imports and integrations

### Phase 1 — Manual and CSV

- Manual account and holding entry
- Brokerage/exchange CSV import with preview and mapping
- Statement upload and reconciliation
- Manual/appraised other assets
- Public market/crypto/metals price provider selected after cost/licensing review

### Phase 2 — Plaid Investments

Use Plaid Investments for supported institutions after approval. Preserve source identity and
institution-reported positions. Plaid supersedes recurring CSV ingestion after a per-account cutoff,
but historical CSV provenance remains.

### Phase 3 — Direct custodians/providers

Only where coverage justifies maintenance: broker APIs, crypto exchanges/wallet read-only addresses,
and metals spot pricing. No trading permissions.

## Review and edit behavior

Every imported transaction supports:

- Correct this transaction only
- Create a rule for future matching transactions
- Preview and apply a correction to historical matches

Original evidence remains immutable. Corrections are versioned, attributed, timestamped, reversible,
and show before/after values.

## Safety and privacy

- Owner-scoped RLS on every table
- Sensitive account identifiers encrypted/masked
- Read-only integrations initially
- No seed phrases, private wallet keys, brokerage passwords, or full account numbers stored
- Signed private-document URLs
- Manual values clearly labeled and aged
- Stale-price and unreconciled-position warnings
- No tax claim or realized gain if basis evidence is incomplete

## MVP acceptance criteria

1. Add accounts and holdings across every in-scope asset class.
2. Import CSV activity through preview → mapping → approval, idempotently.
3. Represent true duplicate transactions without fingerprint collapse.
4. Reconcile computed holdings to reported snapshots.
5. Show value, contributions, income, fees, basis, and gain/loss with explicit unknown states.
6. Include verified values in net worth without duplicating Property-domain real estate.
7. Keep business, personal, retirement, and entity scopes separate.
8. Allow corrections and reusable rules while preserving source evidence.
9. Render responsive light/dark dashboards consistent with FORGE Workspace 2.0 and restrained metallic
   visual treatment.
10. Production contains no mock holdings, prices, or returns.

## Recommended implementation slices

- **ASSETS-02:** schema/types/RLS/repositories only
- **ASSETS-03:** manual accounts, instruments, holdings, and valuations
- **ASSETS-04:** CSV import preview/approval and reconciliation
- **ASSETS-05:** analytics/read models and dashboard
- **ASSETS-06:** price-provider evaluation and adapter
- **ASSETS-07:** Plaid Investments adapter after access is available

Cross-cutting migrations and Production deployment remain single-owner actions and must not overlap
Claude's active Simplifi/document work.
