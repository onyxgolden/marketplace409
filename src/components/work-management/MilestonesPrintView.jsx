"use client";

// Print-ready Milestones export, built from the same snapshot the live
// tab renders (same data, different rendering — never a second, stale
// read). "Download PDF" uses the browser's print-to-PDF, the same
// convention as the Rental check-run print view.

function formatDate(value) {
  if (!value) return "—";
  const [y, m, d] = String(value).slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : String(value);
}

export default function MilestonesPrintView({ instances, onClose }) {
  const rows = [...(instances || [])].sort((a, b) => a.milestoneNumber - b.milestoneNumber);
  return (
    <div className="bg-white">
      <div className="mb-4 flex items-center justify-between gap-4 print:hidden">
        <h2 className="text-xl font-black">Milestones — {rows.length} row{rows.length === 1 ? "" : "s"}</h2>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-bold text-white"
          >
            Download PDF
          </button>
        </div>
      </div>

      <table className="w-full border-collapse text-left text-sm print:text-xs">
        <thead>
          <tr className="border-b border-slate-400">
            <th className="px-2 py-1">#</th>
            <th className="px-2 py-1">Description</th>
            <th className="px-2 py-1">Responsibility</th>
            <th className="px-2 py-1">Department</th>
            <th className="px-2 py-1">Tier</th>
            <th className="px-2 py-1">Planned</th>
            <th className="px-2 py-1">Actual</th>
            <th className="px-2 py-1">% Complete</th>
            <th className="px-2 py-1">Late</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((milestone) => (
            <tr key={milestone.id} className={`border-b border-slate-200 ${milestone.isStageGate ? "font-semibold" : ""}`}>
              <td className="px-2 py-1">{milestone.milestoneNumber}</td>
              <td className="px-2 py-1">{milestone.description}</td>
              <td className="px-2 py-1">{milestone.responsibilityRole || "—"}</td>
              <td className="px-2 py-1">{milestone.department || "—"}</td>
              <td className="px-2 py-1">{milestone.complexityTierSelected}</td>
              <td className="px-2 py-1">{formatDate(milestone.plannedDate)}</td>
              <td className="px-2 py-1">{formatDate(milestone.actualDate)}</td>
              <td className="px-2 py-1">{milestone.percentComplete}%</td>
              <td className="px-2 py-1">{milestone.late ? "Late" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
