// One-time action tokens behind the "Yes, this was me" / "Wasn't me" links in
// new-sign-in alert emails. Only the SHA-256 hex of a token is ever stored
// (location_action_tokens.token_hash); the raw token exists solely inside the
// emailed URL. Tokens are 32 random bytes rendered as 64 hex characters.

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export function createLocationActionToken() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashLocationActionToken(token) };
}

export function hashLocationActionToken(token) {
  if (typeof token !== "string" || !token) throw new Error("hashLocationActionToken requires a token string.");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

// Defense-in-depth on top of the indexed hash lookup: compare the recomputed
// hash against the stored hash in constant time.
export function tokenHashEquals(computedHash, storedHash) {
  if (typeof computedHash !== "string" || typeof storedHash !== "string") return false;
  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export const LOCATION_ACTION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function locationActionTokenExpiry(nowMs = Date.now()) {
  return new Date(nowMs + LOCATION_ACTION_TOKEN_TTL_MS).toISOString();
}
