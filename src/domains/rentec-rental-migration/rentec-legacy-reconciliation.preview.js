import { createHash } from "node:crypto";

const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const dateOnly = (value) => String(value || "").slice(0, 10);
const cents = (value) => Math.abs(Math.round(Number(value || 0) * 100));
const digest = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
const year = (value) => /^\d{4}/.test(String(value || "")) ? String(value).slice(0, 4) : "Unknown year";
const property = (value, prefix = "Property") => value ? `${prefix} ${String(value).slice(0, 80)}` : "Unassigned property";
const category = (value) => {
  const text = normalize(value);
  if (text.includes("rent")) return "Rent";
  if (text.includes("deposit")) return "Deposit";
  if (text.includes("late")) return "Late fee";
  if (text.includes("repair") || text.includes("maintenance")) return "Maintenance";
  if (text.includes("utilit")) return "Utilities";
  if (text.includes("tax")) return "Taxes";
  if (text.includes("insurance")) return "Insurance";
  if (text.includes("management")) return "Management";
  if (text.includes("mortgage") || text.includes("loan")) return "Financing";
  if (text.includes("purchase")) return "Purchase";
  return "Other";
};

export function buildApiTransactionReconciliationFingerprint(row) {
  const date = dateOnly(row.transaction_time);
  const amount = cents(row.amount);
  const description = normalize(row.description || row.category_name || row.memo);
  return Object.freeze({
    exact: digest([date, amount, description]),
    probable: digest([date, amount]),
    conflict: digest([date, description]),
    year: year(date),
    property: property(row.property_id, "Rentec property"),
    category: category(row.category_name || row.description),
    amountCents: amount,
  });
}

function buildLegacyFingerprint(event) {
  const date = dateOnly(event.event_date);
  const amount = cents(event.amount);
  const description = normalize(event.description);
  return Object.freeze({
    exact: digest([date, amount, description]),
    probable: digest([date, amount]),
    conflict: digest([date, description]),
    year: year(date),
    property: property(event.property_id, "Legacy property"),
    category: category(event.normalized_category || event.description),
    amountCents: amount,
  });
}

function queues(records, key) {
  const result = new Map();
  records.forEach((record, index) => {
    const values = result.get(record[key]) || [];
    values.push(index);
    result.set(record[key], values);
  });
  return result;
}

function claim(indexes, used) {
  if (!indexes) return null;
  while (indexes.length && used.has(indexes[0])) indexes.shift();
  const index = indexes.shift();
  if (index === undefined) return null;
  used.add(index);
  return index;
}

function grouped(records, key) {
  const counts = new Map();
  for (const record of records) counts.set(record[key], (counts.get(record[key]) || 0) + 1);
  return Object.freeze([...counts.entries()].map(([label, count]) => Object.freeze({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)).slice(0, 25));
}

function varianceBand(apiRecord, legacyRecord) {
  const variance = Math.abs(apiRecord.amountCents - legacyRecord.amountCents);
  if (variance < 1000) return "Under $10";
  if (variance < 10000) return "$10–$99";
  if (variance < 50000) return "$100–$499";
  return "$500 or more";
}

export function previewRentecLegacyReconciliation({ apiRecords = [], legacyEvents = [] } = {}) {
  if (!Array.isArray(apiRecords) || !Array.isArray(legacyEvents)) throw new Error("Rentec reconciliation records must be arrays.");
  const legacy = legacyEvents.map(buildLegacyFingerprint);
  const exact = queues(legacy, "exact");
  const probable = queues(legacy, "probable");
  const conflict = queues(legacy, "conflict");
  const used = new Set();
  const counts = { alreadyRepresented: 0, probableMatch: 0, conflicting: 0, newFromApi: 0 };
  const probableRecords = [];
  const conflictRecords = [];
  const apiOnlyRecords = [];

  for (const record of apiRecords) {
    if (claim(exact.get(record.exact), used) !== null) counts.alreadyRepresented++;
    else {
      const probableIndex = claim(probable.get(record.probable), used);
      if (probableIndex !== null) {
        counts.probableMatch++;
        probableRecords.push(record);
        continue;
      }
      const conflictIndex = claim(conflict.get(record.conflict), used);
      if (conflictIndex !== null) {
        counts.conflicting++;
        conflictRecords.push({ ...record, variance: varianceBand(record, legacy[conflictIndex]) });
        continue;
      }
      counts.newFromApi++;
      apiOnlyRecords.push(record);
    }
  }

  const legacyOnlyRecords = legacy.filter((_, index) => !used.has(index));

  return Object.freeze({
    mode: "preview_only",
    canCommit: false,
    apiTransactions: apiRecords.length,
    legacyRentecEvents: legacyEvents.length,
    ...counts,
    legacyOnly: legacyEvents.length - used.size,
    exceptionReview: Object.freeze({
      apiOnlyByYear: grouped(apiOnlyRecords, "year"),
      apiOnlyByProperty: grouped(apiOnlyRecords, "property"),
      apiOnlyByCategory: grouped(apiOnlyRecords, "category"),
      probableByYear: grouped(probableRecords, "year"),
      probableByCategory: grouped(probableRecords, "category"),
      legacyOnlyByYear: grouped(legacyOnlyRecords, "year"),
      legacyOnlyByProperty: grouped(legacyOnlyRecords, "property"),
      legacyOnlyByCategory: grouped(legacyOnlyRecords, "category"),
      conflictVarianceBands: grouped(conflictRecords, "variance"),
    }),
    warnings: Object.freeze([
      "The legacy Rentec CSV used synthetic row-based identifiers, so no direct source-ID match can be claimed.",
      "Probable matches require review; no legacy financial event will be copied into Rental Manager.",
      "Transaction descriptions and values remain server-side; only one-way reconciliation fingerprints are compared.",
    ]),
  });
}
