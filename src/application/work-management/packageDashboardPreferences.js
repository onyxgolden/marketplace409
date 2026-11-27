// D4.1 package dashboard — device-local presentation preferences.
//
// Pure helpers only: this module never touches window/localStorage, so
// it is testable in node. The component owns the storage access (with
// try/catch — private mode must fall back to defaults, never crash).
//
// Preferences are presentation-only and non-authoritative: which widget
// is hidden, its custom title, and its pivot. The key is versioned and
// scoped by effective owner, validated Forge project, and package —
// the same widget set renders on every package detail page, so a
// package-only scope would bleed a custom title across packages.
// Invalid or corrupt fields are ignored individually; Reset restores
// the documented defaults.

export const PREFERENCES_VERSION = 1;

export const WIDGET_IDS = Object.freeze(["strip", "planning", "cost", "changeOrders"]);

export const DEFAULT_TITLES = Object.freeze({
  strip: "Package",
  planning: "Planning and work plan",
  cost: "Cost split",
  changeOrders: "Change orders and contingency",
});

const DEFAULT_PIVOTS = Object.freeze({
  strip: "cards",
  planning: "bars",
  cost: "donut",
  changeOrders: "strip",
});

const ALLOWED_PIVOTS = Object.freeze({
  strip: ["cards", "table"],
  planning: ["bars", "table"],
  cost: ["donut", "table"],
  changeOrders: ["strip", "table"],
});

export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 80;

function sanitizeKeyPart(value) {
  const cleaned = String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "-");
  return cleaned === "" ? "default" : cleaned;
}

export function preferenceKey({ ownerId, forgeProjectId, packageId }) {
  return [
    `forge-wpp-package-dashboard-v${PREFERENCES_VERSION}`,
    sanitizeKeyPart(ownerId),
    sanitizeKeyPart(forgeProjectId),
    sanitizeKeyPart(packageId),
  ].join(":");
}

export function defaultPreferences() {
  const widgets = {};
  for (const id of WIDGET_IDS) {
    widgets[id] = { hidden: false, title: null, pivot: DEFAULT_PIVOTS[id] };
  }
  return { version: PREFERENCES_VERSION, widgets };
}

/** Validate a custom widget title: trimmed plain text, 1–80 characters, no control characters. */
export function validateWidgetTitle(value) {
  if (typeof value !== "string") return { ok: false, error: "Title must be text." };
  const title = value.trim();
  if (title.length < TITLE_MIN_LENGTH) return { ok: false, error: "Title needs at least 1 character." };
  if (title.length > TITLE_MAX_LENGTH) return { ok: false, error: "Title must be at most 80 characters." };
  if (/[\x00-\x1F\x7F]/.test(title)) return { ok: false, error: "Title must not contain control characters." };
  return { ok: true, title };
}

function parseWidget(raw, id) {
  const fallback = defaultPreferences().widgets[id];
  if (!raw || typeof raw !== "object") return { ...fallback };
  const hidden = typeof raw.hidden === "boolean" ? raw.hidden : false;
  let title = null;
  if (raw.title !== null && raw.title !== undefined) {
    const checked = validateWidgetTitle(raw.title);
    title = checked.ok ? checked.title : null;
  }
  const pivot = ALLOWED_PIVOTS[id].includes(raw.pivot) ? raw.pivot : fallback.pivot;
  return { hidden, title, pivot };
}

/**
 * Parse stored preferences (object or JSON string). Anything corrupt
 * falls back to defaults; a bad field falls back on its own while the
 * valid fields survive.
 */
export function parsePreferences(raw) {
  const defaults = defaultPreferences();
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== "object" || parsed.version !== PREFERENCES_VERSION) return defaults;
  const widgets = {};
  for (const id of WIDGET_IDS) {
    widgets[id] = parseWidget(parsed.widgets?.[id], id);
  }
  return { version: PREFERENCES_VERSION, widgets };
}

export function serializePreferences(prefs) {
  return JSON.stringify(parsePreferences(prefs));
}
