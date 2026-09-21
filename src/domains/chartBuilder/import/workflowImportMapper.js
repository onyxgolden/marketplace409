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
function splitNextSteps(value) {
  return String(value)
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
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
  if (!rawTable || !Array.isArray(rawTable.rows)) {
    throw new ImportError(
      "invalid-table",
      "Workflow mapping needs a parsed table with a rows array."
    );
  }
  const columns = columnIndexes(confirmedMappings);
  const stepCol = columns.get("step");
  const nextStepCol = columns.get("nextStep");
  if (stepCol === undefined || nextStepCol === undefined) {
    throw new ImportError(
      "incomplete-mapping",
      "Workflow import needs confirmed mappings for both Step and Next Step before rows can be mapped."
    );
  }
  const descriptionCol = columns.get("description");
  const ownerCol = columns.get("owner");
  const decisionCol = columns.get("decision");

  const nodes = [];
  const edges = [];
  const rowIssues = [];
  const nodeSources = {};
  const idsByName = new Map(); // normalized step name -> node ids
  const pendingEdges = []; // resolved after every node exists

  for (const row of rawTable.rows) {
    const step = cellValue(row, stepCol);
    if (step === null) {
      rowIssues.push({
        severity: "error",
        message: `Row ${row.rowNumber}: the Step cell is blank. Every workflow step needs a name.`,
        rowNumber: row.rowNumber,
        header: null,
      });
      continue;
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
      sheetName: rawTable.sheetName ?? null,
    };
    pendingEdges.push({ nodeId, nextSteps, decision, rowNumber: row.rowNumber });
  }

  for (const { nodeId, nextSteps, decision, rowNumber } of pendingEdges) {
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

  return { nodes, edges, rowIssues, nodeSources };
}
