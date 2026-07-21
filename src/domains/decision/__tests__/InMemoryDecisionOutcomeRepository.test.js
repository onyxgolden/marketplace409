import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryDecisionOutcomeRepository,
} from "../InMemoryDecisionOutcomeRepository.js";

function createEvaluation(
  decisionId = "decision-1",
) {
  return Object.freeze({
    decisionId,
    status: "completed",
    outcome: {
      savings: 5000,
    },
    evaluation: "recorded",
  });
}

describe(
  "InMemoryDecisionOutcomeRepository",
  () => {
    it("saves and retrieves an evaluation by decision id", () => {
      const repository =
        new InMemoryDecisionOutcomeRepository();

      const evaluation = createEvaluation();

      expect(repository.save(evaluation)).toBe(
        evaluation,
      );

      expect(
        repository.findByDecisionId("decision-1"),
      ).toBe(evaluation);
    });

    it("returns null when no evaluation exists", () => {
      const repository =
        new InMemoryDecisionOutcomeRepository();

      expect(
        repository.findByDecisionId("missing"),
      ).toBeNull();
    });

    it("supports initial evaluations", () => {
      const evaluation =
        createEvaluation("decision-initial");

      const repository =
        new InMemoryDecisionOutcomeRepository([
          evaluation,
        ]);

      expect(
        repository.findByDecisionId(
          "decision-initial",
        ),
      ).toBe(evaluation);
    });

    it("replaces an existing evaluation deterministically", () => {
      const repository =
        new InMemoryDecisionOutcomeRepository();

      const first = createEvaluation();

      const replacement = Object.freeze({
        ...first,
        outcome: {
          savings: 7500,
        },
      });

      repository.save(first);
      repository.save(replacement);

      expect(
        repository.findByDecisionId("decision-1"),
      ).toBe(replacement);
    });

    it("rejects invalid initial evaluations", () => {
      expect(
        () =>
          new InMemoryDecisionOutcomeRepository(
            null,
          ),
      ).toThrow(
        "Initial decision outcome evaluations must be an array",
      );
    });

    it("rejects invalid evaluations", () => {
      const repository =
        new InMemoryDecisionOutcomeRepository();

      expect(() =>
        repository.save(null),
      ).toThrow(
        "Decision outcome evaluation must be an object",
      );

      expect(() =>
        repository.save({ decisionId: "" }),
      ).toThrow(
        "Decision outcome evaluation decisionId must be a non-empty string",
      );
    });

    it("rejects invalid decision ids", () => {
      const repository =
        new InMemoryDecisionOutcomeRepository();

      expect(() =>
        repository.findByDecisionId(""),
      ).toThrow(
        "Decision id must be a non-empty string",
      );
    });
  },
);
