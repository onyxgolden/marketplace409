import { Decision } from "./decision";

export type DecisionOutcomeEvaluation = Readonly<{
  decisionId: string;
  status: "completed";
  outcome: unknown;
  evaluation: "recorded";
}>;

export class DecisionOutcomeEvaluator {
  evaluate(
    decision: Decision,
  ): DecisionOutcomeEvaluation {
    if (!(decision instanceof Decision)) {
      throw new Error(
        "DecisionOutcomeEvaluator requires a Decision instance",
      );
    }

    if (decision.status !== "completed") {
      throw new Error(
        "Only completed decisions can be evaluated",
      );
    }

    return Object.freeze({
      decisionId: decision.id,
      status: "completed",
      outcome: decision.outcome,
      evaluation: "recorded",
    });
  }
}
