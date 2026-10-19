/**
 * canonical.js — canonical JSON, hashes, and civil-date / working-day
 * utilities for the Scheduler Agent prototype.
 * Pure Node 24 ESM, zero dependencies. All date math is deterministic
 * (UTC day numbers); invented calendars only, no real holidays.
 */

import { createHash } from "node:crypto";

export const HEX40 = /^[0-9a-f]{40}$/;

/** Canonical JSON: stable key ordering, no whitespace. */
export function canonicalJson(v) {
  if (v === null || v === undefined) return "null";
  if (typeof v === "bigint") return `{"$bigint":"${v.toString()}"}`;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("nonfinite number in canonicalJson");
    return JSON.stringify(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  throw new Error(`uncodable type in canonicalJson: ${typeof v}`);
}

export function canonicalByteLength(v) {
  return Buffer.byteLength(canonicalJson(v), "utf8");
}

export function sha256HexUtf8(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Git blob SHA-1 with the "blob <len>\0" header. */
export function gitBlobId(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, bytes])).digest("hex");
}

const DAY_MS = 86400000;

/** "YYYY-MM-DD" -> integer day number (days since Unix epoch, UTC). */
export function dayNumberOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** Integer day number -> "YYYY-MM-DD". */
export function civilOfDayNumber(n) {
  const dt = new Date(n * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO weekday 1=Monday..7=Sunday for a "YYYY-MM-DD" date. */
export function isoWeekdayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sunday..6=Saturday
  return js === 0 ? 7 : js;
}

/** True iff the string is a real civil calendar date. */
export function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
