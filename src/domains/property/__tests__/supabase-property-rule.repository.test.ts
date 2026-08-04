import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SupabasePropertyRuleRepository,
} from "../supabase-property-rule.repository";

const query = {
  upsert:
    vi.fn(),
  select:
    vi.fn(),
  single:
    vi.fn(),
  eq:
    vi.fn(),
  order:
    vi.fn(),
  is:
    vi.fn(),
  or:
    vi.fn(),
};

const supabaseClient = {
  from:
    vi.fn(() => query),
};

describe(
  "SupabasePropertyRuleRepository",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();

      query.upsert
        .mockReturnValue(query);

      query.select
        .mockReturnValue(query);

      query.eq
        .mockReturnValue(query);

      query.order
        .mockReturnValue(query);

      query.is
        .mockReturnValue(query);

      query.or
        .mockReturnValue(query);
    });

    it(
      "requires an injected Supabase client",
      () => {
        expect(
          () =>
            new SupabasePropertyRuleRepository(
              undefined as never,
            ),
        ).toThrow(
          "SupabasePropertyRuleRepository requires a Supabase client.",
        );
      },
    );

    it(
      "saves through the injected Supabase client",
      async () => {
        query.single.mockResolvedValue({
          data: {
            id:
              "rule-1",
            type:
              "manual",
            property_id:
              "property-1",
            property_snapshot: {
              id:
                "property-1",
              name:
                "Rental 1",
            },
            priority:
              1000,
            owner_id:
              "owner-1",
            organization_id:
              null,
            enabled:
              true,
            match_field:
              "merchantName",
            match_value:
              "LOWES",
            match_mode:
              "equals",
          },
          error:
            null,
        });

        const repository =
          new SupabasePropertyRuleRepository(
            supabaseClient,
          );

        const result =
          await repository.save({
            id:
              "rule-1",
            type:
              "manual",
            property: {
              id:
                "property-1",
              name:
                "Rental 1",
            },
            priority:
              1000,
            ownerId:
              "owner-1",
            organizationId:
              null,
            enabled:
              true,
            match: {
              field:
                "merchantName",
              value:
                "LOWES",
              mode:
                "equals",
            },
          });

        expect(
          supabaseClient.from,
        ).toHaveBeenCalledWith(
          "property_rules",
        );

        expect(
          query.upsert,
        ).toHaveBeenCalledWith({
          id:
            "rule-1",
          type:
            "manual",
          property_id:
            "property-1",
          property_snapshot: {
            id:
              "property-1",
            name:
              "Rental 1",
          },
          priority:
            1000,
          owner_id:
            "owner-1",
          organization_id:
            null,
          enabled:
            true,
          match_field:
            "merchantName",
          match_value:
            "LOWES",
          match_mode:
            "equals",
        });

        expect(
          result.property.id,
        ).toBe(
          "property-1",
        );

        expect(
          result.match.value,
        ).toBe(
          "LOWES",
        );
      },
    );

    it(
      "finds enabled owner-scoped rules ordered by priority",
      async () => {
        query.or.mockImplementation(() => ({
          ...query,
          is:
            vi.fn().mockResolvedValue({
              data: [
                {
                  id:
                    "rule-1",
                  type:
                    "manual",
                  property_id:
                    "property-1",
                  property_snapshot: {
                    id:
                      "property-1",
                    name:
                      "Rental 1",
                  },
                  priority:
                    1000,
                  owner_id:
                    "owner-1",
                  organization_id:
                    null,
                  enabled:
                    true,
                  match_field:
                    "merchantName",
                  match_value:
                    "LOWES",
                  match_mode:
                    "equals",
                },
              ],
              error:
                null,
            }),
        }));

        const repository =
          new SupabasePropertyRuleRepository(
            supabaseClient,
          );

        const result =
          await repository.findRules({
            ownerId:
              "owner-1",
            organizationId:
              null,
          });

        expect(
          query.eq,
        ).toHaveBeenCalledWith(
          "enabled",
          true,
        );

        expect(
          query.order,
        ).toHaveBeenCalledWith(
          "priority",
          {
            ascending:
              false,
          },
        );

        expect(
          query.or,
        ).toHaveBeenCalledWith(
          "owner_id.is.null,owner_id.eq.owner-1",
        );

        expect(result).toHaveLength(1);

        expect(
          result[0].id,
        ).toBe(
          "rule-1",
        );
      },
    );

    it(
      "uses global-only filters when no owner or organization exists",
      async () => {
        query.is
          .mockReturnValueOnce(query)
          .mockResolvedValueOnce({
            data: [],
            error: null,
          });

        const repository =
          new SupabasePropertyRuleRepository(
            supabaseClient,
          );

        await repository.findRules();

        expect(
          query.is,
        ).toHaveBeenNthCalledWith(
          1,
          "owner_id",
          null,
        );

        expect(
          query.is,
        ).toHaveBeenNthCalledWith(
          2,
          "organization_id",
          null,
        );
      },
    );
  },
);
