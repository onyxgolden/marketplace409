// FORGE Chart Builder — print / PDF export (slice 4.3).
// Builds a printable, chrome-free rendering of a chart and opens the browser
// print dialog (Print to PDF) exactly once. The static SVG comes from the
// slice 4.2 serializer, so the printed chart matches the exported SVG —
// no toolbar, no inspector, no handles, no grid controls.

import { exportChartSvg, ChartExportError } from "./chartExportSvg.js";

export class ChartPrintError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChartPrintError";
  }
}

function toPrintError(error) {
  if (error instanceof ChartPrintError) return error;
  if (error instanceof ChartExportError) {
    return new ChartPrintError(`Cannot print this chart: ${error.message}`);
  }
  return new ChartPrintError(
    error instanceof Error ? `Cannot print this chart: ${error.message}` : "Cannot print this chart."
  );
}

/**
 * Build the printable rendering of a chart document.
 * @returns {{ id: string, title: string, svg: string, width: number, height: number }}
 * @throws {ChartPrintError} when the document cannot be exported
 */
export function createPrintableChart(chartDocument) {
  try {
    const { svg, width, height } = exportChartSvg(chartDocument, {
      title: `${chartDocument?.type === "workflow" ? "Workflow chart" : "Org chart"}`,
    });
    return {
      id: chartDocument.id,
      title: chartDocument.type === "workflow" ? "Workflow chart" : "Org chart",
      svg,
      width,
      height,
    };
  } catch (error) {
    throw toPrintError(error);
  }
}

/**
 * Validate the chart, then open the browser print dialog exactly once.
 * The caller is responsible for showing the printable view (ChartPrintView)
 * before invoking this, so the dialog captures the chart and not the app.
 * @returns the printable chart, for the caller to render
 * @throws {ChartPrintError} when the document is invalid or printing is unavailable
 */
export function printChart(chartDocument) {
  const printable = createPrintableChart(chartDocument);
  if (typeof window === "undefined" || typeof window.print !== "function") {
    throw new ChartPrintError("Printing is not available in this environment.");
  }
  window.print();
  return printable;
}
