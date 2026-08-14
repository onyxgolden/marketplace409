import { createHash } from "node:crypto";

const normalize = (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const dateOnly = (value) => String(value || "").slice(0, 10);
const cents = (value) => Math.abs(Math.round(Number(value || 0) * 100));
const digest = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);

export function buildApiTransactionReconciliationFingerprint(row) {
  const date = dateOnly(row.transaction_time);
  const amount = cents(row.amount);
  const description = normalize(row.description || row.category_name || row.memo);
  return Object.freeze({
    exact: digest([date, amount, description]),
    probable: digest([date, amount]),
    conflict: digest([date, description]),
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

export function previewRentecLegacyReconciliation({ apiRecords = [], legacyEvents = [] } = {}) {
  if (!Array.isArray(apiRecords) || !Array.isArray(legacyEvents)) throw new Error("Rentec reconciliation records must be arrays.");
  const legacy = legacyEvents.map(buildLegacyFingerprint);
  const exact = queues(legacy, "exact");
  const probable = queues(legacy, "probable");
  const conflict = queues(legacy, "conflict");
  const used = new Set();
  const counts = { alreadyRepresented: 0, probableMatch: 0, conflicting: 0, newFromApi: 0 };

  for (const record of apiRecords) {
    if (claim(exact.get(record.exact), used) !== null) counts.alreadyRepresented++;
    else if (claim(probable.get(record.probable), used) !== null) counts.probableMatch++;
    else if (claim(conflict.get(record.conflict), used) !== null) counts.conflicting++;
    else counts.newFromApi++;
  }

  return Object.freeze({
    mode: "preview_only",
    canCommit: false,
    apiTransactions: apiRecords.length,
    legacyRentecEvents: legacyEvents.length,
    ...counts,
    legacyOnly: legacyEvents.length - used.size,
    warnings: Object.freeze([
      "The legacy Rentec CSV used synthetic row-based identifiers, so no direct source-ID match can be claimed.",
      "Probable matches require review; no legacy financial event will be copied into Rental Manager.",
      "Transaction descriptions and values remain server-side; only one-way reconciliation fingerprints are compared.",
    ]),
  });
}
