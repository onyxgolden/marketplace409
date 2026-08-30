import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = 1;
const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class InvalidAdjustmentPreviewTokenError extends Error {
  constructor(reason) {
    super(`Invalid adjustment preview token: ${reason}`);
    this.name = "InvalidAdjustmentPreviewTokenError";
  }
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new InvalidAdjustmentPreviewTokenError("PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET must contain at least 32 characters");
  }
  return secret;
}

function sign(encodedPayload, secret) {
  return createHmac("sha256", requireSecret(secret)).update(encodedPayload, "utf8").digest("base64url");
}

export function encodeAdjustmentPreviewToken(
  { accountId, actionType, inputs, ledgerSequenceAtPreview, asOfDate, ownerId, actingUserId },
  { secret, now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {},
) {
  const payload = {
    version: TOKEN_VERSION,
    confirmationId: randomUUID(),
    accountId,
    actionType,
    inputs,
    ledgerSequenceAtPreview,
    asOfDate,
    ownerId,
    actingUserId,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function decodeAdjustmentPreviewToken(tokenString, { secret, now = Date.now() } = {}) {
  if (typeof tokenString !== "string" || tokenString.length === 0) {
    throw new InvalidAdjustmentPreviewTokenError("token must be a non-empty string");
  }
  const parts = tokenString.split(".");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new InvalidAdjustmentPreviewTokenError("token must contain a payload and signature");
  }
  const [encodedPayload, suppliedSignature] = parts;
  const expectedSignature = sign(encodedPayload, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new InvalidAdjustmentPreviewTokenError("signature does not match");
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw new InvalidAdjustmentPreviewTokenError("payload is not valid base64url-encoded JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new InvalidAdjustmentPreviewTokenError("decoded token must be an object");
  if (parsed.version !== TOKEN_VERSION) throw new InvalidAdjustmentPreviewTokenError("token version is not supported");
  for (const field of ["confirmationId", "accountId", "actionType", "asOfDate", "ownerId", "actingUserId"]) {
    if (typeof parsed[field] !== "string" || parsed[field].length === 0) throw new InvalidAdjustmentPreviewTokenError(`token is missing a valid ${field}`);
  }
  if (typeof parsed.inputs !== "object" || parsed.inputs === null) throw new InvalidAdjustmentPreviewTokenError("token is missing valid inputs");
  if (!Number.isInteger(parsed.ledgerSequenceAtPreview) || parsed.ledgerSequenceAtPreview < -1) throw new InvalidAdjustmentPreviewTokenError("token is missing a valid ledgerSequenceAtPreview");
  if (!Number.isSafeInteger(parsed.issuedAt) || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= parsed.issuedAt) {
    throw new InvalidAdjustmentPreviewTokenError("token has an invalid validity window");
  }
  if (now > parsed.expiresAt) throw new InvalidAdjustmentPreviewTokenError("token has expired");
  return parsed;
}

export class StaleAdjustmentPreviewError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "StaleAdjustmentPreviewError";
  }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function assertAdjustmentPreviewTokenFresh(
  decodedToken,
  { accountId, actionType, inputs, currentLedgerSequence, ownerId, actingUserId },
) {
  if (decodedToken.ownerId !== ownerId || decodedToken.actingUserId !== actingUserId) {
    throw new StaleAdjustmentPreviewError("This preview was issued for a different signed-in workspace user.");
  }
  if (decodedToken.accountId !== accountId) throw new StaleAdjustmentPreviewError("This preview was issued for a different account.");
  if (decodedToken.actionType !== actionType) throw new StaleAdjustmentPreviewError("This preview was issued for a different action.");
  if (!deepEqual(decodedToken.inputs, inputs)) throw new StaleAdjustmentPreviewError("The adjustment details have changed since this preview was computed.");
  if (decodedToken.ledgerSequenceAtPreview !== currentLedgerSequence) {
    throw new StaleAdjustmentPreviewError("The ledger has changed since this preview was computed. Please refresh and try again.");
  }
}
