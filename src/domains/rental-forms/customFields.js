// Rentec parity R15 — custom fields: definitions + value validation.
//
// Rentec lets the owner define their own input fields (auto-populating
// forms) on tenants, leases, properties, and units. This module is the
// single source of truth for the entity/type catalog and for validation,
// shared by the settings UI, the record editors, and the API routes.
//
// Types are deliberately Brandy-readable: the API stores the short key and
// the UI shows the plain-English label. Values are stored as text
// (value_text) after type-cleaning: numbers as typed, dates YYYY-MM-DD,
// yes/no as "yes"/"no".

export const CUSTOM_FIELD_ENTITIES = [
  { key: "tenant", label: "Tenants", hint: "Fields appear on each tenant's record." },
  { key: "lease", label: "Leases", hint: "Fields appear on each lease's record." },
  { key: "property", label: "Properties", hint: "Fields appear on each property record (by property ID)." },
  { key: "unit", label: "Units", hint: "Fields appear on each unit's record." },
];

export const CUSTOM_FIELD_TYPES = [
  { key: "text", label: "Short text", hint: "Anything — names, account numbers, notes." },
  { key: "number", label: "Number", hint: "Digits and decimals only." },
  { key: "date", label: "Date", hint: "Pick a calendar date." },
  { key: "yes_no", label: "Yes / No", hint: "A simple yes-or-no choice." },
  { key: "picklist", label: "Picklist", hint: "Choose from a list you define." },
];

const ENTITY_KEYS = new Set(CUSTOM_FIELD_ENTITIES.map((entry) => entry.key));
const TYPE_KEYS = new Set(CUSTOM_FIELD_TYPES.map((entry) => entry.key));

export const MAX_FIELD_NAME_LENGTH = 80;
export const MAX_TEXT_VALUE_LENGTH = 500;
export const MAX_PICKLIST_OPTIONS = 50;

// "Lease signer phone" -> "lease_signer_phone". Stable: computed once at
// creation, stored on the row, and used for {{custom.<field_key>}}
// placeholders — renaming a field later regenerates the key.
export function slugifyFieldKey(name) {
  const slug = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return slug || "field";
}

// Shared definition validation for the create/update routes and the
// settings UI. Returns { ok, clean } or { ok: false, error }.
export function validateFieldDefinition(input = {}) {
  const name = String(input.name ?? "").trim();
  const entity = String(input.entity ?? "").trim();
  const fieldType = String(input.fieldType ?? input.type ?? "").trim();
  const isRequired = Boolean(input.isRequired ?? input.required ?? false);

  if (!name) return { ok: false, error: "A field name is required." };
  if (name.length > MAX_FIELD_NAME_LENGTH) {
    return { ok: false, error: `The field name must be ${MAX_FIELD_NAME_LENGTH} characters or fewer.` };
  }
  if (!ENTITY_KEYS.has(entity)) {
    return { ok: false, error: `Field location must be one of: ${[...ENTITY_KEYS].join(", ")}.` };
  }
  if (!TYPE_KEYS.has(fieldType)) {
    return { ok: false, error: `Field type must be one of: ${[...TYPE_KEYS].join(", ")}.` };
  }

  let picklistOptions = null;
  if (fieldType === "picklist") {
    const raw = input.picklistOptions ?? input.options ?? [];
    if (!Array.isArray(raw)) return { ok: false, error: "A picklist needs at least two choices." };
    const seen = new Set();
    picklistOptions = [];
    for (const option of raw) {
      const text = String(option ?? "").trim();
      if (!text || seen.has(text)) continue;
      if (text.length > 60) return { ok: false, error: "Each picklist choice must be 60 characters or fewer." };
      seen.add(text);
      picklistOptions.push(text);
    }
    if (picklistOptions.length < 2) {
      return { ok: false, error: "A picklist needs at least two choices." };
    }
    if (picklistOptions.length > MAX_PICKLIST_OPTIONS) {
      return { ok: false, error: `A picklist can have at most ${MAX_PICKLIST_OPTIONS} choices.` };
    }
  }

  return {
    ok: true,
    clean: {
      entity,
      name,
      fieldKey: slugifyFieldKey(name),
      fieldType,
      isRequired,
      picklistOptions,
    },
  };
}

function isBlank(rawValue) {
  return rawValue === null || rawValue === undefined || String(rawValue).trim() === "";
}

// Validates one stored value against its field definition. Returns
// { ok: true, clean } (clean is the stored text, or null for a cleared
// optional field) or { ok: false, error } with a plain-English message.
export function validateFieldValue(field, rawValue) {
  const type = field?.field_type || field?.fieldType;
  const label = field?.name || "This field";
  if (!TYPE_KEYS.has(type)) return { ok: false, error: `${label}: unknown field type.` };
  const required = Boolean(field?.is_required ?? field?.isRequired);

  if (isBlank(rawValue)) {
    if (required) return { ok: false, error: `${label} is required.` };
    return { ok: true, clean: null };
  }
  const text = String(rawValue).trim();

  if (type === "text") {
    if (text.length > MAX_TEXT_VALUE_LENGTH) {
      return { ok: false, error: `${label} must be ${MAX_TEXT_VALUE_LENGTH} characters or fewer.` };
    }
    return { ok: true, clean: text };
  }
  if (type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, error: `${label} must be a number.` };
    return { ok: true, clean: text };
  }
  if (type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { ok: false, error: `${label} must be a valid date.` };
    const [year, month, day] = text.split("-").map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      return { ok: false, error: `${label} must be a valid date.` };
    }
    return { ok: true, clean: text };
  }
  if (type === "yes_no") {
    const normalized = text.toLowerCase();
    if (["yes", "true", "1"].includes(normalized)) return { ok: true, clean: "yes" };
    if (["no", "false", "0"].includes(normalized)) return { ok: true, clean: "no" };
    return { ok: false, error: `${label} must be Yes or No.` };
  }
  // picklist
  const options = Array.isArray(field?.picklist_options)
    ? field.picklist_options
    : Array.isArray(field?.picklistOptions)
      ? field.picklistOptions
      : [];
  if (!options.includes(text)) {
    return { ok: false, error: `${label} must be one of the list choices.` };
  }
  return { ok: true, clean: text };
}

const displayDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

// Plain-English display of a stored value: "yes" -> "Yes", 2026-10-01 ->
// "Oct 1, 2026", null -> "—".
export function formatFieldValue(field, valueText) {
  if (isBlank(valueText)) return "—";
  const text = String(valueText);
  const type = field?.field_type || field?.fieldType;
  if (type === "yes_no") return text === "yes" ? "Yes" : "No";
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return displayDate.format(new Date(Date.UTC(year, month - 1, day)));
  }
  return text;
}

// Map a DB row to the API/client shape.
export function rowToField(row) {
  return {
    id: row.id,
    entity: row.entity,
    name: row.name,
    fieldKey: row.field_key,
    fieldType: row.field_type,
    isRequired: Boolean(row.is_required),
    picklistOptions: Array.isArray(row.picklist_options) ? row.picklist_options : null,
    sortOrder: row.sort_order ?? 0,
    updatedAt: row.updated_at,
  };
}
