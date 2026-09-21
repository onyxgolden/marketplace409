// FORGE Chart Builder — workflow import mapper (slice 3.3).
//
// Translation step: RawTable rows → draft step nodes + next-step edges.
// Pure function, no chart mutation; it produces input for
// createChartDocument(), which the canonical workflow validator checks
// before anything is committed. It never guesses: missing or ambiguous
// next-step references are explicit errors, duplicate step names are never
// merged, and the Decision column travels on the edge label so nothing is
// lost.
//
// One model constraint this mapper respects: createEdge() forbids
// from === to (a slice-1 invariant). A step that names itself as its next
// step is valid workflow semantics, but the chart model cannot draw a
// self-loop edge — so it becomes an explicit warning and no edge is created
// for it, rather than failing the import or dropping the reference silently.

import { createEdge, createNode } from "../chartDocument.js";
import { ImportError } from "./chartImportTypes.js";

function cellValue(row, columnIndex) {
  if (columnIndex === undefined || columnIndex === null) return null;
  const value = row.values[columnIndex];
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function columnIndexes(confirmedMappings) {
  const byTarget = new Map();
  for (const mapping of confirmedMappings ?? []) {
    if (
      mapping &&
      typeof mapping.headerIndex === "number" &&
      typeof mapping.target === "string"
    ) {
      byTarget.set(mapping.target, mapping.headerIndex);
    }
  }
  return byTarget;
}

// Split one "next step" cell into individual references. The mapping UI
// tells the user comma/semicolon separate multiple next steps; step names
// are never split on anything else.
// Split one "next step" cell into individual references. The mapping UI
// tells the user comma/semicolon separate multiple next steps; step names
// are never split on anything else.
function splitNextSteps(value) {
  return String(value)
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function validateMapperInput(rawTable) {
  if (!rawTable || !Array.isArray(rawTable.rows)) {
    throw new ImportError(
      "invalid-table",
      "Workflow mapping needs a parsed table with a rows array."
    );
  }
}

function resolveWorkflowColumns(confirmedMappings) {
  const columns = columnIndexes(confirmedMappings);
  const stepCol = columns.get("step");
  const nextStepCol = columns.get("nextStep");
  if (stepCol === undefined || nextStepCol === undefined) {
    throw new ImportError(
      "incomplete-mapping",
      "Workflow import needs confirmed mappings for both Step and Next Step before rows can be mapped."
    );
  }
  return columns;
}

function prepareMapperState() {
  return {
    nodes: [],
    edges: [],
    rowIssues: [],
    nodeSources: {},
    idsByName: new Map(), // normalized step name -> node ids
    pendingEdges: [], // resolved after every node exists
  };
}

/**
 * Yield control back to the event loop so a large mapping run never freezes
 * the browser UI — one setTimeout(0) per chunk boundary.
 */
function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Build one step node from one row (pass 1). Mutates state; pure otherwise.
function buildWorkflowNodeFromRow(row, columns, sheetName, state) {
  const { nodes, rowIssues, nodeSources, idsByName, pendingEdges } = state;
  const stepCol = columns.get("step");
  const nextStepCol = columns.get("nextStep");
  const descriptionCol = columns.get("description");
  const ownerCol = columns.get("owner");
  const decisionCol = columns.get("decision");

  const step = cellValue(row, stepCol);
  if (step === null) {
    rowIssues.push({
      severity: "error",
      message: `Row ${row.rowNumber}: the Step cell is blank. Every workflow step needs a name.`,
      rowNumber: row.rowNumber,
      header: null,
    });
    return;
  }
  const nodeId = `import-row-${row.rowNumber}`;
  const description = cellValue(row, descriptionCol);
  const owner = cellValue(row, ownerCol);
  const fields = {};
  if (description !== null) fields.description = description;
  if (owner !== null) fields.owner = owner;
  nodes.push(
    createNode({
      id: nodeId,
      label: step,
      subtitle: description ?? "",
      fields,
    })
  );
  const key = normalizeName(step);
  if (!idsByName.has(key)) idsByName.set(key, []);
  idsByName.get(key).push(nodeId);
  const nextStepCell = cellValue(row, nextStepCol);
  const nextSteps = nextStepCell === null ? [] : splitNextSteps(nextStepCell);
  const decision = cellValue(row, decisionCol);
  nodeSources[nodeId] = {
    rowNumber: row.rowNumber,
    name: step,
    detail:
      nextSteps.length > 0
        ? `Next: ${nextSteps.join(", ")}`
        : "End step — no next steps",
    nextSteps,
    decision,
    sheetName: sheetName ?? null,
  };
  pendingEdges.push({ nodeId, nextSteps, decision, rowNumber: row.rowNumber });
}

// Resolve one entry's next-step references (pass 2). Mutates state.
function resolveWorkflowNextStepEdges(entry, state) {
  const { edges, rowIssues, nodeSources, idsByName } = state;
  const { nodeId, nextSteps, decision, rowNumber } = entry;
  const seenTargets = new Set();
  nextSteps.forEach((reference, refIndex) => {
    const matches = idsByName.get(normalizeName(reference)) ?? [];
    if (matches.length === 0) {
      rowIssues.push({
        severity: "error",
        message: `Row ${rowNumber}: next step "${reference}" does not match any step in the file. The reference was left visible instead of creating a missing step.`,
        rowNumber,
        header: null,
      });
      return;
    }
    if (matches.length > 1) {
      rowIssues.push({
        severity: "error",
        message: `Row ${rowNumber}: next step "${reference}" matches ${matches.length} steps. Ambiguous references are never guessed — rename the rows or disambiguate them.`,
        rowNumber,
        header: null,
      });
      return;
    }
    const targetId = matches[0];
    if (targetId === nodeId) {
      // The chart model cannot draw self-loop edges (createEdge forbids
      // from === to), so the self-reference is surfaced, not silently
      // dropped — and it does not block the import.
      rowIssues.push({
        severity: "warning",
        message: `Row ${rowNumber}: "${nodeSources[nodeId].name}" names itself as its next step. Self-loop edges are not drawn, so no edge was created for it.`,
        rowNumber,
        header: null,
      });
      return;
    }
    if (seenTargets.has(targetId)) return; // same target listed twice in one cell
    seenTargets.add(targetId);
    edges.push(
      createEdge({
        id: `import-edge-${rowNumber}-${refIndex}`,
        from: nodeId,
        to: targetId,
        label: decision ?? "",
        type: decisionEdgeType(decision),
      })
    );
  });
}

function finalizeMapperState(state) {
  return {
    nodes: state.nodes,
    edges: state.edges,
    rowIssues: state.rowIssues,
    nodeSources: state.nodeSources,
  };
}

function decisionEdgeType(decision) {
  const normalized = normalizeName(decision);
  if (["yes", "y", "true"].includes(normalized)) return "decision-yes";
  if (["no", "n", "false"].includes(normalized)) return "decision-no";
  return "sequence";
}

/**
 * Map normalized spreadsheet rows into draft workflow nodes and edges.
 *
 * Returns { nodes, edges, rowIssues, nodeSources }:
 * - nodes/edges: createNode()/createEdge() output ready for
 *   createChartDocument(). Node ids are `import-row-<rowNumber>` — stable and
 *   unique per spreadsheet row even when step names repeat.
 * - rowIssues: ImportIssue[] for mapper-level problems (blank step, missing
 *   or ambiguous next-step references, self-references). Structural checks
 *   (start nodes, disconnected warnings) are the validator's job.
 * - nodeSources: { [nodeId]: { rowNumber, name, detail, ... } } so the
 *   preview builder can trace validator findings back to spreadsheet rows.
 *
 * @param {import("./chartImportTypes.js").RawTable} rawTable
 * @param {Array<{headerIndex:number,target:string}>} confirmedMappings
 */
export function mapWorkflowRows(rawTable, confirmedMappings) {
  validateMapperInput(rawTable);
  const columns = resolveWorkflowColumns(confirmedMappings);
  const state = prepareMapperState();
  const sheetName = rawTable.sheetName;

  for (const row of rawTable.rows) {
    buildWorkflowNodeFromRow(row, columns, sheetName, state);
  }
  for (const entry of state.pendingEdges) {
    resolveWorkflowNextStepEdges(entry, state);
  }
  return finalizeMapperState(state);
}

/**
 * Chunked variant of mapWorkflowRows for large files: identical output, but
 * it yields to the event loop between chunks so the browser UI stays
 * responsive. Reports progress through
 * options.onProgress({ phase, processed, total }).
 *
 * @param {import("./chartImportTypes.js").RawTable} rawTable
 * @param {Array<{headerIndex:number,target:string}>} confirmedMappings
 * @param {{ chunkSize?: number, onProgress?: (p:{phase:string,processed:number,total:number})=>void }} options
 */
export async function mapWorkflowRowsChunked(rawTable, confirmedMappings, options = {}) {
  validateMapperInput(rawTable);
  const columns = resolveWorkflowColumns(confirmedMappings);
  const { chunkSize = 2000, onProgress } = options;
  const state = prepareMapperState();
  const sheetName = rawTable.sheetName;
  const rows = rawTable.rows;

  for (let i = 0; i < rows.length; i += chunkSize) {
    for (const row of rows.slice(i, i + chunkSize)) {
      buildWorkflowNodeFromRow(row, columns, sheetName, state);
    }
    onProgress?.({
      phase: "mapping",
      processed: Math.min(i + chunkSize, rows.length),
      total: rows.length,
    });
    await yieldToEventLoop();
  }
  // Next-step references are global: the whole node pass finishes before
  // any edge is resolved, exactly like the synchronous version.
  const pending = state.pendingEdges;
  for (let i = 0; i < pending.length; i += chunkSize) {
    for (const entry of pending.slice(i, i + chunkSize)) {
      resolveWorkflowNextStepEdges(entry, state);
    }
    onProgress?.({
      phase: "edges",
      processed: Math.min(i + chunkSize, pending.length),
      total: pending.length,
    });
    await yieldToEventLoop();
  }
  return finalizeMapperState(state);
}
