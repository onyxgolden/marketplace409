import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ConnectionExecutionIntelligenceBuilder,
} from "./ConnectionExecutionIntelligenceBuilder.js";

describe(
  "ConnectionExecutionIntelligenceBuilder",
  () => {
    it(
      "builds intelligence for a successful execution",
      () => {
        const result =
          ConnectionExecutionIntelligenceBuilder.build({
            provider: "plaid",
            connectionId: "connection_1",
            success: true,
            financialAccountsImported: 2,
            accountBalancesImported: 2,
            transactionsImported: 150,
            failedRecordCount: 0,
            occurredAt:
              "2026-07-25T05:00:00.000Z",
          });

        expect(result.status)
          .toBe("successful");

        expect(result.health)
          .toEqual({
            state: "healthy",
            score: 100,
          });

        expect(result.metrics)
          .toEqual({
            financialAccountsImported: 2,
            accountBalancesImported: 2,
            transactionsImported: 150,
            failedRecordCount: 0,
          });

        expect(result.recommendation.action)
          .toBe("none");
      },
    );

    it(
      "builds intelligence for a failed execution",
      () => {
        const result =
          ConnectionExecutionIntelligenceBuilder.build({
            success: false,
            failedRecordCount: 5,
            occurredAt:
              "2026-07-25T05:00:00.000Z",
          });

        expect(result.status)
          .toBe("failed");

        expect(result.health.state)
          .toBe("needs_attention");

        expect(result.recommendation)
          .toEqual({
            action: "review-connection",
            priority: "high",
          });
      },
    );

    it(
      "handles empty execution results deterministically",
      () => {
        const result =
          ConnectionExecutionIntelligenceBuilder.build();

        expect(result.success)
          .toBe(false);

        expect(result.metrics)
          .toEqual({
            financialAccountsImported: 0,
            accountBalancesImported: 0,
            transactionsImported: 0,
            failedRecordCount: 0,
          });
      },
    );

    it(
      "returns immutable intelligence",
      () => {
        const result =
          ConnectionExecutionIntelligenceBuilder.build({
            success: true,
          });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(result.metrics),
        ).toBe(true);

        expect(
          Object.isFrozen(result.health),
        ).toBe(true);

        expect(
          Object.isFrozen(result.recommendation),
        ).toBe(true);
      },
    );
  },
);
