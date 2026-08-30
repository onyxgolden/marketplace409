import { describe, expect, it } from "vitest";
import {
  InvalidAdjustmentPreviewTokenError,
  StaleAdjustmentPreviewError,
  assertAdjustmentPreviewTokenFresh,
  decodeAdjustmentPreviewToken,
  encodeAdjustmentPreviewToken,
} from "../adjustmentPreviewToken.js";

const baseArgs = { accountId: "pf_acct_1", actionType: "contractual_principal_correction", inputs: { componentType: "zero_interest", deltaCents: -1000, reason: "typo" }, ledgerSequenceAtPreview: 5, asOfDate: "2026-08-30" };

describe("encodeAdjustmentPreviewToken / decodeAdjustmentPreviewToken round-trip", () => {
  it("round-trips every bound field exactly", () => {
    const token = encodeAdjustmentPreviewToken(baseArgs);
    const decoded = decodeAdjustmentPreviewToken(token);
    expect(decoded).toEqual(baseArgs);
  });

  it("is opaque -- not a plain, human-guessable string", () => {
    const token = encodeAdjustmentPreviewToken(baseArgs);
    expect(token).not.toContain("pf_acct_1");
    expect(token).not.toContain("contractual_principal_correction");
  });
});

describe("decodeAdjustmentPreviewToken -- fails closed on malformed input", () => {
  it("rejects an empty or non-string token", () => {
    expect(() => decodeAdjustmentPreviewToken("")).toThrow(InvalidAdjustmentPreviewTokenError);
    expect(() => decodeAdjustmentPreviewToken(undefined)).toThrow(InvalidAdjustmentPreviewTokenError);
  });

  it("rejects a token that isn't valid base64url JSON", () => {
    expect(() => decodeAdjustmentPreviewToken("not-valid!!!")).toThrow(InvalidAdjustmentPreviewTokenError);
  });

  it("rejects a decoded token missing required fields", () => {
    const missingAccountId = Buffer.from(JSON.stringify({ actionType: "x", inputs: {}, ledgerSequenceAtPreview: 1, asOfDate: "2026-08-30" }), "utf8").toString("base64url");
    expect(() => decodeAdjustmentPreviewToken(missingAccountId)).toThrow(/accountId/);

    const missingLedgerSequence = Buffer.from(JSON.stringify({ accountId: "a", actionType: "x", inputs: {}, asOfDate: "2026-08-30" }), "utf8").toString("base64url");
    expect(() => decodeAdjustmentPreviewToken(missingLedgerSequence)).toThrow(/ledgerSequenceAtPreview/);
  });
});

describe("assertAdjustmentPreviewTokenFresh", () => {
  it("passes silently when everything still matches", () => {
    const decoded = decodeAdjustmentPreviewToken(encodeAdjustmentPreviewToken(baseArgs));
    expect(() => assertAdjustmentPreviewTokenFresh(decoded, { accountId: "pf_acct_1", actionType: "contractual_principal_correction", inputs: baseArgs.inputs, currentLedgerSequence: 5 })).not.toThrow();
  });

  it("rejects cross-account preview reuse", () => {
    const decoded = decodeAdjustmentPreviewToken(encodeAdjustmentPreviewToken(baseArgs));
    expect(() => assertAdjustmentPreviewTokenFresh(decoded, { accountId: "pf_acct_OTHER", actionType: baseArgs.actionType, inputs: baseArgs.inputs, currentLedgerSequence: 5 }))
      .toThrow(StaleAdjustmentPreviewError);
  });

  it("rejects a mismatched action type", () => {
    const decoded = decodeAdjustmentPreviewToken(encodeAdjustmentPreviewToken(baseArgs));
    expect(() => assertAdjustmentPreviewTokenFresh(decoded, { accountId: baseArgs.accountId, actionType: "payment_reversal", inputs: baseArgs.inputs, currentLedgerSequence: 5 }))
      .toThrow(StaleAdjustmentPreviewError);
  });

  it("rejects changed adjustment inputs", () => {
    const decoded = decodeAdjustmentPreviewToken(encodeAdjustmentPreviewToken(baseArgs));
    expect(() => assertAdjustmentPreviewTokenFresh(decoded, { accountId: baseArgs.accountId, actionType: baseArgs.actionType, inputs: { ...baseArgs.inputs, deltaCents: -9999 }, currentLedgerSequence: 5 }))
      .toThrow(/adjustment details have changed/);
  });

  it("rejects a changed ledger sequence -- a new event posted since preview", () => {
    const decoded = decodeAdjustmentPreviewToken(encodeAdjustmentPreviewToken(baseArgs));
    expect(() => assertAdjustmentPreviewTokenFresh(decoded, { accountId: baseArgs.accountId, actionType: baseArgs.actionType, inputs: baseArgs.inputs, currentLedgerSequence: 6 }))
      .toThrow(/ledger has changed/);
  });

  it("a second confirm attempt with the same token is rejected once the first confirm has advanced the ledger sequence -- this is the duplicate-submit/idempotency protection", () => {
    const decoded = decodeAdjustmentPreviewToken(encodeAdjustmentPreviewToken(baseArgs));
    // First attempt succeeds (currentLedgerSequence still matches).
    expect(() => assertAdjustmentPreviewTokenFresh(decoded, { accountId: baseArgs.accountId, actionType: baseArgs.actionType, inputs: baseArgs.inputs, currentLedgerSequence: 5 })).not.toThrow();
    // After a successful post, the real ledger sequence advances by 1 -- a second confirm reusing the
    // SAME token (e.g. a double-click) must now fail.
    expect(() => assertAdjustmentPreviewTokenFresh(decoded, { accountId: baseArgs.accountId, actionType: baseArgs.actionType, inputs: baseArgs.inputs, currentLedgerSequence: 6 })).toThrow(StaleAdjustmentPreviewError);
  });
});
