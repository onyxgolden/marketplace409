// FORGE Chart Builder — browser-local chart project repository (slice 4.1).
// Client-side only: charts persist in the browser's localStorage, never on a
// server — slice 4 ships no chart API routes and performs no uploads. The
// stored shape is the persistence envelope from chartPersistence.js.
//
// Every load runs deserialize → validate → migrate, so a corrupt, foreign,
// or newer-version document can never enter canvas state: the adapter throws
// ChartPersistenceError with a human-readable message instead of crashing or
// silently repairing.

import {
  ChartPersistenceError,
  CHART_DOCUMENT_TYPE,
  deserializeChartDocument,
  serializeChartDocument,
} from "./chartPersistence.js";

const DOCUMENT_KEY_PREFIX = "forge.chart.document.";
const INDEX_KEY = "forge.chart.document.index.v1";

function documentKey(documentId) {
  return `${DOCUMENT_KEY_PREFIX}${documentId}`;
}

function getStorage() {
  const storage =
    typeof window !== "undefined" ? window.localStorage : undefined;
  if (!storage) {
    throw new ChartPersistenceError(
      "Browser storage is unavailable, so charts cannot be saved on this device."
    );
  }
  return storage;
}

function readIndex(storage) {
  const raw = storage.getItem(INDEX_KEY);
  if (raw === null || raw === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ChartPersistenceError(
      "The saved-charts list is corrupt and cannot be read.",
      { cause: error }
    );
  }
  if (!Array.isArray(parsed)) {
    throw new ChartPersistenceError("The saved-charts list is corrupt and cannot be read.");
  }
  return parsed;
}

function writeIndex(storage, index) {
  try {
    storage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (error) {
    throw new ChartPersistenceError(
      "Browser storage is full — the chart could not be saved.",
      { cause: error }
    );
  }
}

function writeDocument(storage, documentId, envelope) {
  let raw;
  try {
    raw = JSON.stringify(envelope);
  } catch (error) {
    throw new ChartPersistenceError("The chart could not be saved.", { cause: error });
  }
  try {
    storage.setItem(documentKey(documentId), raw);
  } catch (error) {
    throw new ChartPersistenceError(
      "Browser storage is full — the chart could not be saved.",
      { cause: error }
    );
  }
}

/**
 * Save a chart document under the caller's project (projectId may be null
 * for standalone charts). Re-saving the same chart id updates it in place.
 * @returns {{ documentId: string, savedAt: string }}
 */
export function saveChartProjectDocument({ projectId, chartDocument, title } = {}) {
  if (!chartDocument || typeof chartDocument !== "object") {
    throw new ChartPersistenceError("A chart document is required to save.");
  }
  const storage = getStorage();
  const envelope = serializeChartDocument(chartDocument, { title });
  const documentId = envelope.id;
  const savedAt = new Date().toISOString();
  writeDocument(storage, documentId, envelope);
  const index = readIndex(storage).filter((entry) => entry.documentId !== documentId);
  index.unshift({
    documentId,
    projectId: projectId ?? null,
    title: envelope.title,
    chartType: envelope.content.type,
    updatedAt: envelope.metadata.updatedAt,
    savedAt,
  });
  writeIndex(storage, index);
  return { documentId, savedAt };
}

/**
 * Load a saved chart back into a canvas ChartDocument.
 * Runs deserialize → validate → migrate; corrupt or foreign documents throw
 * ChartPersistenceError with a visible message and never reach canvas state.
 */
export function loadChartProjectDocument(documentId) {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new ChartPersistenceError("A saved chart id is required to load.");
  }
  const storage = getStorage();
  const raw = storage.getItem(documentKey(documentId));
  if (raw === null) {
    throw new ChartPersistenceError(
      `Saved chart "${documentId}" was not found on this device.`
    );
  }
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch (error) {
    throw new ChartPersistenceError(
      "This saved chart is corrupt and cannot be opened.",
      { cause: error }
    );
  }
  // Invariant: documentType "chart" never loads as another document type.
  if (!envelope || envelope.documentType !== CHART_DOCUMENT_TYPE) {
    throw new ChartPersistenceError(
      `Refusing to open: this saved document is a "${envelope?.documentType ?? "unknown"}" document, not a chart.`
    );
  }
  return deserializeChartDocument(envelope);
}

/**
 * Delete a saved chart. Returns true when a chart was removed.
 */
export function deleteChartProjectDocument(documentId) {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new ChartPersistenceError("A saved chart id is required to delete.");
  }
  const storage = getStorage();
  const existed = storage.getItem(documentKey(documentId)) !== null;
  storage.removeItem(documentKey(documentId));
  writeIndex(
    storage,
    readIndex(storage).filter((entry) => entry.documentId !== documentId)
  );
  return existed;
}

/**
 * List saved charts (newest first), optionally filtered by projectId.
 * Returns plain index entries: { documentId, projectId, title, chartType,
 * updatedAt, savedAt }. Never throws on an empty store.
 */
export function listChartProjectDocuments({ projectId } = {}) {
  const storage = getStorage();
  const index = readIndex(storage);
  const filtered =
    projectId === undefined
      ? index
      : index.filter((entry) => entry.projectId === projectId);
  return filtered.map((entry) => ({ ...entry }));
}
