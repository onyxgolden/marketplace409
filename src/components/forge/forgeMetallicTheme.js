// Shared "premium industrial instrumentation" token set: restrained metallic surfaces for FORGE's
// data visualizations and their controls — anodized/brushed-metal gradients, not glossy or
// decorative. Every value below is a CSS custom property so both SVG (`stop-color: var(...)`) and
// plain HTML (`background-image: linear-gradient(..., var(...))`) surfaces read from one token
// set, and so light/dark switches with Tailwind's existing `dark:` variant instead of duplicated
// JS branching. No animation lives here — all effects are static gradients, so
// prefers-reduced-motion needs no special handling (there is nothing to reduce).
//
// Deliberately scoped to chart primitives and their own controls (§ "Apply this first to the
// redesigned financial chart and shared chart primitives") — this does not restyle unrelated
// FORGE surfaces.
export const METALLIC_GRADIENT_IDS = Object.freeze({
  income: "forge-metal-income",
  expense: "forge-metal-expense",
  netLine: "forge-metal-net-line",
  netDot: "forge-metal-net-dot",
  panel: "forge-metal-panel",
});

// Apply once on a chart's outermost wrapper. Every gradient stop below reads these via var(...),
// so retoning the palette means editing this one class string, not hunting through markup.
export const metallicTokensClassName = [
  // income (anodized green/teal) — hi = light-facing highlight, mid = body tone, lo = darker lower edge
  "[--forge-metal-income-hi:#6ee7b7] [--forge-metal-income-mid:#0d9488] [--forge-metal-income-lo:#065f46]",
  "dark:[--forge-metal-income-hi:#5eead4] dark:[--forge-metal-income-mid:#0f766e] dark:[--forge-metal-income-lo:#022c22]",
  // expense (forged bronze/amber)
  "[--forge-metal-expense-hi:#fde68a] [--forge-metal-expense-mid:#d97706] [--forge-metal-expense-lo:#78350f]",
  "dark:[--forge-metal-expense-hi:#fbbf24] dark:[--forge-metal-expense-mid:#b45309] dark:[--forge-metal-expense-lo:#451a03]",
  // net line/marker (high-contrast metallic cyan)
  "[--forge-metal-net-a:#22d3ee] [--forge-metal-net-b:#0e7490] [--forge-metal-net-dot:#ffffff]",
  "dark:[--forge-metal-net-a:#67e8f9] dark:[--forge-metal-net-b:#0891b2] dark:[--forge-metal-net-dot:#e0f2fe]",
  // structural plot surface (gunmetal/navy)
  "[--forge-metal-panel-hi:#f8fafc] [--forge-metal-panel-lo:#eef2f6]",
  "dark:[--forge-metal-panel-hi:#0f172a] dark:[--forge-metal-panel-lo:#1e293b]",
].join(" ");

// Forged-gold treatment for an active/selected control (e.g. the pressed period button) — a
// machined edge (thin darker border) and a top-to-bottom highlight-to-shadow gradient, no glow or
// shimmer.
export const goldControlClassName = [
  "bg-gradient-to-b from-amber-300 via-amber-500 to-amber-600",
  "dark:from-amber-400 dark:via-amber-500 dark:to-amber-700",
  "border border-amber-700/50 dark:border-amber-900/60",
  "text-slate-950 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55),inset_0_-1px_0_0_rgba(120,53,15,0.35)]",
].join(" ");

export const metallicSwatchClassName = {
  income: "bg-[linear-gradient(to_bottom,var(--forge-metal-income-hi),var(--forge-metal-income-mid),var(--forge-metal-income-lo))]",
  expense: "bg-[linear-gradient(to_bottom,var(--forge-metal-expense-hi),var(--forge-metal-expense-mid),var(--forge-metal-expense-lo))]",
  net: "bg-[linear-gradient(to_right,var(--forge-metal-net-a),var(--forge-metal-net-b),var(--forge-metal-net-a))]",
};

// Validated 8-slot categorical palette (identity color for >=3 distinct series -- category
// donuts/legends, not the 2-tone income/expense scale above). Fixed hue order is the CVD-safety
// mechanism; never cycle or reassign a slot to a different category once rendered. Validated via
// the dataviz skill's validate_palette.js against this app's actual card surfaces (white / #0f172a
// slate-900): all hard gates pass in both modes; slots 3/4/5 (aqua/yellow/magenta) fall below 3:1
// on the light surface, so any chart using this palette must ship direct labels or a legend/table
// for every slice -- color alone is not sufficient there.
export const CATEGORICAL_SLOT_COUNT = 8;

export const metallicCategoricalTokensClassName = [
  "[--forge-cat-1:#2a78d6] dark:[--forge-cat-1:#3987e5]",
  "[--forge-cat-2:#eb6834] dark:[--forge-cat-2:#d95926]",
  "[--forge-cat-3:#1baf7a] dark:[--forge-cat-3:#199e70]",
  "[--forge-cat-4:#eda100] dark:[--forge-cat-4:#c98500]",
  "[--forge-cat-5:#e87ba4] dark:[--forge-cat-5:#d55181]",
  "[--forge-cat-6:#008300] dark:[--forge-cat-6:#008300]",
  "[--forge-cat-7:#4a3aa7] dark:[--forge-cat-7:#9085e9]",
  "[--forge-cat-8:#e34948] dark:[--forge-cat-8:#e66767]",
].join(" ");

export function categoricalSlotVar(index) {
  return `var(--forge-cat-${(index % CATEGORICAL_SLOT_COUNT) + 1})`;
}
