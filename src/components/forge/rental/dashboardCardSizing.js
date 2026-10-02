// Responsive sizing for dashboard stat-card values.
//
// The rental stat cards (DashboardCard in RentalOverviewPanel.jsx and
// ExceptionBox in RentalExceptionAlerts.jsx) render values at text-4xl in a
// narrow 5-column (xl) grid. A wide dollar amount such as "$1,568.00" overflows
// the card's inner width and gets clipped at the card edge. This module picks
// the largest Tailwind text size that fits the value inside the card, so
// amounts up to at least $99,999.00 render fully without clipping.
//
// The width model is intentionally conservative: per-character em advances
// for extra-bold tabular numerals, measured against a worst-case card inner
// width (5-column grid at the xl breakpoint, p-6 padding removed).

// Worst-case inner width (px) a card value may occupy: 5-column xl grid.
export const DASHBOARD_VALUE_MAX_PX = 110;

// Candidate sizes, largest first. Tailwind text-4xl..text-lg.
const SIZE_STEPS = [
  { px: 36, cls: "text-4xl" },
  { px: 30, cls: "text-3xl" },
  { px: 24, cls: "text-2xl" },
  { px: 20, cls: "text-xl" },
  { px: 18, cls: "text-lg" },
];

// Estimated advance width (em) per character for font-black tabular numerals:
// digits and currency/percent symbols are full tabular advances; comma and
// period are narrow; anything else (letters, spaces) gets a wide estimate so
// the fit stays conservative.
export function estimateValueWidthEm(text) {
  const str = String(text ?? "");
  let em = 0;
  for (const ch of str) {
    if (/[0-9$%€£]/.test(ch)) em += 0.62;
    else if (/[.,]/.test(ch)) em += 0.32;
    else em += 0.55;
  }
  return em;
}

// Estimated rendered width (px) of the value at a given font size.
export function estimateValueWidthPx(text, fontPx) {
  return estimateValueWidthEm(text) * fontPx;
}

// Largest Tailwind size class whose estimated width fits the card.
export function dashboardValueSizeClass(value) {
  const em = estimateValueWidthEm(value);
  for (const step of SIZE_STEPS) {
    if (em * step.px <= DASHBOARD_VALUE_MAX_PX) return step.cls;
  }
  return SIZE_STEPS[SIZE_STEPS.length - 1].cls;
}
