# Financial Forge Roadmap

## Current Status

Current Forge: Forge #25  
Current Milestone: Milestone 5 — Financial Reporting

Architecture is governed by `FORGE_CONSTITUTION.md`.

---

## Milestone 1 — Core Value Objects ✅

Purpose: Build immutable primitives used across the platform.

Completed:

- Money

---

## Milestone 2 — Ledger Engine ✅

Purpose: Create the immutable double-entry accounting engine.

Completed:

- Posting
- JournalEntry
- LedgerEntry
- GeneralLedger
- GeneralLedgerHistory
- BalanceCalculator
- TrialBalanceCalculator

---

## Milestone 3 — Account Hierarchy ✅

Purpose: Represent financial account structure.

Completed:

- Account
- AccountType
- AccountCategory
- ChartOfAccounts
- Immutable parentMap hierarchy
- getParent()
- getChildren()
- getDescendants()

---

## Milestone 4 — Rollup Engine ✅

Purpose: Aggregate balances across account hierarchies.

Completed:

- AccountRollupService
- End-to-end ledger integration

---

## Milestone 5 — Financial Reporting 🚧

Purpose: Build financial statements from services without embedding accounting logic in reports.

Completed:

- FinancialReport base object

Planned:

- ReportLine
- TrialBalance report foundation
- BalanceSheet foundation
- IncomeStatement foundation
- CashFlowStatement foundation
- Statement of Equity foundation
- Multi-period reporting

---

## Future Milestones

### Milestone 6 — Budgets and Forecasting

- Budgets
- Forecasts
- Variance analysis

### Milestone 7 — Project Cost Controls

- Projects
- Cost codes
- WBS
- Earned value
- Forecast-to-complete

### Milestone 8 — Asset Management

- Fixed assets
- Depreciation
- Transfers
- Disposals

### Milestone 9 — Business Operating System

- Companies
- Departments
- Users
- Permissions
- Multi-company accounting

### Milestone 10 — Financial Intelligence

- KPIs
- Dashboards
- Ratios
- Trends
- AI insights
