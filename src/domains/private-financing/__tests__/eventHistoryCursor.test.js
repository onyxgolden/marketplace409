import { describe, expect, it } from "vitest";
import {
  DEFAULT_EVENT_HISTORY_PAGE_SIZE,
  MAX_EVENT_HISTORY_PAGE_SIZE,
  InvalidEventHistoryCursorError,
  decodeEventHistoryCursor,
  encodeEventHistoryCursor,
  resolveEventHistoryPageSize,
} from "../eventHistoryCursor.js";

describe("encodeEventHistoryCursor / decodeEventHistoryCursor round-trip", () => {
  it("round-trips a valid cursor for the matching account", () => {
    const cursor = encodeEventHistoryCursor({ accountId: "pf_acct_1", ledgerSequence: 42 });
    const decoded = decodeEventHistoryCursor(cursor, { expectedAccountId: "pf_acct_1" });
    expect(decoded).toEqual({ ledgerSequence: 42 });
  });

  it("is opaque -- not a plain, human-guessable string", () => {
    const cursor = encodeEventHistoryCursor({ accountId: "pf_acct_1", ledgerSequence: 42 });
    expect(cursor).not.toContain("pf_acct_1");
    expect(cursor).not.toContain("42");
  });
});

describe("decodeEventHistoryCursor -- fails closed on any malformed input", () => {
  const expectedAccountId = "pf_acct_1";

  it("rejects an empty or non-string cursor", () => {
    expect(() => decodeEventHistoryCursor("", { expectedAccountId })).toThrow(InvalidEventHistoryCursorError);
    expect(() => decodeEventHistoryCursor(undefined, { expectedAccountId })).toThrow(InvalidEventHistoryCursorError);
    expect(() => decodeEventHistoryCursor(null, { expectedAccountId })).toThrow(InvalidEventHistoryCursorError);
  });

  it("rejects a cursor that isn't valid base64url-encoded JSON", () => {
    expect(() => decodeEventHistoryCursor("not-valid-base64url-json!!!", { expectedAccountId })).toThrow(InvalidEventHistoryCursorError);
  });

  it("rejects a syntactically valid base64 string that decodes to non-JSON garbage", () => {
    const garbage = Buffer.from("this is not json", "utf8").toString("base64url");
    expect(() => decodeEventHistoryCursor(garbage, { expectedAccountId })).toThrow(InvalidEventHistoryCursorError);
  });

  it("rejects a decoded cursor missing accountId", () => {
    const cursor = Buffer.from(JSON.stringify({ ledgerSequence: 5 }), "utf8").toString("base64url");
    expect(() => decodeEventHistoryCursor(cursor, { expectedAccountId })).toThrow(/accountId/);
  });

  it("rejects a decoded cursor with a non-integer ledgerSequence", () => {
    const cursor = Buffer.from(JSON.stringify({ accountId: "pf_acct_1", ledgerSequence: "5" }), "utf8").toString("base64url");
    expect(() => decodeEventHistoryCursor(cursor, { expectedAccountId })).toThrow(/ledgerSequence/);
  });

  it("rejects a decoded cursor with a zero or negative ledgerSequence", () => {
    const zero = Buffer.from(JSON.stringify({ accountId: "pf_acct_1", ledgerSequence: 0 }), "utf8").toString("base64url");
    expect(() => decodeEventHistoryCursor(zero, { expectedAccountId })).toThrow(InvalidEventHistoryCursorError);
    const negative = Buffer.from(JSON.stringify({ accountId: "pf_acct_1", ledgerSequence: -1 }), "utf8").toString("base64url");
    expect(() => decodeEventHistoryCursor(negative, { expectedAccountId })).toThrow(InvalidEventHistoryCursorError);
  });

  it("rejects a cursor issued for a DIFFERENT account -- cross-account cursor reuse", () => {
    const cursorForOtherAccount = encodeEventHistoryCursor({ accountId: "pf_acct_OTHER", ledgerSequence: 10 });
    expect(() => decodeEventHistoryCursor(cursorForOtherAccount, { expectedAccountId: "pf_acct_1" }))
      .toThrow(/different account/);
  });
});

describe("resolveEventHistoryPageSize", () => {
  it("returns the default when no limit is supplied", () => {
    expect(resolveEventHistoryPageSize(undefined)).toBe(DEFAULT_EVENT_HISTORY_PAGE_SIZE);
    expect(resolveEventHistoryPageSize(null)).toBe(DEFAULT_EVENT_HISTORY_PAGE_SIZE);
  });

  it("returns the default for a malformed limit rather than throwing", () => {
    expect(resolveEventHistoryPageSize("not-a-number")).toBe(DEFAULT_EVENT_HISTORY_PAGE_SIZE);
    expect(resolveEventHistoryPageSize(0)).toBe(DEFAULT_EVENT_HISTORY_PAGE_SIZE);
    expect(resolveEventHistoryPageSize(-5)).toBe(DEFAULT_EVENT_HISTORY_PAGE_SIZE);
  });

  it("honors a valid explicit limit within bounds", () => {
    expect(resolveEventHistoryPageSize(10)).toBe(10);
    expect(resolveEventHistoryPageSize("25")).toBe(25);
  });

  it("clamps a limit above the explicit maximum page size", () => {
    expect(resolveEventHistoryPageSize(100000)).toBe(MAX_EVENT_HISTORY_PAGE_SIZE);
  });
});
