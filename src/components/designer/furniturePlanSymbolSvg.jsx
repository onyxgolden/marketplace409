// SVG rendering for furniture plan symbols (geometry in
// src/domains/roomDesigner/furniturePlanSymbols.js). Shared by the plan
// canvas / thumbnails (screen palette) and sheet printing (ink palette).

import { shade } from "@/domains/roomDesigner/designerFurnitureParts";

const PORCELAIN = "#f5f7fa";
const BASIN = "#c9d6e3";
const DARK = "#1f2937";

/**
 * Palettes map a primitive role to SVG paint. screen({ color, stroke }) uses
 * the catalog color for upholstery/wood and porcelain for fixtures;
 * print({ ink }) is line work on white paper.
 */
export const PLAN_SYMBOL_PALETTES = Object.freeze({
  screen: ({ color, stroke }) => (role) => {
    const line = { stroke, strokeWidth: 1.25 };
    switch (role) {
      case "frame": return { fill: shade(color, 0.7), ...line };
      case "headboard": return { fill: shade(color, 0.45), ...line };
      case "pillow": return { fill: "#ffffff", ...line };
      case "sheet": return { fill: shade(color, 1.12), ...line };
      case "sheet-fold": return { fill: shade(color, 1.35), ...line };
      case "tank": case "shell": case "bowl": return { fill: PORCELAIN, ...line };
      case "seat": return { fill: "#ffffff", stroke, strokeWidth: 1 };
      case "basin": return { fill: BASIN, stroke, strokeWidth: 1 };
      case "drain": return { fill: DARK, stroke: "none" };
      case "faucet": case "handle": return { fill: "#9ca3af", stroke: DARK, strokeWidth: 0.75 };
      case "top": return { fill: color, ...line };
      case "top-edge": case "seat-edge": case "grain": return { fill: "none", stroke: shade(color, 0.6), strokeWidth: 1 };
      case "pedestal": return { fill: "none", stroke: shade(color, 0.55), strokeWidth: 1, strokeDasharray: "3 2" };
      case "back": return { fill: shade(color, 0.6), ...line };
      case "spoke": return { fill: "none", stroke: DARK, strokeWidth: 2 };
      case "caster": return { fill: DARK, stroke: "none" };
      default: return { fill: color, ...line };
    }
  },
  print: ({ ink }) => (role) => {
    const base = { fill: "#ffffff", stroke: ink, strokeWidth: 0.6 };
    if (role === "drain" || role === "caster") return { fill: ink, stroke: ink, strokeWidth: 0.3 };
    if (role === "pedestal") return { ...base, fill: "none", strokeDasharray: "2 1.5" };
    if (role === "top-edge" || role === "seat-edge" || role === "grain" || role === "spoke") return { ...base, fill: "none", strokeWidth: 0.4 };
    if (role === "basin" || role === "headboard" || role === "back") return { ...base, fill: "#e5e5e5" };
    return base;
  },
});

/** Render plan-symbol primitives (local inches) at `scale` px per inch with a palette. */
export function renderPlanSymbol(prims, scale, paintFor) {
  return prims.map((p, i) => {
    const paint = paintFor(p.role);
    const common = { "data-role": p.role, ...paint };
    switch (p.kind) {
      case "rect":
        return <rect key={i} {...common} x={p.x * scale} y={p.y * scale} width={p.w * scale} height={p.h * scale} rx={(p.rx || 0) * scale} />;
      case "line":
        return <line key={i} {...common} x1={p.x1 * scale} y1={p.y1 * scale} x2={p.x2 * scale} y2={p.y2 * scale} />;
      case "poly": {
        const pts = p.points.map(([x, y]) => `${x * scale},${y * scale}`).join(" ");
        return p.closed ? <polygon key={i} {...common} points={pts} /> : <polyline key={i} {...common} points={pts} fill="none" />;
      }
      case "circle":
        return <circle key={i} {...common} cx={p.cx * scale} cy={p.cy * scale} r={p.r * scale} />;
      case "ellipse":
        return <ellipse key={i} {...common} cx={p.cx * scale} cy={p.cy * scale} rx={p.rx * scale} ry={p.ry * scale} />;
      default:
        return null;
    }
  });
}
