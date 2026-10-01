// Rentec parity R15 — the notice/form placeholder engine.
//
// Syntax: {{dotted.path}} (whitespace inside the braces is ignored). Paths
// resolve against a plain nested context object — no eval, no function
// calls, no property access beyond own-data lookups. Anything the pattern
// cannot match is left alone; anything it matches but cannot resolve never
// crashes.
//
// Render contract (tested in __tests__/formPlaceholders.test.js):
//   * known path with a value      -> substituted (as-is; the caller escapes)
//   * known path, null/undefined/"" -> "" and listed in `missing`
//   * unknown path                 -> a blank line "________" and listed in
//     `unknown`, so a typo stays visible in the preview AND prints as a
//     hand-fillable blank instead of a broken {{token}}.
//
// Note on the choice: R6's message renderer leaves unknown tokens verbatim
// for message bodies that are sent as text. Notices get printed — a printed
// page with a raw {{placeholder}} is a broken form, while a blank line is
// exactly what paper forms do. The `unknown` list lets the builder UI flag
// the typo before printing.

export const NOTICE_FIELDS = [
  { key: "tenant.name", label: "Tenant name", description: "The tenant's display name." },
  { key: "tenant.email", label: "Tenant email", description: "The tenant's email address." },
  { key: "tenant.phone", label: "Tenant phone", description: "The tenant's phone number." },
  { key: "property.label", label: "Property name", description: "Unit label, or the property ID humanized (\"308-paula\" → \"308 Paula\")." },
  { key: "property.address", label: "Property address", description: "The unit's structured street address, if recorded." },
  { key: "unit.label", label: "Unit label", description: "The unit's label." },
  { key: "lease.start", label: "Lease start", description: "Lease start date (e.g. Sep 1, 2026)." },
  { key: "lease.end", label: "Lease end", description: "Lease end date, or blank for an open tenancy." },
  { key: "lease.rent", label: "Monthly rent", description: "Lease monthly rent, formatted as USD ($1,600.00)." },
  { key: "lease.due_day", label: "Rent due day", description: "Day of the month rent is due (1–28)." },
  { key: "balance.due", label: "Balance due", description: "Total unpaid rent charges, formatted as USD." },
  { key: "owner.name", label: "Owner name", description: "The workspace's sender name from email settings." },
  { key: "today", label: "Today's date", description: "The date the notice is generated (e.g. Oct 1, 2026)." },
  // `custom.<field_key>` is dynamic per workspace (see
  // resolveNoticeContext): every tenant/lease custom field value is
  // available under its field key.
];

const KNOWN_PATHS = new Set(NOTICE_FIELDS.map((field) => field.key));
const TOKEN_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

// A blank that prints like a paper form's fill-in line.
export const UNKNOWN_PLACEHOLDER_MARK = "________";

function isKnownPath(path) {
  if (KNOWN_PATHS.has(path)) return true;
  // Custom fields are dynamic per workspace; any custom.* path is a known
  // path shape — a missing key lands in `missing`, never `unknown`.
  return path === "custom" || path.startsWith("custom.");
}

function resolvePath(values, path) {
  let current = values;
  for (const segment of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    // Plain data lookup only: never invoke functions and never touch
    // prototype properties (no eval, no code execution of any kind).
    if (typeof current !== "object") return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return typeof current === "function" ? undefined : current;
}

export function renderNoticeTemplate(body, context = {}) {
  const values = context ?? {};
  const missing = new Set();
  const unknown = new Set();
  const text = String(body ?? "").replace(TOKEN_PATTERN, (token, path) => {
    if (!isKnownPath(path)) {
      unknown.add(path);
      return UNKNOWN_PLACEHOLDER_MARK;
    }
    const value = resolvePath(values, path);
    if (value === null || value === undefined || value === "") {
      missing.add(path);
      return "";
    }
    return String(value);
  });
  return { text, missing: [...missing], unknown: [...unknown] };
}

// HTML-escape a string for the printable notice view. Values come from
// tenant-entered custom fields, so the escape happens at the HTML boundary
// (here), not in the text engine above — the plain-text log stays readable.
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Plain-text rendered notice -> safe print HTML (escaped, paragraphs kept).
export function noticeTextToHtml(text) {
  return escapeHtml(text).replace(/\r?\n/g, "<br/>");
}

// Extract the distinct placeholder paths used by a template body — used by
// the builder preview to warn about unknown placeholders before printing.
export function listTemplatePlaceholders(body) {
  const found = new Set();
  String(body ?? "").replace(TOKEN_PATTERN, (token, path) => {
    found.add(path);
    return token;
  });
  const known = [...found].filter((path) => isKnownPath(path));
  const unknown = [...found].filter((path) => !isKnownPath(path));
  return { known, unknown };
}
