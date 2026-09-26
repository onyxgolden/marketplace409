"use client";

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { DXF_UNITS } from "@/domains/roomDesigner/importers/dxf/dxfUnits";
import { LAYER_ROLES } from "@/domains/roomDesigner/importers/dxf/dxfLayers";
import { feetInchesLabel } from "@/domains/roomDesigner/designerGeometry";

/**
 * Import a CAD floor plan (.dxf): choose file → review units and what each
 * layer is (walls / doors / windows / rooms / annotation / ignore — suggested
 * from layer names, always editable) with a live preview → import as one
 * undoable step. Everything runs locally in the browser; nothing is uploaded.
 *
 * The importer is loaded on demand so it stays out of the main bundle.
 */
export default function DxfImportSection({ dispatch, design, loadImporter }) {
  const [stage, setStage] = useState("idle"); // idle | reading | preview | done | error
  const [fileName, setFileName] = useState("");
  const [drawing, setDrawing] = useState(null);
  const [importer, setImporter] = useState(null);
  const [unit, setUnit] = useState(null);
  const [roles, setRoles] = useState({});
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);

  const load = loadImporter || (() => import("@/domains/roomDesigner/importers/dxf/dxfImporter"));

  const prepared = useMemo(() => {
    if (!drawing || !importer) return null;
    try {
      return importer.prepareDxfImport(drawing, { unit, roles });
    } catch (err) {
      return { error: err?.message || "Could not prepare that drawing." };
    }
  }, [drawing, importer, unit, roles]);

  const reset = () => {
    setStage("idle");
    setDrawing(null);
    setRoles({});
    setUnit(null);
    setError(null);
  };

  const onFile = async (file) => {
    setError(null);
    setReport(null);
    if (!file) return;
    if (/\.dwg$/i.test(file.name || "")) {
      setError("DWG is a closed binary format. In your CAD program, use Save As / Export → DXF, then import the .dxf.");
      setStage("error");
      return;
    }
    if (!/\.dxf$/i.test(file.name || "")) {
      setError("Choose a .dxf file.");
      setStage("error");
      return;
    }
    setFileName(file.name);
    setStage("reading");
    try {
      const mod = await load();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const d = mod.readDxfDrawing(bytes);
      setImporter(mod);
      setDrawing(d);
      setUnit(d.units.unit);
      setRoles({});
      setStage("preview");
    } catch (err) {
      setError(err?.message || "Could not read that DXF.");
      setStage("error");
    }
  };

  const commit = () => {
    if (!prepared || prepared.error) return;
    dispatch({ type: "IMPORT_DXF_RESULT", importResult: prepared });
    const c = prepared.counts;
    setReport(`Imported ${fileName}: ${c.walls} walls, ${c.openings} doors/windows, ${c.rooms} rooms, ${c.annotations} annotations.`);
    setDrawing(null);
    setStage("done");
  };

  const roleOf = (layer) => roles[layer.name] ?? layer.suggestedRole;
  const designThickness = design?.settings?.wallThicknessIn;

  return (
    <div className="mt-4 border-t border-gray-800 pt-3" data-testid="dxf-import">
      <h2 className="mb-2 text-sm font-semibold text-white">Import CAD plan (.dxf)</h2>

      {(stage === "idle" || stage === "done" || stage === "error") && (
        <div>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">
            <Upload size={14} />
            Choose .dxf file
            <input type="file" accept=".dxf,.dwg" aria-label="Choose DXF file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Walls drawn as two face lines become Designer walls; doors and windows are cut into them; room outlines
            and names become rooms; everything else comes in as drawn. You choose what each layer is before importing.
            Fully local — nothing is uploaded.
          </p>
          {report && <p className="mt-2 text-xs text-emerald-300" role="status">{report}</p>}
          {error && <p className="mt-2 text-xs text-red-300" role="alert">{error}</p>}
        </div>
      )}

      {stage === "reading" && <p className="text-xs text-gray-400">Reading {fileName}…</p>}

      {stage === "preview" && drawing && (
        <div>
          <p className="mb-2 text-xs text-gray-300"><span className="font-medium text-white">{fileName}</span></p>

          <label className="mb-2 block text-xs text-gray-400">
            Drawing units{drawing.units.known ? "" : " (not stated in the file — check the size)"}
            <select aria-label="Drawing units" value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-white">
              {Object.entries(DXF_UNITS).map(([id, u]) => (
                <option key={id} value={id}>{u.label}</option>
              ))}
            </select>
          </label>
          {prepared && !prepared.error && (
            <p className="mb-2 text-[11px] text-gray-400" data-testid="dxf-size">
              Drawing size: {feetInchesLabel(prepared.sizeIn.w)} × {feetInchesLabel(prepared.sizeIn.h)}
            </p>
          )}

          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Layers</p>
          <div className="mb-2 max-h-56 space-y-1 overflow-y-auto">
            {drawing.layers.map((layer) => (
              <label key={layer.name} className="flex items-center justify-between gap-2 text-[11px] text-gray-300">
                <span className="truncate" title={`${layer.polylines} shapes, ${layer.texts} texts${layer.off || layer.frozen ? " · hidden in the DXF" : ""}`}>
                  {layer.name} <span className="text-gray-500">({layer.polylines + layer.texts})</span>
                </span>
                <select
                  aria-label={`Role for layer ${layer.name}`}
                  value={roleOf(layer)}
                  onChange={(e) => setRoles({ ...roles, [layer.name]: e.target.value })}
                  className="w-32 shrink-0 rounded bg-gray-800 px-1 py-0.5 text-white"
                >
                  {LAYER_ROLES.map((r) => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {prepared?.error && <p className="text-xs text-red-300" role="alert">{prepared.error}</p>}
          {prepared && !prepared.error && (
            <>
              <dl className="space-y-0.5 text-xs text-gray-400" aria-label="Import preview">
                {[["Walls", prepared.counts.walls], ["Doors & windows", prepared.counts.openings], ["Rooms", prepared.counts.rooms], ["Annotations", prepared.counts.annotations]].map(([label, n]) => (
                  <div key={label} className="flex justify-between"><dt>{label}</dt><dd className="text-gray-200">{n}</dd></div>
                ))}
              </dl>
              {prepared.wallThicknessIn != null && Math.abs(prepared.wallThicknessIn - (designThickness || 0)) > 0.1 && (
                <p className="mt-2 text-[11px] text-gray-400">
                  Walls in this drawing are about {prepared.wallThicknessIn}″ thick (this design uses {designThickness}″).{" "}
                  <button type="button" className="text-emerald-300 underline" onClick={() => dispatch({ type: "UPDATE_SETTINGS", settings: { wallThicknessIn: prepared.wallThicknessIn } })}>
                    Use {prepared.wallThicknessIn}″
                  </button>
                </p>
              )}
              {prepared.issues.length > 0 && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-amber-300">
                    {prepared.issues.length} note{prepared.issues.length === 1 ? "" : "s"} — review before building on this import
                  </p>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-[11px] text-gray-400">
                    {prepared.issues.slice(0, 12).map((issue, i) => (
                      <li key={i}><span className="text-gray-500">{issue.provenance}: </span>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={commit} disabled={!prepared || !!prepared.error} className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40">
              Import plan
            </button>
            <button type="button" onClick={reset} className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
