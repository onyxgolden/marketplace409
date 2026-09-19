import { describe, expect, test } from "vitest";
import { isPairAlreadyApplied } from "../isPairAlreadyApplied.js";

// Regression tests for the 2026-09-18 "it won't go away" bug: after a successful
// apply, the reconcile-transfers preview re-derived the same pairs from the raw rows
// and kept listing them, so the panel never emptied. Pairs already in their target
// state must be hidden from the preview.

const TRANSFER_INTERNAL = { kind: "transfer", category: "internal_transfer" };

function rowsById(entries) {
  return new Map(Object.entries(entries).map(([id, [kind, category]]) => [id, { transaction_kind: kind, normalized_category: category }]));
}

describe("isPairAlreadyApplied", () => {
  test("true when both legs already carry the target classification", () => {
    const rowById = rowsById({
      "in-1": ["transfer", "internal_transfer"],
      "out-1": ["transfer", "internal_transfer"],
    });
    expect(
      isPairAlreadyApplied({
        inboundId: "in-1",
        outboundId: "out-1",
        expectedInbound: TRANSFER_INTERNAL,
        expectedOutbound: TRANSFER_INTERNAL,
        rowById,
      }),
    ).toBe(true);
  });

  test("true for a debt-payment pair already applied (expense/heloc_payment + transfer/internal_transfer)", () => {
    const rowById = rowsById({
      "heloc-in": ["transfer", "internal_transfer"],
      "savings-out": ["expense", "heloc_payment"],
    });
    expect(
      isPairAlreadyApplied({
        inboundId: "heloc-in",
        outboundId: "savings-out",
        expectedInbound: TRANSFER_INTERNAL,
        expectedOutbound: { kind: "expense", category: "heloc_payment" },
        rowById,
      }),
    ).toBe(true);
  });

  test("false when only one leg has been applied (partial apply still shows the pair)", () => {
    const rowById = rowsById({
      "heloc-in": ["transfer", "internal_transfer"],
      "savings-out": ["expense", "other"],
    });
    expect(
      isPairAlreadyApplied({
        inboundId: "heloc-in",
        outboundId: "savings-out",
        expectedInbound: TRANSFER_INTERNAL,
        expectedOutbound: { kind: "expense", category: "heloc_payment" },
        rowById,
      }),
    ).toBe(false);
  });

  test("false when neither leg has been touched", () => {
    const rowById = rowsById({
      "in-1": ["expense", "other"],
      "out-1": ["expense", "other"],
    });
    expect(
      isPairAlreadyApplied({
        inboundId: "in-1",
        outboundId: "out-1",
        expectedInbound: TRANSFER_INTERNAL,
        expectedOutbound: TRANSFER_INTERNAL,
        rowById,
      }),
    ).toBe(false);
  });

  test("false when a leg is missing from the row map", () => {
    const rowById = rowsById({ "in-1": ["transfer", "internal_transfer"] });
    expect(
      isPairAlreadyApplied({
        inboundId: "in-1",
        outboundId: "out-missing",
        expectedInbound: TRANSFER_INTERNAL,
        expectedOutbound: TRANSFER_INTERNAL,
        rowById,
      }),
    ).toBe(false);
  });

  test("false for a distribution pair where the category is right but the kind is wrong", () => {
    const rowById = rowsById({
      "in-1": ["transfer", "owner_distribution"],
      "out-1": ["expense", "owner_distribution"],
    });
    expect(
      isPairAlreadyApplied({
        inboundId: "in-1",
        outboundId: "out-1",
        expectedInbound: { kind: "income", category: "owner_distribution" },
        expectedOutbound: { kind: "expense", category: "owner_distribution" },
        rowById,
      }),
    ).toBe(false);
  });
});
