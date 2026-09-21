// FORGE Chart Builder — org import pipeline (slice 3.2).
//
// One place that runs the whole translation: map rows → build a draft
// document → validate with the canonical validators → build the preview.
// The draft document never touches chart state until the user approves the
// preview; commitOrgImport() stamps deterministic layout positions and
// returns the finished ChartDocument, ready for the existing canvas.
//
// Re-running the pipeline with different confirmed mappings always
// regenerates everything from scratch — nothing is cached across mapping
// changes.

import {
  createChartDocument,
  withParts,
} from "../chartDocument.js";
import { DEFAULT_CHART_BACKGROUND } from "../chartBackground.js";
import { layoutChart } from "../chartLayout.js";
import { ImportError } from "./chartImportTypes.js";
import { mapOrgRows } from "./orgImportMapper.js";
import { validateDraftDocument } from "./importValidator.js";
import { buildImportPreview } from "./importPreviewBuilder.js";

/**
 * Run the full org import pipeline for a table + confirmed mappings.
 *
 * @param {import("./chartImportTypes.js").RawTable} rawTable
 * @param {Array<{headerIndex:number,target:string}>} confirmedMappings
 * @returns {{ draft:{nodes,edges,rowIssues,nodeSources}, draftDoc:object, validation:{valid,issues}, preview:import("./chartImportTypes.js").ImportPreview }}
 */
export function runOrgImportPipeline(rawTable, confirmedMappings) {
  const draft = mapOrgRows(rawTable, confirmedMappings);
  const draftDoc = createChartDocument({
    id: `chart-import-${Date.now().toString(36)}`,
    type: "org",
    nodes: draft.nodes,
    edges: draft.edges,
    background: DEFAULT_CHART_BACKGROUND,
    metadata: { templateId: null },
  });
  const validation = validateDraftDocument(draftDoc);
  const preview = buildImportPreview({
    nodeSources: draft.nodeSources,
    edges: draft.edges,
    mapperIssues: draft.rowIssues,
    validationIssues: validation.issues,
  });
  return { draft, draftDoc, validation, preview };
}

/**
 * Approve the preview and produce the finished chart document. Throws when
 * the pipeline found any error — commits with validation errors are blocked.
 *
 * @param {{draftDoc:object, validation:{valid:boolean}}} pipelineResult
 * @returns {object} layout-stamped ChartDocument for the existing canvas
 */
export function commitOrgImport(pipelineResult) {
  if (!pipelineResult || !pipelineResult.validation) {
    throw new ImportError(
      "no-pipeline",
      "There is no import preview to commit. Run the pipeline first."
    );
  }
  if (!pipelineResult.validation.valid || pipelineResult.preview.errorCount > 0) {
    throw new ImportError(
      "validation-errors",
      "The import has unresolved errors — fix them or go back and adjust the mapping before importing."
    );
  }
  const { draftDoc } = pipelineResult;
  // Same explicit auto-layout the page applies to new template charts;
  // never a side effect of the import itself beyond this commit.
  const positions = layoutChart(draftDoc, null);
  const nodes = draftDoc.nodes.map((node) =>
    Object.freeze({
      ...node,
      position: Object.freeze(positions[node.id] ?? node.position),
    })
  );
  return withParts(draftDoc, { nodes });
}
