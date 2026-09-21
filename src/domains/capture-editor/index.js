// FORGE Capture editor — the package's one interface per capability.
// Framework-neutral core: no React, no Next.js, no DOM access. Host
// capabilities (canvas, decoding, storage) arrive as injected dependencies;
// the browser-specific adapters live in hosts.js.

export {
  CAPTURE_SCHEMA_VERSION,
  MAX_SOURCE_DIMENSION,
  MAX_DECODED_BYTES,
  UNDO_DEPTH,
  SUPPORTED_SOURCE_MIME_TYPES,
  SourceRejectedError,
  validateSourceImage,
} from "./limits.js";

export {
  normalizeRect,
  rectCenter,
  geometryBounds,
  pointInRect,
  pointInEllipse,
  distToSegment,
  distToPolyline,
  hitTest,
  moveGeometry,
  resizeRect,
  createViewport,
  imageToScreen,
  screenToImage,
  zoomAt,
  fitViewport,
  clamp,
} from "./geometry.js";

export {
  ANNOTATION_TYPES,
  DEFAULT_STYLE,
  AnnotationError,
  createAnnotation,
  validateGeometry,
  validateAnnotationShape,
  normalizeStyle,
  withGeometry,
  withStyle,
  withText,
  withLock,
  withAnchor,
  renumberSteps,
  isRedaction,
} from "./annotations.js";

export {
  DocumentError,
  createDocument,
  getAnnotation,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  setAnnotationLock,
  moveAnnotation,
  reorderZ,
  annotationCount,
  hydrateDocument,
  DOCUMENT_LIMITS,
} from "./document.js";

export {
  HISTORY_LIMIT,
  emptyHistory,
  commitHistory,
  canUndo,
  canRedo,
  undoHistory,
  redoHistory,
} from "./history.js";

export {
  CURRENT_SCHEMA_VERSION,
  PROJECT_KIND,
  ProjectError,
  UnsupportedVersionError,
  CorruptProjectError,
  canonicalize,
  serializeProject,
  deserializeProject,
} from "./schema.js";

export { drawAnnotation, renderDocument } from "./renderer.js";

export { ExportError, EXPORT_FORMATS, exportMimeForFormat, flattenDocument } from "./exporter.js";

export {
  StorageError,
  createProjectStore,
  saveProject,
  loadProject,
  deleteProject,
  listProjects,
  saveDraft,
  clearDraft,
  recoverDraft,
} from "./storage.js";

export {
  fileSource,
  sniffImageMime,
  bytesToBase64,
  base64ToBytes,
  decodeSourceImage,
  createProjectFromSource,
  browserImageCapabilities,
  browserStorageAdapter,
} from "./hosts.js";
