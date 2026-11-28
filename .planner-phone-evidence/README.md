# Planner phone-width fix — evidence

Branch: `feat/planner-phone-width-fix`, base marketplace409 main `bdda3917`
Source: Jason's own S26+ screenshots, Sat Nov 28 2026 ~08:10–08:12 CST,
production `/forge/work` (Fictional FCCU Sample Project) — filed in the
forge-ai-drop as `results/muse/planner-s26-phone-check-2026-11-28/`
(drop `9826839ad`).

## Widths

Jason's phone renders at **360 CSS px** (1080 physical px at DPR 3.0),
not 390/400 — that is the width the defects reproduce at worst, so the
check runs at **360 + 390 + 400**. All runs dark mode (`.dark` on
`documentElement`, re-asserted right before measuring; `darkModeOn`
recorded in every JSON).

## Pre-fix reproduction (all measured live, dev server, committed base)

Run: `node .planner-phone-evidence/planner-phone-fix-check.mjs`
(full failure list in `pre-fix-repro.log`).

- **Defect 1 — D2b cost-split legend, CONFIRMED.** The label was the
  row's only flexible item with `min-w-0`, so the fixed siblings
  (count + `w-24` amount + `w-12` percent + gaps) starved it:
  - 360px: labels **18px** wide — Labor 3 lines, Material 4, Equipment 6,
    External services 8, Rental 3 (one letter per line, exactly as in
    Jason's shot 01).
  - 390px: labels 48px — Material 2 lines, Equipment 2, External services 4.
  - 400px: labels 58px — Equipment 2 lines, External services 2.
- **Defect 2 — D5 scope-map Export CSV, CONFIRMED at 360px.** The header
  controls row (Treemap/Table + Settings + Export CSV) was the one header
  row without `flex-wrap`: header `scrollWidth` 320 vs `clientWidth` 294
  at 360px (26px past its card); at 390/400 the fixture fits with ~1px
  spare, and production clips it (narrower production viewport).
- **Observation 3 — grid Title contrast, CONFIRMED.** Real-row titles
  `text-slate-900` with no `dark:` variant: **1.12:1** in dark mode at all
  three widths (needs ≥ 4.5:1). Header row rendered white in dark mode
  (`background: rgb(255,255,255)`).
- **Observation 4 — blank rows, RULED INTENTIONAL, KEPT.** The four greyed
  "New package title…" rows are the first 4 of the 10 blank inline-create
  rows (`BLANK_ROWS = 10`, `WorkPackageListGrid.jsx` header: "Blank rows
  fill the page (minimum 10) whether items exist or not: typing into a
  blank row creates the next package"). Live count: **10 blank rows** at
  all widths, 6 data rows. No change.

Two measurement bugs were found and fixed in the check script during the
repro (both made the first run falsely PASS — see the script's comments):
`getClientRects()` on a blockified flex item always returns 1 rect, so
line counts now use a `Range` over the text node; Tailwind v4 reports
colors as `oklch()`, so the contrast parser now handles `oklch()` (a
`null` ratio is now a failure, never a pass).

## Fix (3 source files, + tests)

- `PlannerDashboardShell.jsx` (CostRow): row `flex flex-wrap`, label
  `min-w-0` → `min-w-fit` — the label keeps at least its content width
  and the amount/percent wrap to a second line instead of crushing it.
- `PlannerScopeBlockMap.jsx`: header controls div gains `flex-wrap` —
  Export CSV drops to a second line instead of running past the card.
- `WorkPackageListGrid.jsx`: title `dark:text-slate-100`; header row
  `dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700`; other
  real-row text cells `dark:text-slate-300` / `dark:text-slate-400`;
  selected row `dark:bg-blue-950`, hover `dark:hover:bg-slate-800`
  (required: a light title on a light selected row would be unreadable
  without the dark row background); sort-arrow hover, budget caption,
  Import button, cancelled-reason line get matching dark variants.
  Status pills and blank-row placeholders already had dark variants.

## Post-fix verification (same script, committed checkout)

- Legend: **1 line for every label at 360/390/400** (360px: Labor 74px,
  External services 178px; 390px: Labor 48px, External services 208px).
- Scope map: header `scrollWidth == clientWidth` at all widths
  (294/294, 324/324, 334/334); Export CSV fully inside the card on its
  own wrapped line.
- Grid titles: **18.34:1** at all widths; header background now dark
  (`oklch(0.208 0.042 265.755)` = slate-900).
- Blank rows: still 10; data rows still 6.
- Tests: `PlannerDashboardShell` 29/29, `PlannerScopeBlockMap` 43/43,
  `WorkPackageListGrid` 20/20 (3 new red-before tests, all failed
  pre-fix, all pass post-fix).

## Harness notes (for the next live-check run)

- Turbopack panics on the worktree's symlinked `node_modules`
  ("Symlink node_modules could not be resolved") — the check script
  spawns `next dev --webpack`, which serves the same pages fine.
- Playwright must use `http://localhost:3103`, not `127.0.0.1`: the
  dev server treats 127.0.0.1 as cross-origin and the fixture never
  hydrates there (180s selector timeout); localhost works.
- The check script's `waitForServer` polls the fixture route; a cold
  start takes minutes on this VM — it waits up to 600s.

## Files

- `planner-phone-fix-check.mjs` — the live-check script (port 3103).
- `planner-phone-fix-{360,390,400}w.json` — post-fix measurements.
- `dashboard-{360,390,400}w.png`, `grid-{360,390,400}w.png` — post-fix screenshots.
- `pre-fix-repro.log` — the pre-fix run's full output (6 failures).
