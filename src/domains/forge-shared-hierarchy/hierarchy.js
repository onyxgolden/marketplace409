// FORGE shared client -> site -> project foundation (PR A).
//
// Pure domain module: validation, normalization, and the selector state
// transitions. No I/O, no database, no imports — the application service
// and the API route share these rules, and the database migration enforces
// the same bounds again server-side (never trust the client).
//
// Scope: results/chatgpt/shared-client-site-project-foundation-scope-2026-11-11.md
// (PR A only). Identity only — no billing fields exist anywhere here.

export const HIERARCHY_CAPABILITY_READ = "forge.hierarchy.read";
export const HIERARCHY_CAPABILITY_MANAGE = "forge.hierarchy.manage";

export const CLIENT_STATUSES = Object.freeze(["active", "inactive", "archived"]);
export const SITE_STATUSES = Object.freeze(["active", "inactive", "archived"]);
export const PROJECT_STATUSES = Object.freeze([
  "planned",
  "active",
  "on_hold",
  "complete",
  "archived",
]);
export const SITE_TYPES = Object.freeze([
  "industrial",
  "commercial",
  "residential",
  "other",
]);

export const HIERARCHY_ERRORS = Object.freeze({
  FORBIDDEN: "You do not have permission to manage the client, site, and project hierarchy.",
  NOT_FOUND: "That client, site, or project does not exist in this workspace.",
  ARCHIVED: "That project (or its site or client) is archived. Pick an active project instead.",
  PARENT_INACTIVE:
    "The parent client or site is inactive. Activate it first, or pick an active one.",
  STALE_VERSION:
    "This record was changed by someone else. Reload and try again.",
  REQUEST_ID_CONFLICT:
    "This request was already used for a different change. Use a fresh request and try again.",
  DUPLICATE_NAME: "A record with that name already exists here.",
  DUPLICATE_CODE: "A project with that code already exists in this workspace.",
  NOT_ARCHIVED: "Archive the record first — only archived records can be permanently deleted.",
  HAS_CHILDREN:
    "That record still has items under it. Archive or delete those first.",
  INVALID_NAME: "Enter a name (1–200 characters).",
  INVALID_STATUS: "That status is not valid for this record.",
  INVALID_SITE_TYPE: "Pick a site type: industrial, commercial, residential, or other.",
  INVALID_ADDRESS: "Check the address — one of the fields is too long.",
  INVALID_COUNTRY_CODE: "Enter a two-letter country code (for example US).",
  INVALID_PROJECT_CODE: "Enter a project code (1–64 characters).",
  INVALID_DATE: "Enter dates as YYYY-MM-DD.",
  INVALID_DATES: "The finish date must be on or after the start date.",
  NOT_APPLIED:
    "The client, site, and project hierarchy isn't available yet — the database change for this feature hasn't been applied.",
});

function hasControlChars(value) {
  // The migration's CHECKs reject the same class; this is the
  // plain-words pre-check for the UI. Control characters are the C0/C1
  // ranges plus DEL — matched without a POSIX class (JS has none).
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

/** Lowercase + trim, the same normalization the database's generated
 *  name_normalized column applies. Used for duplicate-name checks and
 *  selector ordering. */
export function normalizeName(name) {
  return String(name ?? "").trim().toLowerCase();
}

function validateName(name, { required = true } = {}) {
  if (isBlank(name)) {
    return required ? "INVALID_NAME" : null;
  }
  const trimmed = String(name).trim();
  if (trimmed.length > 200 || hasControlChars(trimmed)) {
    return "INVALID_NAME";
  }
  return null;
}

function validateOptionalText(value, max, code) {
  if (value === null || value === undefined || value === "") return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  if (trimmed.length > max || hasControlChars(trimmed)) return code;
  return null;
}

function validateStatus(status, allowed) {
  if (status === null || status === undefined || status === "") return null;
  return allowed.includes(status) ? null : "INVALID_STATUS";
}

function validateDateText(value) {
  if (value === null || value === undefined || value === "") return null;
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "INVALID_DATE";
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "INVALID_DATE";
  const [y, m, d] = trimmed.split("-").map(Number);
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() + 1 !== m ||
    parsed.getUTCDate() !== d
  ) {
    return "INVALID_DATE";
  }
  return null;
}

/** Validate a client create/update payload. Returns null when valid, or
 *  { code, message } with a plain-words message. Null fields mean
 *  "unchanged" on update; an empty string means "clear" (clearable fields
 *  only — a name can never be cleared). */
export function validateClientInput(input = {}) {
  const nameError = validateName(input.name, { required: input.requireName !== false });
  if (nameError) return { code: nameError, message: HIERARCHY_ERRORS[nameError] };
  const extError = validateOptionalText(input.externalReference, 200, "INVALID_EXTERNAL_REFERENCE");
  if (extError) {
    return {
      code: "INVALID_EXTERNAL_REFERENCE",
      message: "Enter an external reference (1–200 characters).",
    };
  }
  const notesError = validateOptionalText(input.notes, 2000, "INVALID_NOTES");
  if (notesError) {
    return { code: "INVALID_NOTES", message: "Enter notes (up to 2,000 characters)." };
  }
  const statusError = validateStatus(input.status, CLIENT_STATUSES);
  if (statusError) return { code: statusError, message: HIERARCHY_ERRORS[statusError] };
  return null;
}

