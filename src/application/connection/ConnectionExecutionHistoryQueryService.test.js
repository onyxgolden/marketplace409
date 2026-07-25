import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ConnectionExecutionHistoryQueryService,
} from "./ConnectionExecutionHistoryQueryService.js";

describe(
  "ConnectionExecutionHistoryQueryService",
  () => {
    function createRepository() {
      return {
        findByConnectionId:
          vi.fn().mockResolvedValue([]),
        findByOwnerId:
          vi.fn().mockResolvedValue([]),
        findRecentByOwnerId:
          vi.fn().mockResolvedValue([]),
      };
    }

    it(
      "requires a connection execution history repository",
      () => {
        expect(
          () =>
            new ConnectionExecutionHistoryQueryService(),
        ).toThrow(
          "ConnectionExecutionHistoryQueryService requires a connection execution history repository.",
        );
      },
    );

    it(
      "requires all historical repository query methods",
      () => {
        expect(
          () =>
            new ConnectionExecutionHistoryQueryService({
              connectionExecutionHistoryRepository: {
                findByOwnerId: vi.fn(),
              },
            }),
        ).toThrow(
          "ConnectionExecutionHistoryQueryService requires a connection execution history repository.",
        );
      },
    );

    it.each([
      undefined,
      null,
      "",
      "   ",
      123,
      {},
    ])(
      "requires a valid owner id: %p",
      async (ownerId) => {
        const repository =
          createRepository();

        const service =
          new ConnectionExecutionHistoryQueryService({
            connectionExecutionHistoryRepository:
              repository,
          });

        await expect(
          service.findByOwnerId(ownerId),
        ).rejects.toThrow(
          "Owner id is required",
        );

        expect(
          repository.findByOwnerId,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "retrieves owner-scoped execution history",
      async () => {
        const history =
          Object.freeze([]);

        const repository =
          createRepository();

        repository.findByOwnerId
          .mockResolvedValue(history);

        const service =
          new ConnectionExecutionHistoryQueryService({
            connectionExecutionHistoryRepository:
              repository,
          });

        const result =
          await service.findByOwnerId(
            "owner-1",
          );

        expect(
          repository.findByOwnerId,
        ).toHaveBeenCalledWith({
          ownerId: "owner-1",
        });

        expect(result).toBe(history);
      },
    );

    it(
      "retrieves owner-scoped connection history",
      async () => {
        const repository =
          createRepository();

        const service =
          new ConnectionExecutionHistoryQueryService({
            connectionExecutionHistoryRepository:
              repository,
          });

        await service.findByConnectionId(
          "owner-1",
          "connection-1",
        );

        expect(
          repository.findByConnectionId,
        ).toHaveBeenCalledWith(
          "connection-1",
          {
            ownerId: "owner-1",
          },
        );
      },
    );

    it.each([
      undefined,
      null,
      "",
      "   ",
      123,
      {},
    ])(
      "requires a valid connection id: %p",
      async (connectionId) => {
        const repository =
          createRepository();

        const service =
          new ConnectionExecutionHistoryQueryService({
            connectionExecutionHistoryRepository:
              repository,
          });

        await expect(
          service.findByConnectionId(
            "owner-1",
            connectionId,
          ),
        ).rejects.toThrow(
          "Connection id is required",
        );

        expect(
          repository.findByConnectionId,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "retrieves recent owner-scoped history",
      async () => {
        const repository =
          createRepository();

        const service =
          new ConnectionExecutionHistoryQueryService({
            connectionExecutionHistoryRepository:
              repository,
          });

        await service.findRecentByOwnerId(
          "owner-1",
          10,
        );

        expect(
          repository.findRecentByOwnerId,
        ).toHaveBeenCalledWith(
          10,
          {
            ownerId: "owner-1",
          },
        );
      },
    );

    it.each([
      0,
      -1,
      1.5,
      "10",
      null,
    ])(
      "requires a positive integer limit: %p",
      async (limit) => {
        const repository =
          createRepository();

        const service =
          new ConnectionExecutionHistoryQueryService({
            connectionExecutionHistoryRepository:
              repository,
          });

        await expect(
          service.findRecentByOwnerId(
            "owner-1",
            limit,
          ),
        ).rejects.toThrow(
          "Execution history limit must be a positive integer.",
        );

        expect(
          repository.findRecentByOwnerId,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "freezes the service instance",
      () => {
        const service =
          new ConnectionExecutionHistoryQueryService({
            connectionExecutionHistoryRepository:
              createRepository(),
          });

        expect(
          Object.isFrozen(service),
        ).toBe(true);
      },
    );
  },
);
