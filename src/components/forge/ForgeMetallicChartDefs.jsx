"use client";
import { METALLIC_GRADIENT_IDS } from "./forgeMetallicTheme";

export function metallicGradientUrl(prefix, key) {
  return `url(#${prefix}${METALLIC_GRADIENT_IDS[key]})`;
}

// Shared SVG <defs> for the metallic chart palette — reads the CSS custom properties set by
// metallicTokensClassName (see forgeMetallicTheme.js) so light/dark theming lives in one token
// set instead of being duplicated as hardcoded stop colors inside every chart that needs them.
// `prefix` (pass React's useId()) keeps gradient ids collision-free when more than one chart
// instance renders on the same page. Render once per <svg>; reference via metallicGradientUrl.
export default function ForgeMetallicChartDefs({ prefix = "" }) {
  return (
    <defs>
      <linearGradient id={`${prefix}${METALLIC_GRADIENT_IDS.income}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style={{ stopColor: "var(--forge-metal-income-hi)" }} />
        <stop offset="45%" style={{ stopColor: "var(--forge-metal-income-mid)" }} />
        <stop offset="100%" style={{ stopColor: "var(--forge-metal-income-lo)" }} />
      </linearGradient>
      <linearGradient id={`${prefix}${METALLIC_GRADIENT_IDS.expense}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style={{ stopColor: "var(--forge-metal-expense-hi)" }} />
        <stop offset="45%" style={{ stopColor: "var(--forge-metal-expense-mid)" }} />
        <stop offset="100%" style={{ stopColor: "var(--forge-metal-expense-lo)" }} />
      </linearGradient>
      <linearGradient id={`${prefix}${METALLIC_GRADIENT_IDS.netLine}`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" style={{ stopColor: "var(--forge-metal-net-a)" }} />
        <stop offset="50%" style={{ stopColor: "var(--forge-metal-net-b)" }} />
        <stop offset="100%" style={{ stopColor: "var(--forge-metal-net-a)" }} />
      </linearGradient>
      <radialGradient id={`${prefix}${METALLIC_GRADIENT_IDS.netDot}`} cx="35%" cy="30%" r="70%">
        <stop offset="0%" style={{ stopColor: "var(--forge-metal-net-dot)" }} />
        <stop offset="100%" style={{ stopColor: "var(--forge-metal-net-b)" }} />
      </radialGradient>
      <linearGradient id={`${prefix}${METALLIC_GRADIENT_IDS.panel}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style={{ stopColor: "var(--forge-metal-panel-hi)" }} />
        <stop offset="100%" style={{ stopColor: "var(--forge-metal-panel-lo)" }} />
      </linearGradient>
    </defs>
  );
}
