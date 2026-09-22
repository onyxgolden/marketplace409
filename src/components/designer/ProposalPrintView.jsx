"use client";

/**
 * ProposalPrintView — the printable remodel proposal document (slice 4).
 *
 * Rendered inside ProposalPrintOverlay at exact Letter-portrait physical
 * dimensions. Pure presentational: it takes an estimate result from
 * estimateProject() and lays it out as a clean document — header, line-item
 * table, subtotal, "to be priced" section, assumptions, disclaimer.
 *
 * No prices are invented here: a line is priced only when the user entered
 * a unit cost; everything else lists under "To be priced" with its
 * quantity. Quantity provenance (geometry source + measurement version +
 * generation timestamp) is printed in the header so every number traces
 * back to the plan geometry it came from.
 */

import {
  formatUSD,
  unitCostLabel,
} from "@/domains/roomDesigner/homeEstimate";
import { formatArea, formatLength } from "@/domains/roomDesigner/homeQuantities";

export const PROPOSAL_PAGE_CSS = `@page { size: Letter portrait; margin: 0.55in; }`;

const PAGE = { widthIn: 8.5, heightIn: 11 };

function quantityLabel(item, units) {
  if (item.unit === "each") return String(item.quantity);
  if (item.unit === "linft") return formatLength(item.quantity * 12, units);
  return formatArea(item.quantity, units);
}

function buildingLine(building) {
  if (!building) return "";
  const parts = [];
  if (building.address) parts.push(building.address);
  const city = [building.city, building.state].filter(Boolean).join(", ");
  const cityZip = [city, building.zip].filter(Boolean).join(" ");
  if (cityZip) parts.push(cityZip);
  return parts.join(" — ");
}

function generatedLabel(generatedAt) {
  try {
    return new Date(generatedAt).toLocaleString();
  } catch {
    return generatedAt || "";
  }
}

const th = {
  textAlign: "left",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#4b5563",
  padding: "6px 8px",
  borderBottom: "2px solid #111827",
};
const td = {
  fontSize: 13,
  padding: "6px 8px",
  borderBottom: "1px solid #e5e7eb",
};

export default function ProposalPrintView({ estimate }) {
  const items = estimate.items || [];
  const priced = items.filter((i) => i.status === "priced");
  const pending = items.filter((i) => i.status === "pending");
  const address = buildingLine(estimate.building);
  return (
    <div
      className="forge-proposal-sheet"
      style={{
        width: PAGE.widthIn * 96,
        minHeight: PAGE.heightIn * 96,
        background: "#fff",
        color: "#111827",
        padding: "0.55in",
        boxSizing: "border-box",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <div style={{ borderBottom: "3px solid #111827", paddingBottom: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280" }}>
          Remodel proposal — planning estimate
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: "4px 0" }}>
          {estimate.projectName || "Untitled project"}
        </h1>
        {address && <div style={{ fontSize: 13, color: "#374151" }}>{address}</div>}
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
          Generated {generatedLabel(estimate.generatedAt)}
          {estimate.levelCount > 1 ? ` · ${estimate.levelCount} levels` : ""}
        </div>
        <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
          Quantities derived from plan geometry · measurement v{estimate.measurementVersion}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
        <thead>
          <tr>
            <th style={th}>Item</th>
            <th style={{ ...th, textAlign: "right" }}>Quantity</th>
            <th style={{ ...th, textAlign: "right" }}>Unit cost</th>
            <th style={{ ...th, textAlign: "right" }}>Extended</th>
          </tr>
        </thead>
        <tbody>
          {priced.map((item) => (
            <tr key={item.assemblyId}>
              <td style={td}>{item.name}</td>
              <td style={{ ...td, textAlign: "right" }}>
                {quantityLabel(item, estimate.units)}{" "}
                <span style={{ color: "#6b7280", fontSize: 11 }}>{unitCostLabel(item.unit)}</span>
              </td>
              <td style={{ ...td, textAlign: "right" }}>{formatUSD(item.unitCostCents)}</td>
              <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                {formatUSD(item.extendedCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          fontSize: 16,
          fontWeight: 800,
          margin: "8px 0 20px",
        }}
      >
        <span style={{ marginRight: 16, fontWeight: 400, color: "#4b5563" }}>Subtotal</span>
        {formatUSD(estimate.subtotalCents)}
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>To be priced</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {pending.map((item) => (
                <tr key={item.assemblyId}>
                  <td style={td}>{item.name}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {quantityLabel(item, estimate.units)}{" "}
                    <span style={{ color: "#6b7280", fontSize: 11 }}>{unitCostLabel(item.unit)}</span>
                  </td>
                  <td style={{ ...td, textAlign: "right", color: "#6b7280" }}>—</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 11, color: "#6b7280", marginTop: 4 }}>
            Enter unit costs in the designer to price these items — no placeholder prices.
          </p>
        </div>
      )}

      {estimate.assumptions && estimate.assumptions.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Assumptions</h2>
          <ul style={{ fontSize: 12, color: "#374151", paddingLeft: 18, margin: 0 }}>
            {estimate.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <p
        style={{
          fontSize: 11,
          color: "#6b7280",
          borderTop: "1px solid #e5e7eb",
          paddingTop: 10,
          marginTop: 8,
        }}
      >
        Planning estimate derived from plan geometry — not a bid. Verify all quantities on
        site.
      </p>
    </div>
  );
}
