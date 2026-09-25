"use client";

import { Download } from "lucide-react";
import { equipmentSchedule, equipmentScheduleCsv } from "@/domains/roomDesigner/equipmentTags";

/**
 * Equipment list: every process-equipment piece on this level, by category
 * then tag (P-101, P-102, ... V-101). Clicking a row selects that piece on
 * the plan (and in 3D); the CSV is the same schedule for a spreadsheet.
 * Hidden until the design has process equipment.
 */
export default function EquipmentScheduleSection({ design, dispatch }) {
  const rows = equipmentSchedule(design);
  if (rows.length === 0) return null;

  const downloadCsv = () => {
    const blob = new Blob([equipmentScheduleCsv(design)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(design.name || "design").replace(/[^\w.-]+/g, "_")}-equipment-list.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mt-4" aria-label="Equipment list">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Equipment list ({rows.length})</h3>
        <button
          type="button"
          onClick={downloadCsv}
          className="flex items-center gap-1 rounded bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300 hover:bg-gray-700"
          title="Download the equipment list as CSV"
        >
          <Download size={12} aria-hidden="true" /> CSV
        </button>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
            <th className="py-0.5 pr-2 font-medium">Tag</th>
            <th className="py-0.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => dispatch({ type: "SELECT", selection: { kind: "symbol", id: row.id } })}
              className="cursor-pointer text-gray-300 hover:bg-gray-800"
              title={`${row.category} · nominal ${row.sizeLabel}`}
            >
              <td className="py-0.5 pr-2 font-mono font-semibold text-amber-200">{row.tag || "—"}</td>
              <td className="py-0.5">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-gray-500">Sizes are nominal planning footprints, not equipment specs.</p>
    </section>
  );
}
