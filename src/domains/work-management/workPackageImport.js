// Work Package Planner file import — pure domain (no DB, no network).
//
// SAP / Maximo / P6 / Excel / text files land as rows on the same two
// grids (packages + steps). The flow follows the scheduling import's
// validateAndPlanImport shape: parse → auto-match headers → plan
// (create vs update vs error) → confirm applies through the existing
// create/update services, so numbering and unique IDs stay
// server-assigned. Nothing is written by this module.
//
// Matching (never guessed): a row with a source-system record id
// matches the row imported from that system before; otherwise a
// package matches by its number, a step by its sequence number,
// otherwise by title when the title is unique. Ambiguous rows are
// errors in the plan, never silently picked.
import { WP_STATUS, WP_PACKAGE_TYPES, WP_PACKAGE_TYPES_BY_MODE, IMPORT_SOURCE_SYSTEMS } from "./workPackage.js";

export { IMPORT_SOURCE_SYSTEMS };

export const PACKAGE_IMPORT_COLUMNS = [
  { key: "title", header: "Title", required: true, aliases: ["title", "name", "package title", "work package", "workpackage"] },
  { key: "packageCode", header: "Package #", aliases: ["package #", "package number", "package no", "package code", "code", "wp number", "work package number", "work order", "wo number"] },
  { key: "status", header: "Status", aliases: ["status", "state"] },
  { key: "propertyId", header: "Property", aliases: ["property", "property id", "location", "functional location"] },
  { key: "packageType", header: "Scope", aliases: ["scope", "package type", "type", "work type"] },
  { key: "plannedStart", header: "Planned start", aliases: ["planned start", "start", "start date", "planned start date", "scheduled start", "early start"] },
  { key: "plannedFinish", header: "Planned finish", aliases: ["planned finish", "finish", "finish date", "planned finish date", "scheduled finish", "early finish"] },
  { key: "description", header: "Description", aliases: ["description", "desc", "scope description", "short text"] },
  { key: "sourceRecordId", header: "Source record ID", aliases: ["source record id", "source id", "external id", "sap order", "maximo wo", "work order", "wo", "order number", "p6 activity id", "activity id", "activity code"] },
];

export const STEP_IMPORT_COLUMNS = [
  { key: "sequenceNo", header: "Step #", aliases: ["step #", "step number", "sequence", "sequence no", "seq", "operation", "operation no", "activity no", "task no"] },
  { key: "title", header: "Title", required: true, aliases: ["title", "name", "step title", "operation description", "task", "activity", "short text"] },
  { key: "description", header: "Description", aliases: ["description", "desc", "long text"] },
  { key: "craftLabel", header: "Craft", aliases: ["craft", "craft label", "work center", "work centre", "trade", "discipline", "crew"] },
  { key: "plannedDurationDays", header: "Planned days", aliases: ["planned days", "days", "duration", "duration days", "normal duration"] },
  { key: "plannedPersonHours", header: "Planned hours", aliases: ["planned hours", "hours", "person-hours", "person hours", "manhours", "man-hours", "planned manhours", "work"] },
  { key: "sourceRecordId", header: "Source record ID", aliases: ["source record id", "source id", "external id", "sap order", "maximo wo", "work order", "wo", "order number", "p6 activity id", "activity id", "activity code"] },
];

export function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Auto-match file headers to import columns. A header matches when
// its normalized form equals a column header or one of its aliases.
// Returns [{ header, fieldKey }] — fieldKey null means unmapped.
export function matchHeaders(headers, columns) {
  const byNormalized = new Map();
  for (const column of columns) {
    byNormalized.set(normalizeHeader(column.header), column.key);
    for (const alias of column.aliases || []) {
      if (!byNormalized.has(normalizeHeader(alias))) byNormalized.set(normalizeHeader(alias), column.key);
    }
  }
  return (headers || []).map((header) => ({
    header: String(header ?? ""),
    fieldKey: byNormalized.get(normalizeHeader(header)) ?? null,
  }));
}

function splitDelimitedLine(line, delimiter) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1; }
        else inQuotes = false;
      } else current += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

