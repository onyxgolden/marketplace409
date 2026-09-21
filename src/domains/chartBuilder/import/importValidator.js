// FORGE Chart Builder — import validation adapter (slice 3.2).
//
// Runs the EXISTING slice-1 validators over a draft import document and
// reshapes their findings into the import pipeline's ImportIssue format.
// No new validation logic lives here — org forest rules (no cycles, no
// duplicates, no missing supervisors) and workflow rules (start node
// required) stay exactly what the canvas already enforces.

import {
  validateOrgDocument,
  validateWorkflowDocument,
} from "../chartValidation.js";

/**
 * Validate a draft import document with the canonical validators.
 *
 * @param {object} draftDoc a createChartDocument() result of type "org"|"workflow"
 * @returns {{ valid:boolean, issues:Array<import("./chartImportTypes.js").ImportIssue & {nodeId?:string|null,edgeId?:string|null}> }}
 */
export function validateDraftDocument(draftDoc) {
  if (!draftDoc || (draftDoc.type !== "org" && draftDoc.type !== "workflow")) {
    return {
      valid: false,
      issues: [
        {
          severity: "error",
          message: "The draft import document is not a valid org or workflow chart document.",
          rowNumber: null,
          header: null,
        },
      ],
    };
  }
  const result =
    draftDoc.type === "org"
      ? validateOrgDocument(draftDoc)
      : validateWorkflowDocument(draftDoc);
  return {
    valid: result.valid,
    issues: result.errors.map((finding) => ({
      severity: finding.severity,
      message: finding.message,
      rowNumber: null, // resolved to a spreadsheet row by the preview builder
      header: null,
      nodeId: finding.nodeId ?? null,
      edgeId: finding.edgeId ?? null,
    })),
  };
}
