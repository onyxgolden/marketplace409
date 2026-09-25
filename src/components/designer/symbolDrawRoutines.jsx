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
import { pieceSize } from "@/domains/roomDesigner/designerDocument";
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
  // Placed pieces may carry per-piece size overrides (see RESIZE_FURNITURE);
  // fall back to the catalog nominal size otherwise.
  const { widthIn, depthIn } = pieceSize(instance);
  const w = widthIn * scale;
  const h = depthIn * scale;
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

/**
 * Building-element symbol: plan-view doors, windows, stairs, and
 * structural elements. Glyph-driven (symbol.glyph) like the piping
 * routine; coordinates are centered on the symbol footprint, hw/hh are
 * half width/depth in screen px.
 * ctx: { symbol, instance, toScreen, scale, highlighted }
 */
export function drawBuildingElementSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const c = toScreen({ x: instance.x, y: instance.y });
  // Per-instance footprint override (placeSymbol widthIn/depthIn) wins;
  // otherwise the catalog nominal size.
  const hw = ((instance.widthIn ?? symbol.widthIn) * scale) / 2;
  const hh = ((instance.depthIn ?? symbol.depthIn) * scale) / 2;
  const stroke = selectionStroke(highlighted, "#e5e7eb");
  const sw = highlighted ? 3 : 2;
  const fill = symbol.color || "#d6a35c";

  const glyph = (() => {
    switch (symbol.glyph) {
      case "door-single": // opening + leaf + quarter swing arc
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" stroke={stroke} strokeWidth={sw} />
            <line x1={-hw} y1={-hh} x2={-hw} y2={hh} stroke={stroke} strokeWidth={sw + 1} />
            <path d={`M ${-hw} ${-hh} A ${hw * 2} ${hw * 2} 0 0 1 ${hw} ${-hh}`} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.8} />
            <line x1={-hw} y1={-hh} x2={hw} y2={-hh} stroke={fill} strokeWidth={sw} />
          </g>
        );
      case "door-double":
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" stroke={stroke} strokeWidth={sw} />
            <path d={`M ${-hw} ${-hh} A ${hw} ${hw} 0 0 1 0 ${-hh}`} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.8} />
            <path d={`M ${hw} ${-hh} A ${hw} ${hw} 0 0 0 0 ${-hh}`} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.8} />
            <line x1={-hw} y1={-hh} x2={0} y2={-hh} stroke={fill} strokeWidth={sw} />
            <line x1={0} y1={-hh} x2={hw} y2={-hh} stroke={fill} strokeWidth={sw} />
          </g>
        );
      case "door-sliding": // two overlapping panels
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" stroke={stroke} strokeWidth={sw} />
            <rect x={-hw} y={-hh} width={hw * 1.15} height={hh * 2} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={1.25} />
            <rect x={-hw * 0.15} y={-hh} width={hw * 1.15} height={hh * 2} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={1.25} />
          </g>
        );
      case "door-pocket": // opening + dashed pocket in the wall
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" stroke={stroke} strokeWidth={sw} />
            <rect x={hw * 0.1} y={-hh * 1.8} width={hw * 1.7} height={hh * 3.6} fill="none" stroke={stroke} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.8} />
            <line x1={-hw} y1={-hh} x2={-hw} y2={hh} stroke={fill} strokeWidth={sw} />
          </g>
        );
      case "door-bifold": // zigzag leaves
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" stroke={stroke} strokeWidth={sw} />
            <polyline
              points={`${-hw},${-hh} ${-hw / 2},${hh} 0,${-hh} ${hw / 2},${hh} ${hw},${-hh}`}
              fill="none" stroke={fill} strokeWidth={sw} strokeLinejoin="round"
            />
          </g>
        );
      case "window-single": // frame + one horizontal meeting rail
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.25} stroke={stroke} strokeWidth={sw} />
            <line x1={-hw} y1={0} x2={hw} y2={0} stroke={stroke} strokeWidth={1.5} />
          </g>
        );
      case "window-double": // frame + meeting rail + sash lines
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.25} stroke={stroke} strokeWidth={sw} />
            <line x1={-hw} y1={0} x2={hw} y2={0} stroke={stroke} strokeWidth={1.5} />
            <rect x={-hw + 3} y={-hh + 3} width={hw * 2 - 6} height={hh - 3} fill="none" stroke={stroke} strokeWidth={1} opacity={0.7} />
            <rect x={-hw + 3} y={3} width={hw * 2 - 6} height={hh - 3} fill="none" stroke={stroke} strokeWidth={1} opacity={0.7} />
          </g>
        );
      case "window-casement": // frame + vertical mullions (side-hinged)
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.25} stroke={stroke} strokeWidth={sw} />
            <line x1={-hw / 3} y1={-hh} x2={-hw / 3} y2={hh} stroke={stroke} strokeWidth={1.5} />
            <line x1={hw / 3} y1={-hh} x2={hw / 3} y2={hh} stroke={stroke} strokeWidth={1.5} />
          </g>
        );
      case "window-sliding":
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.25} stroke={stroke} strokeWidth={sw} />
            <line x1={-hw * 0.1} y1={-hh} x2={-hw * 0.1} y2={hh} stroke={stroke} strokeWidth={1.5} />
            <line x1={hw * 0.25} y1={-hh} x2={hw * 0.25} y2={hh} stroke={stroke} strokeWidth={1.5} />
          </g>
        );
      case "window-picture": // clean frame, no mullions
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.25} stroke={stroke} strokeWidth={sw + 1} />
          </g>
        );
      case "window-awning": // frame + horizontal lights + top hinge ticks
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.25} stroke={stroke} strokeWidth={sw} />
            <line x1={-hw} y1={-hh / 3} x2={hw} y2={-hh / 3} stroke={stroke} strokeWidth={1.5} />
            <line x1={-hw} y1={hh / 3} x2={hw} y2={hh / 3} stroke={stroke} strokeWidth={1.5} />
            <line x1={-hw} y1={-hh} x2={-hw} y2={-hh - 5} stroke={stroke} strokeWidth={1.5} />
            <line x1={hw} y1={-hh} x2={hw} y2={-hh - 5} stroke={stroke} strokeWidth={1.5} />
          </g>
        );
      case "stairs-straight": {
        const treads = Math.max(3, Math.min(9, Math.round(hw / 7)));
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.2} stroke={stroke} strokeWidth={sw} />
            {Array.from({ length: treads - 1 }, (_, i) => {
              const x = -hw + ((i + 1) * hw * 2) / treads;
              return <line key={i} x1={x} y1={-hh} x2={x} y2={hh} stroke={stroke} strokeWidth={1.25} />;
            })}
            <line x1={-hw + 6} y1={0} x2={hw - 10} y2={0} stroke={stroke} strokeWidth={1.5} />
            <polygon points={`${hw - 10},${-4} ${hw - 10},${4} ${hw - 3},0`} fill={stroke} />
          </g>
        );
      }
      case "stairs-l": // L footprint: two runs with a landing
        return (
          <g>
            <polygon
              points={`${-hw},${-hh} ${hw * 0.25},${-hh} ${hw * 0.25},${hh * 0.1} ${hw},${hh * 0.1} ${hw},${hh} ${-hw},${hh}`}
              fill={fill} fillOpacity={0.2} stroke={stroke} strokeWidth={sw} strokeLinejoin="round"
            />
            {Array.from({ length: 5 }, (_, i) => {
              const x = -hw + ((i + 1) * hw * 1.25) / 6;
              return <line key={`a${i}`} x1={x} y1={-hh} x2={x} y2={hh * 0.1} stroke={stroke} strokeWidth={1.25} />;
            })}
            {Array.from({ length: 3 }, (_, i) => {
              const y = hh * 0.1 + ((i + 1) * hh * 0.9) / 4;
              return <line key={`b${i}`} x1={hw * 0.25} y1={y} x2={hw} y2={y} stroke={stroke} strokeWidth={1.25} />;
            })}
            <polygon points={`${hw - 4},${hh * 0.1 - 8} ${hw - 4},${hh * 0.1 + 2} ${hw + 3},${hh * 0.1 - 3}`} fill={stroke} />
          </g>
        );
      case "stairs-u": // U footprint: two parallel runs
        return (
          <g>
            <polygon
              points={`${-hw},${-hh} ${hw},${-hh} ${hw},${hh} ${-hw},${hh} ${-hw},${hh * 0.35} ${hw * 0.55},${hh * 0.35} ${hw * 0.55},${-hh * 0.35} ${-hw},${-hh * 0.35}`}
              fill={fill} fillOpacity={0.2} stroke={stroke} strokeWidth={sw} strokeLinejoin="round"
            />
            {Array.from({ length: 6 }, (_, i) => {
              const x = -hw + ((i + 1) * hw * 2) / 7;
              return <line key={i} x1={x} y1={-hh} x2={x} y2={-hh * 0.35} stroke={stroke} strokeWidth={1.25} />;
            })}
            {Array.from({ length: 6 }, (_, i) => {
              const x = -hw + ((i + 1) * hw * 2) / 7;
              return <line key={i} x1={x} y1={hh * 0.35} x2={x} y2={hh} stroke={stroke} strokeWidth={1.25} />;
            })}
          </g>
        );
      case "railing": {
        const posts = Math.max(2, Math.round(hw / 12));
        return (
          <g>
            <line x1={-hw} y1={0} x2={hw} y2={0} stroke={stroke} strokeWidth={sw + 1} />
            {Array.from({ length: posts }, (_, i) => {
              const x = -hw + (i * hw * 2) / Math.max(1, posts - 1);
              return <line key={i} x1={x} y1={-hh} x2={x} y2={hh} stroke={stroke} strokeWidth={1.25} />;
            })}
          </g>
        );
      }
      case "column":
        return (
          <g>
            <circle r={Math.min(hw, hh)} fill={fill} fillOpacity={0.5} stroke={stroke} strokeWidth={sw} />
            <circle r={Math.min(hw, hh) * 0.45} fill="none" stroke={stroke} strokeWidth={1.25} />
          </g>
        );
      case "fireplace":
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.3} stroke={stroke} strokeWidth={sw} />
            <rect x={-hw * 0.55} y={-hh * 0.5} width={hw * 1.1} height={hh} fill="#1f2937" stroke={stroke} strokeWidth={1.25} />
            <line x1={-hw} y1={hh} x2={hw} y2={hh} stroke={stroke} strokeWidth={1.5} strokeDasharray="5 3" opacity={0.8} />
          </g>
        );
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

