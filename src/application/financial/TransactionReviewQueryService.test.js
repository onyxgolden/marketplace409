import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  TransactionReviewQueryService,
} from "./TransactionReviewQueryService.js";

describe("TransactionReviewQueryService", () => {
  it("requires a financial event repository", () => {
    expect(
      () =>
        new TransactionReviewQueryService({
          projectionService: {
            project: vi.fn(),
          },
        }),
    ).toThrow(
      "TransactionReviewQueryService requires a financial event repository.",
    );
  });

  it("requires a repository with findByOwnerId", () => {
    expect(
      () =>
        new TransactionReviewQueryService({
          financialEventRepository: {},
          projectionService: {
            project: vi.fn(),
          },
        }),
    ).toThrow(
      "TransactionReviewQueryService requires a repository with findByOwnerId.",
    );
  });

  it("requires a projection service", () => {
    expect(
      () =>
        new TransactionReviewQueryService({
          financialEventRepository: {
            findByOwnerId: vi.fn(),
          },
        }),
    ).toThrow(
      "TransactionReviewQueryService requires a projection service.",
    );
  });

  it("requires a projection service with project", () => {
    expect(
      () =>
        new TransactionReviewQueryService({
          financialEventRepository: {
            findByOwnerId: vi.fn(),
          },
          projectionService: {},
        }),
    ).toThrow(
      "TransactionReviewQueryService requires a projection service with project.",
    );
  });

  it("requires an owner id", async () => {
    const service =
      new TransactionReviewQueryService({
        financialEventRepository: {
          findByOwnerId: vi.fn(),
        },
        projectionService: {
          project: vi.fn(),
        },
      });

    await expect(
      service.buildReviewQueue(),
    ).rejects.toThrow("Owner id is required");
  });

  it("loads owner-scoped events and delegates queue projection", async () => {
    const events = Object.freeze([
      Object.freeze({
        id: "event-1",
        owner_id: "owner-1",
        property_id: null,
      }),
      Object.freeze({
        id: "event-2",
        owner_id: "owner-1",
        property_id: "property-1",
      }),
    ]);

    const queue = Object.freeze({
      items: Object.freeze([]),
    });

    const financialEventRepository = {
      findByOwnerId: vi.fn().mockResolvedValue(events),
    };

    const projectionService = {
      project: vi.fn().mockReturnValue(queue),
    };

    const service =
      new TransactionReviewQueryService({
        financialEventRepository,
        projectionService,
      });

    await expect(
      service.buildReviewQueue("owner-1"),
    ).resolves.toBe(queue);

    expect(
      financialEventRepository.findByOwnerId,
    ).toHaveBeenCalledOnce();

    expect(
      financialEventRepository.findByOwnerId,
    ).toHaveBeenCalledWith("owner-1");

    expect(
      projectionService.project,
    ).toHaveBeenCalledOnce();

    expect(
      projectionService.project,
    ).toHaveBeenCalledWith(events);
  });

  it("propagates repository failures", async () => {
    const repositoryError =
      new Error("Financial events unavailable.");

    const service =
      new TransactionReviewQueryService({
        financialEventRepository: {
          findByOwnerId:
            vi.fn().mockRejectedValue(repositoryError),
        },
        projectionService: {
          project: vi.fn(),
        },
      });

    await expect(
      service.buildReviewQueue("owner-1"),
    ).rejects.toBe(repositoryError);
  });

  it("propagates projection failures", async () => {
    const projectionError =
      new Error("Unable to project review queue.");

    const service =
      new TransactionReviewQueryService({
        financialEventRepository: {
          findByOwnerId:
            vi.fn().mockResolvedValue([]),
        },
        projectionService: {
          project: vi.fn(() => {
            throw projectionError;
          }),
        },
      });

    await expect(
      service.buildReviewQueue("owner-1"),
    ).rejects.toBe(projectionError);
  });

  it("freezes the service instance", () => {
    const service =
      new TransactionReviewQueryService({
        financialEventRepository: {
          findByOwnerId: vi.fn(),
        },
        projectionService: {
          project: vi.fn(),
        },
      });

    expect(Object.isFrozen(service)).toBe(true);
  });
});
