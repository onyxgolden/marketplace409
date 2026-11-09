import crypto from "node:crypto";

// HMAC verification for service -> FORGE receptionist ingestion.
// Mirrors services/brandy-receptionist/app/integrations/forge.py exactly:
//   signature = HMAC-SHA256(secret, "<timestamp>.<nonce>." + rawBody)
// Headers: X-Forge-Timestamp, X-Forge-Nonce, X-Forge-Signature.
// Replay window: 300 s. Constant-time compare; never log the secret.

export const REPLAY_WINDOW_S = 300;

export function computeIngestSignature(secret, rawBody, timestamp, nonce) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.`)
    .update(rawBody)
    .digest("hex");
}

export function verifyIngestSignature({ secret, rawBody, timestamp, nonce, signature, nowS = Math.floor(Date.now() / 1000) }) {
  if (typeof secret !== "string" || secret === "") return false;
  if (typeof signature !== "string" || signature === "") return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > REPLAY_WINDOW_S) return false;
  if (typeof nonce !== "string" || nonce === "") return false;
  const expected = computeIngestSignature(secret, rawBody, String(ts), nonce);
  const expectedBuf = Buffer.from(expected, "utf8");
  const givenBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== givenBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, givenBuf);
}

// Resolve the operation id to its owner id from server config only.
// Env RECEPTIONIST_OPERATION_OWNERS is JSON: {"brandy-rental-office": "<owner-uuid>"}.
// Unknown operations 401 — never reveal whether an operation exists.
export function resolveOperationOwner(operationId, env = process.env) {
  if (typeof operationId !== "string" || operationId === "") return null;
  try {
    const map = JSON.parse(env.RECEPTIONIST_OPERATION_OWNERS || "{}");
    const ownerId = map[operationId];
    return typeof ownerId === "string" && ownerId !== "" ? ownerId : null;
  } catch {
    return null;
  }
}
