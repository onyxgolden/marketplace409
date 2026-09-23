// HOUSE PLANS (HP-L6) saved-reference bookmarks.
//
// Bookmarks are a per-project user preference ("I want to revisit this
// official source"), stored in localStorage. They are deliberately NOT
// regulatory evidence, project decisions, approval records, or compliance
// artifacts — which is why they stay out of the regulatory_snapshots
// table. The snapshots table remains reserved for point-in-time
// source-metadata capture. Pure localStorage helpers; never throws.

const KEY_PREFIX = "forge-house-plans-bookmarks:";

function storage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function bookmarksKey(projectId) {
  const scope = typeof projectId === "string" && projectId.length > 0 ? projectId : "default";
  return `${KEY_PREFIX}${scope}`;
}

// Reference ids (uuids from the reference library), newest first. [] when
// nothing is saved or storage is unavailable.
export function readBookmarks(projectId) {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(bookmarksKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function writeBookmarks(projectId, ids) {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(bookmarksKey(projectId), JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

export function isBookmarked(projectId, referenceId) {
  if (typeof referenceId !== "string" || referenceId.length === 0) return false;
  return readBookmarks(projectId).includes(referenceId);
}

// Toggles the bookmark; returns the new bookmark list. Never throws.
export function toggleBookmark(projectId, referenceId) {
  if (typeof referenceId !== "string" || referenceId.length === 0) {
    return readBookmarks(projectId);
  }
  const current = readBookmarks(projectId);
  const next = current.includes(referenceId)
    ? current.filter((id) => id !== referenceId)
    : [referenceId, ...current];
  writeBookmarks(projectId, next);
  return next;
}
