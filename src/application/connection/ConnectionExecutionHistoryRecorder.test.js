import {
  ConnectionExecutionHistoryRecorder,
} from "./ConnectionExecutionHistoryRecorder.js";

describe(
  "ConnectionExecutionHistoryRecorder",
  () => {
    function createRepository() {
      return {
        save: vi.fn(
          async (record) => record,
        ),
      };
    }

    it(
      "records import execution history",
      async () => {
        const repository =
          createRepository();

        const recorder =
          new ConnectionExecutionHistoryRecorder({
            connectionExecutionHistoryRepository:
              repository,
            idGenerator:
              () => "execution-1",
            clock:
              () =>
                "2026-07-25T06:00:00.000Z",
          });

        await recorder.recordExecution({
          operation:
            "import-transactions",
          ownerId:
            "owner-1",
          executionResult: {
            connectionId:
              "connection-1",
            provider:
              "plaid",
            success:
              true,
            transactionsImported:
              10,
            occurredAt:
              "2026-07-25T05:59:00.000Z",
          },
        });

        const record =
          repository.save.mock.calls[0][0];

        expect(record.operationType)
          .toBe("import");

        expect(record.status)
          .toBe("success");

        expect(record.ownerId)
          .toBe("owner-1");
      },
    );

    it(
      "records review executions as completed",
      async () => {
        const repository =
          createRepository();

        const recorder =
          new ConnectionExecutionHistoryRecorder({
            connectionExecutionHistoryRepository:
              repository,
            idGenerator:
              () => "execution-2",
          });

        await recorder.recordExecution({
          operation:
            "review-connection",
          ownerId:
            "owner-1",
          executionResult: {
            connectionId:
              "connection-1",
            provider:
              "plaid",
            severity:
              "healthy",
            allowsImport:
              true,
          },
        });

        const record =
          repository.save.mock.calls[0][0];

        expect(record.operationType)
          .toBe("review");

        expect(record.status)
          .toBe("completed");
      },
    );

    it(
      "records repaired executions as success",
      async () => {
        const repository =
          createRepository();

        const recorder =
          new ConnectionExecutionHistoryRecorder({
            connectionExecutionHistoryRepository:
              repository,
            idGenerator:
              () => "execution-3",
          });

        await recorder.recordExecution({
          operation:
            "repair-connection",
          ownerId:
            "owner-1",
          executionResult: {
            connectionId:
              "connection-1",
            provider:
              "plaid",
            repaired:
              true,
          },
        });

        const record =
          repository.save.mock.calls[0][0];

        expect(record.operationType)
          .toBe("repair");

        expect(record.status)
          .toBe("success");
      },
    );
  },
);
