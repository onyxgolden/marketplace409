import { describe, expect, test } from "vitest";
import { buildApplyPayloads } from "../../../../../domains/financial-event/buildTransferApplyPayloads.js";
import { classifyTransferPairs } from "../../../../../domains/financial-event/classifyTransferPairs.js";

// Regression tests for the 2026-09-18 HELOC sign destruction:
// POST /api/financial/reconcile-transfers used p_amount: Math.abs(amount) for every leg,
// and the RPC required p_amount > 0, so confirmed inbound transfer legs (negative by
// convention) were written back positive and could never pair again.

describe("buildApplyPayloads preserves transfer direction", () => {
  test("confirmed inbound transfers remain negative after apply", () => {
    const preview = {
      directionFixes: [],
      internalTransfers: [
        {
          inbound: { eventId: "in-1", eventDate: "2026-08-20", amount: -1482.5 },
          outbound: { eventId: "out-1", eventDate: "2026-08-20", amount: 1482.5 },
        },
      ],
      distributions: [],
    };
    const payloads = buildApplyPayloads(preview);
    const byId = Object.fromEntries(payloads.map((p) => [p.eventId, p]));
    expect(byId["in-1"].pAmount).toBe(-1482.5);
    expect(byId["in-1"].transactionKind).toBe("transfer");
    expect(byId["out-1"].pAmount).toBe(1482.5);
    expect(byId["out-1"].transactionKind).toBe("transfer");
  });

  test("re-running preview still pairs applied transfers (signed legs)", () => {
    // Simulate DB state AFTER a correct apply: inbound negative, outbound positive.
    const rows = [
      { id: "in-1", eventDate: "2026-08-20", amount: -1482.5, businessScope: "personal" },
      { id: "out-1", eventDate: "2026-08-20", amount: 1482.5, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([{ inboundId: "in-1", outboundId: "out-1" }]);
    expect(result.ambiguous).toEqual([]);
  });

  test("income corrections remain positive magnitudes", () => {
    const preview = {
      directionFixes: [{ eventId: "inc-1", eventDate: "2026-08-01", amount: -5000 }],
      internalTransfers: [],
      distributions: [
        {
          inbound: { eventId: "dist-in", eventDate: "2026-07-20", amount: -10000 },
          outbound: { eventId: "dist-out", eventDate: "2026-07-20", amount: 10000 },
        },
      ],
    };
    const payloads = buildApplyPayloads(preview);
    const byId = Object.fromEntries(payloads.map((p) => [p.eventId, p]));
    expect(byId["inc-1"].pAmount).toBe(5000);
    expect(byId["inc-1"].transactionKind).toBe("income");
    // Distributions are income/expense kinds: positive magnitudes.
    expect(byId["dist-in"].pAmount).toBe(10000);
    expect(byId["dist-in"].transactionKind).toBe("income");
    expect(byId["dist-out"].pAmount).toBe(10000);
    expect(byId["dist-out"].transactionKind).toBe("expense");
  });

  test("unmatched 2026-07-20 HELOC row stays ambiguous (no counterpart)", () => {
    // Production reality: the 2026-07-20 Home Equity -1482.50 leg has no savings-side
    // counterpart in the data, so it must surface for human review, not silently classify.
    const rows = [
      { id: "heloc-2026-07-20", eventDate: "2026-07-20", amount: -1482.5, businessScope: "personal" },
    ];
    const result = classifyTransferPairs({ rows });
    expect(result.internalTransfers).toEqual([]);
    expect(result.distributions).toEqual([]);
    expect(result.ambiguous).toEqual([
      { side: "inbound", eventId: "heloc-2026-07-20", candidateIds: [], reason: "no_candidates" },
    ]);
  });

  test("defensive: even if preview hands a positive inbound amount, payload forces negative", () => {
    const preview = {
      directionFixes: [],
      internalTransfers: [
        {
          // Simulates a DB that was already absolutized by the old bug.
          inbound: { eventId: "in-bad", eventDate: "2026-08-20", amount: 1482.5 },
          outbound: { eventId: "out-bad", eventDate: "2026-08-20", amount: 1482.5 },
        },
      ],
      distributions: [],
    };
    const payloads = buildApplyPayloads(preview);
    const byId = Object.fromEntries(payloads.map((p) => [p.eventId, p]));
    expect(byId["in-bad"].pAmount).toBe(-1482.5);
    expect(byId["out-bad"].pAmount).toBe(1482.5);
  });
});
