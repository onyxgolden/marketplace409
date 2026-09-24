"use client";

/**
 * PDF import panel for the FORGE Designer.
 *
 * Staged, mirroring the .vsdx import section: choose/drop a file → page picker
 * → prepare → preview + scale calibration → explicit commit. Everything runs
 * in the browser; nothing is uploaded, and no cloud or paid service is
 * involved.
 *
 * Two import modes, chosen from the page's own content:
 *   vector  — the page's path data becomes NATIVE Designer walls: selectable,
 *             movable, endpoint-editable, deletable, exactly like drawn ones.
 *   scanned — the page is rasterized and placed as a scaled background
 *             underlay beneath the drawing layer, for tracing over.
 *
 * Scale calibration follows the Designer's established pattern: a plot scale
 * or a known real-world dimension. For a vector import the scale is applied
 * before commit (re-derived purely, with no re-parse, so it can be adjusted
 * freely first). For a scanned import the page lands with its true paper scale
 * and the existing two-click "Calibrate scale" tool refines it from there.
 *
 * .ai and .eps are out of scope and are refused by name, with what to do
 * instead — including when they are dragged onto the panel.
 */

import { useCallback, useState } from "react";
import { FileText, Ruler, Upload } from "lucide-react";
import { feetInchesLabel } from "@/domains/roomDesigner/designerGeometry";

const PHASE_LABELS = {
  opening: "Opening PDF",
  surveying: "Surveying page",
  "reading-geometry": "Reading vector paths",
  converting: "Converting geometry",
  scaling: "Applying scale",
  rendering: "Rendering page",
  preparing: "Preparing import",
};

const PAGE_KIND_LABELS = {
  vector: "vector",
  raster: "scanned",
  mixed: "vector + image",
  empty: "empty",
  unknown: "unreadable",
};

/** Real-world units the user can express a known dimension in. */
const KNOWN_UNITS = [
  { id: "ft", label: "feet", toInches: 12 },
  { id: "in", label: "inches", toInches: 1 },
  { id: "m", label: "metres", toInches: 1000 / 25.4 },
  { id: "mm", label: "millimetres", toInches: 1 / 25.4 },
];

/** Lazily pull in the importer (and with it pdf.js) only on first use. */
async function importerModule() {
  return import("@/domains/roomDesigner/importers/pdf/pdfImporter");
}

