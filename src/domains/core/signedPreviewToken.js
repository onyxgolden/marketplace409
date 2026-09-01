import { createHmac, timingSafeEqual } from "node:crypto";

// Shared low-level primitive for "sign a JSON payload, hand it to the client, verify it comes back
// unmodified" preview tokens. Domain-specific wrappers own their own payload shape, field
// validation, and error messages; this only owns the HMAC-sign/base64url/timingSafeEqual mechanics.

function requireSecret(secret, message) {
  if (typeof secret !== "string" || secret.length < 32) throw new Error(message);
  return secret;
}

function sign(encodedPayload, secret) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

export function encodeSignedPreviewToken(payload, { secret, secretMessage }) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sign(encoded, requireSecret(secret, secretMessage))}`;
}

export function decodeSignedPreviewToken(token, { secret, secretMessage, invalidMessage }) {
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error(invalidMessage);
  const expected = Buffer.from(sign(parts[0], requireSecret(secret, secretMessage)));
  const supplied = Buffer.from(parts[1]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error(invalidMessage);
  try {
    return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new Error(invalidMessage);
  }
}
