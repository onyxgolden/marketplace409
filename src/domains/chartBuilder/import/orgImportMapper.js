// FORGE Chart Builder — org import mapper (slice 3.2).
//
// Translation step: RawTable rows → draft nodes + supervisor edges. This is a
// pure function with no chart mutation; it produces input for
// createChartDocument(), which the validator then checks before anything is
// committed. It never guesses: unknown supervisor names are explicit errors,
// duplicate names are never merged, self-supervision is rejected, and blank
// required cells are reported per row with their original row numbers.

import { createEdge, createNode } from "../chartDocument.js";
import { ImportError } from "./chartImportTypes.js";

const OPTIONAL_ORG_TARGETS = Object.freeze(["title", "department", "location"]);

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

function prepareMapperState() {
  return {
    nodes: [],
    edges: [],
    rowIssues: [],
    nodeSources: {},
    idsByName: new Map(), // normalized name -> node ids (detects duplicates)
    pendingEdges: [], // resolved after every node exists
  };
}

/**
 * Yield control back to the event loop so a large mapping run never freezes
 * the browser UI. One setTimeout(0) per chunk boundary is enough: each
 * chunk does bounded work, and the UI gets a chance to paint between them.
 */
function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Build one node from one row (pass 1). Mutates state; pure otherwise.
function buildOrgNodeFromRow(row, columns, sheetName, state) {
  const { nodes, rowIssues, nodeSources, idsByName, pendingEdges } = state;
  const nameCol = columns.get("name");
  const supervisorCol = columns.get("supervisor");
  const name = cellValue(row, nameCol);
  if (name === null) {
    rowIssues.push({
      severity: "error",
      message: `Row ${row.rowNumber}: the Name cell is blank. Every person needs a name.`,
      rowNumber: row.rowNumber,
      header: null,
    });
    return;
  }
  const nodeId = `import-row-${row.rowNumber}`;
  const fields = {};
  for (const target of OPTIONAL_ORG_TARGETS) {
    const value = cellValue(row, columns.get(target));
    if (value !== null) fields[target] = value;
  }
  const node = createNode({
    id: nodeId,
    label: name,
    subtitle: fields.title ?? "",
    fields,
  });
  nodes.push(node);
  const key = normalizeName(name);
  if (!idsByName.has(key)) idsByName.set(key, []);
  idsByName.get(key).push(nodeId);
  const supervisor = cellValue(row, supervisorCol);
  nodeSources[nodeId] = {
    rowNumber: row.rowNumber,
    name,
    supervisor,
    sheetName: sheetName ?? null,
  };
  pendingEdges.push({ nodeId, supervisor, rowNumber: row.rowNumber });
}

// Resolve one pending supervisor reference (pass 2). Mutates state.
function resolveOrgSupervisorEdge(entry, state) {
  const { edges, rowIssues, nodeSources, idsByName } = state;
  const { nodeId, supervisor, rowNumber } = entry;
  // Blank supervisor: the person becomes a root. Multiple roots are allowed.
  if (supervisor === null) return;
  const matches = idsByName.get(normalizeName(supervisor)) ?? [];
  if (matches.length === 0) {
    rowIssues.push({
      severity: "error",
      message: `Row ${rowNumber}: supervisor "${supervisor}" does not match any person in the file. The reference was left visible instead of creating a missing supervisor.`,
      rowNumber,
      header: null,
    });
    return;
  }
  if (matches.length > 1) {
    rowIssues.push({
      severity: "error",
      message: `Row ${rowNumber}: supervisor "${supervisor}" matches ${matches.length} people. Ambiguous references are never guessed — rename the rows or disambiguate them.`,
      rowNumber,
      header: null,
    });
    return;
  }
  const supervisorId = matches[0];
  if (supervisorId === nodeId) {
    rowIssues.push({
      severity: "error",
      message: `Row ${rowNumber}: "${nodeSources[nodeId].name}" lists themselves as their own supervisor.`,
      rowNumber,
      header: null,
    });
    return;
  }
  edges.push(
    createEdge({
      id: `import-edge-${rowNumber}`,
      from: supervisorId,
      to: nodeId,
      label: "",
      type: "supervisor",
    })
  );
}

