// Runtime Coverage Registry validation (Slice 1) — fail-closed contract.
//
// Every rule below rejects the whole registry on violation: a registry that
// cannot be proven well-formed is not a registry the Brain may rely on.
// Pure functions; no I/O, no clock, no network.

import {
  CAPABILITIES,
  MONITORING_STATUSES,
  REQUIRED_FIELDS,
  RUNTIME_COVERAGE_SCHEMA_VERSION,
} from "./runtimeCoverageRegistry.mjs";

// Strict 5-field UTC cron: minute hour dom month dow, each a number, range,
// step, list, or "*". Deliberately rejects "@daily"-style shorthands and
// non-UTC annotations — the registry records the declared schedule exactly.
const CRON_FIELD = "(?:\\*|(?:[0-9]+(?:-[0-9]+)?(?:/[0-9]+)?)(?:,(?:[0-9]+(?:-[0-9]+)?(?:/[0-9]+)?))*)";
const CRON_RE = new RegExp(`^${CRON_FIELD}(?: ${CRON_FIELD}){4}$`);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function validateTrigger(entry, errors) {
  const t = entry.trigger;
  if (t === null || typeof t !== "object" || Array.isArray(t)) {
    errors.push(`${entry.id}: trigger must be an object`);
    return;
  }
  if (t.kind === "schedule") {
    const keys = Object.keys(t).sort().join(",");
    if (keys !== "chicago_label,cron,kind") {
      errors.push(`${entry.id}: schedule trigger must have exactly { kind, cron, chicago_label }`);
    }
    if (!isNonEmptyString(t.cron) || !CRON_RE.test(t.cron.trim())) {
      errors.push(`${entry.id}: schedule trigger has a malformed UTC cron expression`);
    }
    if (!isNonEmptyString(t.chicago_label)) {
      errors.push(`${entry.id}: schedule trigger needs a non-empty chicago_label`);
    }
  } else if (t.kind === "event") {
    const keys = Object.keys(t).sort().join(",");
    if (keys !== "description,kind") {
      errors.push(`${entry.id}: event trigger must have exactly { kind, description }`);
    }
    if (!isNonEmptyString(t.description)) {
      errors.push(`${entry.id}: event trigger needs a non-empty description`);
    }
  } else {
    errors.push(`${entry.id}: trigger.kind must be "schedule" or "event"`);
  }
}

function validateEntry(entry, seenIds, seenNames, errors) {
  const label = entry && typeof entry.id === "string" ? entry.id : "<missing id>";
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${label}: entry must be an object`);
    return;
  }

  // Strict shape: every required field present, no unknown fields.
  const keys = Object.keys(entry);
  for (const f of REQUIRED_FIELDS) {
    if (!keys.includes(f)) errors.push(`${label}: missing required field "${f}"`);
  }
  const allowed = new Set([...REQUIRED_FIELDS, "money_note", "monitoring_note"]);
  for (const k of keys) {
    if (!allowed.has(k)) errors.push(`${label}: unknown field "${k}"`);
  }

  if (!isNonEmptyString(entry.id)) errors.push(`${label}: id must be a non-empty string`);
  if (!isNonEmptyString(entry.name)) errors.push(`${label}: name must be a non-empty string`);
  if (!isNonEmptyString(entry.execution_path)) {
    errors.push(`${label}: execution_path must be a non-empty string`);
  }
  if (!isNonEmptyString(entry.expected_cadence)) {
    errors.push(`${label}: expected_cadence must be a non-empty string`);
  }

  if (seenIds.has(entry.id)) errors.push(`${label}: duplicate id`);
  else seenIds.add(entry.id);
  if (typeof entry.name === "string") {
    if (seenNames.has(entry.name)) errors.push(`${label}: duplicate name`);
    else seenNames.add(entry.name);
  }

  if (typeof entry.moves_money !== "boolean") {
    errors.push(`${label}: moves_money must be a boolean`);
  }

  // Money-moving capabilities must name their durable evidence: a charge
  // with no recorded evidence trail is a contract violation, not a gap.
  if (!Array.isArray(entry.durable_evidence) || entry.durable_evidence.length === 0) {
    errors.push(`${label}: durable_evidence must be a non-empty array`);
  } else {
    for (const e of entry.durable_evidence) {
      if (!isNonEmptyString(e)) errors.push(`${label}: durable_evidence entries must be non-empty strings`);
    }
  }

  if (!MONITORING_STATUSES.includes(entry.monitoring_status)) {
    errors.push(
      `${label}: monitoring_status must be one of ${MONITORING_STATUSES.join(", ")}`
    );
  }

  for (const noteField of ["money_note", "monitoring_note"]) {
    if (entry[noteField] !== undefined && !isNonEmptyString(entry[noteField])) {
      errors.push(`${label}: ${noteField} must be a non-empty string when present`);
    }
  }

  validateTrigger(entry, errors);
}

/**
 * Validate a capability list against the registry contract. Fails closed:
 * any violation makes the whole result invalid.
 * Returns { ok: boolean, errors: string[] } — errors sorted for determinism.
 */
export function validateRegistry(capabilities) {
  const errors = [];
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return { ok: false, errors: ["registry must be a non-empty array"] };
  }
  const seenIds = new Set();
  const seenNames = new Set();
  for (const entry of capabilities) {
    validateEntry(entry, seenIds, seenNames, errors);
  }
  // Registry order is part of the contract: sorted by id, deterministic.
  const ids = capabilities.map((c) => (c && c.id) || "");
  const sorted = [...ids].sort();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== sorted[i]) {
      errors.push("registry entries must be sorted by id");
      break;
    }
  }
  errors.sort();
  return { ok: errors.length === 0, errors };
}

/** Validate the shipped registry. */
export function validateShippedRegistry() {
  return validateRegistry(CAPABILITIES);
}

export { RUNTIME_COVERAGE_SCHEMA_VERSION };
