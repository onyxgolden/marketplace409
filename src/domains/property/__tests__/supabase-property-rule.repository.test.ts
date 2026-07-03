import { beforeEach, describe, expect, it, vi } from "vitest";

import { SupabasePropertyRuleRepository } from "../supabase-property-rule.repository";

const query = {
  upsert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  is: vi.fn(),
  or: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => query),
  },
}));

describe("SupabasePropertyRuleRepository", () => {
  beforeEach(() => {
    query.upsert.mockReset();
    query.select.mockReset();
    query.single.mockReset();
    query.eq.mockReset();
    query.order.mockReset();
    query.is.mockReset();
    query.or.mockReset();

    query.upsert.mockReturnValue(query);
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.or.mockReturnValue(query);
  });

  it("saves a property resolution rule", async () => {
    query.single.mockResolvedValue({
      data: {
        id: "rule-1",
        type: "manual",
        property_id: "property-1",
        property_snapshot: { id: "property-1", name: "Rental 1" },
        priority: 1000,
        owner_id: "owner-1",
        organization_id: null,
        enabled: true,
        match_field: "merchantName",
        match_value: "LOWES",
        match_mode: "equals",
      },
      error: null,
    });

    const repository = new SupabasePropertyRuleRepository();

    const result = await repository.save({
      id: "rule-1",
      type: "manual",
      property: { id: "property-1", name: "Rental 1" },
      priority: 1000,
      ownerId: "owner-1",
      organizationId: null,
      enabled: true,
      match: {
        field: "merchantName",
        value: "LOWES",
        mode: "equals",
      },
    });

    expect(query.upsert).toHaveBeenCalledWith({
      id: "rule-1",
      type: "manual",
      property_id: "property-1",
      property_snapshot: { id: "property-1", name: "Rental 1" },
      priority: 1000,
      owner_id: "owner-1",
      organization_id: null,
      enabled: true,
      match_field: "merchantName",
      match_value: "LOWES",
      match_mode: "equals",
    });

    expect(result.property.id).toBe("property-1");
    expect(result.match.value).toBe("LOWES");
  });

  it("finds enabled scoped property rules ordered by priority", async () => {
    query.or.mockImplementation(() => ({
      ...query,
      is: vi.fn().mockResolvedValue({
        data: [
          {
            id: "rule-1",
            type: "manual",
            property_id: "property-1",
            property_snapshot: { id: "property-1", name: "Rental 1" },
            priority: 1000,
            owner_id: "owner-1",
            organization_id: null,
            enabled: true,
            match_field: "merchantName",
            match_value: "LOWES",
            match_mode: "equals",
          },
        ],
        error: null,
      }),
    }));

    const repository = new SupabasePropertyRuleRepository();

    const result = await repository.findRules({
      ownerId: "owner-1",
      organizationId: null,
    });

    expect(query.eq).toHaveBeenCalledWith("enabled", true);
    expect(query.order).toHaveBeenCalledWith("priority", {
      ascending: false,
    });
    expect(query.or).toHaveBeenCalledWith(
      "owner_id.is.null,owner_id.eq.owner-1",
    );

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("rule-1");
  });
});

