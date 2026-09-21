"use client";

/**
 * SheetPrintView — the printable rendering of a paper sheet.
 *
 * A pure, deterministic function of (design, sheet): it renders the sheet's
 * FIXED plan region (never current content bounds) at exact physical CSS
 * dimensions (inches), clipping everything outside the frame. It is fully
 * separate from the interactive PlanCanvas — editor pan/zoom, selection,
 * toolbar, and viewport never affect print geometry.
 *
 * Only `dateLabel` (title-strip metadata) may vary between renders; pass a
 * fixed value in tests.
 */

import { getSheetSize, sheetDimensions } from "@/domains/roomDesigner/sheetCatalog";
import {
  fitScaleLabel,
  pieceSize,
  sheetPlanBounds,
} from "@/domains/roomDesigner/designerDocument";
import { getCatalogEntry } from "@/domains/roomDesigner/furnitureCatalog";
import { findSymbol } from "@/domains/roomDesigner/symbolRegistry";
import {
  dimensionGeometry,
  feetInchesLabel,
  offsetAlongWall,
  rotatedFootprintCorners,
  wallLength,
} from "@/domains/roomDesigner/designerGeometry";
import { splitWallByOpenings } from "@/domains/roomDesigner/designerThreeModel";
import { ORG_CHART_METRICS, layoutOrgChart } from "@/domains/roomDesigner/orgChartLayout";

const INK = "#1a1a1a";
const HAIRLINE = "#555555";

/** @page rule for this sheet's exact paper size (margins handled in-page). */
export function pageCssForSheet(sheet) {
  const { widthIn, heightIn } = sheetDimensions(sheet.sizeId, sheet.orientation);
  return `@page { size: ${widthIn}in ${heightIn}in; margin: 0; }`;
}

const pts = (list) => list.map((p) => `${p.x},${p.y}`).join(" ");
const centroidOf = (list) => ({
  x: list.reduce((s, p) => s + p.x, 0) / list.length,
  y: list.reduce((s, p) => s + p.y, 0) / list.length,
});

function PrintUnderlay({ design }) {
  const u = design.underlay;
  if (!u) return null;
  return (
    <image
      href={u.dataUrl}
      x={u.x}
      y={u.y}
      width={u.widthPx / u.pxPerIn}
      height={u.heightPx / u.pxPerIn}
      preserveAspectRatio="none"
      opacity={u.opacity}
    />
  );
}

