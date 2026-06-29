import { traceExplorerService } from "./TraceExplorerService";

/**
 * useTraceExplorer
 *
 * Lightweight UI helper for drilling into report lines.
 */
export function useTraceExplorer(ledgerContext) {
  const explore = (reportLine) => {
    if (!reportLine) return null;

    return traceExplorerService.exploreReportLine(
      reportLine,
      ledgerContext
    );
  };

  return {
    explore,
  };
}
