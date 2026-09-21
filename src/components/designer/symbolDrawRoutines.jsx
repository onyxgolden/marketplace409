// 2D draw routines for registered symbol sets (see
// src/domains/roomDesigner/symbolRegistry.js).
//
// The canvas (PlanCanvas.jsx) never hard-codes how a symbol looks: it calls
// renderSymbol2D(domain, symbolId, instance, ctx), which resolves the routine
// for the symbol's domain. Routine resolution order per symbol:
//   1. symbol.draw2D (per-symbol custom routine, declared at registration)
//   2. the domain routine registered below (registerDrawRoutine)
//   3. drawDefaultSymbol (rect + label fallback)
//
// Adding a new domain's 2D look is one registerDrawRoutine call — no changes
// to PlanCanvas.jsx, designerReducer.js, or designerDocument.js.

import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import { polygonArea } from "@/domains/roomDesigner/designerGeometry";
import { ORG_CHART_METRICS, departmentColor, layoutOrgChart } from "@/domains/roomDesigner/orgChartLayout";

function centroid(points) {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((s, p) => s + p.x, 0) / n,
    y: points.reduce((s, p) => s + p.y, 0) / n,
  };
}

function selectionStroke(highlighted, normal) {
  return highlighted ? "#f59e0b" : normal;
}

/**
 * Furniture symbol: rounded rect (or circle) in the catalog color + label.
 * ctx: { symbol, instance: {id,x,y,rotationDeg}, toScreen, scale, highlighted }
 */
export function drawFurnitureSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const c = toScreen({ x: instance.x, y: instance.y });
  const w = symbol.widthIn * scale;
  const h = symbol.depthIn * scale;
  const stroke = selectionStroke(highlighted, "#374151");
  return (
    <g key={instance.id} transform={`translate(${c.x} ${c.y}) rotate(${instance.rotationDeg || 0})`}>
      {symbol.symbol === "circle" ? (
        <circle
          r={Math.min(w, h) / 2}
          fill={symbol.color}
          fillOpacity={0.85}
          stroke={stroke}
          strokeWidth={highlighted ? 3 : 1.5}
        />
      ) : (
        <rect
          x={-w / 2}
          y={-h / 2}
          width={w}
          height={h}
          rx={3}
          fill={symbol.color}
          fillOpacity={0.85}
          stroke={stroke}
          strokeWidth={highlighted ? 3 : 1.5}
        />
      )}
      <text y={Math.max(w, h) / 2 + 14} textAnchor="middle" fontSize={11} fill="#d1d5db">
        {symbol.label}
      </text>
    </g>
  );
}

/**
 * Room symbol: dashed polygon + label + area.
 * ctx: { instance: {id,label,polygon}, toScreen, highlighted }
 */
export function drawRoomSymbol({ instance, toScreen, highlighted }) {
  const pts = instance.polygon.map(toScreen).map((p) => `${p.x},${p.y}`).join(" ");
  const c = toScreen(centroid(instance.polygon));
  const area = instance.polygon.length >= 3 ? polygonArea(instance.polygon) / 144 : 0;
  return (
    <g key={instance.id}>
      <polygon
        points={pts}
        fill="#3b82f6"
        fillOpacity={0.08}
        stroke={selectionStroke(highlighted, "#3b82f6")}
        strokeOpacity={0.6}
        strokeWidth={highlighted ? 2.5 : 1.5}
        strokeDasharray="8 5"
      />
      <text x={c.x} y={c.y} textAnchor="middle" fontSize={13} fontWeight={600} fill="#93c5fd">
        {instance.label}
      </text>
      <text x={c.x} y={c.y + 16} textAnchor="middle" fontSize={11} fill="#6b7280">
        {area.toFixed(0)} sq ft
      </text>
    </g>
  );
}

