// FORGE Capture editor — framework-neutral project storage.
// The store persists canonical project JSON through an injected adapter; the
// core never touches localStorage, IndexedDB, the filesystem, or the network.
// Recovery is all-or-nothing: a draft is fully validated before it is ever
// returned, and a corrupt draft can NEVER replace the caller's document —
// recoverDraft() reports { status: "corrupt" } instead of throwing into the
// editor or handing back a half-hydrated document.

import { deserializeProject, serializeProject } from "./schema.js";

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = "StorageError";
  }
}

const PROJECT_PREFIX = "forge.capture.project.";
const DRAFT_KEY = "forge.capture.draft";

const ADAPTER_METHODS = ["getItem", "setItem", "removeItem", "keys"];

function requireAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new StorageError("storage adapter must be an object");
  for (const method of ADAPTER_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw new StorageError(`storage adapter is missing ${method}()`);
    }
  }
}

export function createProjectStore(adapter) {
  requireAdapter(adapter);
  return Object.freeze({ adapter });
}

function projectKey(id) {
  if (typeof id !== "string" || id.length === 0) throw new StorageError("project id must be a non-empty string");
  return PROJECT_PREFIX + id;
}

// Deterministic save: serializeProject() is canonical, so the same document
// always persists the same bytes.
export function saveProject(store, doc) {
  let json;
  try {
    json = serializeProject(doc);
  } catch (e) {
    throw new StorageError(`serialize failed: ${e?.message ?? e}`);
  }
  try {
    store.adapter.setItem(projectKey(doc.id), json);
  } catch (e) {
    throw new StorageError(`save failed: ${e?.message ?? e}`);
  }
  return doc.id;
}

// Returns the hydrated document, or null when nothing is saved under id.
// A corrupt entry throws (ProjectError) — it is never partially returned.
export function loadProject(store, id) {
  let raw;
  try {
    raw = store.adapter.getItem(projectKey(id));
  } catch (e) {
    throw new StorageError(`load failed: ${e?.message ?? e}`);
  }
  if (raw === null || raw === undefined) return null;
  return deserializeProject(raw);
}

export function deleteProject(store, id) {
  try {
    store.adapter.removeItem(projectKey(id));
  } catch (e) {
    throw new StorageError(`delete failed: ${e?.message ?? e}`);
  }
}

export function listProjects(store) {
  let keys;
  try {
    keys = store.adapter.keys();
  } catch (e) {
    throw new StorageError(`list failed: ${e?.message ?? e}`);
  }
  return keys
    .filter((key) => typeof key === "string" && key.startsWith(PROJECT_PREFIX))
    .map((key) => key.slice(PROJECT_PREFIX.length))
    .sort();
}

// --- recoverable draft (autosave slot) ---

export function saveDraft(store, doc) {
  let json;
  try {
    json = serializeProject(doc);
  } catch (e) {
    throw new StorageError(`serialize failed: ${e?.message ?? e}`);
  }
  try {
    store.adapter.setItem(DRAFT_KEY, json);
  } catch (e) {
    throw new StorageError(`draft save failed: ${e?.message ?? e}`);
  }
}

export function clearDraft(store) {
  try {
    store.adapter.removeItem(DRAFT_KEY);
  } catch (e) {
    throw new StorageError(`draft clear failed: ${e?.message ?? e}`);
  }
}

// Never throws corrupt data at the caller and never hands back a partial
// document. The caller decides what to do with { status: "corrupt" }; the
// current document is untouched by construction. The corrupt draft is left in
// place (never silently deleted) so it can be inspected or retried.
export function recoverDraft(store) {
  let raw;
  try {
    raw = store.adapter.getItem(DRAFT_KEY);
  } catch (e) {
    return { status: "error", error: e };
  }
  if (raw === null || raw === undefined) return { status: "missing" };
  try {
    return { status: "ok", doc: deserializeProject(raw) };
  } catch (e) {
    return { status: "corrupt", error: e };
  }
}
