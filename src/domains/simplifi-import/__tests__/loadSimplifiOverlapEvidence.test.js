import { describe, expect, it, vi } from "vitest";

import { loadSimplifiOverlapEvidence } from "../loadSimplifiOverlapEvidence";

function query(data, error = null) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    then(resolve) { return Promise.resolve({ data, error }).then(resolve); },
  };
  return chain;
}

describe("loadSimplifiOverlapEvidence", () => {
  it("loads only owner-scoped Rentec/Plaid evidence and preserves signed cash direction", async () => {
    const chain = query([
      { id: "income", event_date: "2026-08-01", amount: "10.25", transaction_kind: "income", normalized_category: "rent", source_system: "rentec_api" },
      { id: "expense", event_date: "2026-08-02", amount: "4.75", transaction_kind: "expense", normalized_category: "repairs", source_system: "plaid" },
    ]);
    const database = { from: vi.fn(() => chain) };
    await expect(loadSimplifiOverlapEvidence(database, "owner_1")).resolves.toEqual([
      expect.objectContaining({ id: "income", signed_amount_cents: 1025 }),
      expect.objectContaining({ id: "expense", signed_amount_cents: -475 }),
    ]);
    expect(chain.eq).toHaveBeenCalledWith("owner_id", "owner_1");
    expect(chain.in).toHaveBeenCalledWith("source_system", ["rentec", "rentec_api", "plaid"]);
  });

  it("drops non-income/expense and incomplete evidence rather than guessing", async () => {
    const database = { from: vi.fn(() => query([
      { id: "transfer", event_date: "2026-08-01", amount: "25", transaction_kind: "transfer", normalized_category: "transfer", source_system: "plaid" },
      { id: "missing-category", event_date: "2026-08-01", amount: "25", transaction_kind: "expense", normalized_category: null, source_system: "plaid" },
    ])) };
    await expect(loadSimplifiOverlapEvidence(database, "owner_1")).resolves.toEqual([]);
  });
});
