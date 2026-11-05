"use client";

/**
 * Home plan import (H1/G5) — "Import existing plan".
 *
 * The prominent home-mode action for bringing an existing home reference
 * plan in as a CALIBRATED UNDERLAY. One click from the Home — Design
 * surface, home-mode gated (the industrial path never renders this panel).
 *
 * What it does, and nothing more:
 *   image (PNG/JPEG/WebP/GIF/TIFF/BMP) -> decodeUnderlayFile -> preview ->
 *     explicit commit -> SET_UNDERLAY (locked by default)
 *   local PDF -> listPdfPages -> pick ONE page -> preparePdfImport in
 *     raster mode ONLY -> preview -> explicit commit -> SET_UNDERLAY
 *     (locked by default). The vector path of PdfImportPanel is never
 *     offered here: a home reference import creates ZERO native walls or
 *     rooms, ever.
 *
 * The imported plan stays REFERENCE ARTWORK: it does not become editable
 * FORGE walls/rooms, and no area, finish, or dimension is computed from
 * it. Printed dimensions on it remain the source plan's own artwork.
 *
 * Safety: preview-and-commit only — Cancel/Discard dispatches nothing,
 * so the prior underlay stays intact. Replacing an existing underlay
 * needs an explicit confirmation. Everything runs locally in the browser;
 * nothing is uploaded, no URL import, no cloud conversion, no model call.
 * SVG/HTML uploads are refused as active content, never rendered.
 */

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import {
  ACTIVE_CONTENT_REFUSAL,
  decodeUnderlayFile,
  isActiveContentFile,
  UNDERLAY_ACCEPT,
  UNDERLAY_ACCEPT_LABEL,
} from "./underlayImage";

const PDF_DPI_CHOICES = [96, 150, 200, 300];

export const HOME_IMPORT_NO_REDRAW_COPY =
  "Reference artwork only — this plan stays a picture. It does not become editable FORGE walls or rooms, and no area, finish, or dimension is computed from it. Printed dimensions on it are the source plan's own, not FORGE measurements.";

async function importerModule() {
  return import("@/domains/roomDesigner/importers/pdf/pdfImporter");
}

