import {
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  DecisionOutcomeQueryService,
} from "./DecisionOutcomeQueryService.js";

function buildOutcome() {
  return Object.freeze({
    decisionId: "decision-1",
    status: "completed",
    evaluation: Object.freeze({
      result: "recorded",
    }),
    outcome: Object.freeze({
      result: "approved",
    }),
  });
}

describe("DecisionOutcomeQueryService", () => {
  test("requires a decision outcome repository", () => {
    expect(
      () => new DecisionOutcomeQueryService(),
    ).toThrow(
      "DecisionOutcomeQueryService requires a decision outcome repository.",
    );

    expect(
      () =>
        new DecisionOutcomeQueryService({
          decisionOutcomeRepository: {},
        }),
    ).toThrow(
      "DecisionOutcomeQueryService requires a decision outcome repository.",
    );
  });

  test("requires a non-empty decision id", async () => {
    const findByDecisionId = vi.fn();

    const service =
      new DecisionOutcomeQueryService({
        decisionOutcomeRepository: {
          findByDecisionId,
        },
      });

    await expect(
      service.findByDecisionId(),
    ).rejects.toThrow(
      "Decision id is required",
    );

    await expect(
      service.findByDecisionId(""),
    ).rejects.toThrow(
      "Decision id is required",
    );

    await expect(
      service.findByDecisionId("   "),
    ).rejects.toThrow(
      "Decision id is required",
    );

    expect(findByDecisionId).not.toHaveBeenCalled();
  });

  test("delegates retrieval to the decision outcome repository", async () => {
    const outcome = buildOutcome();

    const findByDecisionId =
      vi.fn().mockResolvedValue(outcome);

    const service =
      new DecisionOutcomeQueryService({
        decisionOutcomeRepository: {
          findByDecisionId,
        },
      });

    const result =
      await service.findByDecisionId(
        "decision-1",
      );

    expect(findByDecisionId).toHaveBeenCalledTimes(1);
    expect(findByDecisionId).toHaveBeenCalledWith(
      "decision-1",
    );
    expect(result).toBe(outcome);
  });

  test("returns null outcomes without inventing data", async () => {
    const service =
      new DecisionOutcomeQueryService({
        decisionOutcomeRepository: {
          async findByDecisionId() {
            return null;
          },
        },
      });

    await expect(
      service.findByDecisionId("decision-missing"),
    ).resolves.toBeNull();
  });

  test("does not transform the canonical repository result", async () => {
    const outcome = {
      decisionId: "decision-1",
      status: "completed",
    };

    const service =
      new DecisionOutcomeQueryService({
        decisionOutcomeRepository: {
          async findByDecisionId() {
            return outcome;
          },
        },
      });

    const result =
      await service.findByDecisionId(
        "decision-1",
      );

    expect(result).toBe(outcome);
    expect(result).not.toHaveProperty("type");
    expect(result).not.toHaveProperty("metadata");
    expect(result).not.toHaveProperty(
      "projectionStatus",
    );
  });

  test("is immutable and deterministic", async () => {
    const outcome = buildOutcome();

    const findByDecisionId =
      vi.fn().mockResolvedValue(outcome);

    const service =
      new DecisionOutcomeQueryService({
        decisionOutcomeRepository: {
          findByDecisionId,
        },
      });

    const first =
      await service.findByDecisionId(
        "decision-1",
      );

    const second =
      await service.findByDecisionId(
        "decision-1",
      );

    expect(Object.isFrozen(service)).toBe(true);
    expect(
      Object.isFrozen(DecisionOutcomeQueryService),
    ).toBe(true);

    expect(first).toBe(outcome);
    expect(second).toBe(outcome);
    expect(findByDecisionId).toHaveBeenCalledTimes(2);
  });
});
