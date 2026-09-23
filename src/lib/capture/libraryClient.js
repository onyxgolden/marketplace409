// FORGE Capture Rung 6 — client data layer for the web capture library.
//
// Thin wrappers around the same-origin capture API (the page is behind the
// /auth gate, so the browser sends the session cookie and the API's auth
// guard resolves the owner). No polling anywhere: callers fetch on page
// visit and on explicit user actions only.
//
// Signed URLs are generated server-side at read time (1h expiry) and are
// never persisted by this module.

export const TITLE_MAX = 200;

async function readError(response) {
  try {
    const body = await response.json();
    if (body && typeof body.error === "string" && body.error) return body.error;
  } catch {
    /* fall through to the status-based message */
  }
  return `Request failed (${response.status}).`;
}

export async function fetchLibraryItems() {
  const response = await fetch("/api/capture/library", { credentials: "same-origin" });
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json();
  return Array.isArray(body.items) ? body.items : [];
}

export async function renameCapture(id, title) {
  const clean = String(title || "").trim();
  if (!clean) throw new Error("A non-empty title is required.");
  if (clean.length > TITLE_MAX) {
    throw new Error(`The title must be at most ${TITLE_MAX} characters.`);
  }
  const response = await fetch(`/api/capture/library/${encodeURIComponent(id)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: clean }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json();
  return body.title;
}

// Idempotent: deleting an already-gone capture still succeeds.
export async function deleteCapture(id) {
  const response = await fetch(`/api/capture/library/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await readError(response));
  return true;
}

// Downloads use a freshly generated signed URL: re-read the library (which
// mints new 1h URLs server-side) and open this item's URL. Never persists it.
export async function freshSignedUrlFor(id) {
  const items = await fetchLibraryItems();
  const item = items.find((entry) => entry.id === id);
  if (!item || !item.signedUrl) throw new Error("Capture not found.");
  return item.signedUrl;
}

export function isVideoItem(item) {
  return item && (item.kind === "recording" || item.mime_type === "video/webm");
}
