"use client";

/**
 * ElevationPrintOverlay — the FORGE elevation print flow (slice 5).
 *
 * Mirrors the ProposalPrintOverlay pattern: a full-screen preview of the
 * ElevationPrintView document at exact Letter-landscape physical dimensions,
 * an @page rule injected only while the overlay is mounted, @media print
 * isolation, then window.print() hands off to the browser/OS print dialog
 * (local printer, Adobe PDF, Save as PDF). JavaScript cannot confirm that
 * printing completed.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import ElevationPrintView, { ELEVATION_PAGE_CSS } from "./ElevationPrintView";

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

export default function ElevationPrintOverlay({ elevation, onClose }) {
  const vp = useViewport();
  const close = useCallback(() => onClose(), [onClose]);

  // @page + print isolation live only while the overlay is mounted.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-forge-print", "");
    style.textContent = `
      ${ELEVATION_PAGE_CSS}
      @media print {
        body.forge-printing > *:not(.forge-print-portal) { display: none !important; }
        body.forge-printing { background: #fff !important; }
        .forge-print-portal {
          position: static !important; inset: auto !important;
          overflow: visible !important; padding: 0 !important;
          background: #fff !important; display: block !important;
        }
        .forge-print-portal .print-chrome { display: none !important; }
        .forge-print-portal .forge-elevation-sheet {
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
  }, [close]);

  if (!elevation || typeof document === "undefined") return null;

  const pxW = 11 * 96;
  const pxH = 8.5 * 96;
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
        <span style={{ fontWeight: 700, fontSize: 14 }}>Print elevation</span>
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
          Prints the live on-screen elevation — the drawing below is what prints.
          Choose your printer, Adobe PDF, or Save as PDF in the print dialog.
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ zoom, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }}>
          <ElevationPrintView elevation={elevation} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
