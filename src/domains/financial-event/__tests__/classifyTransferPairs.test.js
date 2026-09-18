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
    expect(result.ambiguous).toEqual([{ side: "inbound", eventId: "in-1", candidateIds: [], reason: "no_candidates" }]);
  });

  // Regression test for the gap flagged during review: an outbound-only row with zero inbound
  // candidates must surface in `ambiguous` too, not disappear silently. Before this fix,
  // `ambiguous` was only ever populated by iterating inbound rows, so an outbound row nobody
  // claimed was invisible in both the confirmed AND ambiguous buckets -- found against real
  // production data as two real unmatched transfers ($5,000 and $30,000).
  test("leaves an outbound row with zero inbound candidates ambiguous -- the exact silent-drop bug this fix closes", () => {
    const rows = [{ id: "out-1", eventDate: "2026-08-21", amount: 30000, businessScope: "business" }];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([]);
    expect(result.distributions).toEqual([]);
    expect(result.ambiguous).toEqual([{ side: "outbound", eventId: "out-1", candidateIds: [], reason: "no_candidates" }]);
  });

  test("leaves an inbound row with multiple same-amount candidates ambiguous, and surfaces both contended outbound rows too", () => {
    const rows = [
      { id: "in-1", eventDate: "2026-08-20", amount: -500, businessScope: "personal" },
      { id: "out-1", eventDate: "2026-08-20", amount: 500, businessScope: "personal" },
      { id: "out-2", eventDate: "2026-08-21", amount: 500, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([]);
    expect(result.distributions).toEqual([]);
    // All three rows are unresolved: in-1 (two candidates), and out-1/out-2 (each sees in-1 as its
    // sole candidate, but that candidacy isn't mutual since in-1 itself has two candidates).
    expect(result.ambiguous).toHaveLength(3);
    const byId = Object.fromEntries(result.ambiguous.map((e) => [e.eventId, e]));
    expect(byId["in-1"].reason).toBe("multiple_candidates");
    expect([...byId["in-1"].candidateIds].sort()).toEqual(["out-1", "out-2"]);
    expect(byId["out-1"].reason).toBe("contended_counterparty");
    expect(byId["out-1"].candidateIds).toEqual(["in-1"]);
    expect(byId["out-2"].reason).toBe("contended_counterparty");
    expect(byId["out-2"].candidateIds).toEqual(["in-1"]);
  });

  test("voids a contended outbound match for both contending inbound rows AND surfaces the contended outbound row itself", () => {
    const rows = [
      { id: "in-1", eventDate: "2026-08-20", amount: -500, businessScope: "personal" },
      { id: "in-2", eventDate: "2026-08-21", amount: -500, businessScope: "personal" },
      { id: "out-1", eventDate: "2026-08-20", amount: 500, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([]);
    expect(result.distributions).toEqual([]);
    expect(result.ambiguous).toHaveLength(3);
    const byId = Object.fromEntries(result.ambiguous.map((e) => [e.eventId, e]));
    expect(byId["in-1"].reason).toBe("contended_counterparty");
    expect(byId["in-2"].reason).toBe("contended_counterparty");
    expect(byId["out-1"].reason).toBe("multiple_candidates");
    expect([...byId["out-1"].candidateIds].sort()).toEqual(["in-1", "in-2"]);
  });

  test("respects the date tolerance window -- both sides end up ambiguous, neither silently dropped", () => {
    const rows = [
      { id: "out-1", eventDate: "2026-08-01", amount: 100, businessScope: "personal" },
      { id: "in-1", eventDate: "2026-08-10", amount: -100, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows, toleranceDays: 3 });
    expect(result.internalTransfers).toEqual([]);
    expect(result.ambiguous).toHaveLength(2);
    const byId = Object.fromEntries(result.ambiguous.map((e) => [e.eventId, e]));
    expect(byId["in-1"]).toEqual({ side: "inbound", eventId: "in-1", candidateIds: [], reason: "no_candidates" });
    expect(byId["out-1"]).toEqual({ side: "outbound", eventId: "out-1", candidateIds: [], reason: "no_candidates" });
  });

  test("compares amounts at cent precision, not exact float equality", () => {
    const rows = [
      { id: "out-1", eventDate: "2026-08-20", amount: 100.1, businessScope: "personal" },
      { id: "in-1", eventDate: "2026-08-20", amount: -100.10000000001, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([{ inboundId: "in-1", outboundId: "out-1" }]);
    expect(result.ambiguous).toEqual([]);
  });

  test("a mixed batch: confirmed pair, contended pair, and a lone unmatched outbound row are all classified correctly at once", () => {
    const rows = [
      // Clean confirmed pair.
      { id: "out-clean", eventDate: "2026-05-01", amount: 200, businessScope: "personal" },
      { id: "in-clean", eventDate: "2026-05-01", amount: -200, businessScope: "personal" },
      // Contended: two inbound rows, one outbound candidate.
      { id: "in-a", eventDate: "2026-06-01", amount: -700, businessScope: "personal" },
      { id: "in-b", eventDate: "2026-06-02", amount: -700, businessScope: "personal" },
      { id: "out-contended", eventDate: "2026-06-01", amount: 700, businessScope: "personal" },
      // Lone, entirely unmatched outbound row -- the exact regression case.
      { id: "out-lone", eventDate: "2026-08-21", amount: 30000, businessScope: "business" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([{ inboundId: "in-clean", outboundId: "out-clean" }]);
    expect(result.distributions).toEqual([]);
    const ambiguousIds = result.ambiguous.map((e) => e.eventId).sort();
    expect(ambiguousIds).toEqual(["in-a", "in-b", "out-contended", "out-lone"]);
    const outLone = result.ambiguous.find((e) => e.eventId === "out-lone");
    expect(outLone.side).toBe("outbound");
    expect(outLone.reason).toBe("no_candidates");
  });

  test("throws on invalid input", () => {
    expect(() => classifyTransferPairs({ rows: null })).toThrow();
    expect(() => classifyTransferPairs({ rows: [], toleranceDays: -1 })).toThrow();
  });
});