/**
 * Site/outdoor symbol: hardscape surfaces, site structures, landscape.
 * Glyph-driven (symbol.glyph); same ctx contract as the other routines.
 */
export function drawSiteOutdoorSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const c = toScreen({ x: instance.x, y: instance.y });
  const hw = (symbol.widthIn * scale) / 2;
  const hh = (symbol.depthIn * scale) / 2;
  const stroke = selectionStroke(highlighted, "#e5e7eb");
  const sw = highlighted ? 3 : 2;
  const fill = symbol.color || "#a3835b";

  const glyph = (() => {
    switch (symbol.glyph) {
      case "deck": {
        const planks = Math.max(3, Math.min(10, Math.round(hh / 6)));
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />
            {Array.from({ length: planks - 1 }, (_, i) => {
              const y = -hh + ((i + 1) * hh * 2) / planks;
              return <line key={i} x1={-hw} y1={y} x2={hw} y2={y} stroke={stroke} strokeWidth={1} opacity={0.7} />;
            })}
          </g>
        );
      }
      case "patio": {
        const nx = Math.max(2, Math.round(hw / 14));
        const ny = Math.max(2, Math.round(hh / 14));
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />
            {Array.from({ length: nx - 1 }, (_, i) => {
              const x = -hw + ((i + 1) * hw * 2) / nx;
              return <line key={`x${i}`} x1={x} y1={-hh} x2={x} y2={hh} stroke={stroke} strokeWidth={1} opacity={0.6} />;
            })}
            {Array.from({ length: ny - 1 }, (_, i) => {
              const y = -hh + ((i + 1) * hh * 2) / ny;
              return <line key={`y${i}`} x1={-hw} y1={y} x2={hw} y2={y} stroke={stroke} strokeWidth={1} opacity={0.6} />;
            })}
          </g>
        );
      }
      case "driveway":
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />
            <line x1={0} y1={-hh} x2={0} y2={hh} stroke={stroke} strokeWidth={1.25} strokeDasharray="6 4" opacity={0.8} />
          </g>
        );
      case "walkway": {
        const joints = Math.max(2, Math.round(hw / 16));
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />
            {Array.from({ length: joints - 1 }, (_, i) => {
              const x = -hw + ((i + 1) * hw * 2) / joints;
              return <line key={i} x1={x} y1={-hh} x2={x} y2={hh} stroke={stroke} strokeWidth={1.25} />;
            })}
          </g>
        );
      }
      case "fence": {
        const posts = Math.max(2, Math.round(hw / 10));
        return (
          <g>
            <line x1={-hw} y1={-hh / 2} x2={hw} y2={-hh / 2} stroke={stroke} strokeWidth={1.5} />
            <line x1={-hw} y1={hh / 2} x2={hw} y2={hh / 2} stroke={stroke} strokeWidth={1.5} />
            {Array.from({ length: posts }, (_, i) => {
              const x = -hw + (i * hw * 2) / Math.max(1, posts - 1);
              return <line key={i} x1={x} y1={-hh} x2={x} y2={hh} stroke={fill} strokeWidth={sw} />;
            })}
          </g>
        );
      }
      case "shed":
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={fill} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />
            <line x1={-hw} y1={-hh} x2={hw} y2={hh} stroke={stroke} strokeWidth={1.25} opacity={0.8} />
            <line x1={hw} y1={-hh} x2={-hw} y2={hh} stroke={stroke} strokeWidth={1.25} opacity={0.8} />
            <line x1={0} y1={hh * 0.2} x2={0} y2={hh} stroke={stroke} strokeWidth={1.5} />
          </g>
        );
      case "garden-bed":
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={Math.min(hw, hh) * 0.4} fill={fill} fillOpacity={0.3} stroke={stroke} strokeWidth={sw} />
            <circle cx={-hw * 0.5} cy={-hh * 0.3} r={3} fill={fill} />
            <circle cx={0} cy={hh * 0.25} r={3.5} fill={fill} />
            <circle cx={hw * 0.5} cy={-hh * 0.25} r={3} fill={fill} />
            <circle cx={hw * 0.15} cy={-hh * 0.5} r={2.5} fill={fill} />
          </g>
        );
      case "pool-rect":
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={6} fill={fill} fillOpacity={0.45} stroke={stroke} strokeWidth={sw} />
            <path
              d={`M ${-hw + 8} 0 q 8 -5 16 0 t 16 0 t 16 0 t 16 0`}
              fill="none" stroke="#e0f2fe" strokeWidth={1.5} opacity={0.9}
            />
          </g>
        );
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