/** Fallback routine: plain rect + label for symbols with no domain routine. */
export function drawDefaultSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const c = toScreen({ x: instance.x, y: instance.y });
  const w = (symbol.widthIn || 24) * scale;
  const h = (symbol.depthIn || 24) * scale;
  return (
    <g key={instance.id} transform={`translate(${c.x} ${c.y}) rotate(${instance.rotationDeg || 0})`}>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={3}
        fill={symbol.color || "#6b7280"}
        fillOpacity={0.85}
        stroke={selectionStroke(highlighted, "#374151")}
        strokeWidth={highlighted ? 3 : 1.5}
      />
      <text y={Math.max(w, h) / 2 + 14} textAnchor="middle" fontSize={11} fill="#d1d5db">
        {symbol.label}
      </text>
    </g>
  );
}

/**
 * Piping symbol: P&ID-inspired glyphs (valve bowties, pump, vessel,
 * fittings, flow arrow, equipment tag) drawn from symbol.glyph.
 * ctx: { symbol, instance: {id,x,y,rotationDeg,tag}, toScreen, scale, highlighted }
 */
export function drawPipingSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const c = toScreen({ x: instance.x, y: instance.y });
  const hw = (symbol.widthIn * scale) / 2;
  const hh = (symbol.depthIn * scale) / 2;
  const stroke = selectionStroke(highlighted, "#cbd5e1");
  const sw = highlighted ? 3 : 2;
  const accent = highlighted ? "#f59e0b" : "#38bdf8";

  const glyph = (() => {
    switch (symbol.glyph) {
      case "gate": // valve bowtie + pipe stub
        return (
          <g>
            <line x1={-hw} y1={0} x2={hw} y2={0} stroke={stroke} strokeWidth={sw} />
            <polygon points={`${-hw},${-hh} ${-hw},${hh} 0,0`} fill="none" stroke={stroke} strokeWidth={sw} />
            <polygon points={`${hw},${-hh} ${hw},${hh} 0,0`} fill="none" stroke={stroke} strokeWidth={sw} />
          </g>
        );
      case "ball": // bowtie with filled ball
        return (
          <g>
            <line x1={-hw} y1={0} x2={hw} y2={0} stroke={stroke} strokeWidth={sw} />
            <polygon points={`${-hw},${-hh} ${-hw},${hh} 0,0`} fill="none" stroke={stroke} strokeWidth={sw} />
            <polygon points={`${hw},${-hh} ${hw},${hh} 0,0`} fill="none" stroke={stroke} strokeWidth={sw} />
            <circle r={Math.min(hw, hh) * 0.32} fill={stroke} />
          </g>
        );
      case "check": // bowtie with flow dart
        return (
          <g>
            <line x1={-hw} y1={0} x2={hw} y2={0} stroke={stroke} strokeWidth={sw} />
            <polygon points={`${-hw},${-hh} ${-hw},${hh} 0,0`} fill="none" stroke={stroke} strokeWidth={sw} />
            <polygon points={`${hw},${-hh} ${hw},${hh} 0,0`} fill="none" stroke={stroke} strokeWidth={sw} />
            <polygon
              points={`${hw * 0.1},${-hh * 0.35} ${hw * 0.1},${hh * 0.35} ${hw * 0.6},0`}
              fill={accent}
            />
          </g>
        );
      case "pump": {
        const r = Math.min(hw, hh) * 0.95;
        return (
          <g>
            <circle r={r} fill="#0f172a" stroke={stroke} strokeWidth={sw} />
            <polygon
              points={`${-r * 0.45},${-r * 0.55} ${-r * 0.45},${r * 0.55} ${r * 0.55},0`}
              fill={accent}
            />
          </g>
        );
      }
      case "tank": // vessel with elliptical head
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="#1f2937" stroke={stroke} strokeWidth={sw} />
            <ellipse cx={0} cy={-hh} rx={hw} ry={hh * 0.28} fill="none" stroke={stroke} strokeWidth={sw} />
            <line x1={-hw} y1={hh * 0.45} x2={hw} y2={hh * 0.45} stroke={stroke} strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
          </g>
        );
      case "elbow":
        return (
          <path
            d={`M ${-hw} ${hh * 0.6} Q ${-hw} ${-hh} ${hw * 0.6} ${-hh}`}
            fill="none"
            stroke={stroke}
            strokeWidth={sw + 1}
            strokeLinecap="round"
          />
        );
      case "tee":
        return (
          <g stroke={stroke} strokeWidth={sw + 1} strokeLinecap="round">
            <line x1={-hw} y1={0} x2={hw} y2={0} />
            <line x1={0} y1={0} x2={0} y2={hh} />
          </g>
        );
      case "reducer": // concentric reducer: trapezoid
        return (
          <polygon
            points={`${-hw},${-hh} ${hw},${-hh * 0.35} ${hw},${hh * 0.35} ${-hw},${hh}`}
            fill="#1f2937"
            stroke={stroke}
            strokeWidth={sw}
          />
        );
      case "flow":
        return (
          <polygon
            points={`${-hw},${-hh} ${-hw},${hh} ${hw},0`}
            fill={accent}
            fillOpacity={0.9}
          />
        );
      case "tag": {
        const label = (instance.tag || symbol.label || "").slice(0, 12);
        return (
          <g>
            <rect
              x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={3}
              fill="#1f2937" stroke={highlighted ? "#f59e0b" : "#fbbf24"} strokeWidth={sw}
            />
            <text textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={700} fill="#fde68a">
              {label}
            </text>
          </g>
        );
      }
      default:
        return (
          <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" stroke={stroke} strokeWidth={sw} />
        );
    }
  })();

  return (
    <g key={instance.id} transform={`translate(${c.x} ${c.y}) rotate(${instance.rotationDeg || 0})`}>
      {glyph}
      <text y={Math.max(hw, hh) + 14} textAnchor="middle" fontSize={10} fill="#9ca3af">
        {symbol.label}
      </text>
    </g>
  );
}