export default function PdfImportPanel({ design, dispatch }) {
  const [stage, setStage] = useState("idle");
  const [file, setFile] = useState(null);
  const [survey, setSurvey] = useState(null);
  const [phase, setPhase] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [dragging, setDragging] = useState(false);

  // Scale controls (vector mode).
  const [scaleMode, setScaleMode] = useState("preset");
  const [presetId, setPresetId] = useState("arch-1-4");
  const [knownValue, setKnownValue] = useState("");
  const [knownUnit, setKnownUnit] = useState("ft");
  const [minSegmentIn, setMinSegmentIn] = useState(6);
  const [includeDashed, setIncludeDashed] = useState(false);
  const [dpi, setDpi] = useState(150);
  // Loaded with the importer chunk, so the preset list is not in the main bundle.
  const [presets, setPresets] = useState([]);

  const reset = useCallback(() => {
    setStage("idle");
    setFile(null);
    setSurvey(null);
    setPrepared(null);
    setError(null);
    setPhase(null);
  }, []);

  const fail = useCallback((err) => {
    setError(err?.message || "Could not import that PDF.");
    setStage("error");
  }, []);

  /** Refuse .ai/.eps (and non-PDFs) before anything is parsed. */
  const gate = useCallback(async (candidate) => {
    const { checkPdfFileSupported } = await import("@/domains/roomDesigner/importers/pdf/pdfErrors");
    return checkPdfFileSupported({ name: candidate.name || "", type: candidate.type || "" });
  }, []);

  const runPrepare = useCallback(
    async (candidate, pageNumber, mode, overrides = {}) => {
      setStage("preparing");
      setPhase(null);
      try {
        const { preparePdfImport } = await importerModule();
        const { PLOT_SCALE_PRESETS, findPlotScalePreset } = await import(
          "@/domains/roomDesigner/importers/pdf/pdfScale"
        );
        setPresets(PLOT_SCALE_PRESETS);
        const preset = findPlotScalePreset(presetId);
        const result = await preparePdfImport(candidate, {
          pageNumber,
          mode,
          // Raster pages land at their paper scale unless a plot scale is
          // chosen; vector pages are scaled here and can be re-scaled after.
          scaleFactor: preset ? preset.factor : 1,
          minSegmentIn,
          includeDashed,
          dpi,
          fileName: candidate.name || "pdf",
          onPhase: setPhase,
          ...overrides,
        });
        setPrepared(result);
        setError(null);
        // A freshly prepared vector page with a measurable run makes the
        // known-dimension path usable straight away.
        if (result.mode === "vector" && !result.longestRun) setScaleMode("preset");
        setStage("preview");
      } catch (err) {
        fail(err);
      }
    },
    [presetId, minSegmentIn, includeDashed, dpi, fail],
  );

  const onFile = useCallback(
    async (candidate) => {
      setError(null);
      setReport(null);
      if (!candidate) return;
      const check = await gate(candidate);
      if (!check.ok) {
        setError(check.message);
        setStage("error");
        return;
      }
      setFile(candidate);
      setStage("reading");
      try {
        const { listPdfPages } = await importerModule();
        const result = await listPdfPages(candidate, { onPhase: setPhase });
        setSurvey(result);
        if (result.pages.length === 1) {
          const only = result.pages[0];
          await runPrepare(candidate, 1, only.kind === "raster" ? "raster" : "vector");
        } else {
          setStage("pages");
        }
      } catch (err) {
        fail(err);
      }
    },
    [gate, runPrepare, fail],
  );

  /** Re-derive the preview at a different scale or filter — pure, no re-parse. */
  const rescale = useCallback(
    async (next) => {
      if (!prepared || prepared.mode !== "vector") return;
      try {
        const { applyVectorScale } = await importerModule();
        setPrepared(applyVectorScale(prepared, next));
        setError(null);
      } catch (err) {
        setError(err?.message || "That scale could not be applied.");
      }
    },
    [prepared],
  );

  const applyPreset = useCallback(
    async (id) => {
      setPresetId(id);
      const { findPlotScalePreset } = await import("@/domains/roomDesigner/importers/pdf/pdfScale");
      const preset = findPlotScalePreset(id);
      if (preset) await rescale({ scaleFactor: preset.factor });
    },
    [rescale],
  );

  const applyKnownDimension = useCallback(async () => {
    if (!prepared || !prepared.longestRun) return;
    const unit = KNOWN_UNITS.find((u) => u.id === knownUnit) || KNOWN_UNITS[0];
    const realInches = Number(knownValue) * unit.toInches;
    try {
      const { scaleFromKnownDistance } = await import("@/domains/roomDesigner/importers/pdf/pdfScale");
      // The reference run is measured on the PAPER-TRUE drawing, which is what
      // prepared.longestRun holds, so the factor is independent of the scale
      // currently previewed.
      const factor = scaleFromKnownDistance(prepared.longestRun.lengthIn, realInches);
      await rescale({ scaleFactor: factor });
    } catch (err) {
      setError(err?.message || "That dimension could not be used.");
    }
  }, [prepared, knownValue, knownUnit, rescale]);

  const commit = useCallback(() => {
    if (!prepared) return;
    setStage("committing");
    try {
      dispatch({ type: "IMPORT_PDF_RESULT", importResult: prepared });
      setReport(
        prepared.mode === "raster"
          ? `Placed page ${prepared.pageNumber} as a ${prepared.plan.dpi} DPI underlay, ${feetInchesLabel(
              prepared.plan.pageWidthIn * prepared.scale.factor,
            )} wide on the plan.`
          : `Imported ${prepared.counts.walls} editable wall segment${
              prepared.counts.walls === 1 ? "" : "s"
            } from page ${prepared.pageNumber} at ${prepared.scale.label}.`,
      );
      setPrepared(null);
      setStage("done");
    } catch (err) {
      fail(err);
    }
  }, [prepared, dispatch, fail]);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      setDragging(false);
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) void onFile(dropped);
    },
    [onFile],
  );

  const issueList = (issues, cap = 12) => (
    <div className="mt-2">
      <p className="text-[11px] font-semibold text-amber-300">
        {issues.length} note{issues.length === 1 ? "" : "s"} — review before building on this import
      </p>
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-[11px] text-gray-400">
        {issues.slice(0, cap).map((issue, i) => (
          <li key={i}>
            <span className="text-gray-500">{issue.provenance}: </span>
            {issue.message}
          </li>
        ))}
        {issues.length > cap && <li className="text-gray-500">…and {issues.length - cap} more.</li>}
      </ul>
    </div>
  );

  return (
    <div className="mt-4 border-t border-gray-800 pt-3">
      <h2 className="mb-2 text-sm font-semibold text-white">Import PDF</h2>

      {stage === "idle" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="pdf-dropzone"
          className={`rounded border border-dashed px-2 py-3 ${
            dragging ? "border-emerald-500 bg-emerald-900/20" : "border-gray-700"
          }`}
        >
          <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700">
            <Upload size={14} />
            Choose PDF file
            <input
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            Drop a PDF here, or choose one. A vector drawing becomes editable
            walls you can select and move; a scan is placed as a background
            image to trace. Set the scale before importing. Fully local —
            nothing is uploaded.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
            Limits: PDF only — .ai and .eps are not supported. A PDF carries no
            wall/door information, so a vector import transcribes every visible
            line, title block and dimension line included; prune what you do
            not need.
          </p>
        </div>
      )}

      {stage === "reading" && (
        <p className="text-xs text-gray-400">{PHASE_LABELS[phase] || "Opening PDF"}…</p>
      )}

      {stage === "pages" && survey && (
        <div>
          <p className="mb-1 text-xs text-gray-300">
            <span className="font-medium text-white">{file?.name}</span> has {survey.pageCount} pages
            {survey.surveyedCount < survey.pageCount
              ? ` (first ${survey.surveyedCount} surveyed)`
              : ""}{" "}
            — which one should be imported?
          </p>
          <ul className="mb-2 max-h-52 space-y-1 overflow-y-auto">
            {survey.pages.map((page) => (
              <li key={page.pageNumber} className="rounded bg-gray-800 px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-white">
                    <span className="text-gray-500">{page.pageNumber}.</span>{" "}
                    {page.widthIn}″ × {page.heightIn}″
                  </span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">
                    {PAGE_KIND_LABELS[page.kind] || page.kind}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-gray-500">{page.kindReason}</p>
                <div className="mt-1 flex gap-1">
                  {page.kind !== "raster" && (
                    <button
                      onClick={() => runPrepare(file, page.pageNumber, "vector")}
                      className="rounded bg-gray-700 px-2 py-0.5 text-[11px] text-white hover:bg-gray-600"
                    >
                      As editable walls
                    </button>
                  )}
                  <button
                    onClick={() => runPrepare(file, page.pageNumber, "raster")}
                    className="rounded bg-gray-700 px-2 py-0.5 text-[11px] text-white hover:bg-gray-600"
                  >
                    As image underlay
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button onClick={reset} className="text-[11px] text-gray-500 hover:text-gray-300">
            Cancel
          </button>
        </div>
      )}

      {stage === "preparing" && (
        <p className="text-xs text-gray-400">{PHASE_LABELS[phase] || "Working"}…</p>
      )}

      {stage === "preview" && prepared && (
        <div>
          <p className="text-xs text-gray-300">
            <span className="font-medium text-white">Page {prepared.pageNumber}</span> —{" "}
            {prepared.pageSizeIn.widthIn}″ × {prepared.pageSizeIn.heightIn}″,{" "}
            {PAGE_KIND_LABELS[prepared.pageKind.kind] || prepared.pageKind.kind}.
          </p>

          {prepared.mode === "vector" ? (
            <>
              <dl className="mt-2 space-y-0.5 text-xs text-gray-400">
                <div className="flex justify-between">
                  <dt>Editable wall segments</dt>
                  <dd className="text-gray-200">{prepared.counts.walls}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Paths skipped</dt>
                  <dd className="text-gray-200">{prepared.counts.skippedPaths}</dd>
                </div>
                {prepared.bounds && (
                  <div className="flex justify-between">
                    <dt>Imported extent</dt>
                    <dd className="text-gray-200">
                      {feetInchesLabel(prepared.bounds.width)} × {feetInchesLabel(prepared.bounds.height)}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-3 rounded bg-gray-800/60 p-2">
                <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-white">
                  <Ruler size={12} /> Scale — currently {prepared.scale.label}
                </p>
                <div className="mb-1 flex gap-2 text-[11px]">
                  <label className="inline-flex items-center gap-1 text-gray-300">
                    <input
                      type="radio"
                      name="pdf-scale-mode"
                      checked={scaleMode === "preset"}
                      onChange={() => setScaleMode("preset")}
                    />
                    Plot scale
                  </label>
                  <label className="inline-flex items-center gap-1 text-gray-300">
                    <input
                      type="radio"
                      name="pdf-scale-mode"
                      checked={scaleMode === "known"}
                      onChange={() => setScaleMode("known")}
                      disabled={!prepared.longestRun}
                    />
                    Known dimension
                  </label>
                </div>

                {scaleMode === "preset" ? (
                  <label className="block text-[11px] text-gray-400">
                    Drawn at
                    <select
                      value={presetId}
                      onChange={(e) => applyPreset(e.target.value)}
                      aria-label="Plot scale"
                      className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white"
                    >
                      {presets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="text-[11px] text-gray-400">
                    <p>
                      The longest straight line on this page measures{" "}
                      <span className="text-gray-200">
                        {prepared.longestRun ? prepared.longestRun.lengthIn.toFixed(3) : "—"}″
                      </span>{" "}
                      on paper. How long is it in the real world?
                    </p>
                    <div className="mt-1 flex gap-1">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={knownValue}
                        onChange={(e) => setKnownValue(e.target.value)}
                        aria-label="Known real-world length"
                        className="w-20 rounded bg-gray-800 px-2 py-1 text-xs text-white"
                      />
                      <select
                        value={knownUnit}
                        onChange={(e) => setKnownUnit(e.target.value)}
                        aria-label="Known length unit"
                        className="rounded bg-gray-800 px-2 py-1 text-xs text-white"
                      >
                        {KNOWN_UNITS.map((unit) => (
                          <option key={unit.id} value={unit.id}>
                            {unit.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={applyKnownDimension}
                        className="rounded bg-gray-700 px-2 py-1 text-[11px] text-white hover:bg-gray-600"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-2 space-y-1">
                <label className="block text-[11px] text-gray-400">
                  Ignore lines shorter than
                  <span className="ml-1 text-gray-200">{minSegmentIn}″</span>
                  <input
                    type="range"
                    min={1}
                    max={48}
                    value={minSegmentIn}
                    aria-label="Minimum line length"
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setMinSegmentIn(value);
                      void rescale({ minSegmentIn: value });
                    }}
                    className="mt-1 block w-full"
                  />
                </label>
                <label className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                  <input
                    type="checkbox"
                    checked={includeDashed}
                    onChange={(e) => {
                      setIncludeDashed(e.target.checked);
                      void rescale({ includeDashed: e.target.checked });
                    }}
                  />
                  Include dashed lines (centerlines, hidden lines)
                </label>
              </div>
            </>
          ) : (
            <>
              <dl className="mt-2 space-y-0.5 text-xs text-gray-400">
                <div className="flex justify-between">
                  <dt>Rendered</dt>
                  <dd className="text-gray-200">
                    {prepared.plan.widthPx} × {prepared.plan.heightPx} px @ {prepared.plan.dpi} DPI
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Width on the plan</dt>
                  <dd className="text-gray-200">
                    {feetInchesLabel(prepared.plan.pageWidthIn * prepared.scale.factor)}
                  </dd>
                </div>
              </dl>
              <label className="mt-2 block text-[11px] text-gray-400">
                Resolution
                <select
                  value={dpi}
                  aria-label="Render resolution"
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setDpi(value);
                    void runPrepare(file, prepared.pageNumber, "raster", { dpi: value });
                  }}
                  className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white"
                >
                  {[96, 150, 200, 300].map((choice) => (
                    <option key={choice} value={choice}>
                      {choice} DPI
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 text-[11px] text-gray-500">
                Placed beneath the drawing layer. Fine-tune with{" "}
                <span className="text-gray-300">Background underlay → Calibrate scale</span> after
                importing.
              </p>
            </>
          )}

          {error && (
            <p className="mt-2 rounded bg-red-900/40 px-2 py-1 text-[11px] text-red-200">{error}</p>
          )}

          {prepared.issues.length > 0 && issueList(prepared.issues)}

          <div className="mt-3 flex gap-2">
            <button
              onClick={commit}
              className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
            >
              {prepared.mode === "raster" ? "Place this page" : "Import this page"}
            </button>
            <button
              onClick={reset}
              className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {stage === "committing" && <p className="text-xs text-gray-400">Merging…</p>}

      {stage === "done" && (
        <div>
          <p className="flex items-start gap-1 text-xs text-emerald-300">
            <FileText size={14} className="mt-0.5 shrink-0" />
            {report}
          </p>
          {design?.underlay && (
            <button
              onClick={() => dispatch({ type: "SET_TOOL", tool: "calibrate" })}
              className="mt-2 inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-white hover:bg-gray-700"
            >
              <Ruler size={14} />
              Calibrate scale
            </button>
          )}
          <button
            onClick={reset}
            className="ml-2 mt-2 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
          >
            Import another
          </button>
        </div>
      )}

      {stage === "error" && (
        <div>
          <p className="rounded bg-red-900/40 px-2 py-1 text-xs text-red-200">{error}</p>
          <button
            onClick={reset}
            className="mt-2 rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
          >
            Try another file
          </button>
        </div>
      )}
    </div>
  );
}