/**
 * MEP fixture symbol: electrical devices and plumbing fixtures.
 * Device glyphs are drawn oversized (the CAD-symbol convention) so they
 * stay legible on the plan. Glyph-driven (symbol.glyph).
 */
export function drawMepFixtureSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const c = toScreen({ x: instance.x, y: instance.y });
  const hw = (symbol.widthIn * scale) / 2;
  const hh = (symbol.depthIn * scale) / 2;
  const stroke = selectionStroke(highlighted, "#e5e7eb");
  const sw = highlighted ? 3 : 2;
  const accent = highlighted ? "#f59e0b" : symbol.color || "#e3c878";

  const glyph = (() => {
    switch (symbol.glyph) {
      case "outlet-duplex": // circle + two duplex slot pairs
        return (
          <g>
            <circle r={Math.min(hw, hh)} fill="#1f2937" stroke={stroke} strokeWidth={sw} />
            <line x1={-hw * 0.35} y1={-hh * 0.45} x2={-hw * 0.35} y2={-hh * 0.05} stroke={accent} strokeWidth={1.5} />
            <line x1={-hw * 0.1} y1={-hh * 0.45} x2={-hw * 0.1} y2={-hh * 0.05} stroke={accent} strokeWidth={1.5} />
            <line x1={hw * 0.1} y1={hh * 0.05} x2={hw * 0.1} y2={hh * 0.45} stroke={accent} strokeWidth={1.5} />
            <line x1={hw * 0.35} y1={hh * 0.05} x2={hw * 0.35} y2={hh * 0.45} stroke={accent} strokeWidth={1.5} />
          </g>
        );
      case "switch": // S-style toggle
        return (
          <g>
            <circle r={Math.min(hw, hh)} fill="#1f2937" stroke={stroke} strokeWidth={sw} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={Math.min(hw, hh)} fontWeight={700} fill={accent}>
              S
            </text>
          </g>
        );
      case "smoke-detector":
        return (
          <g>
            <circle r={Math.min(hw, hh)} fill="#1f2937" stroke={stroke} strokeWidth={sw} />
            <circle r={Math.min(hw, hh) * 0.5} fill="none" stroke={accent} strokeWidth={1.5} />
            <circle r={1.75} fill={accent} />
          </g>
        );
      case "load-center": // panel box + door seam + latch
        return (
          <g>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="#1f2937" stroke={stroke} strokeWidth={sw} />
            <line x1={hw * 0.55} y1={-hh} x2={hw * 0.55} y2={hh} stroke={accent} strokeWidth={1.5} />
            <circle cx={hw * 0.32} cy={0} r={1.75} fill={accent} />
          </g>
        );
      case "hose-bib":
        return (
          <g>
            <circle r={Math.min(hw, hh) * 0.7} fill="#1f2937" stroke={stroke} strokeWidth={sw} />
            <line x1={0} y1={0} x2={hw} y2={hh * 0.6} stroke={accent} strokeWidth={sw} strokeLinecap="round" />
            <circle cx={-hw * 0.2} cy={-hh * 0.2} r={1.75} fill={accent} />
          </g>
        );
      case "floor-drain": // circle + grate cross
        return (
          <g>
            <circle r={Math.min(hw, hh)} fill="#1f2937" stroke={stroke} strokeWidth={sw} />
            <circle r={Math.min(hw, hh) * 0.62} fill="none" stroke={accent} strokeWidth={1.5} />
            <line x1={-hw * 0.62} y1={0} x2={hw * 0.62} y2={0} stroke={accent} strokeWidth={1.25} />
            <line x1={0} y1={-hh * 0.62} x2={0} y2={hh * 0.62} stroke={accent} strokeWidth={1.25} />
          </g>
        );
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

// ---------------------------------------------------------------------------
// Declarative P&ID glyphs for the wider process-equipment catalog.
//
// Each glyph is a base outline plus a list of marks drawn inside it, the way
// P&ID symbols are built (a pump circle + discharge triangle, a column + trays,
// a reactor + catalyst hatching, a driver box + "M"/"ST"/"GT"). Specs are data;
// renderProcessGlyphSpec is the only code. "text:XX" draws a letter code.
// ---------------------------------------------------------------------------
export const PROCESS_GLYPH_SPECS = Object.freeze({
  // pumps
  "pump-vertical-can": { base: "pump", marks: ["ring"] },
  "pump-vertical-inline": { base: "pump", marks: ["vline"] },
  "pump-submersible": { base: "pump", marks: ["wave"] },
  "pump-sump": { base: "pump", marks: ["boot"] },
  "pump-gear": { base: "roundrect", marks: ["lobes", "plus"] },
  "pump-screw": { base: "capsule", marks: ["zigzag"] },
  "pump-metering": { base: "pump", marks: ["diaphragm"] },
  "pump-progressive-cavity": { base: "capsule", marks: ["wave"] },
  "pump-plunger": { base: "rect", marks: ["pistons"] },
  // compressors & vacuum
  "compressor-screw": { base: "trapezoid", marks: ["zigzag"] },
  "compressor-axial": { base: "trapezoid", marks: ["vlines3"] },
  "blower-lobe": { base: "circle", marks: ["lobes"] },
  "vacuum-liquid-ring": { base: "circle", marks: ["ring", "text:VAC"] },
  "ejector": { base: "venturi", marks: ["arrow"] },
  "air-package": { base: "rect", marks: ["hline", "text:IA"] },
  // drivers
  "motor": { base: "circle", marks: ["shaft", "text:M"] },
  "turbine-steam": { base: "trapezoid-rev", marks: ["shaft", "text:ST"] },
  "turbine-gas": { base: "trapezoid-rev", marks: ["shaft", "vlines3", "text:GT"] },
  "expander": { base: "trapezoid-rev", marks: ["text:EX"] },
  "engine-diesel": { base: "rect", marks: ["shaft", "text:DE"] },
  "gearbox": { base: "rect", marks: ["lobes", "shaft"] },
  // fired equipment
  "heater-cylindrical": { base: "circle", marks: ["ring", "flame"] },
  "furnace-reformer": { base: "rect", marks: ["vlines5", "flame"] },
  "furnace-cracking": { base: "rect", marks: ["zigzag", "flame"] },
  "boiler-firetube": { base: "capsule", marks: ["hlines3", "flame"] },
  "boiler-waste-heat": { base: "rect", marks: ["zigzag", "arrow"] },
  "thermal-oxidizer": { base: "capsule", marks: ["flame", "text:TO"] },
  "flare": { base: "circle", marks: ["flame", "dot"] },
  "stack": { base: "circle", marks: ["ring", "dot"] },
  // heat exchangers
  "hx-kettle": { base: "kettle", marks: ["hline"] },
  "hx-double-pipe": { base: "hairpin", marks: [] },
  "hx-spiral": { base: "circle", marks: ["spiral"] },
  "hx-plate-fin": { base: "rect", marks: ["hatch"] },
  "hx-condenser": { base: "capsule", marks: ["hlines3", "boot"] },
  "heater-electric": { base: "capsule", marks: ["zigzag", "text:EH"] },
  // columns & reactors
  "column-packed": { base: "circle", marks: ["dots"] },
  "column-absorber": { base: "circle", marks: ["hlines3"] },
  "column-stripper": { base: "circle", marks: ["hline", "arrow"] },
  "column-vacuum": { base: "circle", marks: ["ring", "hline"] },
  "reactor-fixed-bed": { base: "circle", marks: ["hatch"] },
  "reactor-fluidized": { base: "circle", marks: ["ring", "dots"] },
  "regenerator": { base: "circle", marks: ["dots", "flame"] },
  "reactor-tubular": { base: "rect", marks: ["hlines5"] },
  // vessels & storage
  "drum-knockout": { base: "circle", marks: ["cross"] },
  "separator-three-phase": { base: "capsule", marks: ["baffle", "boot"] },
  "accumulator": { base: "capsule", marks: ["boot"] },
  "tank-dome-roof": { base: "circle", marks: ["ring", "ring-inner"] },
  "tank-floating-roof": { base: "circle", marks: ["ring", "plus"] },
  "sphere": { base: "circle", marks: ["legs", "cross"] },
  "bullet": { base: "capsule", marks: ["saddles", "cross"] },
  "tank-day": { base: "circle", marks: ["hline"] },
  // separation & filtration
  "coalescer": { base: "capsule", marks: ["dots"] },
  "desalter": { base: "capsule", marks: ["hline", "zigzag"] },
  "dryer-desiccant": { base: "twin", marks: ["dots"] },
  "evaporator": { base: "circle", marks: ["ring", "wave"] },
  "crystallizer": { base: "circle", marks: ["diamond"] },
  "filter-press": { base: "rect", marks: ["vlines5"] },
  "baghouse": { base: "rect", marks: ["circles"] },
  "precipitator": { base: "rect", marks: ["vlines3", "zigzag"] },
  "scrubber": { base: "circle", marks: ["dots", "wave"] },
  // solids handling
  "conveyor-screw": { base: "capsule", marks: ["zigzag", "shaft"] },
  "elevator-bucket": { base: "rect", marks: ["vline", "circles"] },
  "rotary-valve": { base: "circle", marks: ["plus", "cross"] },
  "crusher": { base: "triangle", marks: ["cross"] },
  "mill": { base: "capsule", marks: ["circles"] },
  "weigh-feeder": { base: "rect", marks: ["arrow", "text:W"] },
  // mixing
  "mixer-inline": { base: "rect", marks: ["impeller", "shaft"] },
  "blender-ribbon": { base: "capsule", marks: ["spiral"] },
  // utilities & environmental
  "chiller": { base: "rect", marks: ["zigzag", "text:CH"] },
  "deaerator": { base: "capsule", marks: ["dome"] },
  "water-treatment": { base: "rect", marks: ["circles", "text:WT"] },
  "api-separator": { base: "rect", marks: ["baffle", "wave"] },
  // valves & instruments
  "valve-shutdown": { base: "bowtie", marks: ["actuator-box"] },
  "valve-motor-operated": { base: "bowtie", marks: ["actuator-motor"] },
  "rupture-disc": { base: "disc", marks: [] },
  "instrument-temperature": { base: "bubble", marks: [] },
  "instrument-level": { base: "rect", marks: ["hlines3", "text:LG"] },
  "analyzer": { base: "rect", marks: ["bubble-inset"] },
});

/** Render a declarative process glyph spec. Coordinates are local to the symbol center. */
function renderProcessGlyphSpec(spec, { hw, hh, stroke, sw, accent, body, symbol }) {
  const r = Math.min(hw, hh);
  const line = { stroke, strokeWidth: sw, fill: "none" };
  const thin = { stroke: accent, strokeWidth: Math.max(1, sw - 0.5), fill: "none" };
  const base = (() => {
    switch (spec.base) {
      case "circle":
        return <circle r={r} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "rect":
        return <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "roundrect":
        return <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={hh * 0.4} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "capsule":
        return <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={hh} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "pump":
        return (
          <g>
            <circle r={r} fill={body} stroke={stroke} strokeWidth={sw} />
            <line x1={0} y1={-r} x2={r} y2={-r} stroke={stroke} strokeWidth={sw} />
            <polygon points={`${-r * 0.4},${-r * 0.5} ${-r * 0.4},${r * 0.5} ${r * 0.5},0`} fill={accent} fillOpacity={0.55} />
          </g>
        );
      case "trapezoid": // converging: compressor
        return <polygon points={`${-hw},${-hh} ${hw},${-hh * 0.45} ${hw},${hh * 0.45} ${-hw},${hh}`} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "trapezoid-rev": // diverging: turbine / expander
        return <polygon points={`${-hw},${-hh * 0.45} ${hw},${-hh} ${hw},${hh} ${-hw},${hh * 0.45}`} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "triangle":
        return <polygon points={`${-hw},${-hh} ${hw},${-hh} 0,${hh}`} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "venturi":
        return <polygon points={`${-hw},${-hh} ${-hw * 0.1},${-hh * 0.3} ${hw},${-hh} ${hw},${hh} ${-hw * 0.1},${hh * 0.3} ${-hw},${hh}`} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "kettle":
        return (
          <g>
            <rect x={-hw} y={-hh * 0.5} width={hw * 0.6} height={hh} fill={body} stroke={stroke} strokeWidth={sw} />
            <rect x={-hw * 0.4} y={-hh} width={hw * 1.4} height={hh * 2} rx={hh} fill={body} stroke={stroke} strokeWidth={sw} />
          </g>
        );
      case "hairpin":
        return (
          <g {...line}>
            <path d={`M ${-hw} ${-hh * 0.6} L ${hw * 0.6} ${-hh * 0.6} A ${hh * 0.6} ${hh * 0.6} 0 0 1 ${hw * 0.6} ${hh * 0.6} L ${-hw} ${hh * 0.6}`} />
            <path d={`M ${-hw} ${-hh * 0.25} L ${hw * 0.6} ${-hh * 0.25} A ${hh * 0.25} ${hh * 0.25} 0 0 1 ${hw * 0.6} ${hh * 0.25} L ${-hw} ${hh * 0.25}`} stroke={accent} />
          </g>
        );
      case "twin":
        return (
          <g>
            <circle cx={-hw * 0.5} cy={0} r={Math.min(hw * 0.48, hh)} fill={body} stroke={stroke} strokeWidth={sw} />
            <circle cx={hw * 0.5} cy={0} r={Math.min(hw * 0.48, hh)} fill={body} stroke={stroke} strokeWidth={sw} />
          </g>
        );
      case "bowtie":
        return (
          <g {...line}>
            <line x1={-hw} y1={hh * 0.3} x2={hw} y2={hh * 0.3} />
            <polygon points={`${-hw},${-hh * 0.1} ${-hw},${hh * 0.7} 0,${hh * 0.3}`} />
            <polygon points={`${hw},${-hh * 0.1} ${hw},${hh * 0.7} 0,${hh * 0.3}`} />
            <line x1={0} y1={hh * 0.3} x2={0} y2={-hh * 0.4} />
          </g>
        );
      case "disc":
        return (
          <g {...line}>
            <line x1={-hw} y1={-hh} x2={-hw} y2={hh} />
            <line x1={hw} y1={-hh} x2={hw} y2={hh} />
            <path d={`M ${-hw} ${-hh * 0.7} Q ${hw * 0.9} 0 ${-hw} ${hh * 0.7}`} stroke={accent} />
          </g>
        );
      case "bubble":
        return (
          <g>
            <circle r={r} fill={body} stroke={stroke} strokeWidth={sw} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(7, r * 0.8)} fontWeight={700} fill={accent}>
              {symbol.tagPrefix}
            </text>
          </g>
        );
      default:
        return <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={body} stroke={stroke} strokeWidth={sw} />;
    }
  })();

  const rows = (n, span = 0.7) => Array.from({ length: n }, (_, i) => -span + ((i + 1) * 2 * span) / (n + 1));
  const mark = (m, i) => {
    if (m.startsWith("text:")) {
      return (
        // Haloed in the body color so marks behind it (trays, coils,
        // flames) never strike through the letters.
        <text key={i} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(7, Math.min(r * 0.75, 16))} fontWeight={700} fill={accent} stroke={body} strokeWidth={3} paintOrder="stroke">
          {m.slice(5)}
        </text>
      );
    }
    switch (m) {
      case "ring": return <circle key={i} r={r * 0.75} {...thin} strokeDasharray="4 3" />;
      case "ring-inner": return <circle key={i} r={r * 0.45} {...thin} />;
      case "dot": return <circle key={i} r={Math.max(1.5, r * 0.14)} fill={accent} />;
      case "hline": return <line key={i} x1={-hw * 0.7} y1={0} x2={hw * 0.7} y2={0} {...thin} />;
      case "vline": return <line key={i} x1={0} y1={-hh * 0.8} x2={0} y2={hh * 0.8} {...thin} />;
      case "hlines3": return <g key={i}>{rows(3).map((f) => <line key={f} x1={-hw * 0.7} y1={hh * f} x2={hw * 0.7} y2={hh * f} {...thin} />)}</g>;
      case "hlines5": return <g key={i}>{rows(5, 0.8).map((f) => <line key={f} x1={-hw * 0.85} y1={hh * f} x2={hw * 0.85} y2={hh * f} {...thin} />)}</g>;
      case "vlines3": return <g key={i}>{rows(3).map((f) => <line key={f} x1={hw * f} y1={-hh * 0.7} x2={hw * f} y2={hh * 0.7} {...thin} />)}</g>;
      case "vlines5": return <g key={i}>{rows(5, 0.8).map((f) => <line key={f} x1={hw * f} y1={-hh * 0.75} x2={hw * f} y2={hh * 0.75} {...thin} />)}</g>;
      case "cross": return <g key={i} {...thin}><line x1={-r * 0.55} y1={-r * 0.55} x2={r * 0.55} y2={r * 0.55} /><line x1={-r * 0.55} y1={r * 0.55} x2={r * 0.55} y2={-r * 0.55} /></g>;
      case "plus": return <g key={i} {...thin}><line x1={-r * 0.6} y1={0} x2={r * 0.6} y2={0} /><line x1={0} y1={-r * 0.6} x2={0} y2={r * 0.6} /></g>;
      case "diamond": return <polygon key={i} points={`0,${-r * 0.55} ${r * 0.55},0 0,${r * 0.55} ${-r * 0.55},0`} {...thin} />;
      case "zigzag": {
        const n = 6;
        const pts = Array.from({ length: n + 1 }, (_, k) => `${-hw * 0.75 + (k * 1.5 * hw) / n},${k % 2 ? -hh * 0.45 : hh * 0.45}`);
        return <polyline key={i} points={pts.join(" ")} {...thin} />;
      }
      case "wave": return <path key={i} d={`M ${-hw * 0.7} 0 Q ${-hw * 0.35} ${-hh * 0.5} 0 0 T ${hw * 0.7} 0`} {...thin} />;
      case "spiral": return <path key={i} d={`M 0 0 m ${r * 0.1} 0 a ${r * 0.15} ${r * 0.15} 0 1 1 ${-r * 0.3} 0 a ${r * 0.35} ${r * 0.35} 0 1 1 ${r * 0.6} 0 a ${r * 0.55} ${r * 0.55} 0 1 1 ${-r * 1.0} 0`} {...thin} />;
      case "dots": return <g key={i}>{[-0.4, 0, 0.4].flatMap((fx) => [-0.4, 0, 0.4].map((fy) => <circle key={`${fx}${fy}`} cx={r * fx} cy={r * fy} r={Math.max(1, r * 0.07)} fill={accent} />))}</g>;
      case "hatch": return <g key={i}>{[-0.6, -0.3, 0, 0.3, 0.6].map((f) => <line key={f} x1={r * (f - 0.3)} y1={r * 0.5} x2={r * (f + 0.3)} y2={-r * 0.5} {...thin} />)}</g>;
      case "circles": return <g key={i}>{rows(4, 0.8).map((f) => <circle key={f} cx={hw * f} cy={0} r={Math.min(hh * 0.3, hw * 0.12)} {...thin} />)}</g>;
      case "lobes": return <g key={i}><circle cx={-r * 0.3} cy={0} r={r * 0.35} {...thin} /><circle cx={r * 0.3} cy={0} r={r * 0.35} {...thin} /></g>;
      case "flame": return <path key={i} d={`M ${-r * 0.25} ${r * 0.5} Q 0 ${-r * 0.6} ${r * 0.25} ${r * 0.5} Z`} fill={accent} fillOpacity={0.8} />;
      case "arrow": return <polygon key={i} points={`${hw * 0.2},${-hh * 0.3} ${hw * 0.2},${hh * 0.3} ${hw * 0.7},0`} fill={accent} />;
      case "shaft": return <line key={i} x1={hw} y1={0} x2={hw + Math.max(4, hw * 0.35)} y2={0} stroke={stroke} strokeWidth={sw + 1} />;
      case "boot": return <circle key={i} cx={0} cy={hh} r={Math.max(2, hh * 0.35)} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "dome": return <circle key={i} cx={-hw * 0.3} cy={-hh} r={Math.max(2, hh * 0.45)} fill={body} stroke={stroke} strokeWidth={sw} />;
      case "baffle": return <line key={i} x1={hw * 0.25} y1={-hh * 0.2} x2={hw * 0.25} y2={hh} {...thin} />;
      case "saddles": return <g key={i} {...thin}><line x1={-hw * 0.55} y1={-hh} x2={-hw * 0.55} y2={hh} /><line x1={hw * 0.55} y1={-hh} x2={hw * 0.55} y2={hh} /></g>;
      case "legs": return <g key={i}>{[0, 60, 120, 180, 240, 300].map((a) => <line key={a} transform={`rotate(${a})`} x1={r} y1={0} x2={r * 1.15} y2={0} stroke={stroke} strokeWidth={sw} />)}</g>;
      case "pistons": return <g key={i}>{[-0.55, 0, 0.55].map((f) => <rect key={f} x={hw * f - hw * 0.15} y={-hh} width={hw * 0.3} height={hh * 0.8} {...thin} />)}</g>;
      case "diaphragm": return <path key={i} d={`M ${-r * 0.6} ${-r * 0.9} A ${r * 0.6} ${r * 0.35} 0 0 1 ${r * 0.6} ${-r * 0.9}`} {...thin} />;
      case "impeller": return <g key={i} {...thin}><line x1={-r * 0.5} y1={-r * 0.3} x2={r * 0.5} y2={r * 0.3} /><line x1={-r * 0.5} y1={r * 0.3} x2={r * 0.5} y2={-r * 0.3} /></g>;
      case "actuator-box": return <rect key={i} x={-hw * 0.4} y={-hh} width={hw * 0.8} height={hh * 0.6} fill={accent} fillOpacity={0.35} stroke={stroke} strokeWidth={sw} />;
      case "actuator-motor": return <g key={i}><circle cx={0} cy={-hh * 0.7} r={hh * 0.35} fill={body} stroke={stroke} strokeWidth={sw} /><text x={0} y={-hh * 0.7} textAnchor="middle" dominantBaseline="central" fontSize={Math.max(6, hh * 0.45)} fontWeight={700} fill={accent}>M</text></g>;
      case "bubble-inset": return <g key={i}><circle r={r * 0.55} fill={body} stroke={accent} strokeWidth={sw} /><text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(6, r * 0.45)} fontWeight={700} fill={accent}>{symbol.tagPrefix}</text></g>;
      default: return null;
    }
  };

  return (
    <g>
      {base}
      {/* letter codes last, so their halo sits over every other mark */}
      {(spec.marks || []).map((m, i) => (m.startsWith("text:") ? null : mark(m, i)))}
      {(spec.marks || []).map((m, i) => (m.startsWith("text:") ? mark(m, i) : null))}
    </g>
  );
}

