// FORGE Chart Builder — import preview builder (slice 3.2).
//
// Human-readable before-commit summary for the wizard's preview step. Pure:
// it reads the mapper output plus validator issues and produces the
// ImportPreview the UI renders. Nothing here mutates any chart.

/**
 * Build the before-commit preview.
 *
 * @param {object} input
 * @param {{[nodeId:string]:{rowNumber:number,name:string,supervisor:string|null}}} input.nodeSources
 * @param {Array} input.edges draft edges (counted only)
 * @param {Array} input.mapperIssues row-level mapper issues
 * @param {Array} input.validationIssues validator issues (rowNumber resolved
 *   through nodeId via nodeSources when the validator did not set one)
 * @returns {import("./chartImportTypes.js").ImportPreview}
 */
export function buildImportPreview({
  nodeSources = {},
  edges = [],
  mapperIssues = [],
  validationIssues = [],
}) {
  const issues = [...mapperIssues, ...validationIssues].map((issue) => {
    const resolved = { ...issue };
    if (
      (resolved.rowNumber === null || resolved.rowNumber === undefined) &&
      resolved.nodeId &&
      nodeSources[resolved.nodeId]
    ) {
      resolved.rowNumber = nodeSources[resolved.nodeId].rowNumber;
    }
    return resolved;
  });
  // Errors first, then warnings; keep the original relative order otherwise.
  issues.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "error" ? -1 : 1;
  });

  const issuesByRow = new Map();
  for (const issue of issues) {
    if (issue.rowNumber !== null && issue.rowNumber !== undefined) {
      if (!issuesByRow.has(issue.rowNumber)) issuesByRow.set(issue.rowNumber, []);
      issuesByRow.get(issue.rowNumber).push(issue);
    }
  }

  const sources = Object.values(nodeSources).sort(
    (a, b) => a.rowNumber - b.rowNumber
  );
  const rowTrace = sources.map((source) => {
    const rowIssues = issuesByRow.get(source.rowNumber) ?? [];
    const firstProblem = rowIssues[0];
    const detail = firstProblem
      ? `${firstProblem.severity === "error" ? "Error" : "Warning"}: ${firstProblem.message}`
      : source.supervisor
        ? `Supervisor: ${source.supervisor}`
        : "Root — no supervisor";
    return { rowNumber: source.rowNumber, label: source.name, detail };
  });

  return {
    nodeCount: sources.length,
    edgeCount: edges.length,
    warningCount: issues.filter((i) => i.severity === "warning").length,
    errorCount: issues.filter((i) => i.severity === "error").length,
    rowTrace,
    issues,
  };
}
