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

// --- Transaction cutover filtering (account groups) -----------------------------------------
describe("FinancialWorkspaceQueryService -- transaction cutover", () => {
  function csvEvent(id, eventDate, financialAccountId = "acct-manual") {
    return Object.freeze({ id, financial_account_id: financialAccountId, event_date: eventDate, source_system: "quicken_simplifi_csv" });
  }

  function stripeEvent(id, eventDate, financialAccountId = "acct-stripe") {
    return Object.freeze({ id, financial_account_id: financialAccountId, event_date: eventDate, source_system: "stripe_financial_connections" });
  }

  test("with no groups at all, every event passes through unfiltered -- byte-for-byte unchanged", async () => {
    const events = [csvEvent("e1", "2026-09-01"), csvEvent("e2", "2026-09-05")];
    const aggregationService = { aggregate: vi.fn().mockReturnValue(buildWorkspace()) };
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: { findByOwnerId: vi.fn().mockResolvedValue(events) },
      aggregationService,
      financialAccountGroupRepository: { findActiveGroupsForOwner: vi.fn().mockResolvedValue([]) },
    });

    await service.buildWorkspace("owner-1");

    expect(aggregationService.aggregate).toHaveBeenCalledWith(events, { scope: null });
  });

  test("a group whose coverage is not yet 'reconciled' filters nothing -- manual/CSV history stays fully retained until a human explicitly confirms coverage", async () => {
    const events = [csvEvent("e1", "2026-09-01"), csvEvent("e2", "2026-09-08"), stripeEvent("e3", "2026-09-09")];
    const aggregationService = { aggregate: vi.fn().mockReturnValue(buildWorkspace()) };
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: { findByOwnerId: vi.fn().mockResolvedValue(events) },
      aggregationService,
      financialAccountGroupRepository: {
        findActiveGroupsForOwner: vi.fn().mockResolvedValue([
          {
            group: { transactionCoverageStatus: "pending_reconciliation", transactionCutoverAt: null, balanceAuthorityAccountId: "acct-stripe" },
            activeMemberFinancialAccountIds: ["acct-stripe", "acct-manual"],
          },
        ]),
      },
    });

    await service.buildWorkspace("owner-1");

    expect(aggregationService.aggregate).toHaveBeenCalledWith(events, { scope: null });
  });

  test("once reconciled with a cutover date: CSV events strictly before cutover are retained, CSV events on/after cutover are excluded, Stripe events are always retained regardless of date", async () => {
    const events = [
      csvEvent("csv-before", "2026-08-31"),
      csvEvent("csv-on-cutover", "2026-09-01"),
      csvEvent("csv-after", "2026-09-05"),
      stripeEvent("stripe-before-cutover-date-but-always-kept", "2026-08-15"),
      stripeEvent("stripe-after", "2026-09-09"),
    ];
    const aggregationService = { aggregate: vi.fn().mockReturnValue(buildWorkspace()) };
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: { findByOwnerId: vi.fn().mockResolvedValue(events) },
      aggregationService,
      financialAccountGroupRepository: {
        findActiveGroupsForOwner: vi.fn().mockResolvedValue([
          {
            group: { transactionCoverageStatus: "reconciled", transactionCutoverAt: "2026-09-01", balanceAuthorityAccountId: "acct-stripe", transactionAuthorityAccountId: "acct-stripe" },
            activeMemberFinancialAccountIds: ["acct-stripe", "acct-manual"],
          },
        ]),
      },
    });

    await service.buildWorkspace("owner-1");

    const passedEvents = aggregationService.aggregate.mock.calls[0][0];
    expect(passedEvents.map((e) => e.id).sort()).toEqual(
      ["csv-before", "stripe-after", "stripe-before-cutover-date-but-always-kept"].sort(),
    );
  });

  test("no double-counting: neither the CSV row nor the Stripe row is ever deleted -- the exclusion is a read-time filter only, proven by re-running with a later cutover and getting the CSV row back", async () => {
    const events = [csvEvent("csv-mid", "2026-09-05"), stripeEvent("stripe-1", "2026-09-09")];
    const financialEventRepository = { findByOwnerId: vi.fn().mockResolvedValue(events) };
    const aggregationService = { aggregate: vi.fn().mockReturnValue(buildWorkspace()) };

    const excludingService = new FinancialWorkspaceQueryService({
      financialEventRepository,
      aggregationService,
      financialAccountGroupRepository: {
        findActiveGroupsForOwner: vi.fn().mockResolvedValue([
          { group: { transactionCoverageStatus: "reconciled", transactionCutoverAt: "2026-09-01", balanceAuthorityAccountId: "acct-stripe", transactionAuthorityAccountId: "acct-stripe" }, activeMemberFinancialAccountIds: ["acct-stripe", "acct-manual"] },
        ]),
      },
    });
    await excludingService.buildWorkspace("owner-1");
    expect(aggregationService.aggregate.mock.calls[0][0].map((e) => e.id)).toEqual(["stripe-1"]);

    // The underlying repository data is untouched (same `events` array, same rows) -- only the
    // cutover date differs, proving the CSV row was filtered, not deleted.
    aggregationService.aggregate.mockClear();
    const laterCutoverService = new FinancialWorkspaceQueryService({
      financialEventRepository,
      aggregationService,
      financialAccountGroupRepository: {
        findActiveGroupsForOwner: vi.fn().mockResolvedValue([
          { group: { transactionCoverageStatus: "reconciled", transactionCutoverAt: "2026-09-06", balanceAuthorityAccountId: "acct-stripe", transactionAuthorityAccountId: "acct-stripe" }, activeMemberFinancialAccountIds: ["acct-stripe", "acct-manual"] },
        ]),
      },
    });
    await laterCutoverService.buildWorkspace("owner-1");
    expect(aggregationService.aggregate.mock.calls[0][0].map((e) => e.id).sort()).toEqual(["csv-mid", "stripe-1"]);
  });

  test("reconciled with a cutover date but NO transaction authority identified: filters nothing -- transaction authority is never inferred from balanceAuthorityAccountId", async () => {
    const events = [csvEvent("csv-mid", "2026-09-05"), stripeEvent("stripe-1", "2026-09-09")];
    const aggregationService = { aggregate: vi.fn().mockReturnValue(buildWorkspace()) };
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: { findByOwnerId: vi.fn().mockResolvedValue(events) },
      aggregationService,
      financialAccountGroupRepository: {
        findActiveGroupsForOwner: vi.fn().mockResolvedValue([
          {
            // reconciled + a cutover date present, but transactionAuthorityAccountId was never
            // set -- must NOT fall back to treating balanceAuthorityAccountId as the canonical
            // side. The real RPC (set_financial_account_group_transaction_cutover) refuses to
            // ever produce this combination, but the read model must not rely on that alone.
            group: { transactionCoverageStatus: "reconciled", transactionCutoverAt: "2026-09-01", balanceAuthorityAccountId: "acct-stripe", transactionAuthorityAccountId: null },
            activeMemberFinancialAccountIds: ["acct-stripe", "acct-manual"],
          },
        ]),
      },
    });

    await service.buildWorkspace("owner-1");

    expect(aggregationService.aggregate).toHaveBeenCalledWith(events, { scope: null });
  });

  test("three members (manual + Stripe + Plaid): transaction authority is independent of balance authority -- Plaid can be balance authority while Stripe is transaction authority", async () => {
    const events = [
      csvEvent("manual-before", "2026-08-31", "acct-manual"),
      csvEvent("manual-after", "2026-09-05", "acct-manual"),
      stripeEvent("stripe-after", "2026-09-05", "acct-stripe"),
      { id: "plaid-after", financial_account_id: "acct-plaid", event_date: "2026-09-05", source_system: "plaid" },
    ];
    const aggregationService = { aggregate: vi.fn().mockReturnValue(buildWorkspace()) };
    const service = new FinancialWorkspaceQueryService({
      financialEventRepository: { findByOwnerId: vi.fn().mockResolvedValue(events) },
      aggregationService,
      financialAccountGroupRepository: {
        findActiveGroupsForOwner: vi.fn().mockResolvedValue([
          {
            // balanceAuthorityAccountId is Plaid (freshest live balance right now);
            // transactionAuthorityAccountId is Stripe (the member a human actually verified
            // complete transaction coverage for) -- deliberately NOT the same account.
            group: {
              transactionCoverageStatus: "reconciled",
              transactionCutoverAt: "2026-09-01",
              balanceAuthorityAccountId: "acct-plaid",
              transactionAuthorityAccountId: "acct-stripe",
            },
            activeMemberFinancialAccountIds: ["acct-manual", "acct-stripe", "acct-plaid"],
          },
        ]),
      },
    });

    await service.buildWorkspace("owner-1");

    const passedEvents = aggregationService.aggregate.mock.calls[0][0];
    // Stripe (transaction authority) is retained regardless of date. Manual and Plaid are both
    // non-canonical here -- despite Plaid being BALANCE authority, its transaction history is
    // still cut off at the cutover date exactly like manual's, because transaction authority,
    // not balance authority, decides this.
    expect(passedEvents.map((e) => e.id).sort()).toEqual(["manual-before", "stripe-after"].sort());
  });
});
