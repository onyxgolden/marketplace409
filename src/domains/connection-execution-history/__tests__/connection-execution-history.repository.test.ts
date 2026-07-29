import {
  describe,
  expect,
  it,
} from "vitest";

import {
  InMemoryConnectionExecutionHistoryRepository,
} from "../index";

import type {
  ConnectionExecutionHistory,
} from "../connection-execution-history.types";

describe(
  "InMemoryConnectionExecutionHistoryRepository",
  () => {
    const createRecord = (
      overrides:
        Partial<ConnectionExecutionHistory> = {},
    ): ConnectionExecutionHistory => ({
      id: "execution-1",
      ownerId: "owner-1",
      connectionId: "connection-1",
      operationType: "import",
      status: "success",
      provider: "plaid",
      startedAt: "2026-07-25T05:00:00.000Z",
      completedAt: "2026-07-25T05:01:00.000Z",
      metrics: {
        transactionsImported: 10,
      },
      errorDetails: null,
      createdAt: "2026-07-25T05:01:00.000Z",
      ...overrides,
    });

    it("saves execution history", async () => {
      const repository =
        new InMemoryConnectionExecutionHistoryRepository();

      const record = createRecord();

      await repository.save(record, {
        ownerId: "owner-1",
      });

      await expect(
        repository.findByOwnerId({
          ownerId: "owner-1",
        }),
      ).resolves.toEqual([record]);
    });

    it("finds history by connection id", async () => {
      const repository =
        new InMemoryConnectionExecutionHistoryRepository();

      await repository.save(createRecord(), {
        ownerId: "owner-1",
      });

      await repository.save(
        createRecord({
          id: "execution-2",
          connectionId: "connection-2",
        }),
        {
          ownerId: "owner-1",
        },
      );

      const result =
        await repository.findByConnectionId(
          "connection-1",
          {
            ownerId: "owner-1",
          },
        );

      expect(result).toHaveLength(1);
      expect(result[0].connectionId)
        .toBe("connection-1");
    });

    it("enforces owner isolation", async () => {
      const repository =
        new InMemoryConnectionExecutionHistoryRepository();

      await repository.save(
        createRecord({
          ownerId: "owner-2",
        }),
        {
          ownerId: "owner-2",
        },
      );

      const result =
        await repository.findByOwnerId({
          ownerId: "owner-1",
        });

      expect(result).toEqual([]);
    });

    it("returns recent executions newest first", async () => {
      const repository =
        new InMemoryConnectionExecutionHistoryRepository();

      await repository.save(
        createRecord({
          id: "execution-old",
          createdAt:
            "2026-07-25T05:00:00.000Z",
        }),
        {
          ownerId: "owner-1",
        },
      );

      await repository.save(
        createRecord({
          id: "execution-new",
          createdAt:
            "2026-07-25T06:00:00.000Z",
        }),
        {
          ownerId: "owner-1",
        },
      );

      const result =
        await repository.findRecentByOwnerId(
          2,
          {
            ownerId: "owner-1",
          },
        );

      expect(result[0].id)
        .toBe("execution-new");
      expect(result[1].id)
        .toBe("execution-old");
    });
  },
);
