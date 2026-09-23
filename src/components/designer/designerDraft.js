/**
 * Crash-resilience: localStorage autosave drafts for the designer.
 *
 * The designer historically saved only on explicit user action (Ctrl+S /
 * Save button). A page crash therefore lost everything since the last save.
 * This module snapshots the project envelope to localStorage ~2s after edits
 * stop, so a crash or accidental tab close can offer recovery on next load.
 *
 * Client-side only: no API, no migrations, no cost. Drafts are keyed by
 * project id; the envelope already carries levels[] + currentLevelId, so one
 * key covers the whole project. Schema versions are explicit and rejected
 * gracefully — an incompatible draft is ignored, never applied.
 */
export const DRAFT_SCHEMA_VERSION = 1;

const DRAFT_KEY_PREFIX = "forge-designer-draft:";
const SAVED_KEY_PREFIX = "forge-designer-saved:";

export function draftKey(projectId) {
  return `${DRAFT_KEY_PREFIX}${projectId}`;
}

export function savedRecordKey(projectId) {
  return `${SAVED_KEY_PREFIX}${projectId}`;
}

function storage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readJson(store, key) {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Read and validate the autosave draft. Returns null when there is no
 * draft, storage is unavailable, or the draft is incompatible/corrupt —
 * recovery must reject those gracefully and load the server revision.
 */
export function readDraft(projectId) {
  const store = storage();
  if (!store) return null;
  const draft = readJson(store, draftKey(projectId));
  if (!draft || draft.schemaVersion !== DRAFT_SCHEMA_VERSION) return null;
  if (!Number.isFinite(draft.designRevision)) return null;
  if (!draft.envelope || typeof draft.envelope !== "object") return null;
  if (!Array.isArray(draft.envelope.levels)) return null;
  return draft;
}

/**
 * The last revision successfully persisted to the server. LocalStorage is
 * the authority of record here: saves are serialized, so the newest
 * completed save is always the server's revision.
 */
export function readSavedRecord(projectId) {
  const store = storage();
  if (!store) return null;
  const record = readJson(store, savedRecordKey(projectId));
  if (!record || !Number.isFinite(record.designRevision)) return null;
  return record;
}

export function writeSavedRecord(projectId, designRevision) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(
      savedRecordKey(projectId),
      JSON.stringify({ designRevision, savedAt: Date.now() }),
    );
  } catch {
    // A failed bookkeeping write must never break the save flow.
  }
}

export function deleteDraft(projectId) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(draftKey(projectId));
  } catch {
    // Best effort only.
  }
}

export function isQuotaError(error) {
  return (
    !!error &&
    (error.name === "QuotaExceededError" || error.code === 22 || error.code === 1014)
  );
}

/**
 * Strip base64 underlay images from every level design so the draft fits
 * under the ~5MB localStorage quota. Returns the slim envelope and whether
 * anything was omitted (surfaced in the recovery dialog).
 */
export function stripUnderlayDataUrls(envelope) {
  let stripped = 0;
  const levels = (envelope.levels || []).map((level) => {
    const design = level && level.design;
    if (design && design.underlay && typeof design.underlay.dataUrl === "string") {
      stripped += 1;
      return {
        ...level,
        design: {
          ...design,
          underlay: { ...design.underlay, dataUrl: null },
        },
      };
    }
    return level;
  });
  return { envelope: { ...envelope, levels }, underlayOmitted: stripped > 0 };
}

/**
 * Persist an autosave draft. On quota exhaustion, retry once with underlay
 * images stripped (user-approved). Never throws; autosave must never break
 * the editor.
 */
export function writeDraft(projectId, { designRevision, envelope }) {
  const store = storage();
  if (!store) return { ok: false, error: "no-storage" };
  const payload = {
    schemaVersion: DRAFT_SCHEMA_VERSION,
    savedAt: Date.now(),
    designRevision,
    envelope,
  };
  try {
    store.setItem(draftKey(projectId), JSON.stringify(payload));
    return { ok: true, underlayOmitted: false, savedAt: payload.savedAt };
  } catch (error) {
    if (!isQuotaError(error)) return { ok: false, error: "write-failed" };
    try {
      const { envelope: slim, underlayOmitted } = stripUnderlayDataUrls(envelope);
      const slimPayload = { ...payload, envelope: slim, underlayOmitted: true };
      store.setItem(draftKey(projectId), JSON.stringify(slimPayload));
      return { ok: true, underlayOmitted, savedAt: payload.savedAt };
    } catch {
      return { ok: false, error: "quota" };
    }
  }
}

/** Recovery authority is revision comparison; timestamps are display-only. */
export function isNewerDraft(draft, serverRevision) {
  return !!draft && draft.designRevision > serverRevision;
}
