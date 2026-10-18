// Tool-palette (left sidebar) width persistence for the FORGE designer.
//
// Width is stored per signed-in user (DesignerScreen receives userId), so
// users sharing one browser never overwrite each other (D647-004). All
// helpers are pure / storage-guarded and unit-testable; the screen owns the
// React state and the resize listener.

/** Base localStorage key; the per-user key appends ":<userId>". */
export const SIDEBAR_WIDTH_KEY_BASE = "forge-designer-sidebar-width";

/** Legacy key from before per-user storage (read as a one-time fallback). */
const SIDEBAR_WIDTH_KEY_LEGACY = "forge-designer-sidebar-width";

/** Minimum readable palette width in px. */
export const SIDEBAR_MIN_PX = 240;

/**
 * Storage key for a user. Anonymous / missing identities share an
 * "anonymous" key — they cannot be told apart, so a shared key is the only
 * honest option.
 */
export function sidebarWidthKey(userId) {
  const id =
    typeof userId === "string" && userId.trim() ? userId.trim() : "anonymous";
  return `${SIDEBAR_WIDTH_KEY_BASE}:${id}`;
}

/**
 * Clamp a palette width between the readable minimum and half the
 * viewport. Pure: takes the viewport width explicitly so tests can drive
 * shrink scenarios without a window.
 */
export function clampSidebarWidth(px, viewportWidth) {
  const vw =
    typeof viewportWidth === "number" && Number.isFinite(viewportWidth) && viewportWidth > 0
      ? viewportWidth
      : typeof window !== "undefined" && Number.isFinite(window.innerWidth)
        ? window.innerWidth
        : 960;
  const maxPx = Math.floor(vw / 2);
  const n = Number(px);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), SIDEBAR_MIN_PX), Math.max(maxPx, SIDEBAR_MIN_PX));
}

/**
 * Read the stored width for a user, clamped to the current viewport.
 * Returns the width in px, or null when nothing valid is stored (absent,
 * corrupt, or non-numeric). Falls back to the legacy global key once so
 * existing users keep their width after the per-user migration.
 */
export function readSidebarWidth(userId, viewportWidth) {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem(sidebarWidthKey(userId)) ??
      window.localStorage.getItem(SIDEBAR_WIDTH_KEY_LEGACY);
    if (raw == null || raw === "") return null;
    return clampSidebarWidth(Number.parseInt(raw, 10), viewportWidth);
  } catch {
    // Storage may be unavailable (private mode, quota); the default stands.
    return null;
  }
}

/** Persist the width for a user; a null width removes the stored value. */
export function writeSidebarWidth(userId, pxOrNull) {
  if (typeof window === "undefined") return;
  try {
    const key = sidebarWidthKey(userId);
    if (pxOrNull == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(pxOrNull));
  } catch {
    // Storage may be unavailable; the in-memory width still works.
  }
}
