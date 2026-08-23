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
