import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  retrieveFinancialConnectionsAccount: vi.fn(),
  listAllFinancialConnectionsTransactions: vi.fn(),
}));

// Mocked at the client-module boundary (not the raw Stripe SDK) -- this coordinator's own
// contract is "call these two functions correctly and act on their return values," which is
// exactly what stripe-financial-connections.client.test.ts already proves those two functions do
// correctly against the real Stripe SDK shape. Testing both boundaries with raw Stripe fixtures
// here too would just duplicate that coverage without adding any.
vi.mock("../stripe-financial-connections.client", () => ({
  retrieveFinancialConnectionsAccount: mocks.retrieveFinancialConnectionsAccount,
  listAllFinancialConnectionsTransactions: mocks.listAllFinancialConnectionsTransactions,
}));

const { createStripeFinancialConnectionsRefreshCoordinator } = await import("../stripe-financial-connections-refresh-coordinator");

function fakeAccountState(overrides = {}) {
  return {
    accountId: "fca_1",
    displayName: null,
    institutionName: null,
    last4: null,
    category: "cash",
    subcategory: "checking",
    status: "active",
    balance: { currentCents: 100, availableCents: 90, currency: "USD", asOf: "2026-09-09T00:00:00.000Z", type: "cash" },
    balanceRefreshStatus: "succeeded",
    balanceRefreshLastAttemptedAt: 1000,
    nextBalanceRefreshAvailableAt: null,
    transactionRefreshStatus: "succeeded",
    transactionRefreshId: "fcxrefresh_1",
    transactionRefreshLastAttemptedAt: 2000,
    ...overrides,
  };
}

function fakeRefreshRepository(overrides = {}) {
  return {
    getWatermark: vi.fn().mockResolvedValue(null),
    claim: vi.fn().mockResolvedValue({ outcome: "claimed", workItemId: "work_1" }),
    markImporting: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ outcome: "committed", supersededByRefreshId: null }),
    ...overrides,
  };
}

function fakeAccountBalanceRepository() {
  return { saveMany: vi.fn().mockResolvedValue(undefined) };
}

function fakeFinancialEventImportService(overrides = {}) {
  return {
    import: vi.fn().mockResolvedValue({ importedFinancialEventCount: 0, failedFinancialEventCount: 0 }),
    ...overrides,
  };
}

