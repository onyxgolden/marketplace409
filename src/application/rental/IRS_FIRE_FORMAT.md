# IRS FIRE-Modeled 1099 Export Format (R23)

**Guidance only — NOT IRS-certified.** This document describes the exact file
layout R23 generates. It is modeled on IRS Publication 1220 (the FIRE
electronic-filing record layout) but is not a certified reproduction of it.
**Before any real filing, the CPA must validate this file against the
current-year Publication 1220** — IRS record layouts, TCC requirements, and
deadlines change. Do not present the export as IRS-certified.

## Why this format

Rentec's e-filing integration sends 1099s through a partner. R23's free layer
prepares the data and emits a fixed-width electronic file (the shape the IRS
FIRE system and most e-filing partners ingest), while the partner layer stays
hard-gated until Jason approves a provider and per-filing cost. Brandy can hand
this file to her CPA or import it into the partner's uploader the day the gate
opens — no re-keying of recipients or amounts.

## File envelope

- One file per tax year: `FORGE-1099-<year>.txt`
- CRLF (`\r\n`) line endings.
- Every record is exactly **750 characters**; any shorter/longer record is a
  hard error at build time (a short record means a broken layout).
- Records end with the literal marker `###` at positions 748–750.
- Text fields are UPPERCASED, truncated to their width, blank-padded.
- Amounts are **12 characters, zero-padded, whole cents, no decimal point**:
  `$1,234.56` → `000000123456`. A `###` mismatch or mis-sized amount throws.
- TINs are 9 digits, no dashes (e.g. `123456789`). Full TINs appear ONLY in
  this file; the on-screen preview and the summary CSV carry `XXX-XX-1234`.

## Record sequence

```
T  Transmitter — the business filing the forms (from the payer profile)
A  Payer — one per FORM TYPE (1099-NEC and 1099-MISC are separate A groups)
B  Payee — one per reportable recipient (Box 1 amount only)
C  End of Payer — closes the current A group
K  End of Transmission
F  End of Transmission summary
```

Reportable = recipient total ≥ the $600 IRS threshold AND entity type not
corporation-excluded (C/S corps). Below-threshold recipients are excluded from
the file (they stay flagged in the year summary) and recipients with no full
TIN on file are skipped with an explicit reason in the export result.

## Field positions (1-indexed)

### T — Transmitter (1 per file)

| Pos | Width | Field |
|-----|-------|-------|
| 1 | 1 | Record type `T` |
| 2–5 | 4 | Tax year (`2026`) |
| 6–14 | 9 | Transmitter TIN (from payer profile) |
| 15–19 | 5 | Reserved (blank) |
| 20–59 | 40 | Transmitter name |
| 60–99 | 40 | Transmitter street address |
| 100–139 | 40 | City |
| 140–141 | 2 | State |
| 142–150 | 9 | ZIP |
| 151–747 | 597 | Reserved (blank) |
| 748–750 | 3 | `###` |

### A — Payer (1 per form type)

| Pos | Width | Field |
|-----|-------|-------|
| 1 | 1 | Record type `A` |
| 2–5 | 4 | Tax year |
| 6–14 | 9 | Payer TIN |
| 15–18 | 4 | Payer name control (first 4 alphanumerics of payer name) |
| 19–20 | 2 | Type of return: `NE` = 1099-NEC, `A␣` = 1099-MISC |
| 21–60 | 40 | Payer name |
| 61–100 | 40 | Payer street address |
| 101–140 | 40 | City |
| 141–142 | 2 | State |
| 143–151 | 9 | ZIP |
| 152–158 | 7 | Reserved (blank) |
| 159–166 | 8 | Amount codes: `1` = Box 1 only (left-justified, blank-padded) |
| 167–747 | 581 | Reserved (blank) |
| 748–750 | 3 | `###` |

### B — Payee (1 per reportable recipient)

| Pos | Width | Field |
|-----|-------|-------|
| 1 | 1 | Record type `B` |
| 2–5 | 4 | Tax year |
| 6–14 | 9 | Payee TIN (full — export only) |
| 15–18 | 4 | Payee name control |
| 19 | 1 | Type of TIN: `1`=EIN `2`=SSN `3`=ITIN (blank when unknown) |
| 20–59 | 40 | Payee name line 1 |
| 60–99 | 40 | Mailing address |
| 100–139 | 40 | City |
| 140–141 | 2 | State |
| 142–150 | 9 | ZIP |
| 151–160 | 10 | Reserved (blank) |
| 161–172 | 12 | Payment Amount 1 — Box 1 (Nonemployee compensation / Rents) |
| 173–352 | 180 | Payment Amounts 2–16 (zeros — R23 reports Box 1 only) |
| 353–394 | 42 | Reserved (blank) |
| 395–396 | 2 | State code for combined filing (blank — no combined filing) |
| 397–398 | 2 | Reserved (blank) |
| 399–410 | 12 | State income tax withheld (zeros — not tracked) |
| 411–422 | 12 | Local income tax withheld (zeros — not tracked) |
| 423–442 | 20 | State income (blank) |
| 443–722 | 280 | Reserved (blank) |
| 723 | 1 | Corrected return indicator (blank) |
| 724–747 | 24 | Reserved (blank) |
| 748–750 | 3 | `###` |

### C — End of Payer (1 per A record)

| Pos | Width | Field |
|-----|-------|-------|
| 1 | 1 | Record type `C` |
| 2–5 | 4 | Tax year |
| 6–14 | 9 | Payer TIN |
| 15–19 | 5 | Number of B records in this payer group (zero-padded) |
| 20–31 | 12 | Total of Payment Amount 1 for this group |
| 32–211 | 180 | Totals of Amounts 2–16 (zeros) |
| 212–747 | 536 | Reserved (blank) |
| 748–750 | 3 | `###` |

### K — End of Transmission

| Pos | Width | Field |
|-----|-------|-------|
| 1 | 1 | Record type `K` |
| 2–5 | 4 | Tax year |
| 6–10 | 5 | Number of payers (A records), zero-padded |
| 11–15 | 5 | Total number of payees (B records), zero-padded |
| 16–27 | 12 | Grand total of Payment Amount 1 |
| 28–747 | 720 | Reserved (blank) |
| 748–750 | 3 | `###` |

### F — End of Transmission summary

| Pos | Width | Field |
|-----|-------|-------|
| 1 | 1 | Record type `F` |
| 2–10 | 9 | Number of A records, zero-padded |
| 11–15 | 5 | Zero |
| 16–25 | 10 | Total number of B records, zero-padded |
| 26–36 | 11 | Reserved (blank) |
| 37–750 | 714 | Zero-filled |

## Companion CSV (human-readable)

`FORGE-1099-summary-<year>.csv` — the same rows with **masked** TINs for Brandy
and the CPA to eyeball before filing. Columns: Tax year, Recipient, Kind, Form,
Box, Entity type, TIN (masked), Total paid, Payments, Reportable,
Exclusion reason, Filing status.
