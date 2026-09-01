import { createHash, randomUUID } from "node:crypto";
import { decodeSignedPreviewToken, encodeSignedPreviewToken } from "@/domains/core/signedPreviewToken";

const SECRET_MESSAGE = "Reservation import preview secret is not configured.";
const INVALID_MESSAGE = "Reservation import preview token is invalid.";

export function digestBulkInventoryRows(rows) { return createHash("sha256").update(JSON.stringify(rows)).digest("hex"); }

export function encodeBulkImportPreview(payload, { secret, now = Date.now(), ttlMs = 600000 } = {}) {
  return encodeSignedPreviewToken(
    { ...payload, importId: payload.importId || randomUUID(), version: 1, issuedAt: now, expiresAt: now + ttlMs },
    { secret, secretMessage: SECRET_MESSAGE },
  );
}

export function decodeBulkImportPreview(token, { secret, now = Date.now() } = {}) {
  if (typeof token !== "string") throw new Error("Reservation import preview token is required.");
  const value = decodeSignedPreviewToken(token, { secret, secretMessage: SECRET_MESSAGE, invalidMessage: INVALID_MESSAGE });
  if (value.version !== 1 || !value.importId || !Number.isSafeInteger(value.expiresAt) || now > value.expiresAt) {
    throw new Error("Reservation import preview has expired.");
  }
  return value;
}
