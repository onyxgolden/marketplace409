import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createDecisionOutcomeRepository,
  DecisionOutcomeRepositoryStorage,
} from "../createDecisionOutcomeRepository.js";

import {
  InMemoryDecisionOutcomeRepository,
} from "../../../domains/decision/InMemoryDecisionOutcomeRepository.js";

describe(
  "createDecisionOutcomeRepository",
  () => {
    const originalStorage =
      process.env.DECISION_OUTCOME_REPOSITORY;

    afterEach(() => {
      if (originalStorage === undefined) {
        delete process.env
          .DECISION_OUTCOME_REPOSITORY;
      } else {
        process.env.DECISION_OUTCOME_REPOSITORY =
          originalStorage;
      }
    });

    it("creates an in-memory repository by default", async () => {
      delete process.env
        .DECISION_OUTCOME_REPOSITORY;

      const repository =
        await createDecisionOutcomeRepository();

      expect(repository).toBeInstanceOf(
        InMemoryDecisionOutcomeRepository,
      );
    });

    it("creates an in-memory repository when explicitly selected", async () => {
      const repository =
        await createDecisionOutcomeRepository({
          storage:
            DecisionOutcomeRepositoryStorage.MEMORY,
        });

      expect(repository).toBeInstanceOf(
        InMemoryDecisionOutcomeRepository,
      );
    });

    it("creates an in-memory repository from environment selection", async () => {
      process.env.DECISION_OUTCOME_REPOSITORY =
        DecisionOutcomeRepositoryStorage.MEMORY;

      const repository =
        await createDecisionOutcomeRepository();

      expect(repository).toBeInstanceOf(
        InMemoryDecisionOutcomeRepository,
      );
    });

    it("passes initial evaluations to the repository", async () => {
      const evaluation = Object.freeze({
        decisionId: "decision-initial",
        status: "completed",
        outcome: "Completed",
        evaluation: "recorded",
      });

      const repository =
        await createDecisionOutcomeRepository({
          initialEvaluations: [evaluation],
        });

      expect(
        repository.findByDecisionId(
          "decision-initial",
        ),
      ).toBe(evaluation);
    });

    it("creates a Supabase repository when selected", async () => {
      const supabaseClient = {
        from() {},
      };

      const repository =
        await createDecisionOutcomeRepository({
          storage:
            DecisionOutcomeRepositoryStorage
              .SUPABASE,
          supabaseClient,
          ownerId: "owner-1",
        });

      const {
        SupabaseDecisionOutcomeRepository,
      } = await import(
        "../../../domains/decision/" +
        "SupabaseDecisionOutcomeRepository.js"
      );

      expect(repository).toBeInstanceOf(
        SupabaseDecisionOutcomeRepository,
      );
      expect(repository.supabaseClient).toBe(
        supabaseClient,
      );
      expect(repository.ownerId).toBe(
        "owner-1",
      );
    });

    it("requires owner context for Supabase storage", async () => {
      await expect(
        createDecisionOutcomeRepository({
          storage:
            DecisionOutcomeRepositoryStorage
              .SUPABASE,
          supabaseClient: {
            from() {},
          },
        }),
      ).rejects.toThrow(
        "SupabaseDecisionOutcomeRepository requires an owner id.",
      );
    });

    it("rejects unsupported repository storage selections", async () => {
      await expect(
        createDecisionOutcomeRepository({
          storage: "unsupported",
        }),
      ).rejects.toThrow(
        "Unsupported decision outcome repository storage: unsupported",
      );
    });
  },
);
