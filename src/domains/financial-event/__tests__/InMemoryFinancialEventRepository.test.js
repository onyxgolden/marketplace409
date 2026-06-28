import { describe, expect, test } from "vitest";

import { InMemoryFinancialEventRepository } from "../InMemoryFinancialEventRepository";

function buildEvent(overrides = {}) {
  return {
    id: "",
    owner_id: "owner-1",
    event_date: "2026-01-01",
    description: "Rental Income",
    amount: 1500,
    transaction_kind: "income",
    normalized_category: "rental_income",
    tax_deductible: false,
    affects_noi: true,
    capitalized: false,
    source_system: "rentec",
    ...overrides,
  };
}

describe("InMemoryFinancialEventRepository", () => {
  test("saves financial events", () => {
    const repository = new InMemoryFinancialEventRepository();

    repository.saveMany([buildEvent(), buildEvent({ id: "evt-2" })]);

    expect(repository.count()).toBe(2);
  });

  test("finds financial events by owner id", () => {
    const repository = new InMemoryFinancialEventRepository([
      buildEvent({ id: "evt-1", owner_id: "owner-1" }),
      buildEvent({ id: "evt-2", owner_id: "owner-2" }),
      buildEvent({ id: "evt-3", owner_id: "owner-1" }),
    ]);

    const events = repository.findByOwnerId("owner-1");

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.id)).toEqual(["evt-1", "evt-3"]);
  });

  test("requires owner id when querying by owner", () => {
    const repository = new InMemoryFinancialEventRepository();

    expect(() => repository.findByOwnerId(null)).toThrow(
      "Owner id is required",
    );
  });
});
