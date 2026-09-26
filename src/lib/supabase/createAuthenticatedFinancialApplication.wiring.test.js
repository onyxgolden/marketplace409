import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createFinancialApplicationSuite: vi.fn(),
  createFinancialEventRepository: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock(
  "@/infrastructure/composition/createFinancialApplicationSuite.js",
  () => ({
    createFinancialApplicationSuite:
      mocks.createFinancialApplicationSuite,
  }),
);

vi.mock(
  "@/infrastructure/composition/createFinancialEventRepository.js",
  () => ({
    createFinancialEventRepository:
      mocks.createFinancialEventRepository,
  }),
);

import {
  createAuthenticatedFinancialApplication,
} from "./createAuthenticatedFinancialApplication";

function buildSupabaseClient(user) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(function eq() {
          return this;
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      })),
    })),
  };
}

function financialEventRow(overrides = {}) {
  return {
    id: "evt-1",
    owner_id: "owner-1",
    status: "active",
    is_deleted: false,
    event_date: "2026-08-15",
    description: "Chipotle",
    amount: 42.5,
    transaction_kind: "expense",
    normalized_category: "dining_drinks",
    created_at: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("createAuthenticatedFinancialApplication reporting wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createFinancialApplicationSuite.mockResolvedValue({
      readModelApplication: {},
    });
  });

  it("passes real financial_events rows through as ledger inputs to the suite", async () => {
    const supabaseClient = buildSupabaseClient({ id: "owner-1" });
    const repository = {
      findByOwnerId: vi.fn().mockResolvedValue([
        financialEventRow(),
        financialEventRow({
          id: "evt-2",
          transaction_kind: "income",
          amount: 1600,
          normalized_category: "rent",
          event_date: "2026-08-01",
        }),
      ]),
    };

    mocks.createClient.mockResolvedValue(supabaseClient);
    mocks.createFinancialEventRepository.mockResolvedValue(repository);

    const { getFinancialApplicationSuite } =
      await createAuthenticatedFinancialApplication();

    await getFinancialApplicationSuite();

    expect(
      mocks.createFinancialEventRepository,
    ).toHaveBeenCalledWith({ supabaseClient });
    expect(repository.findByOwnerId).toHaveBeenCalledWith("owner-1");

    const deps =
      mocks.createFinancialApplicationSuite.mock.calls[0][0];

    // The same repository instance is shared through, so events are read once.
    expect(deps.financialEventRepository).toBe(repository);

    // Real ledger inputs reach the composition: engine/reportingApplication will be
    // built instead of null, so /financial/reports and /financial/ask stop 503ing.
    expect(deps.financialData).not.toBeNull();
    expect(
      deps.financialData.chartOfAccounts.hasAccount(
        "expense:dining_drinks",
      ),
    ).toBe(true);
    expect(
      deps.financialData.chartOfAccounts.hasAccount("revenue:rent"),
    ).toBe(true);
    expect(
      deps.financialData.generalLedger.getEntries(),
    ).toHaveLength(2);
  });

  it("keeps the deliberate 503 contract (financialData null) when the ledger is empty", async () => {
    const supabaseClient = buildSupabaseClient({ id: "owner-1" });

    mocks.createClient.mockResolvedValue(supabaseClient);
    mocks.createFinancialEventRepository.mockResolvedValue({
      findByOwnerId: vi.fn().mockResolvedValue([]),
    });

    const { getFinancialApplicationSuite } =
      await createAuthenticatedFinancialApplication();

    await getFinancialApplicationSuite();

    const deps =
      mocks.createFinancialApplicationSuite.mock.calls[0][0];

    expect(deps.financialData).toBeNull();
  });

  it("keeps the deliberate 503 contract (financialData null) when the event read fails", async () => {
    const supabaseClient = buildSupabaseClient({ id: "owner-1" });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mocks.createClient.mockResolvedValue(supabaseClient);
    mocks.createFinancialEventRepository.mockResolvedValue({
      findByOwnerId: vi
        .fn()
        .mockRejectedValue(new Error("read failed")),
    });

    const { getFinancialApplicationSuite } =
      await createAuthenticatedFinancialApplication();

    await getFinancialApplicationSuite();

    const deps =
      mocks.createFinancialApplicationSuite.mock.calls[0][0];

    // A transient read failure must not 500 the route or fabricate zeros -- the suite
    // still builds, and the reports/ask routes answer 503 with their retry UI.
    expect(deps.financialData).toBeNull();
    expect(
      mocks.createFinancialApplicationSuite,
    ).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
