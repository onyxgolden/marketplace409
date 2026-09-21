"use client";

/**
 * PrintSheetOverlay — the single FORGE print flow.
 *
 * Opens a full-screen preview of the selected sheet rendered by
 * SheetPrintView at exact physical dimensions, injects an @page rule for the
 * sheet's paper size, then hands off to the browser/OS print dialog with
 * window.print(). The dialog covers every destination: the local printer,
 * Adobe PDF, Microsoft Print to PDF, and Save as PDF — there are no
 * printer-specific or Adobe-specific adapters. Browser/printer settings in
 * the dialog can override paper size, margins, and scaling; JavaScript
 * cannot confirm that printing completed.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import SheetPrintView, { pageCssForSheet } from "./SheetPrintView";
import { sheetDimensions, sheetSizeLabel } from "@/domains/roomDesigner/sheetCatalog";
import { fitScaleLabel } from "@/domains/roomDesigner/designerDocument";

function useViewport() {
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return vp;
}

export default function PrintSheetOverlay({ design, sheets, initialSheetId, onClose }) {
  const [sheetId, setSheetId] = useState(initialSheetId || sheets[0]?.id);
  const vp = useViewport();
  const sheet = (sheets || []).find((s) => s.id === sheetId) || sheets[0];

  const close = useCallback(() => onClose(), [onClose]);

  // @page + print isolation live only while the overlay is mounted.
  useEffect(() => {
    if (!sheet) return undefined;
    const style = document.createElement("style");
    style.setAttribute("data-forge-print", "");
    style.textContent = `
      ${pageCssForSheet(sheet)}
      @media print {
        body.forge-printing > *:not(.forge-print-portal) { display: none !important; }
        body.forge-printing { background: #fff !important; }
        .forge-print-portal {
          position: static !important; inset: auto !important;
          overflow: visible !important; padding: 0 !important;
          background: #fff !important; display: block !important;
        }
        .forge-print-portal .print-chrome { display: none !important; }
        .forge-print-portal .forge-print-sheet {
          zoom: 1 !important; box-shadow: none !important; margin: 0 !important;
        }
      }
    `;
    document.head.appendChild(style);
    document.body.classList.add("forge-printing");
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      style.remove();
      document.body.classList.remove("forge-printing");
      window.removeEventListener("keydown", onKey);
    };
  }, [sheet, close]);

  if (!sheet || typeof document === "undefined") return null;

  const dims = sheetDimensions(sheet.sizeId, sheet.orientation);
  const pxW = dims.widthIn * 96;
  const pxH = dims.heightIn * 96;
  // Preview only: scale the physical sheet to fit the viewport with CSS zoom
  // (layout-affecting, unlike transform). Print CSS forces zoom back to 1.
  const zoom = Math.min(1, (vp.w - 64) / pxW, (vp.h - 260) / pxH);

  return createPortal(
    <div
      className="forge-print-portal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(0,0,0,0.88)",
        overflow: "auto",
        padding: 24,
      }}
    >
      <div
        className="print-chrome"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          padding: "10px 14px",
          background: "#1f2937",
          borderRadius: 8,
          color: "#fff",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14 }}>Print sheet</span>
        <select
          value={sheet.id}
          onChange={(e) => setSheetId(e.target.value)}
          style={{ background: "#111827", color: "#fff", borderRadius: 6, padding: "6px 8px", fontSize: 13 }}
        >
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {sheetSizeLabel(s.sizeId, s.orientation)} · {fitScaleLabel(s.fitScale)}
            </option>
          ))}
        </select>
        <button
          onClick={() => window.print()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#2563eb",
            color: "#fff",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <Printer size={16} /> Print
        </button>
        <button
          onClick={close}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "#374151",
            color: "#fff",
            borderRadius: 6,
            padding: "8px 12px",
            fontSize: 14,
          }}
        >
          <X size={16} /> Close
        </button>
        <span style={{ fontSize: 12, color: "#9ca3af", flexBasis: "100%" }}>
          Choose your printer, Adobe PDF, or Save as PDF in the print dialog. Paper size,
          margins, and scaling set there override the preview — the dialog&apos;s settings win.
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ zoom, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}>
          <SheetPrintView design={design} sheet={sheet} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
