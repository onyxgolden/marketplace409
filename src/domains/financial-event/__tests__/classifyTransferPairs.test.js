import { describe, expect, test } from "vitest";
import { isInternalTransferDescription, classifyTransferPairs } from "../classifyTransferPairs";

describe("isInternalTransferDescription", () => {
  test("matches real production transfer descriptions", () => {
    expect(isInternalTransferDescription("Online Banking Withdrawal / Transfer to Loan 0020: Internet Access 09/06/2026 11:19 550101:")).toBe(true);
    expect(isInternalTransferDescription("Online Banking Payment / Transfer from Share 0000: Internet Access 09/06/2026 11:19 550101:")).toBe(true);
    expect(isInternalTransferDescription("Deposit / Transfer from XP Property Management LLC Share 0000")).toBe(true);
    expect(isInternalTransferDescription("Withdrawal / Transfer to Jason Daniel Morgan Share 0000")).toBe(true);
    expect(isInternalTransferDescription("Online Banking Deposit / Transfer from Share 0009: Internet Access 09/03/2026 09:49 537548:")).toBe(true);
  });

  test("does not match unrelated descriptions, including real rent deposits", () => {
    expect(isInternalTransferDescription("ACH Deposit / FORTE 5330903620 235733 260327 091000012980918")).toBe(false);
    expect(isInternalTransferDescription("ACH Withdrawal / VERIZON WIRELESS 1223344794 PAYMENTS 260903 021000023184811")).toBe(false);
    expect(isInternalTransferDescription("/ Correcting Posting")).toBe(false);
  });

  test("handles non-string input without throwing", () => {
    expect(isInternalTransferDescription(null)).toBe(false);
    expect(isInternalTransferDescription(undefined)).toBe(false);
  });
});

describe("classifyTransferPairs", () => {
  test("pairs an unambiguous same-scope transfer as an internal transfer, not a distribution", () => {
    const rows = [
      { id: "out-1", eventDate: "2026-08-20", amount: 1482.5, businessScope: "personal" },
      { id: "in-1", eventDate: "2026-08-20", amount: -1482.5, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([{ inboundId: "in-1", outboundId: "out-1" }]);
    expect(result.distributions).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  test("pairs an unambiguous cross-scope transfer as a distribution, with scope on each leg", () => {
    const rows = [
      { id: "biz-out", eventDate: "2026-07-20", amount: 10000, businessScope: "business" },
      { id: "personal-in", eventDate: "2026-07-20", amount: -10000, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([]);
    expect(result.distributions).toEqual([
      { inboundId: "personal-in", outboundId: "biz-out", inboundScope: "personal", outboundScope: "business" },
    ]);
    expect(result.ambiguous).toEqual([]);
  });

  test("leaves an inbound row with zero outbound candidates ambiguous", () => {
    const rows = [{ id: "in-1", eventDate: "2026-08-20", amount: -500, businessScope: "personal" }];
    const result = classifyTransferPairs({ rows });
    expect(result.ambiguous).toEqual([{ inboundId: "in-1", candidateOutboundIds: [], reason: "no_candidates" }]);
  });

  test("leaves an inbound row with multiple same-amount candidates ambiguous, resolving neither", () => {
    const rows = [
      { id: "in-1", eventDate: "2026-08-20", amount: -500, businessScope: "personal" },
      { id: "out-1", eventDate: "2026-08-20", amount: 500, businessScope: "personal" },
      { id: "out-2", eventDate: "2026-08-21", amount: 500, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([]);
    expect(result.distributions).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].reason).toBe("multiple_candidates");
    expect([...result.ambiguous[0].candidateOutboundIds].sort()).toEqual(["out-1", "out-2"]);
  });

  test("voids a contended outbound match for BOTH contending inbound rows, picks neither", () => {
    const rows = [
      { id: "in-1", eventDate: "2026-08-20", amount: -500, businessScope: "personal" },
      { id: "in-2", eventDate: "2026-08-21", amount: -500, businessScope: "personal" },
      { id: "out-1", eventDate: "2026-08-20", amount: 500, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([]);
    expect(result.distributions).toEqual([]);
    const reasons = result.ambiguous.map((entry) => entry.reason).sort();
    expect(reasons).toEqual(["contended_outbound_row", "contended_outbound_row"]);
  });

  test("respects the date tolerance window", () => {
    const rows = [
      { id: "out-1", eventDate: "2026-08-01", amount: 100, businessScope: "personal" },
      { id: "in-1", eventDate: "2026-08-10", amount: -100, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows, toleranceDays: 3 });
    expect(result.internalTransfers).toEqual([]);
    expect(result.ambiguous).toEqual([{ inboundId: "in-1", candidateOutboundIds: [], reason: "no_candidates" }]);
  });

  test("compares amounts at cent precision, not exact float equality", () => {
    const rows = [
      { id: "out-1", eventDate: "2026-08-20", amount: 100.1, businessScope: "personal" },
      { id: "in-1", eventDate: "2026-08-20", amount: -100.10000000001, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([{ inboundId: "in-1", outboundId: "out-1" }]);
  });

  test("throws on invalid input", () => {
    expect(() => classifyTransferPairs({ rows: null })).toThrow();
    expect(() => classifyTransferPairs({ rows: [], toleranceDays: -1 })).toThrow();
  });
});
