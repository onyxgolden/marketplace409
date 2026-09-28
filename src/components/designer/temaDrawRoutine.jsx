// 2D renderer for TEMA shell-and-tube symbols (see
// src/domains/roomDesigner/temaGeometry.js for the geometry itself).
//
// drawProcessEquipmentSymbol hands any symbol carrying `tema` metadata to
// drawTemaSymbol; every other process-equipment glyph keeps its existing
// drawing untouched. The geometry is plain primitives in plan inches, so
// this file only maps each primitive + role to SVG.

import { temaDrawing } from "@/domains/roomDesigner/temaGeometry";

/** Map one geometry primitive to SVG. `scale` converts plan inches to screen px. */
export function temaPrimitiveToSvg(p, key, scale, { stroke, sw, accent, body, flange = "#1e293b" }) {
  const thin = Math.max(0.75, sw - 0.75);
  const paint = {
    body: { fill: body, stroke, strokeWidth: sw },
    flange: { fill: flange, stroke, strokeWidth: thin },
    tubesheet: { fill: accent, fillOpacity: 0.35, stroke, strokeWidth: thin },
    internal: { fill: "none", stroke: accent, strokeWidth: thin },
    hidden: { fill: "none", stroke: accent, strokeWidth: thin, strokeDasharray: "4 3", opacity: 0.7 },
    weld: { fill: stroke, stroke: "none" },
    packing: { fill: "#a8a29e", stroke, strokeWidth: thin },
    nozzle: { fill: body, stroke, strokeWidth: thin },
    flow: { fill: accent, stroke: "none" },
    weir: { fill: "none", stroke: accent, strokeWidth: sw + 0.5 },
    ubend: { fill: "none", stroke: accent, strokeWidth: thin },
    bolt: { fill: "none", stroke: "#94a3b8", strokeWidth: thin },
    label: { fill: accent, stroke: "none" },
  }[p.role] || { fill: "none", stroke, strokeWidth: thin };
  const pts = (list) => list.map(([x, y]) => `${x * scale},${y * scale}`).join(" ");
  switch (p.kind) {
    case "rect":
      return <rect key={key} x={p.x * scale} y={p.y * scale} width={p.w * scale} height={p.h * scale} {...paint} />;
    case "line":
      return <line key={key} x1={p.x1 * scale} y1={p.y1 * scale} x2={p.x2 * scale} y2={p.y2 * scale} {...paint} fill="none" />;
    case "poly":
      return p.closed
        ? <polygon key={key} points={pts(p.points)} {...paint} />
        : <polyline key={key} points={pts(p.points)} {...paint} fill={p.role === "body" ? body : "none"} />;
    case "circle":
      return <circle key={key} cx={p.cx * scale} cy={p.cy * scale} r={p.r * scale} {...paint} />;
    case "text":
      return (
        <text key={key} x={p.x * scale} y={p.y * scale} textAnchor="middle" dominantBaseline="central"
          fontSize={Math.max(7, Math.min(p.size * scale, 18))} fontWeight={700} {...paint}
          stroke={body} strokeWidth={3} paintOrder="stroke">
          {p.text}
        </text>
      );
    default:
      return null;
  }
}

function accessibleName(symbol, drawing) {
  const mode = drawing.mode === "pid" ? "P&ID symbol" : "detailed drawing";
  if (symbol.tema.kind === "assembly") return `TEMA ${drawing.designation} shell-and-tube exchanger, ${mode}`;
  const where = symbol.tema.position === "shell" ? "shell" : `${symbol.tema.position} head`;
  return `TEMA ${where} ${symbol.tema.letter}, ${mode}`;
}

/**
 * TEMA symbol: detailed cutaway or simplified P&ID per the instance's
 * drawingMode, with the equipment tag and description under it (same label
 * layout as the other process glyphs). Connection anchors show as small
 * rings while the symbol is selected.
 * ctx: { symbol, instance, toScreen, scale, highlighted }
 */
export function drawTemaSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const drawing = temaDrawing(symbol, instance);
  const c = toScreen({ x: instance.x, y: instance.y });
  const style = {
    stroke: highlighted ? "#f59e0b" : "#e2e8f0",
    sw: highlighted ? 3 : 1.75,
    accent: highlighted ? "#f59e0b" : symbol.color || "#f59e0b",
    body: "#0f172a",
  };
  // Nozzle flanges reach the footprint edge; keep the labels clear of them.
  const below = (drawing.depthIn * scale) / 2 + 4;
  const label = symbol.tema.kind === "assembly" ? `${symbol.label} · ${drawing.designation}` : symbol.label;
  return (
    <g
      key={instance.id}
      transform={`translate(${c.x} ${c.y}) rotate(${instance.rotationDeg || 0})`}
      role="img"
      aria-label={accessibleName(symbol, drawing)}
      data-tema-mode={drawing.mode}
    >
      {drawing.prims.map((p, i) => temaPrimitiveToSvg(p, i, scale, style))}
      {highlighted && drawing.anchors.map((a) => (
        <circle key={`anchor-${a.id}`} data-anchor={a.id} cx={a.x * scale} cy={a.y * scale} r={4}
          fill="none" stroke="#22d3ee" strokeWidth={1.5} />
      ))}
      {instance.tag && (
        <text y={below + 13} textAnchor="middle" fontSize={11} fontWeight={700} fill={highlighted ? "#f59e0b" : "#fde68a"}>
          {instance.tag.slice(0, 14)}
        </text>
      )}
      <text y={below + (instance.tag ? 26 : 14)} textAnchor="middle" fontSize={10} fill="#9ca3af">
        {label}
      </text>
    </g>
  );
}
