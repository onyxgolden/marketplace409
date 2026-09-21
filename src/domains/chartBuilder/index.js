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

export {
  CHART_BACKGROUND_CATEGORIES,
  CHART_BACKGROUNDS,
  DEFAULT_CHART_BACKGROUND,
  getChartBackground,
  isValidChartBackgroundId,
  listChartBackgroundsByCategory,
} from "./chartBackground.js";

export {
  LAYOUT_NODE_ORG,
  LAYOUT_NODE_WORKFLOW,
  DEFAULT_LAYOUT_GAPS,
  layoutChart,
  contentBounds,
} from "./chartLayout.js";

export { resolveCanvasDrop } from "./chartInteractions.js";

export { seedChartFromTemplate } from "./chartSeeds.js";

export {
  CHART_DOCUMENT_TYPE,
  PERSISTED_CHART_VERSION,
  ChartPersistenceError,
  serializeChartDocument,
  validatePersistedChartDocument,
  migrateChartDocument,
  deserializeChartDocument,
} from "./chartPersistence.js";

export {
  IMPORT_MODES,
  ORG_TARGETS,
  WORKFLOW_TARGETS,
  REQUIRED_TARGETS,
  ImportError,
  assertImportMode,
  assertTableHasData,
  missingRequiredTargets,
} from "./import/chartImportTypes.js";

export {
  parseCsv,
  parseXlsx,
  normalizeWorkbookSheets,
} from "./import/spreadsheetParser.js";

export {
  detectHeaders,
  produceCandidates,
  normalizeHeader,
} from "./import/headerDetector.js";

export {
  mapOrgRows,
  mapOrgRowsChunked,
} from "./import/orgImportMapper.js";

export {
  mapWorkflowRows,
  mapWorkflowRowsChunked,
} from "./import/workflowImportMapper.js";

export {
  validateDraftDocument,
} from "./import/importValidator.js";

export {
  buildImportPreview,
} from "./import/importPreviewBuilder.js";

export {
  targetsForMode,
  isKnownImportMode,
  validateConfirmedMappings,
} from "./import/importMapping.js";

export {
  runOrgImportPipeline,
  runOrgImportPipelineAsync,
  commitOrgImport,
  runWorkflowImportPipeline,
  runWorkflowImportPipelineAsync,
  commitWorkflowImport,
} from "./import/importPipeline.js";
