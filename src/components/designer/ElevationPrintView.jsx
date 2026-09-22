"use client";

/**
 * ElevationPrintView — the printable elevation sheet document (slice 5).
 *
 * Rendered inside ElevationPrintOverlay at exact Letter-landscape physical
 * dimensions. Pure presentational: it takes a buildElevation /
 * buildStackedElevation result and lays it out as a clean document —
 * header (project, direction, scope, provenance), the elevation drawing at
 * full sheet width, assumptions, and the pipes limitation.
 *
 * No dimensions are invented here: every vertical default is listed under
 * assumptions, and the quantity provenance traces every number back to the
 * plan geometry it came from.
 */

import ElevationSvg from "./ElevationSvg";

export const ELEVATION_PAGE_CSS = `@page { size: Letter landscape; margin: 0.5in; }`;

const PAGE = { widthIn: 11, heightIn: 8.5 };

function generatedLabel(generatedAt) {
  try {
    return new Date(generatedAt).toLocaleString();
  } catch {
    return generatedAt || "";
  }
}

export default function ElevationPrintView({ elevation }) {
  if (!elevation || !elevation.ok) return null;
  return (
    <div
      className="forge-elevation-sheet"
      style={{
        width: PAGE.widthIn * 96,
        minHeight: PAGE.heightIn * 96,
        background: "#fff",
        color: "#111827",
        padding: "0.5in",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          borderBottom: "2px solid #111827",
          paddingBottom: 8,
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {elevation.projectName || "Elevation"}
          </div>
          <div style={{ fontSize: 13, color: "#4b5563" }}>
            {elevation.directionLabel}
            {elevation.scope === "stacked" ? " · All levels stacked" : " · Current level"}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", textAlign: "right" }}>
          <div>FORGE Home Designer · elevation from plan geometry</div>
          <div>
            {generatedLabel(elevation.generatedAt)} ·{" "}
            {elevation.quantitySource}, v{elevation.measurementVersion}
          </div>
        </div>
      </div>

      <ElevationSvg elevation={elevation} dark={false} id="print" />

      {(elevation.assumptions || []).length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#92400e" }}>
          <strong>Assumptions:</strong> {elevation.assumptions.join("; ")}.
        </div>
      )}
      {(elevation.limitations || []).length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#4b5563" }}>
          {elevation.limitations.join(" ")}
        </div>
      )}
      <div style={{ marginTop: 10, fontSize: 11, color: "#6b7280", fontStyle: "italic" }}>
        Planning elevation derived from plan geometry — not construction
        documents. Verify all dimensions on site.
      </div>
    </div>
  );
}
