# Rental speed Slice 1 — live baseline receipt (desktop)

Date: 2026-11-26 ~13:42–13:49 CST. Environment: production 409marketplace.online, signed in as owner (jasonmorgan99@gmail.com), cloud browser, desktop viewport 1919x998. Navigation/viewing only — nothing changed, saved, deleted or submitted. Tenant used for detail trials: Anthony Babino (display name only; no IDs, emails, financial contents).

## Method and limits (read before using the numbers)

- Times are BRACKETS from wait-for-marker probes, not exact milliseconds: the browser has no network panel and no Performance API access, and pixel-program timing failed. "≤1.0s" means the usable marker was visible within a 1,000 ms probe. Cold brackets are approximate (±~2 s).
- TTFB / API duration was not visible and was not measured. Rows/bytes/query counts and JS bytes/chunks were not measured — the bundle ledger remains owed from a real Vercel preview/production build, not the dev server.
- Click-to-feedback was immediate on every page (nav item showed selected/loading state in the first post-click view). No errors in any trial.
- Usable markers: Summary = "RENT COLLECTED" cards drawn; Tenants = "30 records" plus rows drawn; Detail = "Tenant details" tab panel plus primary tenant form drawn.
- Deviations: warm detail trials n=6, not 10 (row-click round-trips needed separate browser acts; all 6 ≤1 s at the 1,000 ms probe except two early trials run at looser probes ≤5 s / ≤30 s). Planner control NOT FOUND — no Planner page in Forge navigation and command-palette search for "Planner" returned no matches; no URL was guessed, no Planner trial run. (Work Package Planner lives at /forge/work; the control was not measured, not a defect finding.)
- PHONE 390 px: NOT MEASURED. Chrome device emulation / viewport resizing is not available in this browser. All figures below are desktop only. Phone-width timing evidence rests on Jason's S26+ acceptance (the brief's hard gate), not on this receipt.

## Results

| Page | Warm median / p90 / max (click-to-usable) | Cold median (click-to-usable) |
|---|---|---|
| Rental Summary (/forge/rental) | ≤1.0 s / ≤1.0 s / ≤1.0 s (n=10) | ≤15 s (n=5; first-ever load at sign-in ~15–30 s; then 5–35 s, ≤15 s, ≤15 s, ≤15 s). Long "Loading rental summary…" spinner on every cold load. 23 units shown. |
| Rental Tenants list (?section=tenants) | ≤1.0 s / ≤1.0 s / ≤1.0 s (n=10) | ≤5 s (n=5, all ≤5 s). 30 records total, 12 rows visible. Brief "Updating…" indicator even after rows drawn. |
| Tenant detail (Anthony Babino) | ≤1.0 s median (n=6; 4 trials at 1,000 ms probe all ≤1.0 s) | ≤10 s (n=5, direct URL; all ≤10 s). Direct load first renders "Loading tenants…" + empty Tenant Setup form, then selects the record. After the usable marker, sub-sections (custom fields, generated notices) and payment-history "Updating…" were still loading — "usable" = header + primary form, not every sub-section. |

Controls (one trial each, 15,000 ms probe, desktop): /forge dashboard ≤15 s (long "Loading dashboard…" spinner before painting the app chooser); Scheduling list ≤15 s (4 projects); Designer list ≤15 s (5 design rows). Planner: not measured (see above).

## Stop-condition evaluation (brief §1 / §7.2)

Floor: fresh Rental Summary and Tenants medians ≤1.0 s with p90 ≤1.5 s and no dead-click symptom → stop with NO CURRENT PERFORMANCE DEFECT / MEASUREMENT ONLY.

- Warm medians MEET the floor (≤1.0 s, p90 ≤1.0 s) and no dead-click symptom was observed — warm in-app navigation is fast.
- Cold medians DO NOT meet the floor: Summary ≤15 s, Tenants ≤5 s, Detail ≤10 s — all far above the §5 cold target of ≤2.5 s.
- Verdict: floor NOT met. The defect is real but it is a COLD / FIRST-LOAD defect, not a warm-navigation defect. Build proceeds.

## Consequence for the build

- The slice's measurable win is cold/first-load time (surface projections + demand-loaded shell). Warm click feedback is already immediate and Saving…/disable already exist on the create/invite paths (see inventory) — do not claim a warm-click win the baseline cannot show.
- Acceptance must be judged on cold medians (target ≤2.5 s) plus the §4 guards (50-row first page, no legacy full-payload fetch on Summary/Tenants, bundle reduction, data parity vs golden ledger). Warm-median ≥20% / ≥300 ms improvement is not measurable with bracket methods at ≤1.0 s — record warm as "already ≤1.0 s, no regression" rather than manufacturing a warm improvement claim.
- Volume ledger: see §3 of docs/rental-speed-slice1-inventory.md (23 units, 30 tenants, 30 leases, 12,813 financial_events all scopes — fresh 2026-11-26 ~13:45 CST, read-only counts).