export function validateSiteInput(input = {}) {
  const nameError = validateName(input.name, { required: input.requireName !== false });
  if (nameError) return { code: nameError, message: HIERARCHY_ERRORS[nameError] };
  if (
    input.siteType !== null &&
    input.siteType !== undefined &&
    input.siteType !== "" &&
    !SITE_TYPES.includes(input.siteType)
  ) {
    return { code: "INVALID_SITE_TYPE", message: HIERARCHY_ERRORS.INVALID_SITE_TYPE };
  }
  for (const [field, max] of [
    ["addressLine1", 200],
    ["addressLine2", 200],
    ["city", 120],
    ["region", 120],
    ["postalCode", 20],
  ]) {
    const error = validateOptionalText(input[field], max, "INVALID_ADDRESS");
    if (error) return { code: error, message: HIERARCHY_ERRORS[error] };
  }
  if (
    input.countryCode !== null &&
    input.countryCode !== undefined &&
    String(input.countryCode).trim() !== "" &&
    !/^[A-Za-z]{2}$/.test(String(input.countryCode).trim())
  ) {
    return { code: "INVALID_COUNTRY_CODE", message: HIERARCHY_ERRORS.INVALID_COUNTRY_CODE };
  }
  const statusError = validateStatus(input.status, SITE_STATUSES);
  if (statusError) return { code: statusError, message: HIERARCHY_ERRORS[statusError] };
  return null;
}

export function validateProjectInput(input = {}) {
  const nameError = validateName(input.name, { required: input.requireName !== false });
  if (nameError) return { code: nameError, message: HIERARCHY_ERRORS[nameError] };
  const codeError = validateOptionalText(input.projectCode, 64, "INVALID_PROJECT_CODE");
  if (codeError) return { code: codeError, message: HIERARCHY_ERRORS[codeError] };
  const descError = validateOptionalText(input.description, 2000, "INVALID_DESCRIPTION");
  if (descError) {
    return { code: "INVALID_DESCRIPTION", message: "Enter a description (up to 2,000 characters)." };
  }
  const typeError = validateOptionalText(input.projectType, 64, "INVALID_PROJECT_TYPE");
  if (typeError) {
    return { code: "INVALID_PROJECT_TYPE", message: "Enter a project type (1–64 characters)." };
  }
  const startError = validateDateText(input.plannedStart);
  if (startError) return { code: startError, message: HIERARCHY_ERRORS[startError] };
  const finishError = validateDateText(input.plannedFinish);
  if (finishError) return { code: finishError, message: HIERARCHY_ERRORS[finishError] };
  const start = input.plannedStart ? String(input.plannedStart).trim() : "";
  const finish = input.plannedFinish ? String(input.plannedFinish).trim() : "";
  if (start && finish && finish < start) {
    return { code: "INVALID_DATES", message: HIERARCHY_ERRORS.INVALID_DATES };
  }
  const statusError = validateStatus(input.status, PROJECT_STATUSES);
  if (statusError) return { code: statusError, message: HIERARCHY_ERRORS[statusError] };
  return null;
}

// --- Selector state --------------------------------------------------------
//
// One shared selector lives in the authenticated FORGE shell header. These
// are the pure state transitions (brief §Selector rules 4–5):
//   * Changing client clears site and project in one state transaction.
//   * Changing site clears project.
//   * Clearing the client clears everything; clearing the site clears
//     the project. Nothing here silently substitutes another selection —
//     a revoked/archived id is cleared by the caller with an explanation
//     (see clearInvalidSelection), never replaced.

export function emptySelection() {
  return Object.freeze({ clientId: null, siteId: null, projectId: null });
}

/** Apply a client change. Returns the new selection: the client set, site
 *  and project cleared — always, even when the new client equals the old
 *  one (a re-pick is still a fresh choice, not a restore). */
export function applyClientSelection(_selection, clientId) {
  return Object.freeze({
    clientId: clientId ?? null,
    siteId: null,
    projectId: null,
  });
}

/** Apply a site change. Returns the new selection: the site set, the
 *  project cleared, the client untouched. */
export function applySiteSelection(selection, siteId) {
  return Object.freeze({
    clientId: selection?.clientId ?? null,
    siteId: siteId ?? null,
    projectId: null,
  });
}

/** Apply a project change. The client and site are untouched. */
export function applyProjectSelection(selection, projectId) {
  return Object.freeze({
    clientId: selection?.clientId ?? null,
    siteId: selection?.siteId ?? null,
    projectId: projectId ?? null,
  });
}

/** Clear an inaccessible / archived / revoked selection back to the
 *  chooser. Returns { selection, cleared } so the caller can explain
 *  what happened instead of silently showing something else. */
export function clearInvalidSelection(selection) {
  const cleared = [];
  if (selection?.projectId) cleared.push("project");
  if (selection?.siteId) cleared.push("site");
  if (selection?.clientId) cleared.push("client");
  return { selection: emptySelection(), cleared };
}

/** Find a project inside a selector tree, resolving its client and site
 *  through the chain (never from a client id stored on the project —
 *  none exists). Returns { client, site, project } or null. */
export function findProjectInTree(tree, projectId) {
  if (!tree || !projectId) return null;
  for (const client of tree.clients ?? []) {
    for (const site of client.sites ?? []) {
      for (const project of site.projects ?? []) {
        if (project.id === projectId) return { client, site, project };
      }
    }
  }
  return null;
}

/** Count every unassigned-visible row the selector tree holds (active
 *  clients/sites/projects). Slice 1 has no app rows attached, so the
 *  unassigned inbox counts come from the apps themselves in PRs B–F. */
export function countTree(tree) {
  let clients = 0;
  let sites = 0;
  let projects = 0;
  for (const client of tree?.clients ?? []) {
    clients += 1;
    for (const site of client.sites ?? []) {
      sites += 1;
      projects += (site.projects ?? []).length;
    }
  }
  return { clients, sites, projects };
}
