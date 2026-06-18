# Ledger Domain Blueprint

## Purpose

The Ledger Domain is the financial heart of Financial Forge.

It records, organizes, validates, and reports financial movement across:

- Personal finances
- Businesses
- Rental properties
- Investments
- Taxes
- Banking
- Marketplace activity
- Future AI CFO and advisor systems

## Core Principle

Every financial event must be explainable as movement of money between accounts.

## Core Objects

### Ledger

A Ledger is the container for financial records.

Examples:

- Personal ledger
- Business ledger
- Rental property ledger
- Family office ledger
- Marketplace ledger

Responsibilities:

- Own accounts
- Own transactions
- Enforce accounting rules
- Produce balances
- Support reporting

### Account

An Account represents a financial bucket.

Examples:

- Checking account
- Credit card
- Rental income
- Mortgage liability
- Repairs expense
- Owner equity
- Accounts receivable
- Accounts payable

Responsibilities:

- Hold entries
- Belong to a ledger
- Have a type
- Support balance calculation

### Transaction

A Transaction represents one financial event.

Examples:

- Rent collected
- Mortgage paid
- Contractor invoice paid
- Marketplace fee received
- Insurance premium paid
- Property purchased
- Loan payment made

Responsibilities:

- Group entries
- Store date, description, source, and metadata
- Enforce that entries balance
- Support auditability

### Entry

An Entry is one side of a transaction.

Responsibilities:

- Point to one account
- Hold debit or credit amount
- Belong to one transaction
- Never exist alone

### Balance

A Balance is a calculated result, not the source of truth.

Responsibilities:

- Summarize account state
- Support point-in-time calculation
- Support reporting

### Money

Money represents an amount and currency.

Responsibilities:

- Prevent floating point math errors
- Store amount in smallest currency unit
- Support formatting
- Support arithmetic

### Currency

Currency represents the unit of money.

Examples:

- USD
- EUR
- BTC in future
- Stablecoins in future

## Ledger Invariants

These rules must never be broken:

1. A transaction must have at least two entries.
2. Total debits must equal total credits.
3. An entry must belong to exactly one transaction.
4. An entry must point to exactly one account.
5. A transaction cannot be partially saved.
6. Money calculations must never use floating point values.
7. Balances are derived, not manually trusted.
8. Posted transactions should be immutable except through reversal or adjustment.
9. Every financial change should be auditable.
10. Ledger logic must not live in pages or UI components.

## Account Types

Initial account types:

- Asset
- Liability
- Equity
- Income
- Expense

Future account types may include:

- Contra asset
- Contra liability
- Gain
- Loss
- Clearing
- Escrow
- Tax payable
- Tax receivable

## Transaction Status

Initial statuses:

- Draft
- Posted
- Reversed
- Voided

Rules:

- Draft transactions may be edited.
- Posted transactions should not be edited directly.
- Reversed transactions should point to reversing transactions.
- Voided transactions should remain auditable.

## Future Engines Depending on Ledger

The Ledger Domain will support:

- Banking Engine
- Accounting Engine
- Property Engine
- Tax Engine
- Investment Engine
- Marketplace Engine
- AI CFO Engine
- Reporting Engine
- Budget Engine
- Cash Flow Engine

## Architectural Decision

The Ledger Domain will be built as domain logic first.

Pages, forms, Supabase tables, and UI screens come later.

The first implementation should define stable domain objects and rules before persistence.
