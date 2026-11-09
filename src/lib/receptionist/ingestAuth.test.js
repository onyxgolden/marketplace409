import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { computeIngestSignature, resolveOperationOwner, verifyIngestSignature } from "./ingestAuth";

const SECRET = "synthetic-test-secret-only";

function signed({ body, ts = Math.floor(Date.now() / 1000), nonce = "nonce-1", secret = SECRET }) {
  return {
    rawBody: body,
    timestamp: String(ts),
    nonce,
    signature: computeIngestSignature(secret, body, String(ts), nonce),
  };
}

describe("receptionist ingest auth", () => {
  it("verifies a correctly signed body", () => {
    const body = JSON.stringify({ operation_id: "brandy-rental-office" });
    expect(verifyIngestSignature({ secret: SECRET, ...signed({ body }) })).toBe(true);
  });

  it("rejects a tampered body", () => {
    const { timestamp, nonce, signature } = signed({ body: '{"a":1}' });
    expect(verifyIngestSignature({ secret: SECRET, rawBody: '{"a":2}', timestamp, nonce, signature })).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const { rawBody, timestamp, nonce, signature } = signed({ body: "{}" });
    expect(verifyIngestSignature({ secret: "other-secret", rawBody, timestamp, nonce, signature })).toBe(false);
  });

  it("rejects stale and future timestamps (replay protection)", () => {
    const now = Math.floor(Date.now() / 1000);
    const stale = signed({ body: "{}", ts: now - 3600 });
    expect(verifyIngestSignature({ secret: SECRET, ...stale })).toBe(false);
    const future = signed({ body: "{}", ts: now + 3600 });
    expect(verifyIngestSignature({ secret: SECRET, ...future })).toBe(false);
  });

  it("resolves operation owners from server env only", () => {
    const env = { RECEPTIONIST_OPERATION_OWNERS: JSON.stringify({ "brandy-rental-office": "owner-uuid-1" }) };
    expect(resolveOperationOwner("brandy-rental-office", env)).toBe("owner-uuid-1");
    expect(resolveOperationOwner("unknown-op", env)).toBeNull();
    expect(resolveOperationOwner("brandy-rental-office", {})).toBeNull();
    expect(resolveOperationOwner("brandy-rental-office", { RECEPTIONIST_OPERATION_OWNERS: "not-json" })).toBeNull();
  });

  it("matches the Python worker's HMAC construction", () => {
    // Independent recomputation: HMAC-SHA256 over "<ts>.<nonce>." + body.
    const body = '{"x":1}';
    const ts = "1700000000";
    const nonce = "abc";
    const expected = crypto.createHmac("sha256", SECRET).update(`${ts}.${nonce}.`).update(body).digest("hex");
    expect(computeIngestSignature(SECRET, body, ts, nonce)).toBe(expected);
  });
});
