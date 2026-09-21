// FORGE Chart Builder — the package's one interface per capability.
// Framework-neutral core: no React, no Next.js, no DOM access.

export {
  CHART_SCHEMA_VERSION,
  CHART_TYPES,
  NODE_SHAPES,
  ORG_EDGE_TYPES,
  WORKFLOW_EDGE_TYPES,
  EDGE_TYPE_GUIDE,
  ChartError,
  createNode,
  createEdge,
  createChartDocument,
  getNode,
  getEdge,
  withParts,
} from "./chartDocument.js";

export {
  CHART_ACTIONS,
  chartReducer,
  isSupervisorDescendant,
  nodeChildren,
  nodeSupervisor,
} from "./chartReducer.js";

export {
  ORG_ERROR_TYPES,
  WORKFLOW_ERROR_TYPES,
  validateOrgDocument,
  validateWorkflowDocument,
} from "./chartValidation.js";

export {
  CHART_HISTORY_LIMIT,
  emptyChartHistory,
  commitChartAction,
  canUndoChart,
  canRedoChart,
  undoChart,
  redoChart,
} from "./chartHistory.js";

export {
  CHART_TEMPLATE_IDS,
  listChartTemplates,
  getChartTemplate,
  listChartTemplatesByType,
} from "./chartTemplates.js";