function PrintRooms({ design }) {
  return (
    <g>
      {(design.rooms || []).map((room) => {
        const poly = room.polygon || [];
        if (poly.length < 3) return null;
        const c = centroidOf(poly);
        const area = Math.abs(poly.reduce((s, p, i) => {
          const q = poly[(i + 1) % poly.length];
          return s + (p.x * q.y - q.x * p.y);
        }, 0)) / 2;
        const fontSize = Math.max(3, Math.min(8, Math.sqrt(area) / 8));
        return (
          <g key={room.id}>
            <polygon points={pts(poly)} fill="#f4f4f4" stroke={INK} strokeWidth={1} />
            {room.label && (
              <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="middle"
                fontSize={fontSize} fill={HAIRLINE}>
                {room.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}

function PrintWalls({ design }) {
  const thickness = design.settings.wallThicknessIn;
  const wallHeightIn = design.settings.wallHeightIn;
  return (
    <g>
      {(design.walls || []).flatMap((wall) => {
        const segments = splitWallByOpenings(wall, design.openings || [], { wallHeightIn });
        const lines = segments.map((seg) => (
          <line
            key={`${wall.id}-${seg.a.x}-${seg.b.x}-${seg.kind}`}
            x1={seg.a.x} y1={seg.a.y} x2={seg.b.x} y2={seg.b.y}
            stroke={INK}
            strokeWidth={seg.kind === "wall" ? thickness : thickness * 0.25}
            strokeLinecap="butt"
          />
        ));
        const dim = dimensionGeometry(wall, thickness / 2 + 10);
        if (dim) {
          lines.push(
            <g key={`${wall.id}-dim`} stroke={HAIRLINE} strokeWidth={0.6}>
              <line x1={dim.lineA.x} y1={dim.lineA.y} x2={dim.lineB.x} y2={dim.lineB.y} />
              <line x1={dim.tickA.a.x} y1={dim.tickA.a.y} x2={dim.tickA.b.x} y2={dim.tickA.b.y} />
              <line x1={dim.tickB.a.x} y1={dim.tickB.a.y} x2={dim.tickB.b.x} y2={dim.tickB.b.y} />
              <text
                x={dim.labelPos.x} y={dim.labelPos.y}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={5} fill={HAIRLINE} stroke="none"
                transform={`rotate(${dim.labelAngle} ${dim.labelPos.x} ${dim.labelPos.y})`}
              >
                {feetInchesLabel(dim.length)}
              </text>
            </g>,
          );
        }
        return lines;
      })}
    </g>
  );
}

function PrintOpenings({ design }) {
  const thickness = design.settings.wallThicknessIn;
  return (
    <g>
      {(design.openings || []).map((o) => {
        const wall = (design.walls || []).find((w) => w.id === o.wallId);
        if (!wall || wallLength(wall) <= 0) return null;
        const gp1 = offsetAlongWall(wall, o.offsetIn);
        const gp2 = offsetAlongWall(wall, o.offsetIn + o.widthIn);
        const len = Math.hypot(gp2.x - gp1.x, gp2.y - gp1.y);
        if (len <= 0) return null;
        const dir = { x: (gp2.x - gp1.x) / len, y: (gp2.y - gp1.y) / len };
        const n = { x: -dir.y, y: dir.x };
        if (o.type === "window") {
          const off = thickness / 4;
          return (
            <g key={o.id} stroke={INK} strokeWidth={0.75}>
              <line x1={gp1.x + n.x * off} y1={gp1.y + n.y * off} x2={gp2.x + n.x * off} y2={gp2.y + n.y * off} />
              <line x1={gp1.x - n.x * off} y1={gp1.y - n.y * off} x2={gp2.x - n.x * off} y2={gp2.y - n.y * off} />
            </g>
          );
        }
        // Door: leaf line across the gap + 90° swing arc from the hinge.
        const arcEnd = { x: gp1.x + n.x * o.widthIn, y: gp1.y + n.y * o.widthIn };
        return (
          <g key={o.id} stroke={INK} strokeWidth={1} fill="none">
            <line x1={gp1.x} y1={gp1.y} x2={gp2.x} y2={gp2.y} />
            <path d={`M ${gp2.x} ${gp2.y} A ${o.widthIn} ${o.widthIn} 0 0 1 ${arcEnd.x} ${arcEnd.y}`}
              strokeDasharray="4 2" stroke={HAIRLINE} />
          </g>
        );
      })}
    </g>
  );
}

function PrintFurniture({ design }) {
  return (
    <g>
      {(design.furniture || []).map((f) => {
        const { widthIn, depthIn } = pieceSize(f);
        const corners = rotatedFootprintCorners(f, widthIn, depthIn);
        const entry = getCatalogEntry(f.catalogId);
        const fontSize = Math.max(2.5, Math.min(6, Math.min(widthIn, depthIn) / 5));
        return (
          <g key={f.id}>
            <polygon points={pts(corners)} fill="#ffffff" stroke={INK} strokeWidth={1} />
            <text x={f.x} y={f.y} textAnchor="middle" dominantBaseline="middle"
              fontSize={fontSize} fill={INK}>
              {(entry?.label || f.catalogId || "").slice(0, 14)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function PrintPipes({ design }) {
  return (
    <g>
      {(design.pipes || []).map((run) => (
        <polyline
          key={run.id}
          points={pts(run.points || [])}
          fill="none"
          stroke={INK}
          strokeWidth={Math.max(run.diameterIn || 1, 0.75)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

function PrintSymbols({ design }) {
  return (
    <g>
      {(design.symbols || []).map((inst) => {
        const sym = findSymbol(inst.domain, inst.symbolId);
        if (!sym) return null;
        const w = sym.widthIn || 12;
        const h = sym.depthIn || 12;
        const label = inst.tag || sym.label || inst.symbolId;
        return (
          <g key={inst.id} transform={`translate(${inst.x} ${inst.y}) rotate(${inst.rotationDeg || 0})`}>
            <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#ffffff" stroke={INK} strokeWidth={1} />
            <text x={0} y={0} textAnchor="middle" dominantBaseline="middle"
              fontSize={Math.max(2.5, Math.min(5, h / 4))} fill={INK}>
              {String(label).slice(0, 12)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function PrintOrgCharts({ design }) {
  const boxW = ORG_CHART_METRICS.boxWidthIn;
  const boxH = ORG_CHART_METRICS.boxHeightIn;
  return (
    <g>
      {(design.orgCharts || []).map((chart) => {
        const layout = layoutOrgChart(chart.nodes || []);
        const byId = new Map((chart.nodes || []).map((n) => [n.id, n]));
        const pos = new Map((layout.positions || []).map((p) => [p.id, p]));
        const ox = chart.x - layout.widthIn / 2;
        return (
          <g key={chart.id}>
            {(layout.edges || []).map((e, i) => {
              const a = pos.get(e.from);
              const b = pos.get(e.to);
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={ox + a.x + boxW / 2} y1={chart.y + a.y + boxH}
                  x2={ox + b.x + boxW / 2} y2={chart.y + b.y}
                  stroke={HAIRLINE} strokeWidth={1}
                />
              );
            })}
            {(layout.positions || []).map((p) => {
              const node = byId.get(p.id);
              if (!node) return null;
              const x = ox + p.x;
              const y = chart.y + p.y;
              return (
                <g key={p.id}>
                  <rect x={x} y={y} width={boxW} height={boxH} fill="#ffffff" stroke={INK} strokeWidth={1} />
                  <text x={x + boxW / 2} y={y + boxH / 2 - 2} textAnchor="middle"
                    dominantBaseline="middle" fontSize={boxH * 0.26} fontWeight={700} fill={INK}>
                    {(node.name || "").slice(0, 16)}
                  </text>
                  <text x={x + boxW / 2} y={y + boxH / 2 + boxH * 0.22} textAnchor="middle"
                    dominantBaseline="middle" fontSize={boxH * 0.2} fill={HAIRLINE}>
                    {(node.title || "").slice(0, 20)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export default function SheetPrintView({ design, sheet, dateLabel }) {
  const dims = sheetDimensions(sheet.sizeId, sheet.orientation);
  const bounds = sheetPlanBounds(sheet);
  const clipId = `forge-print-clip-${sheet.id}`;
  const viewBox = `${bounds.x} ${bounds.y} ${bounds.widthIn} ${bounds.heightIn}`;
  const titleDate = dateLabel || new Date().toLocaleDateString();
  return (
    <div
      className="forge-print-sheet"
      style={{
        width: `${dims.widthIn}in`,
        height: `${dims.heightIn}in`,
        background: "#ffffff",
        color: INK,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <svg width="100%" height="100%" viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
        style={{ display: "block" }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={bounds.x} y={bounds.y} width={bounds.widthIn} height={bounds.heightIn} />
          </clipPath>
        </defs>
        {/* Fixed frame: content outside the sheet's plan region never prints. */}
        <g clipPath={`url(#${clipId})`}>
          <PrintUnderlay design={design} />
          <PrintRooms design={design} />
          <PrintWalls design={design} />
          <PrintOpenings design={design} />
          <PrintFurniture design={design} />
          <PrintPipes design={design} />
          <PrintSymbols design={design} />
          <PrintOrgCharts design={design} />
        </g>
      </svg>
      {/* Title strip lives in the bottom margin: physical units, never scaled. */}
      <div
        style={{
          position: "absolute",
          left: "0.5in",
          right: "0.5in",
          bottom: "0.06in",
          height: "0.36in",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.25in",
          borderTop: "1pt solid #1a1a1a",
          fontSize: "9pt",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        <span style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
          {design.name}
        </span>
        <span>
          {getSheetSize(sheet.sizeId).label} · {sheet.orientation}
        </span>
        <span>{fitScaleLabel(sheet.fitScale)}</span>
        <span>{titleDate}</span>
      </div>
    </div>
  );
}
