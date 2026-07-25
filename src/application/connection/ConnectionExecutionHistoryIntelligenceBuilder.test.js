import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ConnectionExecutionHistoryIntelligenceBuilder,
} from "./ConnectionExecutionHistoryIntelligenceBuilder.js";

function execution({
  id,
  status,
  completedAt,
  operationType = "import",
  metrics = {},
}) {
  return Object.freeze({
    id,
    ownerId: "owner-1",
    connectionId: "connection-1",
    operationType,
    status,
    provider: "plaid",
    startedAt: completedAt,
    completedAt,
    metrics: Object.freeze(metrics),
    errorDetails: null,
    createdAt: completedAt,
  });
}

describe(
  "ConnectionExecutionHistoryIntelligenceBuilder",
  () => {
    it(
      "builds deterministic empty history intelligence",
      () => {
        const result =
          ConnectionExecutionHistoryIntelligenceBuilder
            .build();

        expect(result)
          .toEqual({
            totalExecutions: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            completedExecutions: 0,
            successRate: 0,
            failureRate: 0,
            completionRate: 0,
            consecutiveFailures: 0,
            lastExecution: null,
            lastSuccessfulExecution: null,
            lastFailedExecution: null,
            importedTotals: {
              financialAccounts: 0,
              accountBalances: 0,
              transactions: 0,
              failedRecords: 0,
            },
          });
      },
    );

    it(
      "builds intelligence for successful history",
      () => {
        const record =
          execution({
            id: "execution-1",
            status: "success",
            completedAt:
              "2026-07-25T06:00:00.000Z",
            metrics: {
              financialAccountsImported: 2,
              accountBalancesImported: 2,
              transactionsImported: 100,
            },
          });

        const result =
          ConnectionExecutionHistoryIntelligenceBuilder
            .build([record]);

        expect(result.totalExecutions)
          .toBe(1);

        expect(result.successfulExecutions)
          .toBe(1);

        expect(result.successRate)
          .toBe(1);

        expect(result.lastExecution)
          .toEqual(record);

        expect(result.importedTotals)
          .toEqual({
            financialAccounts: 2,
            accountBalances: 2,
            transactions: 100,
            failedRecords: 0,
          });
      },
    );

    it(
      "distinguishes success, failed, and completed statuses",
      () => {
        const history = [
          execution({
            id: "execution-1",
            status: "success",
            completedAt:
              "2026-07-25T04:00:00.000Z",
          }),
          execution({
            id: "execution-2",
            status: "failed",
            completedAt:
              "2026-07-25T05:00:00.000Z",
          }),
          execution({
            id: "execution-3",
            status: "completed",
            operationType: "review",
            completedAt:
              "2026-07-25T06:00:00.000Z",
          }),
        ];

        const result =
          ConnectionExecutionHistoryIntelligenceBuilder
            .build(history);

        expect(result)
          .toMatchObject({
            totalExecutions: 3,
            successfulExecutions: 1,
            failedExecutions: 1,
            completedExecutions: 1,
            successRate: 0.3333,
            failureRate: 0.3333,
            completionRate: 0.3333,
          });
      },
    );

    it(
      "orders history deterministically before selecting latest executions",
      () => {
        const oldest =
          execution({
            id: "execution-1",
            status: "success",
            completedAt:
              "2026-07-25T04:00:00.000Z",
          });

        const newest =
          execution({
            id: "execution-3",
            status: "failed",
            completedAt:
              "2026-07-25T06:00:00.000Z",
          });

        const middle =
          execution({
            id: "execution-2",
            status: "success",
            completedAt:
              "2026-07-25T05:00:00.000Z",
          });

        const result =
          ConnectionExecutionHistoryIntelligenceBuilder
            .build([
              oldest,
              newest,
              middle,
            ]);

        expect(result.lastExecution.id)
          .toBe("execution-3");

        expect(
          result.lastSuccessfulExecution.id,
        ).toBe("execution-2");

        expect(
          result.lastFailedExecution.id,
        ).toBe("execution-3");
      },
    );

    it(
      "calculates consecutive failures from the newest execution",
      () => {
        const history = [
          execution({
            id: "execution-1",
            status: "success",
            completedAt:
              "2026-07-25T03:00:00.000Z",
          }),
          execution({
            id: "execution-2",
            status: "failed",
            completedAt:
              "2026-07-25T04:00:00.000Z",
          }),
          execution({
            id: "execution-3",
            status: "failed",
            completedAt:
              "2026-07-25T05:00:00.000Z",
          }),
        ];

        const result =
          ConnectionExecutionHistoryIntelligenceBuilder
            .build(history);

        expect(result.consecutiveFailures)
          .toBe(2);
      },
    );

    it(
      "aggregates known numeric metrics and ignores invalid values",
      () => {
        const history = [
          execution({
            id: "execution-1",
            status: "success",
            completedAt:
              "2026-07-25T04:00:00.000Z",
            metrics: {
              transactionsImported: 25,
              financialAccountsImported: 2,
              failedRecordCount: "invalid",
            },
          }),
          execution({
            id: "execution-2",
            status: "failed",
            completedAt:
              "2026-07-25T05:00:00.000Z",
            metrics: {
              transactionsImported: 10,
              accountBalancesImported: 3,
              failedRecordCount: 4,
            },
          }),
        ];

        const result =
          ConnectionExecutionHistoryIntelligenceBuilder
            .build(history);

        expect(result.importedTotals)
          .toEqual({
            financialAccounts: 2,
            accountBalances: 3,
            transactions: 35,
            failedRecords: 4,
          });
      },
    );

    it(
      "does not mutate the input history ordering",
      () => {
        const first =
          execution({
            id: "execution-1",
            status: "success",
            completedAt:
              "2026-07-25T04:00:00.000Z",
          });

        const second =
          execution({
            id: "execution-2",
            status: "failed",
            completedAt:
              "2026-07-25T05:00:00.000Z",
          });

        const history = [
          first,
          second,
        ];

        ConnectionExecutionHistoryIntelligenceBuilder
          .build(history);

        expect(history)
          .toEqual([
            first,
            second,
          ]);
      },
    );

    it(
      "returns deeply immutable intelligence",
      () => {
        const result =
          ConnectionExecutionHistoryIntelligenceBuilder
            .build([
              execution({
                id: "execution-1",
                status: "success",
                completedAt:
                  "2026-07-25T06:00:00.000Z",
              }),
            ]);

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.importedTotals,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.lastExecution,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.lastExecution.metrics,
          ),
        ).toBe(true);
      },
    );
  },
);