// Parses .csv / .tsv / .txt: delimiter is detected from the first
// non-empty line (tab wins when present, else comma, else semicolon).
// Returns { headers, rows } — rows are arrays of strings, header row
// excluded; fully blank lines are skipped.
export function parseDelimitedText(text) {
  const lines = String(text ?? "").split(/\r\n|\r|\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const first = lines[0];
  const delimiter = first.includes("\t") ? "\t" : first.includes(";") && !first.includes(",") ? ";" : ",";
  const headers = splitDelimitedLine(first, delimiter);
  const rows = lines.slice(1).map((line) => splitDelimitedLine(line, delimiter));
  return { headers, rows };
}

// Accepts YYYY-MM-DD, MM/DD/YYYY, and Excel serial dates. Returns a
// YYYY-MM-DD string or null when the value is empty; returns
// { error } when it cannot be read as a date.
export function parseDateCell(value) {
  if (value == null || String(value).trim() === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) {
    const month = us[1].padStart(2, "0");
    const day = us[2].padStart(2, "0");
    return `${us[3]}-${month}-${day}`;
  }
  const serial = Number(text);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return { error: `Could not read "${text}" as a date (use YYYY-MM-DD).` };
}

function asText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function asNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : { error: `"${value}" is not a number.` };
}

function findByTitle(rows, title) {
  const needle = title.trim().toLowerCase();
  return rows.filter((row) => (row.title || "").trim().toLowerCase() === needle);
}

