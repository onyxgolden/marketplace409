import { randomUUID } from "node:crypto";
import { decodeSignedPreviewToken, encodeSignedPreviewToken } from "@/domains/core/signedPreviewToken";

const SECRET_MESSAGE = "Reservation preview secret is not configured.";
const INVALID_MESSAGE = "Reservation preview token is invalid.";

export function encodeReservationPreview(payload, { key, now = Date.now(), ttlMs = 600000 } = {}) {
  return encodeSignedPreviewToken(
    { ...payload, confirmationId: randomUUID(), version: 1, issuedAt: now, expiresAt: now + ttlMs },
    { secret: key, secretMessage: SECRET_MESSAGE },
  );
}

export function decodeReservationPreview(token, { key, now = Date.now() } = {}) {
  if (typeof token !== "string") throw new Error("Reservation preview token is required.");
  const value = decodeSignedPreviewToken(token, { secret: key, secretMessage: SECRET_MESSAGE, invalidMessage: INVALID_MESSAGE });
  if (value.version !== 1 || typeof value.confirmationId !== "string" || !value.confirmationId
    || !Number.isSafeInteger(value.expiresAt) || now > value.expiresAt) {
    throw new Error("Reservation preview has expired.");
  }
  return value;
}
