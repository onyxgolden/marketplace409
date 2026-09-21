import { useState } from "react";
import { exportChartSvg } from "@/domains/chartBuilder";

// Export menu for /forge/charts: Download SVG (slice 4.2) and Print / Save
// PDF. Export is a pure read of the current chart — nothing is changed, so
// no confirmation is needed. Print goes through the dedicated print view
// (slice 4.3) via onPrint; without it, falls back to printing the page.
export default function ChartExportMenu({ doc, onPrint, onNotice }) {
  const [open, setOpen] = useState(false);

  function notify(text, kind) {
    if (typeof onNotice === "function") onNotice({ text, kind });
  }

  function handleDownloadSvg() {
    setOpen(false);
    try {
      const { svg } = exportChartSvg(doc);
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${doc.id || "chart"}.svg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Chart downloaded as SVG.", "info");
    } catch (error) {
      notify(
        error instanceof Error ? `SVG export failed: ${error.message}` : "SVG export failed.",
        "error"
      );
    }
  }

  function handlePrint() {
    setOpen(false);
    if (typeof onPrint === "function") {
      onPrint();
    } else {
      window.print();
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Export
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={handleDownloadSvg}
          >
            Download SVG
          </button>
          <button
            type="button"
            role="menuitem"
            className="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            onClick={handlePrint}
          >
            Print / Save PDF
          </button>
        </div>
      )}
    </div>
  );
}
