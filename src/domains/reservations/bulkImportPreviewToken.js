import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function key(value) { if (typeof value !== "string" || value.length < 32) throw new Error("Reservation import preview secret is not configured."); return value; }
function sign(payload, secret) { return createHmac("sha256", key(secret)).update(payload).digest("base64url"); }
export function digestBulkInventoryRows(rows) { return createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }
export function encodeBulkImportPreview(payload, { secret, now = Date.now(), ttlMs = 600000 } = {}) {
  const value = { ...payload, importId: payload.importId || randomUUID(), version: 1, issuedAt: now, expiresAt: now + ttlMs };
  const encoded = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}
export function decodeBulkImportPreview(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== "string") throw new Error("Reservation import preview token is required.");
  const parts = token.split("."); if (parts.length !== 2) throw new Error("Reservation import preview token is invalid.");
  const expected = Buffer.from(sign(parts[0], secret)); const supplied = Buffer.from(parts[1]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error("Reservation import preview token is invalid.");
  let value; try { value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { throw new Error("Reservation import preview token is invalid."); }
  if (value.version !== 1 || !value.importId || !Number.isSafeInteger(value.expiresAt) || now > value.expiresAt) throw new Error("Reservation import preview has expired.");
  return value;
}