const BASE_INPUT = {
  ownerId: "owner-123",
  connectionId: "connection_1",
  financialAccountId: "financial_account_1",
  providerAccountId: "fca_1",
  triggeringEventId: "evt_1",
  connection: {
    id: "connection_1", userId: "owner-123", name: "Capital One", type: "bank",
    status: "connected", provider: "stripe_financial_connections",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  },
  credentialReference: {
    id: "credential_1", provider: "stripe_financial_connections", externalCredentialId: "fcsess_1",
    vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state", status: "active",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  },
  institutionReference: {
    id: "institution_1", connectionId: "connection_1", name: "Capital One", type: "bank",
    provider: "stripe_financial_connections", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  },
} as const;

function buildCoordinator(overrides = {}) {
  return createStripeFinancialConnectionsRefreshCoordinator({
    // The two functions this coordinator calls (retrieveFinancialConnectionsAccount,
    // listAllFinancialConnectionsTransactions) are mocked at the module boundary above, so the
    // real shape of stripeClient is never actually exercised here -- an empty stub, typed
    // through, is intentional and sufficient.
    stripeClient: {} as Parameters<typeof createStripeFinancialConnectionsRefreshCoordinator>[0]["stripeClient"],
    refreshRepository: fakeRefreshRepository(),
    accountBalanceRepository: fakeAccountBalanceRepository(),
    financialEventImportService: fakeFinancialEventImportService(),
    ...overrides,
  });
}

describe("createStripeFinancialConnectionsRefreshCoordinator", () => {
  beforeEach(() => {
    mocks.retrieveFinancialConnectionsAccount.mockReset();
    mocks.listAllFinancialConnectionsTransactions.mockReset().mockResolvedValue([]);
  });

  it("retrieves the account read-only (no refresh requested), never calling accounts.refresh or transactions.list before confirming currency", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    const refreshRepository = fakeRefreshRepository();
    const coordinator = buildCoordinator({ refreshRepository });

    await coordinator.processRefresh({ ...BASE_INPUT, feature: "balance" });

    expect(mocks.retrieveFinancialConnectionsAccount).toHaveBeenCalledWith({}, { accountId: "fca_1" });
    expect(mocks.retrieveFinancialConnectionsAccount).toHaveBeenCalledTimes(1);
    expect(mocks.listAllFinancialConnectionsTransactions).not.toHaveBeenCalled();
  });

  it("reports not_current without claiming anything when the account's own current refresh has not succeeded", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState({ transactionRefreshStatus: "pending" }));
    const refreshRepository = fakeRefreshRepository();
    const coordinator = buildCoordinator({ refreshRepository });

    const outcome = await coordinator.processRefresh({ ...BASE_INPUT, feature: "transactions" });

    expect(outcome).toEqual({ outcome: "not_current" });
    expect(refreshRepository.claim).not.toHaveBeenCalled();
  });

  // The literal fix this coordinator exists for: an out-of-order webhook redelivery describing an
  // OLDER refresh must never be trusted just because it arrived. Regardless of what the webhook
  // event itself claims, ONLY Stripe's own live, current answer is ever passed to claim().
  it("trusts Stripe's live current refresh, never the arriving webhook event's own embedded refresh id -- proves reversed/out-of-order delivery cannot regress anything", async () => {
    // Stripe's live account state says the CURRENT transaction refresh is "fcxrefresh_newer" --
    // regardless of which stale event this coordinator was invoked to handle.
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(
      fakeAccountState({ transactionRefreshId: "fcxrefresh_newer", transactionRefreshLastAttemptedAt: 9999 }),
    );
    const refreshRepository = fakeRefreshRepository();
    const coordinator = buildCoordinator({ refreshRepository });

    // triggeringEventId is the only thing tying this call to a specific (older, stale) webhook
    // delivery -- the coordinator has NO OTHER access to that event's own embedded refresh info,
    // by design, so it cannot possibly act on it even if it wanted to.
    await coordinator.processRefresh({ ...BASE_INPUT, feature: "transactions", triggeringEventId: "evt_stale_reversed_delivery" });

    expect(refreshRepository.claim).toHaveBeenCalledWith(expect.objectContaining({
      refreshId: "fcxrefresh_newer",
      refreshLastAttemptedAt: 9999,
      triggeringEventId: "evt_stale_reversed_delivery",
    }));
  });

  // Different refresh ids can legitimately share the same last_attempted_at second. Since the
  // coordinator never compares timestamps of its own accord -- it only ever acts on whatever
  // Stripe's live retrieve currently reports -- a tie is never even evaluated as a tie; there is
  // simply one live answer, always used verbatim.
  it("does not need to break a tie between equal-timestamp refresh ids -- it only ever acts on Stripe's single live answer", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(
      fakeAccountState({ transactionRefreshId: "fcxrefresh_Y", transactionRefreshLastAttemptedAt: 5000 }),
    );
    const refreshRepository = fakeRefreshRepository();
    const coordinator = buildCoordinator({ refreshRepository });

    // The arriving webhook event might describe some OTHER refresh (e.g. "fcxrefresh_X") that
    // happens to share last_attempted_at 5000 -- irrelevant, since the coordinator never reads
    // the event's own embedded refresh fields at all, only triggeringEventId (for bookkeeping).
    await coordinator.processRefresh({ ...BASE_INPUT, feature: "transactions", triggeringEventId: "evt_tie" });

    expect(refreshRepository.claim).toHaveBeenCalledWith(expect.objectContaining({ refreshId: "fcxrefresh_Y", refreshLastAttemptedAt: 5000 }));
  });

  it("balance feature: persists only via accountBalanceRepository, never touches financialEventImportService", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    const refreshRepository = fakeRefreshRepository();
    const accountBalanceRepository = fakeAccountBalanceRepository();
    const financialEventImportService = fakeFinancialEventImportService();
    const coordinator = buildCoordinator({ refreshRepository, accountBalanceRepository, financialEventImportService });

    const outcome = await coordinator.processRefresh({ ...BASE_INPUT, feature: "balance" });

    expect(outcome).toEqual({ outcome: "committed", importedCount: 1 });
    expect(accountBalanceRepository.saveMany).toHaveBeenCalledTimes(1);
    expect(financialEventImportService.import).not.toHaveBeenCalled();
  });

  it("transactions feature: persists only via financialEventImportService, never touches accountBalanceRepository", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    mocks.listAllFinancialConnectionsTransactions.mockResolvedValue([
      { transactionId: "fctxn_1", accountId: "fca_1", amount: -1000, currency: "USD", description: "Rocket Rides", status: "posted", transactedAt: "2026-09-01", statusTransitionedAt: "2026-09-01T00:00:01.000Z", transactionRefreshId: "fcxrefresh_1" },
    ]);
    const refreshRepository = fakeRefreshRepository();
    const accountBalanceRepository = fakeAccountBalanceRepository();
    const financialEventImportService = fakeFinancialEventImportService({
      import: vi.fn().mockResolvedValue({ importedFinancialEventCount: 1, failedFinancialEventCount: 0 }),
    });
    const coordinator = buildCoordinator({ refreshRepository, accountBalanceRepository, financialEventImportService });

    const outcome = await coordinator.processRefresh({ ...BASE_INPUT, feature: "transactions" });

    expect(outcome).toEqual({ outcome: "committed", importedCount: 1 });
    expect(financialEventImportService.import).toHaveBeenCalledTimes(1);
    expect(accountBalanceRepository.saveMany).not.toHaveBeenCalled();
  });

  it("passes the previously-committed watermark as the incremental transactionRefreshAfter filter -- never an always-full refetch", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    mocks.listAllFinancialConnectionsTransactions.mockResolvedValue([]);
    const refreshRepository = fakeRefreshRepository({
      getWatermark: vi.fn().mockResolvedValue({ committedRefreshId: "fcxrefresh_previous", committedRefreshLastAttemptedAt: null }),
    });
    const coordinator = buildCoordinator({ refreshRepository });

    await coordinator.processRefresh({ ...BASE_INPUT, feature: "transactions" });

    expect(mocks.listAllFinancialConnectionsTransactions).toHaveBeenCalledWith(
      {}, expect.objectContaining({ accountId: "fca_1", transactionRefreshAfter: "fcxrefresh_previous" }),
    );
  });

  it("propagates claim outcomes (already_committed, slot_busy) without ever calling markImporting/persisting/committing", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    const accountBalanceRepository = fakeAccountBalanceRepository();

    const alreadyCommittedRepo = fakeRefreshRepository({ claim: vi.fn().mockResolvedValue({ outcome: "already_committed", workItemId: "work_1" }) });
    const coordinator1 = buildCoordinator({ refreshRepository: alreadyCommittedRepo, accountBalanceRepository });
    const outcome1 = await coordinator1.processRefresh({ ...BASE_INPUT, feature: "balance" });
    expect(outcome1).toEqual({ outcome: "already_committed" });
    expect(alreadyCommittedRepo.markImporting).not.toHaveBeenCalled();
    expect(accountBalanceRepository.saveMany).not.toHaveBeenCalled();

    // A different refresh for this exact account+feature is already actively importing -- this
    // arriving one must stay retryable/queued, never falsely marked processed.
    const slotBusyRepo = fakeRefreshRepository({ claim: vi.fn().mockResolvedValue({ outcome: "slot_busy", workItemId: "work_2" }) });
    const coordinator2 = buildCoordinator({ refreshRepository: slotBusyRepo, accountBalanceRepository });
    const outcome2 = await coordinator2.processRefresh({ ...BASE_INPUT, feature: "balance" });
    expect(outcome2).toEqual({ outcome: "slot_busy" });
    expect(slotBusyRepo.markImporting).not.toHaveBeenCalled();
    expect(accountBalanceRepository.saveMany).not.toHaveBeenCalled();
  });

  it("marks the work item failed (never commits) when persistence throws, and rethrows so the caller's own retry/bookkeeping applies", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    const refreshRepository = fakeRefreshRepository();
    const accountBalanceRepository = { saveMany: vi.fn().mockRejectedValue(new Error("db write failed")) };
    const coordinator = buildCoordinator({ refreshRepository, accountBalanceRepository });

    await expect(coordinator.processRefresh({ ...BASE_INPUT, feature: "balance" })).rejects.toThrow("db write failed");

    expect(refreshRepository.markFailed).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "work_1" }));
    expect(refreshRepository.commit).not.toHaveBeenCalled();
  });

  // "Crash after persistence but before watermark commit" (a real process crash, not a normal
  // thrown error) is proven safe at the database level instead (see
  // SupabaseFinancialAccountRefreshRepository.integration.test.js): the persistence step's own
  // idempotent upsert-by-source-id means a retry that re-runs persistence for the same refresh is
  // harmless, and the watermark's own atomic, monotonic compare-and-swap is the sole correctness
  // gate regardless of how many times persistence itself has run. This test only covers the
  // ordinary-exception case at the coordinator's own boundary.
  it("marks the work item failed (not committed) when the commit call itself throws after persistence has already succeeded", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    const refreshRepository = fakeRefreshRepository({ commit: vi.fn().mockRejectedValue(new Error("connection lost")) });
    const coordinator = buildCoordinator({ refreshRepository });

    await expect(coordinator.processRefresh({ ...BASE_INPUT, feature: "balance" })).rejects.toThrow("connection lost");

    expect(refreshRepository.markFailed).toHaveBeenCalledWith(expect.objectContaining({ workItemId: "work_1" }));
  });

  it("reports superseded, with the authoritative newer refresh id, when the commit's own compare-and-swap loses to a concurrently-committed newer refresh", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    const refreshRepository = fakeRefreshRepository({
      commit: vi.fn().mockResolvedValue({ outcome: "superseded", supersededByRefreshId: "fcxrefresh_beat_us_to_it" }),
    });
    const coordinator = buildCoordinator({ refreshRepository });

    const outcome = await coordinator.processRefresh({ ...BASE_INPUT, feature: "balance" });

    expect(outcome).toEqual({ outcome: "superseded", supersededByRefreshId: "fcxrefresh_beat_us_to_it" });
  });

  it("uses last_attempted_at itself as the balance feature's synthetic refresh id (BalanceRefresh has no id field on Stripe's own object)", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState({ balanceRefreshLastAttemptedAt: 424242 }));
    const refreshRepository = fakeRefreshRepository();
    const coordinator = buildCoordinator({ refreshRepository });

    await coordinator.processRefresh({ ...BASE_INPUT, feature: "balance" });

    expect(refreshRepository.claim).toHaveBeenCalledWith(expect.objectContaining({
      refreshId: "balance_refresh_424242",
      refreshLastAttemptedAt: 424242,
    }));
  });

  it("webhook duplicate delivery: a second call for a refresh already committed resolves to already_committed without re-persisting anything", async () => {
    mocks.retrieveFinancialConnectionsAccount.mockResolvedValue(fakeAccountState());
    const accountBalanceRepository = fakeAccountBalanceRepository();
    const refreshRepository = fakeRefreshRepository({
      claim: vi.fn()
        .mockResolvedValueOnce({ outcome: "claimed", workItemId: "work_1" })
        .mockResolvedValueOnce({ outcome: "already_committed", workItemId: "work_1" }),
    });
    const coordinator = buildCoordinator({ refreshRepository, accountBalanceRepository });

    const first = await coordinator.processRefresh({ ...BASE_INPUT, feature: "balance" });
    const second = await coordinator.processRefresh({ ...BASE_INPUT, feature: "balance", triggeringEventId: "evt_1_redelivered" });

    expect(first.outcome).toBe("committed");
    expect(second).toEqual({ outcome: "already_committed" });
    expect(accountBalanceRepository.saveMany).toHaveBeenCalledTimes(1); // not 2 -- the redelivery never re-persists
  });
});