function validateMapperInput(rawTable) {
  if (!rawTable || !Array.isArray(rawTable.rows)) {
    throw new ImportError(
      "invalid-table",
      "Org mapping needs a parsed table with a rows array."
    );
  }
}

function resolveOrgColumns(confirmedMappings) {
  const columns = columnIndexes(confirmedMappings);
  const nameCol = columns.get("name");
  const supervisorCol = columns.get("supervisor");
  if (nameCol === undefined || supervisorCol === undefined) {
    throw new ImportError(
      "incomplete-mapping",
      "Org import needs confirmed mappings for both Name and Supervisor before rows can be mapped."
    );
  }
  return columns;
}

function finalizeOrgState(state) {
  return {
    nodes: state.nodes,
    edges: state.edges,
    rowIssues: state.rowIssues,
    nodeSources: state.nodeSources,
  };
}

/**
 * Map normalized spreadsheet rows into draft org nodes and supervisor edges.
 *
 * Returns { nodes, edges, rowIssues, nodeSources }:
 * - nodes/edges: createNode()/createEdge() output ready for
 *   createChartDocument(). Node ids are `import-row-<rowNumber>` — stable and
 *   unique per spreadsheet row even when names repeat.
 * - rowIssues: ImportIssue[] for mapper-level problems (blank name, missing
 *   or ambiguous supervisor, self-supervision). Structural checks (cycles,
 *   duplicate labels) are the validator's job and run on the draft document.
 * - nodeSources: { [nodeId]: { rowNumber, name, supervisor } } so the preview
 *   builder can trace validator findings back to spreadsheet rows.
 *
 * @param {import("./chartImportTypes.js").RawTable} rawTable
 * @param {Array<{headerIndex:number,target:string}>} confirmedMappings
 */
export function mapOrgRows(rawTable, confirmedMappings) {
  validateMapperInput(rawTable);
  const columns = resolveOrgColumns(confirmedMappings);
  const state = prepareMapperState();
  const sheetName = rawTable.sheetName;

  for (const row of rawTable.rows) {
    buildOrgNodeFromRow(row, columns, sheetName, state);
  }
  for (const entry of state.pendingEdges) {
    resolveOrgSupervisorEdge(entry, state);
  }
  return finalizeOrgState(state);
}

/**
 * Chunked variant of mapOrgRows for large files: identical output, but it
 * yields to the event loop between chunks so the browser UI stays responsive.
 * Reports progress through options.onProgress({ phase, processed, total }).
 *
 * @param {import("./chartImportTypes.js").RawTable} rawTable
 * @param {Array<{headerIndex:number,target:string}>} confirmedMappings
 * @param {{ chunkSize?: number, onProgress?: (p:{phase:string,processed:number,total:number})=>void }} options
 */
export async function mapOrgRowsChunked(rawTable, confirmedMappings, options = {}) {
  validateMapperInput(rawTable);
  const columns = resolveOrgColumns(confirmedMappings);
  const { chunkSize = 2000, onProgress } = options;
  const state = prepareMapperState();
  const sheetName = rawTable.sheetName;
  const rows = rawTable.rows;

  for (let i = 0; i < rows.length; i += chunkSize) {
    for (const row of rows.slice(i, i + chunkSize)) {
      buildOrgNodeFromRow(row, columns, sheetName, state);
    }
    onProgress?.({
      phase: "mapping",
      processed: Math.min(i + chunkSize, rows.length),
      total: rows.length,
    });
    await yieldToEventLoop();
  }
  // Supervisor references are global: the whole node pass finishes before
  // any edge is resolved, exactly like the synchronous version.
  const pending = state.pendingEdges;
  for (let i = 0; i < pending.length; i += chunkSize) {
    for (const entry of pending.slice(i, i + chunkSize)) {
      resolveOrgSupervisorEdge(entry, state);
    }
    onProgress?.({
      phase: "edges",
      processed: Math.min(i + chunkSize, pending.length),
      total: pending.length,
    });
    await yieldToEventLoop();
  }
  return finalizeOrgState(state);
}