const routines = new Map([
  ["furniture", drawFurnitureSymbol],
  ["rooms", drawRoomSymbol],
  ["piping", drawPipingSymbol],
]);

/** Truncate a label so it fits a person card; SVG text never wraps. */
function fitLabel(text, maxChars = 26) {
  const s = String(text || "");
  return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

/**
 * Org chart (Phase 3): a placeable people-hierarchy diagram. Person boxes
 * lay out through the pure layoutOrgChart (derived at render, never
 * stored); the chart anchor (chart.x, chart.y) is the top-center of the
 * laid-out tree. Manager -> report edges draw as elbow connectors.
 * ctx: { chart: {id,name,x,y,nodes}, toScreen, scale, highlighted }
 *
 * Text sizes stay TV-readable: name 15px, title 12px, department 11px,
 * chart title 17px at any zoom.
 */
export function drawOrgChart({ chart, toScreen, scale, highlighted }) {
  const layout = layoutOrgChart(chart.nodes);
  const anchor = toScreen({ x: chart.x, y: chart.y });
  const { boxWidthIn, boxHeightIn } = ORG_CHART_METRICS;
  const boxW = boxWidthIn * scale;
  const boxH = boxHeightIn * scale;
  const byId = new Map((chart.nodes || []).map((n) => [n.id, n]));
  const nodePos = new Map(layout.positions.map((p) => [p.id, p]));

  const connectors = layout.edges.map(({ from, to }) => {
    const a = nodePos.get(from);
    const b = nodePos.get(to);
    if (!a || !b) return null;
    const x1 = anchor.x + (a.x + boxWidthIn / 2) * scale;
    const y1 = anchor.y + (a.y + boxHeightIn) * scale;
    const x2 = anchor.x + (b.x + boxWidthIn / 2) * scale;
    const y2 = anchor.y + b.y * scale;
    const midY = (y1 + y2) / 2;
    return (
      <path
        key={`${from}->${to}`}
        d={`M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`}
        fill="none"
        stroke="#64748b"
        strokeWidth={2}
      />
    );
  });

  const boxes = layout.positions.map((p) => {
    const person = byId.get(p.id);
    if (!person) return null;
    const sx = anchor.x + p.x * scale;
    const sy = anchor.y + p.y * scale;
    const isRoot = person.managerId == null || !byId.has(person.managerId);
    const accent = departmentColor(person.department);
    const border = highlighted || isRoot ? "#f59e0b" : "#475569";
    const lines = [
      { text: fitLabel(person.name), size: 15, weight: 700, fill: "#ffffff" },
    ];
    if (person.title) {
      lines.push({ text: fitLabel(person.title), size: 12, weight: 400, fill: "#cbd5e1" });
    }
    if (person.department) {
      lines.push({ text: fitLabel(person.department), size: 11, weight: 600, fill: accent });
    }
    const lineHeight = 20;
    const firstBaseline = boxH / 2 - ((lines.length - 1) * lineHeight) / 2;
    return (
      <g key={p.id} transform={`translate(${sx} ${sy})`}>
        <rect
          width={boxW}
          height={boxH}
          rx={8}
          fill="#1e293b"
          fillOpacity={0.95}
          stroke={border}
          strokeWidth={highlighted || isRoot ? 2.5 : 1.5}
        />
        <rect width={boxW} height={Math.max(4, boxH * 0.09)} rx={4} fill={accent} opacity={0.9} />
        {lines.map((line, i) => (
          <text
            key={i}
            x={boxW / 2}
            y={firstBaseline + i * lineHeight}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={line.size}
            fontWeight={line.weight}
            fill={line.fill}
          >
            {line.text}
          </text>
        ))}
      </g>
    );
  });

  return (
    <g key={chart.id}>
      <text
        x={anchor.x}
        y={anchor.y - 16}
        textAnchor="middle"
        fontSize={17}
        fontWeight={700}
        fill="#f1f5f9"
      >
        {fitLabel(chart.name, 40)}
      </text>
      {boxes.length === 0 ? (
        <g transform={`translate(${anchor.x - boxW / 2} ${anchor.y})`}>
          <rect
            width={boxW}
            height={boxH}
            rx={8}
            fill="none"
            stroke="#475569"
            strokeWidth={1.5}
            strokeDasharray="8 5"
          />
          <text
            x={boxW / 2}
            y={boxH / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={13}
            fill="#94a3b8"
          >
            Empty chart — add people
          </text>
        </g>
      ) : (
        <>
          {connectors}
          {boxes}
        </>
      )}
      {highlighted && boxes.length > 0 && (
        <rect
          x={anchor.x - (layout.widthIn * scale) / 2 - 8}
          y={anchor.y - 8}
          width={layout.widthIn * scale + 16}
          height={layout.heightIn * scale + 16}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="10 6"
          rx={10}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/** Register (or replace) the 2D draw routine for a symbol domain. */
export function registerDrawRoutine(domain, routine) {
  if (typeof domain !== "string" || !domain.trim()) {
    throw new Error("Draw routine domain must be a non-empty string.");
  }
  if (typeof routine !== "function") throw new Error("Draw routine must be a function.");
  routines.set(domain, routine);
}

/** The registered 2D draw routine for a domain, or undefined. */
export function getDrawRoutine(domain) {
  return routines.get(domain);
}

/**
 * Render one registered symbol instance as SVG.
 * Unknown symbols degrade to the default rect + label instead of vanishing.
 */
export function renderSymbol2D(domain, symbolId, instance, ctx) {
  const symbol = (symbolId && findSymbol(domain, symbolId)) || null;
  const routine = symbol?.draw2D || routines.get(domain) || drawDefaultSymbol;
  const safeSymbol = symbol || {
    id: symbolId || "unknown",
    label: symbolId || "Unknown",
    widthIn: 24,
    depthIn: 24,
  };
  return routine({ symbol: safeSymbol, instance, ...ctx });
}
