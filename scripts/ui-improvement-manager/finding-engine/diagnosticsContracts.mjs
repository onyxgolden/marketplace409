// Fail-closed validation for a UiDiagnosticsSnapshot (the structured DOM/CSSOM facts
// diagnosticsSnapshotScript.mjs gathers). Mirrors repairContracts.mjs's / screenshotManifestContracts.
// mjs's style: reject an unknown/malformed shape at the boundary rather than letting a rule module
// discover a missing field halfway through and produce a wrong or silently-empty finding set.

export class MalformedDiagnosticsSnapshotError extends Error {
  constructor(reason) {
    super(`Malformed UiDiagnosticsSnapshot: ${reason}`);
    this.name = "MalformedDiagnosticsSnapshotError";
    this.reason = reason;
  }
}

function fail(reason) {
  throw new MalformedDiagnosticsSnapshotError(reason);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRect(rect, field) {
  if (typeof rect !== "object" || rect === null) fail(`${field} must be an object`);
  for (const key of ["x", "y", "width", "height"]) {
    if (rect[key] !== undefined && !isFiniteNumber(rect[key])) fail(`${field}.${key} must be a finite number`);
  }
  if (!isFiniteNumber(rect.width) || !isFiniteNumber(rect.height)) fail(`${field} requires numeric width/height`);
  return { x: rect.x ?? 0, y: rect.y ?? 0, width: rect.width, height: rect.height };
}

function validateElement(element, index) {
  if (typeof element !== "object" || element === null) fail(`elements[${index}] must be an object`);
  if (!isNonEmptyString(element.selector)) fail(`elements[${index}].selector must be a non-empty string`);
  if (!isNonEmptyString(element.tagName)) fail(`elements[${index}].tagName must be a non-empty string`);
  const rect = validateRect(element.rect, `elements[${index}].rect`);
  if (typeof element.overflow !== "object" || element.overflow === null) fail(`elements[${index}].overflow must be an object`);
  if (typeof element.computedStyle !== "object" || element.computedStyle === null) fail(`elements[${index}].computedStyle must be an object`);
  if (typeof element.isInteractive !== "boolean") fail(`elements[${index}].isInteractive must be a boolean`);
  if (typeof element.visible !== "boolean") fail(`elements[${index}].visible must be a boolean`);
  return Object.freeze({
    selector: element.selector, tagName: element.tagName, role: element.role ?? null, rect: Object.freeze(rect),
    overflow: Object.freeze({ ...element.overflow }), computedStyle: Object.freeze({ ...element.computedStyle }),
    accessibleName: element.accessibleName ?? "", text: element.text ?? "", isInteractive: element.isInteractive,
    focusVisibleChanged: element.focusVisibleChanged ?? null, visible: element.visible,
  });
}

export function validateDiagnosticsSnapshot(snapshot) {
  if (typeof snapshot !== "object" || snapshot === null) fail("snapshot must be an object");
  const { documentMetrics } = snapshot;
  if (typeof documentMetrics !== "object" || documentMetrics === null) fail("documentMetrics must be an object");
  for (const key of ["scrollWidth", "clientWidth", "scrollHeight", "clientHeight"]) {
    if (!isFiniteNumber(documentMetrics[key])) fail(`documentMetrics.${key} must be a finite number`);
  }
  if (!["light", "dark", "normal"].includes(documentMetrics.colorScheme)) fail('documentMetrics.colorScheme must be "light", "dark", or "normal"');
  if (!Array.isArray(snapshot.elements)) fail("elements must be an array");
  const elements = snapshot.elements.map((element, index) => validateElement(element, index));
  if (!Array.isArray(snapshot.statusMarkers)) fail("statusMarkers must be an array");
  if (!Array.isArray(snapshot.chartMarkers)) fail("chartMarkers must be an array");
  if (!Array.isArray(snapshot.emptyStateMarkers)) fail("emptyStateMarkers must be an array");
  if (!Array.isArray(snapshot.spacingSamples)) fail("spacingSamples must be an array");

  return Object.freeze({
    documentMetrics: Object.freeze({ ...documentMetrics }),
    elements: Object.freeze(elements),
    statusMarkers: Object.freeze(snapshot.statusMarkers.map((m) => Object.freeze({ ...m }))),
    chartMarkers: Object.freeze(snapshot.chartMarkers.map((m) => Object.freeze({ ...m }))),
    emptyStateMarkers: Object.freeze(snapshot.emptyStateMarkers.map((m) => Object.freeze({ ...m }))),
    spacingSamples: Object.freeze(snapshot.spacingSamples.map((m) => Object.freeze({ ...m }))),
  });
}
