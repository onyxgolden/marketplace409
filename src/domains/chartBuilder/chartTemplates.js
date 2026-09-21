// FORGE Chart Builder — initial template library (slice 1).
// Data only: each template is { id, type, defaultNodeStyle, edgeStyle,
// layoutPreset }. Rendering and the layout algorithms arrive in later slices.

export const CHART_TEMPLATE_IDS = Object.freeze([
  "org-classic-hierarchy",
  "org-executive-tree",
  "org-department-columns",
  "org-compact-tv-board",
  "workflow-left-to-right",
  "workflow-swimlane",
  "workflow-decision-tree",
  "workflow-kanban-flow",
]);

const TEMPLATES = Object.freeze([
  Object.freeze({
    id: "org-classic-hierarchy",
    type: "org",
    name: "Classic hierarchy",
    defaultNodeStyle: Object.freeze({ template: "org-classic-hierarchy", shape: "rectangle", color: "#1f6feb" }),
    edgeStyle: Object.freeze({ style: "elbow", color: "#6b7280", width: 2 }),
    layoutPreset: Object.freeze({ algorithm: "tidy-tree", direction: "top-down", siblingGap: 24, levelGap: 64 }),
  }),
  Object.freeze({
    id: "org-executive-tree",
    type: "org",
    name: "Executive tree",
    defaultNodeStyle: Object.freeze({ template: "org-executive-tree", shape: "rounded", color: "#0b3b8f" }),
    edgeStyle: Object.freeze({ style: "elbow", color: "#94a3b8", width: 2 }),
    layoutPreset: Object.freeze({ algorithm: "tidy-tree", direction: "top-down", siblingGap: 40, levelGap: 80, rootCardSize: "large" }),
  }),
  Object.freeze({
    id: "org-department-columns",
    type: "org",
    name: "Department columns",
    defaultNodeStyle: Object.freeze({ template: "org-department-columns", shape: "rectangle", color: "#0e7490" }),
    edgeStyle: Object.freeze({ style: "elbow", color: "#6b7280", width: 2 }),
    layoutPreset: Object.freeze({ algorithm: "column-group", direction: "top-down", groupBy: "fields.department", siblingGap: 24, levelGap: 64 }),
  }),
  Object.freeze({
    id: "org-compact-tv-board",
    type: "org",
    name: "Compact TV board",
    defaultNodeStyle: Object.freeze({ template: "org-compact-tv-board", shape: "pill", color: "#166534" }),
    edgeStyle: Object.freeze({ style: "straight", color: "#9ca3af", width: 1 }),
    layoutPreset: Object.freeze({ algorithm: "compact-grid", direction: "left-right", maxColumns: 6, siblingGap: 16, levelGap: 32 }),
  }),
  Object.freeze({
    id: "workflow-left-to-right",
    type: "workflow",
    name: "Left-to-right process",
    defaultNodeStyle: Object.freeze({ template: "workflow-left-to-right", shape: "rounded", color: "#7c3aed" }),
    edgeStyle: Object.freeze({ style: "elbow", color: "#6b7280", width: 2, arrow: true }),
    layoutPreset: Object.freeze({ algorithm: "layered", direction: "left-right", layerGap: 80, siblingGap: 24 }),
  }),
  Object.freeze({
    id: "workflow-swimlane",
    type: "workflow",
    name: "Swimlane workflow",
    defaultNodeStyle: Object.freeze({ template: "workflow-swimlane", shape: "rounded", color: "#b45309" }),
    edgeStyle: Object.freeze({ style: "elbow", color: "#6b7280", width: 2, arrow: true }),
    layoutPreset: Object.freeze({ algorithm: "swimlane", direction: "left-right", laneBy: "fields.department", laneGap: 48, siblingGap: 24 }),
  }),
  Object.freeze({
    id: "workflow-decision-tree",
    type: "workflow",
    name: "Decision tree",
    defaultNodeStyle: Object.freeze({ template: "workflow-decision-tree", shape: "diamond", color: "#be123c" }),
    edgeStyle: Object.freeze({ style: "straight", color: "#6b7280", width: 2, arrow: true }),
    layoutPreset: Object.freeze({ algorithm: "binary-tree", direction: "top-down", branchGap: 96, levelGap: 80 }),
  }),
  Object.freeze({
    id: "workflow-kanban-flow",
    type: "workflow",
    name: "Kanban-style flow",
    defaultNodeStyle: Object.freeze({ template: "workflow-kanban-flow", shape: "rectangle", color: "#047857" }),
    edgeStyle: Object.freeze({ style: "straight", color: "#9ca3af", width: 1, arrow: true }),
    layoutPreset: Object.freeze({ algorithm: "kanban-columns", direction: "left-right", columnGap: 32, maxRows: 8 }),
  }),
]);

export function listChartTemplates() {
  return TEMPLATES;
}

export function getChartTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export function listChartTemplatesByType(type) {
  return TEMPLATES.filter((t) => t.type === type);
}
