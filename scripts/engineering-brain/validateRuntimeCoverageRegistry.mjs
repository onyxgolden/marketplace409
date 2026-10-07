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

// America/Chicago is UTC-5 in daylight time, UTC-6 in standard time. A
// fixed UTC cron therefore lands at two different local wall times across
// the year. This helper derives both, so labels can be checked for honesty
// instead of trusted. `cron` must be "M H * * *" with single numeric fields.
export function chicagoWallTimes(cron) {
  const [minute, hour] = cron.trim().split(/\s+/).slice(0, 2).map(Number);
  const fmt = (h24raw) => {
    const h24 = ((h24raw % 24) + 24) % 24;
    const ampm = h24 < 12 ? "AM" : "PM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(minute).padStart(2, "0")} ${ampm}`;
  };
  return { cdt: fmt(hour - 5), cst: fmt(hour - 6) };
}

function isSingleCron(cron) {
  const [minute, hour] = cron.trim().split(/\s+/).slice(0, 2);
  return /^[0-9]+$/.test(minute) && /^[0-9]+$/.test(hour);
}

function validateTrigger(entry, errors) {
  const t = entry.trigger;
  const label = entry && typeof entry.id === "string" ? entry.id : "<missing id>";
  if (t === null || typeof t !== "object" || Array.isArray(t)) {
    errors.push(`${label}: trigger must be an object`);
    return;
  }
  if (t.kind === "schedule") {
    // Timezone-honest schedule representation (review finding, Slice 1):
    // a fixed UTC cron is NOT a fixed Chicago wall time. `dst` declares
    // which pattern the schedule follows, and the label must match it:
    // - "fixed-utc": one UTC cron; Chicago wall time shifts with DST, so
    //   the label must name BOTH the CDT and CST equivalents.
    // - "dst-guarded": a UTC cron pair with a guard that admits exactly one
    //   Chicago wall time; the label names that wall time and the guard.
    // - "dual-fire": several UTC crons with no guard; every slot fires, so
    //   the label must say so.
    const hasCron = isNonEmptyString(t.cron);
    const hasCrons = Array.isArray(t.crons);
    if (hasCron === hasCrons) {
      errors.push(`${label}: schedule trigger needs exactly one of "cron" or "crons"`);
      return;
    }
    const crons = hasCron ? [t.cron] : t.crons;
    for (const c of crons) {
      if (!isNonEmptyString(c) || !CRON_RE.test(c.trim())) {
        errors.push(`${label}: malformed UTC cron expression "${c}"`);
      }
    }
    if (!isNonEmptyString(t.chicago_label)) {
      errors.push(`${label}: schedule trigger needs a non-empty chicago_label`);
    }
    const allowedDst = ["fixed-utc", "dst-guarded", "dual-fire"];
    if (!allowedDst.includes(t.dst)) {
      errors.push(`${label}: schedule trigger dst must be one of ${allowedDst.join(", ")}`);
      return;
    }
    const keys = Object.keys(t).sort().join(",");
    const okKeys =
      (hasCron && keys === "chicago_label,cron,dst,kind") ||
      (!hasCron && keys === "chicago_label,crons,dst,kind");
    if (!okKeys) {
      errors.push(
        `${label}: schedule trigger must have exactly { kind, cron|crons, chicago_label, dst }`
      );
    }
    if (t.dst === "fixed-utc") {
      if (!hasCron || !isSingleCron(t.cron)) {
        errors.push(`${label}: fixed-utc needs a single "cron" with numeric minute and hour`);
      } else if (isNonEmptyString(t.chicago_label)) {
        // The regression: a fixed-UTC cron labeled as a fixed CDT wall
        // time is wrong half the year. Both equivalents must appear.
        const { cdt, cst } = chicagoWallTimes(t.cron);
        if (!t.chicago_label.includes(cdt) || !t.chicago_label.includes(cst)) {
          errors.push(
            `${label}: fixed-utc label must name both Chicago equivalents (${cdt} CDT / ${cst} CST)`
          );
        }
      }
    } else if (t.dst === "dst-guarded") {
      if (hasCron || t.crons.length !== 2) {
        errors.push(`${label}: dst-guarded needs "crons" with exactly the two UTC slots`);
      }
      if (isNonEmptyString(t.chicago_label) && !t.chicago_label.includes("DST-guard")) {
        errors.push(`${label}: dst-guarded label must name the DST-guard and the wall time it enforces`);
      }
    } else if (t.dst === "dual-fire") {
      if (hasCron || t.crons.length < 2) {
        errors.push(`${label}: dual-fire needs "crons" with at least two UTC slots`);
      }
      if (isNonEmptyString(t.chicago_label) && !/both (slots )?fire/i.test(t.chicago_label)) {
        errors.push(`${label}: dual-fire label must state that every UTC slot fires (no DST guard)`);
      }
    }
  } else if (t.kind === "event") {
    const keys = Object.keys(t).sort().join(",");
    if (keys !== "description,kind") {
      errors.push(`${label}: event trigger must have exactly { kind, description }`);
    }
    if (!isNonEmptyString(t.description)) {
      errors.push(`${label}: event trigger needs a non-empty description`);
    }
  } else {
    errors.push(`${label}: trigger.kind must be "schedule" or "event"`);
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
