# Depreciation methods — supported, and explicitly out of scope

Rentec parity R19 (depreciation schedule per property). The engine lives in
`src/domains/rental-depreciation/depreciation.js` — pure functions, integer
cents, whole-cent monthly amounts, largest-remainder so every schedule sums
exactly to the depreciable basis.

## Supported

- **Straight line** — even monthly depreciation over a caller-supplied useful
  life (in months). First full month is the placed-in-service month, so a
  mid-year placement naturally prorates the first calendar year. Custom lives
  for appliances, equipment, and improvements (e.g. 60 months for appliances,
  180 months for a roof).
- **MACRS 27.5-year residential rental** — straight-line over 330 months with
  the IRS mid-month convention: a half month of depreciation in the
  placed-in-service month, with the leftover half month recovered in the
  extra final month (period 331). For residential rental property.
- **MACRS 39-year nonresidential real property** — straight-line over 468
  months, same mid-month convention (period 469 carries the stub). For
  nonresidential real property.

MACRS methods lock the useful life to the preset (330 / 468). A
caller-supplied life on a MACRS asset is normalized to the preset, never
honored silently.

## Explicitly out of scope

- Declining-balance methods (200% / 150% DB) and any other accelerated method.
- Section 179 expensing and bonus depreciation.
- MACRS personal-property classes (3/5/7/10-year with the half-year
  convention) — only the two real-property presets above are supported.
- State-specific depreciation rules.
- Land — non-depreciable; do not enter land in the asset register.
- Amortization, depletion, or any non-depreciation capital recovery.

## Books integration decision (report-only)

Depreciation is a **non-cash** expense. FORGE keeps it **report-only**: the
depreciation schedule never posts to the property ledger, never touches the
bank register, and never moves cash. The property ledger stays cash-based so
bank reconciliation keeps matching reality — an auto-posted depreciation
entry would silently change reported net income and confuse reconciliation.

The per-property depreciation schedule report (year → assets → depreciation
taken, accumulated, remaining book value) is the CPA hand-off: print it and
hand it to the accountant, who decides whether and where to book
depreciation in the tax filings. If Brandy ever wants it in the books, she
posts a manual transaction herself — nothing here posts automatically.

**This is not tax advice — confirm with your CPA.** MACRS classification,
placed-in-service dates, and cost-basis treatment (land vs building split,
settlement-statement allocations) are tax positions for the CPA to make.