/**
 * Process equipment: P&ID-style glyphs (ISO 10628 / ISA-5.1 conventions,
 * simplified for plan view) drawn from symbol.glyph, with the equipment tag
 * (P-101, V-101, ...) under the symbol and the description beneath it.
 * ctx: { symbol, instance: {id,x,y,rotationDeg,tag,widthIn?,depthIn?}, toScreen, scale, highlighted }
 */
export function drawProcessEquipmentSymbol({ symbol, instance, toScreen, scale, highlighted }) {
  const c = toScreen({ x: instance.x, y: instance.y });
  const hw = ((instance.widthIn ?? symbol.widthIn) * scale) / 2;
  const hh = ((instance.depthIn ?? symbol.depthIn) * scale) / 2;
  const stroke = selectionStroke(highlighted, "#e2e8f0");
  const sw = highlighted ? 3 : 1.75;
  const accent = highlighted ? "#f59e0b" : symbol.color || "#60a5fa";
  const body = "#0f172a";
  const r = Math.min(hw, hh);
  const common = { stroke, strokeWidth: sw };

  const glyph = (() => {
    switch (symbol.glyph) {
      // ---- pumps & compressors ----
      case "pump-centrifugal": // circle casing + tangential discharge + base
        return (
          <g {...common}>
            <rect x={-hw} y={-hh * 0.35} width={hw * 0.9} height={hh * 0.7} fill={body} />
            <circle cx={hw * 0.45} cy={0} r={Math.min(hw * 0.5, hh)} fill={body} />
            <line x1={hw * 0.45} y1={-Math.min(hw * 0.5, hh)} x2={hw} y2={-Math.min(hw * 0.5, hh)} />
            <polygon points={`${hw * 0.25},${-hh * 0.4} ${hw * 0.25},${hh * 0.4} ${hw * 0.7},0`} fill={accent} stroke="none" />
          </g>
        );
      case "pump-pd": // casing with two meshing lobes
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={hh * 0.4} fill={body} />
            <circle cx={-hw * 0.3} cy={0} r={hh * 0.55} fill="none" stroke={accent} />
            <circle cx={hw * 0.3} cy={0} r={hh * 0.55} fill="none" stroke={accent} />
          </g>
        );
      case "compressor-centrifugal": // trapezoid (converging flow) + shaft
        return (
          <g {...common}>
            <polygon points={`${-hw},${-hh} ${hw * 0.6},${-hh * 0.45} ${hw * 0.6},${hh * 0.45} ${-hw},${hh}`} fill={body} />
            <line x1={hw * 0.6} y1={0} x2={hw} y2={0} />
            <line x1={-hw * 0.5} y1={-hh * 0.6} x2={-hw * 0.5} y2={hh * 0.6} stroke={accent} />
          </g>
        );
      case "compressor-recip": // frame + two cylinders
        return (
          <g {...common}>
            <rect x={-hw} y={-hh * 0.4} width={hw * 2} height={hh * 0.8} fill={body} />
            <rect x={-hw * 0.7} y={-hh} width={hw * 0.5} height={hh * 0.6} fill={body} stroke={accent} />
            <rect x={hw * 0.2} y={-hh} width={hw * 0.5} height={hh * 0.6} fill={body} stroke={accent} />
          </g>
        );
      case "blower": // circle + fan blades
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            {[0, 120, 240].map((a) => (
              <path key={a} transform={`rotate(${a})`} d={`M 0 0 Q ${r * 0.5} ${-r * 0.2} ${r * 0.8} ${r * 0.1}`} fill="none" stroke={accent} />
            ))}
          </g>
        );
      // ---- vessels & tanks ----
      case "vessel-vertical": // plan: circle with head seam
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <circle r={r * 0.72} fill="none" strokeDasharray="4 3" opacity={0.7} />
          </g>
        );
      case "vessel-horizontal": // capsule + saddles
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={hh} fill={body} />
            <line x1={-hw * 0.55} y1={-hh} x2={-hw * 0.55} y2={hh} stroke={accent} />
            <line x1={hw * 0.55} y1={-hh} x2={hw * 0.55} y2={hh} stroke={accent} />
          </g>
        );
      case "tank-cone-roof": // plan: circle + roof rafters to center
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            {[0, 45, 90, 135].map((a) => (
              <line key={a} transform={`rotate(${a})`} x1={-r} y1={0} x2={r} y2={0} opacity={0.45} strokeWidth={1} />
            ))}
            <circle r={r * 0.12} fill={accent} stroke="none" />
          </g>
        );
      case "column": // plan: circle + tray lines
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <line x1={-r * 0.7} y1={-r * 0.3} x2={r * 0.7} y2={-r * 0.3} stroke={accent} />
            <line x1={-r * 0.7} y1={r * 0.3} x2={r * 0.7} y2={r * 0.3} stroke={accent} />
          </g>
        );
      case "reactor": // circle + jacket ring + agitator cross
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <circle r={r * 0.8} fill="none" stroke={accent} />
            <line x1={-r * 0.45} y1={0} x2={r * 0.45} y2={0} />
            <line x1={0} y1={-r * 0.45} x2={0} y2={r * 0.45} />
          </g>
        );
      // ---- heat transfer ----
      case "hx-shell-tube": // shell + channel head + tube lines
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 1.7} height={hh * 2} rx={hh * 0.3} fill={body} />
            <rect x={hw * 0.7} y={-hh} width={hw * 0.3} height={hh * 2} fill={body} />
            <line x1={-hw * 0.9} y1={-hh * 0.35} x2={hw * 0.7} y2={-hh * 0.35} stroke={accent} />
            <line x1={-hw * 0.9} y1={hh * 0.35} x2={hw * 0.7} y2={hh * 0.35} stroke={accent} />
          </g>
        );
      case "hx-plate": // frame + plate pack
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={body} />
            {[-0.5, -0.25, 0, 0.25, 0.5].map((f) => (
              <line key={f} x1={-hw * 0.8} y1={hh * f * 1.6} x2={hw * 0.8} y2={hh * f * 1.6} stroke={accent} strokeWidth={1} />
            ))}
          </g>
        );
      case "hx-air-cooled": // bundle + fan circles
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={body} />
            <circle cx={-hw * 0.5} cy={0} r={Math.min(hw * 0.4, hh * 0.8)} fill="none" stroke={accent} />
            <circle cx={hw * 0.5} cy={0} r={Math.min(hw * 0.4, hh * 0.8)} fill="none" stroke={accent} />
          </g>
        );
      case "fired-heater": // box + burner flames
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={body} />
            {[-0.45, 0, 0.45].map((f) => (
              <path key={f} d={`M ${hw * f - r * 0.12} ${hh * 0.5} Q ${hw * f} ${-hh * 0.3} ${hw * f + r * 0.12} ${hh * 0.5} Z`} fill={accent} stroke="none" />
            ))}
          </g>
        );
      case "boiler": // shell + stack circle + flame
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={hh * 0.5} fill={body} />
            <circle cx={hw * 0.6} cy={0} r={hh * 0.35} fill="none" />
            <path d={`M ${-hw * 0.6} ${hh * 0.45} Q ${-hw * 0.4} ${-hh * 0.5} ${-hw * 0.2} ${hh * 0.45} Z`} fill={accent} stroke="none" />
          </g>
        );
      case "cooling-tower": // cell + fan
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={body} />
            <circle r={r * 0.6} fill="none" stroke={accent} />
            <line x1={-r * 0.6} y1={0} x2={r * 0.6} y2={0} stroke={accent} />
            <line x1={0} y1={-r * 0.6} x2={0} y2={r * 0.6} stroke={accent} />
          </g>
        );
      // ---- separation & filtration ----
      case "filter": // circle + dashed element
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <line x1={-r * 0.7} y1={0} x2={r * 0.7} y2={0} stroke={accent} strokeDasharray="3 2" />
          </g>
        );
      case "strainer": // body + mesh basket
        return (
          <g {...common}>
            <line x1={-hw} y1={0} x2={hw} y2={0} />
            <rect x={-hw * 0.5} y={-hh} width={hw} height={hh * 2} fill={body} />
            <path d={`M ${-hw * 0.3} ${-hh * 0.6} L 0 ${hh * 0.6} L ${hw * 0.3} ${-hh * 0.6}`} fill="none" stroke={accent} />
          </g>
        );
      case "cyclone": // circle + tangential inlet + vortex
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <line x1={-r} y1={-r} x2={0} y2={-r} />
            <circle r={r * 0.35} fill="none" stroke={accent} />
          </g>
        );
      case "centrifuge": // box + spinning bowl
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={4} fill={body} />
            <circle r={r * 0.65} fill="none" stroke={accent} />
            <path d={`M ${r * 0.65} 0 A ${r * 0.65} ${r * 0.65} 0 0 1 0 ${r * 0.65}`} fill="none" stroke={accent} strokeWidth={sw + 1} />
          </g>
        );
      // ---- mixing & handling ----
      case "agitator-tank": // circle + impeller
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <line x1={-r * 0.55} y1={0} x2={r * 0.55} y2={0} stroke={accent} strokeWidth={sw + 1} />
            <circle r={r * 0.1} fill={accent} stroke="none" />
          </g>
        );
      case "static-mixer": // pipe body + helical elements
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill={body} />
            <path d={`M ${-hw * 0.8} ${hh * 0.6} L ${-hw * 0.4} ${-hh * 0.6} L 0 ${hh * 0.6} L ${hw * 0.4} ${-hh * 0.6} L ${hw * 0.8} ${hh * 0.6}`} fill="none" stroke={accent} />
          </g>
        );
      case "conveyor": // belt between pulleys
        return (
          <g {...common}>
            <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} rx={hh} fill={body} />
            <circle cx={-hw + hh} cy={0} r={hh * 0.6} fill="none" stroke={accent} />
            <circle cx={hw - hh} cy={0} r={hh * 0.6} fill="none" stroke={accent} />
          </g>
        );
      case "hopper": // plan: square outlet inside circle
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <rect x={-r * 0.25} y={-r * 0.25} width={r * 0.5} height={r * 0.5} fill="none" stroke={accent} />
            {[45, 135, 225, 315].map((a) => (
              <line key={a} transform={`rotate(${a})`} x1={r * 0.35} y1={0} x2={r * 0.95} y2={0} strokeWidth={1} opacity={0.6} />
            ))}
          </g>
        );
      // ---- valves & instruments ----
      case "control-valve": // bowtie + diaphragm actuator
        return (
          <g {...common}>
            <line x1={-hw} y1={hh * 0.3} x2={hw} y2={hh * 0.3} />
            <polygon points={`${-hw},${-hh * 0.1} ${-hw},${hh * 0.7} 0,${hh * 0.3}`} fill="none" />
            <polygon points={`${hw},${-hh * 0.1} ${hw},${hh * 0.7} 0,${hh * 0.3}`} fill="none" />
            <line x1={0} y1={hh * 0.3} x2={0} y2={-hh * 0.5} />
            <path d={`M ${-hw * 0.5} ${-hh * 0.5} A ${hw * 0.5} ${hh * 0.45} 0 0 1 ${hw * 0.5} ${-hh * 0.5} Z`} fill={accent} fillOpacity={0.35} />
          </g>
        );
      case "relief-valve": // angle body + spring
        return (
          <g {...common}>
            <polygon points={`${-hw},${-hh * 0.5} ${-hw},${hh * 0.5} 0,0`} fill="none" />
            <polygon points={`${-hh * 0.5},${hh} ${hh * 0.5},${hh} 0,0`} fill="none" />
            <path d={`M 0 0 L ${hw * 0.4} ${-hh * 0.2} L ${-hw * 0.1} ${-hh * 0.45} L ${hw * 0.4} ${-hh * 0.7} L 0 ${-hh}`} fill="none" stroke={accent} />
          </g>
        );
      case "flow-meter": // inline body + "M"
        return (
          <g {...common}>
            <line x1={-hw} y1={0} x2={hw} y2={0} />
            <rect x={-hw * 0.6} y={-hh} width={hw * 1.2} height={hh * 2} fill={body} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(8, hh * 1.1)} fontWeight={700} fill={accent} stroke="none">M</text>
          </g>
        );
      case "instrument": // ISA field-instrument bubble
        return (
          <g {...common}>
            <circle r={r} fill={body} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(7, r * 0.8)} fontWeight={700} fill={accent} stroke="none">
              {symbol.tagPrefix}
            </text>
          </g>
        );
      default: {
        const spec = PROCESS_GLYPH_SPECS[symbol.glyph];
        if (spec) return renderProcessGlyphSpec(spec, { hw, hh, stroke, sw, accent, body, symbol });
        return <rect x={-hw} y={-hh} width={hw * 2} height={hh * 2} fill="none" {...common} />;
      }
    }
  })();

  // Labels sit under the body in the symbol's own frame (they rotate with
  // it), so the offset is the half-DEPTH — using the width would strand the
  // tag far below long horizontal pieces (drums, exchangers, conveyors).
  // Marks that hang below the body (a boot, sphere legs) push the labels down.
  const hangs = PROCESS_GLYPH_SPECS[symbol.glyph]?.marks || [];
  const below = hh + (hangs.includes("boot") ? Math.max(2, hh * 0.35) : 0) + (hangs.includes("legs") ? Math.min(hw, hh) * 0.15 : 0);
  return (
    <g key={instance.id} transform={`translate(${c.x} ${c.y}) rotate(${instance.rotationDeg || 0})`}>
      {glyph}
      {instance.tag && (
        <text y={below + 13} textAnchor="middle" fontSize={11} fontWeight={700} fill={highlighted ? "#f59e0b" : "#fde68a"}>
          {instance.tag.slice(0, 14)}
        </text>
      )}
      <text y={below + (instance.tag ? 26 : 14)} textAnchor="middle" fontSize={10} fill="#9ca3af">
        {symbol.label}
      </text>
    </g>
  );
}

const routines = new Map([
  ["furniture", drawFurnitureSymbol],
  ["rooms", drawRoomSymbol],
  ["piping", drawPipingSymbol],
  ["buildingElements", drawBuildingElementSymbol],
  ["siteOutdoor", drawSiteOutdoorSymbol],
  ["mepFixtures", drawMepFixtureSymbol],
  ["processEquipment", drawProcessEquipmentSymbol],
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
