/**
 * canonical.js — canonical JSON, hashes, and civil-date / instant
 * validation utilities for the Validation Agent prototype.
 * Pure Node 24 ESM, zero dependencies.
 */

import { createHash } from "node:crypto";

export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;

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

/** True iff the string is a real UTC instant (no Date.parse normalization). */
export function isRealInstant(value) {
  if (typeof value !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
  if (!m) return false;
  const [, ys, mos, ds, hs, mis, ss] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds);
  const h = Number(hs), mi = Number(mis), s = Number(ss);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d &&
    dt.getUTCHours() === h &&
    dt.getUTCMinutes() === mi &&
    dt.getUTCSeconds() === s
  );
}

/** True iff the string is a real civil calendar date. */
export function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