export default function HomePlanImportPanel({ design, dispatch, onClose }) {
  const [stage, setStage] = useState("idle");
  const [file, setFile] = useState(null);
  const [fileKind, setFileKind] = useState(null);
  const [decoded, setDecoded] = useState(null);
  const [survey, setSurvey] = useState(null);
  const [prepared, setPrepared] = useState(null);
  const [dpi, setDpi] = useState(150);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [printInclude, setPrintInclude] = useState(true);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const hasExisting = Boolean(design?.underlay);
  const canCommit = !hasExisting || replaceConfirmed;

  const fail = (err) => {
    if (!aliveRef.current) return;
    setError(err?.message || "Could not import that file.");
    setStage("error");
  };

  const reset = () => {
    setStage("idle");
    setFile(null);
    setFileKind(null);
    setDecoded(null);
    setSurvey(null);
    setPrepared(null);
    setReplaceConfirmed(false);
    setPrintInclude(true);
    setError(null);
    setReport(null);
  };

  const runPdfPrepare = async (candidate, pageNumber, nextDpi) => {
    setStage("preparing");
    try {
      const { preparePdfImport } = await importerModule();
      const result = await preparePdfImport(candidate, {
        pageNumber,
        mode: "raster",
        dpi: nextDpi,
        fileName: candidate.name || "pdf",
      });
      if (!aliveRef.current) return;
      setPrepared(result);
      setError(null);
      setStage("pdf-preview");
    } catch (err) {
      fail(err);
    }
  };

  const onFile = async (candidate) => {
    setError(null);
    setReport(null);
    if (!candidate) return;
    if (isActiveContentFile(candidate)) {
      setError(ACTIVE_CONTENT_REFUSAL);
      setStage("error");
      return;
    }
    const lowerName = String(candidate.name || "").toLowerCase();
    const isPdf = lowerName.endsWith(".pdf") || candidate.type === "application/pdf";
    if (isPdf) {
      const { checkPdfFileSupported } = await import(
        "@/domains/roomDesigner/importers/pdf/pdfErrors"
      );
      const check = checkPdfFileSupported({ name: candidate.name || "", type: candidate.type || "" });
      if (!check.ok) {
        setError(check.message);
        setStage("error");
        return;
      }
      setFile(candidate);
      setFileKind("pdf");
      setStage("reading");
      try {
        const { listPdfPages } = await importerModule();
        const result = await listPdfPages(candidate);
        if (!aliveRef.current) return;
        setSurvey(result);
        if (result.pages.length === 1) {
          await runPdfPrepare(candidate, 1, dpi);
        } else {
          setStage("pages");
        }
      } catch (err) {
        fail(err);
      }
      return;
    }
    if (candidate.type && candidate.type.startsWith("image/")) {
      setFile(candidate);
      setFileKind("image");
      setStage("preparing");
      try {
        const result = await decodeUnderlayFile(candidate);
        if (!aliveRef.current) return;
        setDecoded(result);
        setError(null);
        setStage("preview");
      } catch (err) {
        fail(err);
      }
      return;
    }
    setError(`Choose an image (${UNDERLAY_ACCEPT_LABEL}) or a PDF file.`);
    setStage("error");
  };

  const commitImage = () => {
    if (!decoded || !canCommit) return;
    dispatch({
      type: "SET_UNDERLAY",
      underlay: { name: file?.name || "reference plan", ...decoded, locked: true, printInclude },
    });
    setReport(
      `Reference plan placed and locked. Calibrate its scale next so measurements over it are true.`,
    );
    setStage("done");
  };

  const commitPdf = () => {
    if (!prepared?.image || !canCommit) return;
    dispatch({
      type: "SET_UNDERLAY",
      underlay: { ...prepared.image, locked: true, printInclude },
    });
    setReport(
      `Page ${prepared.pageNumber} placed as a locked reference image, ${prepared.plan.widthPx} × ${prepared.plan.heightPx} px. Calibrate its scale next so measurements over it are true.`,
    );
    setStage("done");
  };

  const previewSrc = decoded?.dataUrl || prepared?.image?.dataUrl || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import existing plan"
      data-testid="home-import-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-gray-900 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <ImagePlus size={18} /> Import existing plan
          </h2>
          <button
            onClick={onClose}
            aria-label="Close import"
            data-testid="home-import-close"
            className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-gray-400">{HOME_IMPORT_NO_REDRAW_COPY}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Fully local — the file never leaves this browser. No URL import, no cloud conversion.
        </p>

        {stage === "idle" && (
          <div className="mt-4">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
              <ImagePlus size={14} />
              Choose plan file
              <input
                type="file"
                accept={`${UNDERLAY_ACCEPT},.pdf,application/pdf`}
                data-testid="home-import-file"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </label>
            <p className="mt-1 text-[11px] text-gray-500">
              {UNDERLAY_ACCEPT_LABEL} image, or a PDF (one page is placed as a reference image).
            </p>
          </div>
        )}

        {(stage === "reading" || stage === "preparing") && (
          <p className="mt-4 text-xs text-gray-400">
            {stage === "reading" ? "Reading pages…" : "Preparing preview…"}
          </p>
        )}

        {stage === "pages" && survey && (
          <div className="mt-4">
            <p className="mb-2 text-xs text-gray-300">
              <span className="font-medium text-white">{file?.name}</span> has {survey.pageCount}{" "}
              pages — which one should be placed as the reference image?
            </p>
            <ul className="mb-2 max-h-52 space-y-1 overflow-y-auto" data-testid="home-import-pdf-pages">
              {survey.pages.map((page) => (
                <li key={page.pageNumber} className="rounded bg-gray-800 px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-white">
                      <span className="text-gray-500">{page.pageNumber}.</span> {page.widthIn}″ ×{" "}
                      {page.heightIn}″
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                      {page.kind}
                    </span>
                  </div>
                  <button
                    onClick={() => runPdfPrepare(file, page.pageNumber, dpi)}
                    className="mt-1 rounded bg-gray-700 px-2 py-0.5 text-[11px] text-white hover:bg-gray-600"
                  >
                    Preview this page as reference image
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={reset} className="text-[11px] text-gray-500 hover:text-gray-300">
              Choose another file
            </button>
          </div>
        )}

        {(stage === "preview" || stage === "pdf-preview") && previewSrc && (
          <div className="mt-4" data-testid="home-import-preview">
            <p className="mb-2 text-xs text-gray-300">
              Preview — inspect before committing. Nothing is placed until you commit.
            </p>
            <div className="rounded border border-gray-700 bg-white p-1">
              {/* Plain <img>: the preview is a local data URL, never a
                  remote image next/image could optimize. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewSrc} alt="Reference plan preview" className="max-h-64 w-full object-contain" />
            </div>
            {stage === "preview" && decoded && (
              <p className="mt-1 text-[11px] text-gray-500">
                {decoded.widthPx} × {decoded.heightPx} px · {decoded.mimeType}
              </p>
            )}
            {stage === "pdf-preview" && prepared && (
              <>
                <p className="mt-1 text-[11px] text-gray-500">
                  Page {prepared.pageNumber} — {prepared.plan.widthPx} × {prepared.plan.heightPx} px
                  @ {prepared.plan.dpi} DPI
                </p>
                {prepared.pageKind?.kind === "mixed" && (
                  <p className="mt-1 text-[11px] text-amber-300">
                    This page mixes vector lines and a scanned image; it is placed as one flat
                    reference image — no editable walls are created.
                  </p>
                )}
                <label className="mt-2 block text-[11px] text-gray-400">
                  Resolution
                  <select
                    value={dpi}
                    aria-label="Render resolution"
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setDpi(value);
                      void runPdfPrepare(file, prepared.pageNumber, value);
                    }}
                    className="mt-1 block w-full rounded bg-gray-800 px-2 py-1 text-xs text-white"
                  >
                    {PDF_DPI_CHOICES.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice} DPI
                      </option>
                    ))}
                  </select>
                </label>
                {prepared.issues?.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] text-gray-400">
                    {prepared.issues.map((issue, i) => (
                      <li key={i}>{issue.message}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {hasExisting && (
              <label className="mt-3 flex items-start gap-2 text-xs text-amber-200">
                <input
                  type="checkbox"
                  checked={replaceConfirmed}
                  onChange={(e) => setReplaceConfirmed(e.target.checked)}
                  data-testid="home-import-replace-confirm"
                  className="mt-0.5"
                />
                Replace the existing reference plan (“{design.underlay.name}”). The old image can
                be restored with Undo.
              </label>
            )}
            <label className="mt-2 flex items-start gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={printInclude}
                onChange={(e) => setPrintInclude(e.target.checked)}
                data-testid="home-import-print-include"
                className="mt-0.5"
              />
              Include this reference image when printing (you can change this later; the print
              preview freezes whatever you chose when it opened).
            </label>
            {!canCommit && (
              <p className="mt-1 text-[11px] text-amber-300">
                Confirm the replacement above before committing.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                onClick={stage === "preview" ? commitImage : commitPdf}
                disabled={!canCommit}
                data-testid="home-import-commit"
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                Place reference plan
              </button>
              <button
                onClick={reset}
                data-testid="home-import-cancel"
                className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">
              Cancel leaves the current reference plan (if any) exactly as it was.
            </p>
          </div>
        )}

        {stage === "done" && (
          <div className="mt-4">
            <p className="text-xs text-emerald-300">{report}</p>
            <p className="mt-1 text-[11px] text-gray-500">
              The plan starts locked so it cannot be dragged by accident. Unlock it from the
              reference-plan controls to reposition it.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => {
                  dispatch({ type: "SET_TOOL", tool: "calibrate" });
                  onClose();
                }}
                className="rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700"
              >
                Calibrate scale
              </button>
              <button
                onClick={onClose}
                className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {stage === "error" && (
          <div className="mt-4">
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
    </div>
  );
}
