"use client";

/**
 * GlbExportDialog — Room Designer .glb export (Phase 1).
 *
 * Small modal behind the toolbar's "Export GLB" button: choose whether the
 * floor and furniture go into the export (default: both on), then download a
 * fully client-side binary glTF 2.0 file built by exportDesignToGlb. The
 * export reflects the on-screen design, including unsaved edits — the same
 * "print what you see" contract as the DXF export.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { exportDesignToGlb, glbFileName } from "@/domains/roomDesigner/designerGlbModel";
import { projectWithEditedDesign } from "@/domains/roomDesigner/homeQuantities";

export default function GlbExportDialog({ project, design, onClose }) {
  const [includeFloor, setIncludeFloor] = useState(true);
  const [includeFurniture, setIncludeFurniture] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const merged = projectWithEditedDesign(project, design) || project;
      const result = await exportDesignToGlb(merged, { includeFloor, includeFurniture });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const blob = new Blob([result.glb], { type: "model/gltf-binary" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = glbFileName(merged.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onClose();
    } catch (err) {
      setError(err && err.message ? err.message : "Could not export GLB.");
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
      aria-label="Export GLB"
    >
      <div className="w-full max-w-sm rounded-lg bg-gray-900 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Export GLB</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-400">
          3D model export — fully client-side, meters, glTF 2.0. Opens in Windows 3D
          Viewer, Blender, and most CAD tools.
        </p>
        <div className="mb-4 space-y-1" role="group" aria-label="What to include">
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-800">
            <input
              type="checkbox"
              checked={includeFloor}
              onChange={(e) => setIncludeFloor(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Floor
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-800">
            <input
              type="checkbox"
              checked={includeFurniture}
              onChange={(e) => setIncludeFurniture(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Furniture
          </label>
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
            disabled={busy}
            className="flex items-center gap-1.5 rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            <Download size={15} /> {busy ? "Exporting…" : "Download GLB"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
