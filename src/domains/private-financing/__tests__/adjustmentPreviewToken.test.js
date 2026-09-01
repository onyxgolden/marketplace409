import { describe, expect, it } from "vitest";
import {
  InvalidAdjustmentPreviewTokenError,
  StaleAdjustmentPreviewError,
  assertAdjustmentPreviewTokenFresh,
  decodeAdjustmentPreviewToken,
  encodeAdjustmentPreviewToken,
} from "../adjustmentPreviewToken.js";

const secret = "test-only-private-financing-preview-secret-123456";
const now = Date.parse("2026-08-30T12:00:00.000Z");
const baseArgs = {
  accountId: "pf_acct_1",
  actionType: "contractual_principal_correction",
  inputs: { componentId: "component-a", deltaCents: -1000, reason: "typo" },
  ledgerSequenceAtPreview: 5,
  asOfDate: "2026-08-30",
  ownerId: "owner-1",
  actingUserId: "user-1",
};

function encode(args = baseArgs) {
  return encodeAdjustmentPreviewToken(args, { secret, now });
}

function decode(token = encode(), options = {}) {
  return decodeAdjustmentPreviewToken(token, { secret, now, ...options });
}

describe("signed adjustment preview token", () => {
  it("round-trips every bound field and adds a unique confirmation identity", () => {
    const decoded = decode();
    expect(decoded).toMatchObject({ ...baseArgs, version: 1, issuedAt: now });
    expect(decoded.confirmationId).toEqual(expect.any(String));
    expect(decoded.expiresAt).toBeGreaterThan(decoded.issuedAt);
  });

  it("does not expose account or action text in the token", () => {
    const token = encode();
    expect(token).not.toContain(baseArgs.accountId);
    expect(token).not.toContain(baseArgs.actionType);
  });

  it("rejects a one-byte payload change even when the modified payload is valid JSON", () => {
    const token = encode();
    const [payload, signature] = token.split(".");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    parsed.inputs.deltaCents = -999999;
    const tamperedPayload = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
    expect(() => decode(`${tamperedPayload}.${signature}`)).toThrow(InvalidAdjustmentPreviewTokenError);
  });

  it("rejects a forged signature and the wrong signing key", () => {
    const [payload] = encode().split(".");
    expect(() => decode(`${payload}.forged`)).toThrow(InvalidAdjustmentPreviewTokenError);
    expect(() => decodeAdjustmentPreviewToken(encode(), { secret: "different-purpose-secret-that-is-long-enough", now })).toThrow(InvalidAdjustmentPreviewTokenError);
  });

  it("rejects missing/short secrets rather than falling back to an unrelated secret", () => {
    expect(() => encodeAdjustmentPreviewToken(baseArgs, { now })).toThrow(/PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET/);
    expect(() => encodeAdjustmentPreviewToken(baseArgs, { secret: "short", now })).toThrow(/at least 32/);
  });

  it("rejects malformed and expired tokens", () => {
    expect(() => decodeAdjustmentPreviewToken("", { secret, now })).toThrow(InvalidAdjustmentPreviewTokenError);
    expect(() => decodeAdjustmentPreviewToken("not-a-signed-token", { secret, now })).toThrow(InvalidAdjustmentPreviewTokenError);
    expect(() => decode(encode(), { now: now + (11 * 60 * 1000) })).toThrow(/expired/);
  });
});

describe("assertAdjustmentPreviewTokenFresh", () => {
  const expected = {
    accountId: baseArgs.accountId,
    actionType: baseArgs.actionType,
    inputs: baseArgs.inputs,
    currentLedgerSequence: 5,
    ownerId: baseArgs.ownerId,
    actingUserId: baseArgs.actingUserId,
  };

  it("passes when signed identity, request, and live ledger all match", () => {
    expect(() => assertAdjustmentPreviewTokenFresh(decode(), expected)).not.toThrow();
  });

  it.each([
    ["accountId", "pf_acct_other"],
    ["actionType", "payment_reversal"],
    ["ownerId", "owner-other"],
    ["actingUserId", "user-other"],
  ])("rejects a changed %s", (field, value) => {
    expect(() => assertAdjustmentPreviewTokenFresh(decode(), { ...expected, [field]: value })).toThrow(StaleAdjustmentPreviewError);
  });

  it("rejects changed inputs and a moved ledger sequence", () => {
    expect(() => assertAdjustmentPreviewTokenFresh(decode(), { ...expected, inputs: { ...baseArgs.inputs, deltaCents: -2 } })).toThrow(/adjustment details/);
    expect(() => assertAdjustmentPreviewTokenFresh(decode(), { ...expected, currentLedgerSequence: 6 })).toThrow(/ledger has changed/);
  });
});
