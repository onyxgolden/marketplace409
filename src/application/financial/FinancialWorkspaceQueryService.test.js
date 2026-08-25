import { describe, expect, test, vi } from "vitest";

import { FinancialWorkspaceQueryService } from "./FinancialWorkspaceQueryService.js";

function buildWorkspace() {
  return Object.freeze({
    portfolio: Object.freeze({
      income: 1500,
      expenses: 250,
      noi: 1250,
      cashFlow: 1250,
      transactionCount: 2,
    }),
    properties: Object.freeze([]),
    categories: Object.freeze([]),
    transactions: Object.freeze([]),
  });
}

describe("FinancialWorkspaceQueryService", () => {
  test("requires a financial event repository", () => {
    expect(
      () =>
        new FinancialWorkspaceQueryService({
          aggregationService: {
            aggregate: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialWorkspaceQueryService requires a financial event repository.",
    );
  });

  test("requires an aggregation service", () => {
    expect(
      () =>
        new FinancialWorkspaceQueryService({
          financialEventRepository: {
            findByOwnerId: vi.fn(),
          },
          aggregationService: null,
        }),
    ).toThrow(
      "FinancialWorkspaceQueryService requires an aggregation service.",
    );
  });

  test("requires a repository query contract", () => {
    expect(
      () =>
        new FinancialWorkspaceQueryService({
          financialEventRepository: {},
          aggregationService: {
            aggregate: vi.fn(),
          },
        }),
    ).toThrow(
      "FinancialWorkspaceQueryService requires a repository with findByOwnerId.",
    );
  });

  test("requires an aggregation contract", () => {
    expect(
      () =>
        new FinancialWorkspaceQueryService({
          financialEventRepository: {
            findByOwnerId: vi.fn(),
          },
          aggregationService: {},
        }),
    ).toThrow(
      "FinancialWorkspaceQueryService requires an aggregation service with aggregate.",
    );
  });

  test("requires an owner id", async () => {
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: {
        findByOwnerId: vi.fn(),
      },
      aggregationService: {
        aggregate: vi.fn(),
      },
    });

    await expect(service.buildWorkspace(null)).rejects.toThrow(
      "Owner id is required",
    );
  });

  test("queries financial events within the owner boundary", async () => {
    const events = Object.freeze([
      Object.freeze({
        id: "event-1",
        owner_id: "owner-1",
      }),
    ]);

    const financialEventRepository = {
      findByOwnerId: vi.fn().mockResolvedValue(events),
    };

    const aggregationService = {
      aggregate: vi.fn().mockReturnValue(buildWorkspace()),
    };

    const service = new FinancialWorkspaceQueryService({
      financialEventRepository,
      aggregationService,
    });

    await service.buildWorkspace("owner-1");

    expect(financialEventRepository.findByOwnerId).toHaveBeenCalledOnce();
    expect(financialEventRepository.findByOwnerId).toHaveBeenCalledWith(
      "owner-1",
    );
  });

  test("passes repository events to the domain aggregation service", async () => {
    const events = Object.freeze([
      Object.freeze({
        id: "event-1",
        owner_id: "owner-1",
      }),
      Object.freeze({
        id: "event-2",
        owner_id: "owner-1",
      }),
    ]);

    const financialEventRepository = {
      findByOwnerId: vi.fn().mockResolvedValue(events),
    };

    const aggregationService = {
      aggregate: vi.fn().mockReturnValue(buildWorkspace()),
    };

    const service = new FinancialWorkspaceQueryService({
      financialEventRepository,
      aggregationService,
    });

    await service.buildWorkspace("owner-1");

    expect(aggregationService.aggregate).toHaveBeenCalledOnce();
    expect(aggregationService.aggregate).toHaveBeenCalledWith(events, { scope: null });
  });

  test("returns the immutable workspace produced by the domain service", async () => {
    const workspace = buildWorkspace();

    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: {
        findByOwnerId: vi.fn().mockResolvedValue([]),
      },
      aggregationService: {
        aggregate: vi.fn().mockReturnValue(workspace),
      },
    });

    const result = await service.buildWorkspace("owner-1");

    expect(result).toBe(workspace);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.portfolio)).toBe(true);
  });

  test("propagates repository errors", async () => {
    const repositoryError = new Error("Repository query failed");

    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: {
        findByOwnerId: vi.fn().mockRejectedValue(repositoryError),
      },
      aggregationService: {
        aggregate: vi.fn(),
      },
    });

    await expect(
      service.buildWorkspace("owner-1"),
    ).rejects.toBe(repositoryError);
  });

  test("propagates aggregation errors", async () => {
    const aggregationError = new Error("Aggregation failed");

    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: {
        findByOwnerId: vi.fn().mockResolvedValue([]),
      },
      aggregationService: {
        aggregate: vi.fn(() => {
          throw aggregationError;
        }),
      },
    });

    await expect(
      service.buildWorkspace("owner-1"),
    ).rejects.toBe(aggregationError);
  });

  test("freezes the application service instance", () => {
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: {
        findByOwnerId: vi.fn(),
      },
      aggregationService: {
        aggregate: vi.fn(),
      },
    });

    expect(Object.isFrozen(service)).toBe(true);
  });
});
