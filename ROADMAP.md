# Financial Forge Roadmap

## Current Status

Current Forge: Forge #25  
Current Milestone: Milestone 5 — Financial Reporting (6 of 7 items complete; multi-period reporting remains)

Milestone 6 work (budgets UI/API) is underway in parallel.

Architecture is governed by `FORGE_CONSTITUTION.md`.

Last verified against codebase: 2026-09-18.

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
- ReportLine (`src/domains/ledger/reports/ReportLine.js`)
- TrialBalance report foundation (`TrialBalance.js` + `TrialBalanceBuilder.js`)
- BalanceSheet foundation (`BalanceSheet.js` + `BalanceSheetBuilder.js` + `BalanceSheetSection.js`)
- IncomeStatement foundation (`IncomeStatement.js` + `IncomeStatementBuilder.js`)
- CashFlowStatement foundation (`CashFlowStatement.js` + `CashFlowStatementBuilder.js`)
- Statement of Equity foundation (`StatementOfOwnersEquity.js`)
- Report validation layer (`validation/FinancialReportValidator.js`)
- Snapshot adapters (`SnapshotReportFactory.js`, `SnapshotToAccountBalanceCollectionAdapter.js`, `AccountRollupSnapshotCache.js`)

All of the above ship with unit tests alongside the implementation.

Planned:

- Multi-period reporting

---

## Future Milestones

### Milestone 6 — Budgets and Forecasting 🚧 (in progress)

- Budgets — in progress (`src/app/api/budgeting`, budget UI: table view, per-category notes, edit/delete, charts)
- Forecasts — started (`src/domains/financial-intelligence/FinancialForecastService.js`)
- Variance analysis — planned

### Milestone 7 — Project Cost Controls

- Projects
- Cost codes
- WBS — started (scheduling WBS pages exist: `src/app/forge/scheduling/[projectId]/wbs/`)
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
