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
  if (!rawTable || !Array.isArray(rawTable.rows)) {
    throw new ImportError(
      "invalid-table",
      "Org mapping needs a parsed table with a rows array."
    );
  }
  const columns = columnIndexes(confirmedMappings);
  const nameCol = columns.get("name");
  const supervisorCol = columns.get("supervisor");
  if (nameCol === undefined || supervisorCol === undefined) {
    throw new ImportError(
      "incomplete-mapping",
      "Org import needs confirmed mappings for both Name and Supervisor before rows can be mapped."
    );
  }

  const nodes = [];
  const edges = [];
  const rowIssues = [];
  const nodeSources = {};
  const idsByName = new Map(); // normalized name -> node ids (detects duplicates)
  const pendingEdges = []; // resolved after every node exists

  for (const row of rawTable.rows) {
    const name = cellValue(row, nameCol);
    if (name === null) {
      rowIssues.push({
        severity: "error",
        message: `Row ${row.rowNumber}: the Name cell is blank. Every person needs a name.`,
        rowNumber: row.rowNumber,
        header: null,
      });
      continue;
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
      sheetName: rawTable.sheetName ?? null,
    };
    pendingEdges.push({ nodeId, supervisor, rowNumber: row.rowNumber });
  }

  for (const { nodeId, supervisor, rowNumber } of pendingEdges) {
    // Blank supervisor: the person becomes a root. Multiple roots are allowed.
    if (supervisor === null) continue;
    const matches = idsByName.get(normalizeName(supervisor)) ?? [];
    if (matches.length === 0) {
      rowIssues.push({
        severity: "error",
        message: `Row ${rowNumber}: supervisor "${supervisor}" does not match any person in the file. The reference was left visible instead of creating a missing supervisor.`,
        rowNumber,
        header: null,
      });
      continue;
    }
    if (matches.length > 1) {
      rowIssues.push({
        severity: "error",
        message: `Row ${rowNumber}: supervisor "${supervisor}" matches ${matches.length} people. Ambiguous references are never guessed — rename the rows or disambiguate them.`,
        rowNumber,
        header: null,
      });
      continue;
    }
    const supervisorId = matches[0];
    if (supervisorId === nodeId) {
      rowIssues.push({
        severity: "error",
        message: `Row ${rowNumber}: "${nodeSources[nodeId].name}" lists themselves as their own supervisor.`,
        rowNumber,
        header: null,
      });
      continue;
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

  return { nodes, edges, rowIssues, nodeSources };
}
