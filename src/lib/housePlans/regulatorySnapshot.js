// HOUSE PLANS (HP-L4) immutable Regulatory Snapshots.
//
// A snapshot captures the reference-library state -- which regulatory source
// records, their factual metadata, retrieval/verification dates -- at a point
// in time. Snapshots are IMMUTABLE and APPEND-ONLY:
//
//   - They are created once via createRegulatorySnapshot() and never mutated.
//     The returned record (and every entry in it) is deeply frozen.
//   - There are no UPDATE/DELETE endpoints, no domain mutators, and no SQL
//     written for mutation. Newer data triggers a NEW snapshot row; it never
//     silently rewrites a historical one.
//   - Each snapshot carries a content hash of its canonical entries, so the
//     API can distinguish "library changed since the last snapshot" (create a
//     new row) from "no new data" (reuse the latest row) without touching
//     history.
//
// Link-only scope (inherited from HP-L1): entries are factual metadata only.
// The forbidden content fields (summary, content, description, explanation,
// paraphrase, interpretation) are rejected by validateRegulatorySource and can
// never enter a snapshot. No compliance logic, no verdicts, no check engine.
//
// Pure module: no I/O, no DB, no network.

import {
  normalizeRegulatorySource,
  validateRegulatorySource,
} from "./regulatorySource";

export const MAX_SNAPSHOT_LABEL_LENGTH = 120;

// Deterministic entry ordering for a stable content hash: official URL,
// then title, then section identifier. Nulls sort as empty strings.
function compareSnapshotEntries(a, b) {
  for (const key of ["officialUrl", "title", "sectionIdentifier"]) {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

// Canonical JSON: object keys sorted recursively, so the same entries in any
// order always serialize identically.
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// cyrb53: a small deterministic non-cryptographic hash. Used ONLY for change
// detection ("did the library change since the last snapshot?"), never for
// security, identity, or addressing.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h1 >>> 0).toString(16).padStart(8, "0")
  );
}

// Deterministic content hash of a snapshot's entries. Entries are sorted
// into canonical order first, so insertion order never affects the hash.
export function snapshotContentHash(entries) {
  const ordered = Array.isArray(entries) ? [...entries].sort(compareSnapshotEntries) : [];
  return cyrb53(canonicalize(ordered));
}

function isValidDateLike(value) {
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime());
}

function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function checkLabel(label, errors) {
  if (label === undefined || label === null) return null;
  if (typeof label !== "string" || label.trim().length === 0) {
    errors.push('"label" must be a non-empty string when provided');
    return null;
  }
  if (label.trim().length > MAX_SNAPSHOT_LABEL_LENGTH) {
    errors.push(`"label" must be at most ${MAX_SNAPSHOT_LABEL_LENGTH} characters`);
    return null;
  }
  return label.trim();
}

// Pure snapshot creation from a set of validated regulatory source records.
// Returns { ok: true, snapshot } or { ok: false, errors }. Never throws on
// malformed input. The snapshot is deeply frozen: newer data means calling
// this again for a NEW snapshot, never mutating the returned one.
export function createRegulatorySnapshot(input) {
  const errors = [];
  const record =
    typeof input === "object" && input !== null && !Array.isArray(input) ? input : {};

  let entries = [];
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    errors.push('"sources" must be a non-empty array of regulatory source records');
  } else {
    record.sources.forEach((source, index) => {
      const result = validateRegulatorySource(source);
      if (!result.ok) {
        for (const message of result.errors) {
          errors.push(`sources[${index}]: ${message}`);
        }
      }
    });
    if (errors.length === 0) {
      entries = record.sources.map(normalizeRegulatorySource).sort(compareSnapshotEntries);
    }
  }

  const label = checkLabel(record.label, errors);

  let capturedAt = new Date().toISOString();
  if (record.capturedAt !== undefined && record.capturedAt !== null) {
    if (!isValidDateLike(record.capturedAt)) {
      errors.push('"capturedAt" must be a valid date when provided');
    } else {
      capturedAt = toIsoDate(record.capturedAt);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const frozenEntries = entries.map((entry) => Object.freeze({ ...entry }));
  Object.freeze(frozenEntries);
  const snapshot = Object.freeze({
    label,
    entries: frozenEntries,
    sourceCount: frozenEntries.length,
    contentHash: snapshotContentHash(frozenEntries),
    capturedAt,
  });
  return { ok: true, snapshot };
}

// Pure validation of an existing snapshot record shape (round-trip /
// API-output checking). Returns { ok, errors }. Never throws.
export function validateRegulatorySnapshot(input) {
  const errors = [];
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["snapshot must be an object"] };
  }

  checkLabel(input.label, errors);

  let entriesValid = false;
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    errors.push('"entries" must be a non-empty array');
  } else {
    entriesValid = true;
    input.entries.forEach((entry, index) => {
      const result = validateRegulatorySource(entry);
      if (!result.ok) {
        for (const message of result.errors) {
          errors.push(`entries[${index}]: ${message}`);
        }
      }
    });
  }

  if (typeof input.contentHash !== "string" || input.contentHash.trim().length === 0) {
    errors.push('"contentHash" must be a non-empty string');
  } else if (entriesValid && errors.length === 0) {
    const expected = snapshotContentHash(input.entries);
    if (expected !== input.contentHash) {
      errors.push('"contentHash" does not match the snapshot entries');
    }
  }

  if (input.capturedAt === undefined || input.capturedAt === null || !isValidDateLike(input.capturedAt)) {
    errors.push('"capturedAt" must be a valid date');
  }

  if (
    input.sourceCount !== undefined &&
    input.sourceCount !== null &&
    (!Array.isArray(input.entries) || input.sourceCount !== input.entries.length)
  ) {
    errors.push('"sourceCount" must equal the number of entries');
  }

  return { ok: errors.length === 0, errors };
}