export function validateAndPlanWorkPackageImport({
  kind,
  rows,
  existingPackages = [],
  existingSteps = [],
  sourceSystem = null,
  sourceTrackingAvailable = false,
  properties = [],
  // Mode selector: when the caller names an active mode, a row's Scope
  // value must be one of that mode's package types, not just any of
  // the full WP_PACKAGE_TYPES list — reusing this function's existing
  // "Scope \"X\" is not a package type" error shape, extended to name
  // the active mode. A caller that omits mode (e.g. an older client)
  // still gets the full-list check, unchanged — no regression.
  mode = null,
}) {
  const errors = [];
  const creates = [];
  const updates = [];
  const seen = new Map();
  const isSteps = kind === "steps";
  const propertyBySlugOrLabel = new Map();
  for (const property of properties || []) {
    propertyBySlugOrLabel.set(String(property.slug).toLowerCase(), property.slug);
    propertyBySlugOrLabel.set(String(property.label || "").toLowerCase(), property.slug);
  }

  function duplicateCheck(key, rowIndex, label) {
    if (seen.has(key)) {
      errors.push({ rowIndex, message: `Row ${rowIndex + 1}: ${label} appears twice in this file — the second row is skipped.` });
      return true;
    }
    seen.set(key, rowIndex);
    return false;
  }

  (rows || []).forEach((raw, rowIndex) => {
    const row = raw || {};
    const title = asText(row.title);
    if (!title) {
      errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Title is required.` });
      return;
    }

    const sourceRecordId = asText(row.sourceRecordId);
    const fields = { title };
    if (row.description != null && asText(row.description) !== "") fields.description = asText(row.description);
    if (sourceRecordId !== "") fields.sourceRecordId = sourceRecordId;

    let statusTarget = null;
    if (!isSteps) {
      const status = asText(row.status);
      if (status !== "") {
        if (!Object.values(WP_STATUS).includes(status)) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Status "${status}" is not a work package status.` });
          return;
        }
        statusTarget = status;
      }
      const packageType = asText(row.packageType);
      if (packageType !== "") {
        if (!WP_PACKAGE_TYPES.includes(packageType)) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Scope "${packageType}" is not a package type.` });
          return;
        }
        const subset = mode ? WP_PACKAGE_TYPES_BY_MODE[mode] : null;
        if (subset && !subset.includes(packageType)) {
          const article = mode === "industrial" ? "an" : "a";
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Scope "${packageType}" is not ${article} ${mode} package type.` });
          return;
        }
        fields.packageType = packageType;
      }
      const propertyRaw = asText(row.propertyId);
      if (propertyRaw !== "") {
        const slug = propertyBySlugOrLabel.get(propertyRaw.toLowerCase());
        if (!slug) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Property "${propertyRaw}" does not match any known property.` });
          return;
        }
        fields.propertyId = slug;
      }
      const start = parseDateCell(row.plannedStart);
      if (start && start.error) {
        errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Planned start — ${start.error}` });
        return;
      }
      if (start) fields.plannedStart = start;
      const finish = parseDateCell(row.plannedFinish);
      if (finish && finish.error) {
        errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Planned finish — ${finish.error}` });
        return;
      }
      if (finish) fields.plannedFinish = finish;
      if (fields.plannedStart && fields.plannedFinish && fields.plannedFinish < fields.plannedStart) {
        errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Planned finish is before planned start.` });
        return;
      }
    } else {
      const craft = asText(row.craftLabel);
      if (craft !== "") fields.craftLabel = craft;
      if (row.plannedDurationDays != null && asText(row.plannedDurationDays) !== "") {
        const days = asNumber(row.plannedDurationDays);
        if (days && days.error) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Planned days — ${days.error}` });
          return;
        }
        if (!Number.isInteger(days) || days < 1 || days > 366) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Planned days must be a whole number from 1 to 366.` });
          return;
        }
        fields.plannedDurationDays = days;
      }
      if (row.plannedPersonHours != null && asText(row.plannedPersonHours) !== "") {
        const hours = asNumber(row.plannedPersonHours);
        if (hours && hours.error) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Planned hours — ${hours.error}` });
          return;
        }
        if (hours <= 0 || hours > 1000000 || Math.round(hours * 100) !== hours * 100) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Planned hours must be more than 0 and at most 1,000,000, with at most two decimal places.` });
          return;
        }
        fields.plannedPersonHours = hours;
      }
    }

    // Matching, strongest first. Never guessed: an ambiguous title
    // match is an error, and a package number that does not exist is
    // an error (numbers are server-assigned, never invented by a file).
    let match = null;
    let matchKind = null;
    if (sourceTrackingAvailable && sourceSystem && sourceRecordId !== "") {
      const pool = isSteps ? existingSteps : existingPackages;
      const found = pool.find((item) => item.source_system === sourceSystem && item.source_record_id === sourceRecordId);
      if (found) {
        if (duplicateCheck(`source:${sourceSystem}:${sourceRecordId}`, rowIndex, `Source record "${sourceRecordId}"`)) return;
        match = found;
        matchKind = "source";
      }
    }
    if (!match && !isSteps) {
      const code = asText(row.packageCode);
      if (code !== "") {
        const found = existingPackages.find((pkg) => (pkg.code || "").toLowerCase() === code.toLowerCase());
        if (!found) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: No package with number ${code} exists — package numbers are assigned by the system, never by a file.` });
          return;
        }
        if (duplicateCheck(`code:${code.toLowerCase()}`, rowIndex, `Package ${code}`)) return;
        match = found;
        matchKind = "code";
      }
    }
    if (!match && isSteps) {
      const seq = asNumber(row.sequenceNo);
      if (row.sequenceNo != null && asText(row.sequenceNo) !== "") {
        if (seq && seq.error) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Step # — ${seq.error}` });
          return;
        }
        if (!Number.isInteger(seq) || seq < 1) {
          errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Step # must be a whole number from 1 up.` });
          return;
        }
        const found = existingSteps.find((step) => step.sequenceNo === seq);
        if (found) {
          if (duplicateCheck(`seq:${seq}`, rowIndex, `Step #${seq}`)) return;
          match = found;
          matchKind = "sequence";
        }
        fields.sequenceNo = seq;
      }
    }
    if (!match) {
      const pool = isSteps ? existingSteps : existingPackages;
      const byTitle = findByTitle(pool, title);
      if (byTitle.length > 1) {
        errors.push({ rowIndex, message: `Row ${rowIndex + 1}: Title "${title}" matches ${byTitle.length} existing ${isSteps ? "steps" : "packages"} — add a step # / package # or a source record ID so it matches exactly one.` });
        return;
      }
      if (byTitle.length === 1) {
        if (duplicateCheck(`title:${title.toLowerCase()}`, rowIndex, `Title "${title}"`)) return;
        match = byTitle[0];
        matchKind = "title";
      }
    }
    if (!match) {
      if (duplicateCheck(`new-title:${title.toLowerCase()}`, rowIndex, `Title "${title}"`)) return;
    }

    if (match) {
      updates.push({ rowIndex, id: match.id, matchKind, fields, statusTarget, version: match.version, current: match });
    } else {
      creates.push({ rowIndex, fields, statusTarget });
    }
  });

  return {
    success: errors.length === 0,
    creates,
    updates,
    errors,
    summary: { createCount: creates.length, updateCount: updates.length, errorCount: errors.length },
  };
}
