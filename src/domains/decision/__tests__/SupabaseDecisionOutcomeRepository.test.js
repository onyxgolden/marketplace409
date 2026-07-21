import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  SupabaseDecisionOutcomeRepository,
} from "../SupabaseDecisionOutcomeRepository.js";

const query = {
  upsert: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

function createSupabaseClient() {
  return {
    from: vi.fn(() => query),
  };
}

function createEvaluation(
  overrides = {},
) {
  return Object.freeze({
    decisionId: "decision-1",
    status: "completed",
    evaluation: {
      result: "recorded",
    },
    outcome: {
      savings: 5000,
    },
    ...overrides,
  });
}

function createRow(
  overrides = {},
) {
  return {
    owner_id: "owner-1",
    decision_id: "decision-1",
    status: "completed",
    evaluation: {
      result: "recorded",
    },
    outcome: {
      savings: 5000,
    },
    ...overrides,
  };
}

describe(
  "SupabaseDecisionOutcomeRepository",
  () => {
    beforeEach(() => {
      query.upsert.mockReset();
      query.select.mockReset();
      query.eq.mockReset();
      query.single.mockReset();
      query.maybeSingle.mockReset();

      query.upsert.mockReturnValue(query);
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
    });

    it("requires a Supabase client", () => {
      expect(
        () =>
          new SupabaseDecisionOutcomeRepository({
            supabaseClient: {},
            ownerId: "owner-1",
          }),
      ).toThrow(
        "SupabaseDecisionOutcomeRepository requires a Supabase client.",
      );
    });

    it("requires an owner id", () => {
      expect(
        () =>
          new SupabaseDecisionOutcomeRepository({
            supabaseClient: {
              from: vi.fn(),
            },
          }),
      ).toThrow(
        "SupabaseDecisionOutcomeRepository requires an owner id.",
      );
    });

    it("persists an owner-scoped decision outcome", async () => {
      query.single.mockResolvedValue({
        data: createRow(),
        error: null,
      });

      const repository =
        new SupabaseDecisionOutcomeRepository({
          supabaseClient: createSupabaseClient(),
          ownerId: "owner-1",
        });

      const result =
        await repository.save(
          createEvaluation(),
        );

      expect(query.upsert).toHaveBeenCalledWith(
        {
          owner_id: "owner-1",
          decision_id: "decision-1",
          status: "completed",
          evaluation: {
            result: "recorded",
          },
          outcome: {
            savings: 5000,
          },
        },
        {
          onConflict: "owner_id,decision_id",
        },
      );

      expect(Object.isFrozen(result)).toBe(true);
      expect(result).toEqual(
        createEvaluation(),
      );
    });

    it("finds an outcome within the owner boundary", async () => {
      query.maybeSingle.mockResolvedValue({
        data: createRow(),
        error: null,
      });

      const repository =
        new SupabaseDecisionOutcomeRepository({
          supabaseClient: createSupabaseClient(),
          ownerId: "owner-1",
        });

      const result =
        await repository.findByDecisionId(
          "decision-1",
        );

      expect(query.eq).toHaveBeenNthCalledWith(
        1,
        "owner_id",
        "owner-1",
      );
      expect(query.eq).toHaveBeenNthCalledWith(
        2,
        "decision_id",
        "decision-1",
      );

      expect(Object.isFrozen(result)).toBe(true);
      expect(result).toEqual(
        createEvaluation(),
      );
    });

    it("returns null when no outcome exists", async () => {
      query.maybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const repository =
        new SupabaseDecisionOutcomeRepository({
          supabaseClient: createSupabaseClient(),
          ownerId: "owner-1",
        });

      await expect(
        repository.findByDecisionId(
          "decision-missing",
        ),
      ).resolves.toBeNull();
    });

    it("rejects invalid evaluations", async () => {
      const repository =
        new SupabaseDecisionOutcomeRepository({
          supabaseClient: createSupabaseClient(),
          ownerId: "owner-1",
        });

      await expect(
        repository.save(null),
      ).rejects.toThrow(
        "Decision outcome evaluation must be an object",
      );

      await expect(
        repository.save({
          decisionId: "",
        }),
      ).rejects.toThrow(
        "Decision outcome evaluation decisionId must be a non-empty string",
      );
    });

    it("rejects invalid decision ids", async () => {
      const repository =
        new SupabaseDecisionOutcomeRepository({
          supabaseClient: createSupabaseClient(),
          ownerId: "owner-1",
        });

      await expect(
        repository.findByDecisionId(""),
      ).rejects.toThrow(
        "Decision id must be a non-empty string",
      );
    });

    it("propagates Supabase persistence errors", async () => {
      const error =
        new Error("decision outcome save failed");

      query.single.mockResolvedValue({
        data: null,
        error,
      });

      const repository =
        new SupabaseDecisionOutcomeRepository({
          supabaseClient: createSupabaseClient(),
          ownerId: "owner-1",
        });

      await expect(
        repository.save(
          createEvaluation(),
        ),
      ).rejects.toBe(error);
    });

    it("propagates Supabase query errors", async () => {
      const error =
        new Error("decision outcome query failed");

      query.maybeSingle.mockResolvedValue({
        data: null,
        error,
      });

      const repository =
        new SupabaseDecisionOutcomeRepository({
          supabaseClient: createSupabaseClient(),
          ownerId: "owner-1",
        });

      await expect(
        repository.findByDecisionId(
          "decision-1",
        ),
      ).rejects.toBe(error);
    });
  },
);
