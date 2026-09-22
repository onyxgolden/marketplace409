"use client";

/**
 * DxfExportDialog — FORGE Home Designer slice 6.
 *
 * Small modal behind the toolbar's "Export DXF" button: pick which levels to
 * export (default: the current level), then download a fully client-side
 * ASCII DXF file built by planToDxf. Elevations are not offered in slice 6
 * (plan export only). The export reflects the on-screen design, including
 * unsaved edits — the same "print what you see" contract as slice 5.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { dxfFileName, planToDxf } from "@/domains/roomDesigner/homeDxfExport";
import { projectWithEditedDesign } from "@/domains/roomDesigner/homeQuantities";

export default function DxfExportDialog({ project, design, currentLevelId, onClose }) {
  const [selected, setSelected] = useState(() => new Set([currentLevelId]));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const levels = (project && project.levels) || [];

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const download = () => {
    setError(null);
    if (selected.size === 0) {
      setError("Select at least one level to export.");
      return;
    }
    setBusy(true);
    try {
      const merged = projectWithEditedDesign(project, design) || project;
      const result = planToDxf(merged, { levelIds: [...selected] });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const blob = new Blob([result.dxf], { type: "application/dxf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = dxfFileName(merged.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onClose();
    } catch (err) {
      setError(err && err.message ? err.message : "Could not export DXF.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Export DXF"
    >
      <div className="w-full max-w-sm rounded-lg bg-gray-900 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Export DXF</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-400">
          Plan export only — fully client-side, inches, R14 DXF.
        </p>
        <div className="mb-4 space-y-1" role="group" aria-label="Levels to export">
          {levels.map((level) => (
            <label
              key={level.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-800"
            >
              <input
                type="checkbox"
                checked={selected.has(level.id)}
                onChange={() => toggle(level.id)}
                className="h-4 w-4 accent-emerald-500"
              />
              {level.name}
              {level.id === currentLevelId && (
                <span className="text-xs text-gray-500">(current)</span>
              )}
            </label>
          ))}
        </div>
        {error && (
          <div className="mb-3 rounded bg-red-900/60 px-3 py-2 text-sm text-red-200">{error}</div>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded bg-gray-800 px-4 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={download}
            disabled={busy || selected.size === 0}
            className="flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Download size={15} /> {busy ? "Exporting…" : "Download DXF"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
