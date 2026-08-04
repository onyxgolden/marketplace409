import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  createConnectionPlatformSuite:
    vi.fn(),
  createFinancialApplicationSuite:
    vi.fn(),
  createTransactionReviewApplicationSuite:
    vi.fn(),
}));

vi.mock(
  "@/infrastructure/composition",
  () => ({
    createConnectionPlatformSuite:
      mocks.createConnectionPlatformSuite,
    createFinancialApplicationSuite:
      mocks.createFinancialApplicationSuite,
    createTransactionReviewApplicationSuite:
      mocks.createTransactionReviewApplicationSuite,
  }),
);

import {
  createForgeApplicationSuite,
} from "../createForgeApplicationSuite.js";

describe(
  "createForgeApplicationSuite",
  () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it(
      "composes request-scoped FORGE application suites",
      async () => {
        const connectionPlatformSuite = {
          connectionOperationsApplication: {
            kind:
              "connection-operations",
          },
          connectionReadModelApplication: {
            kind:
              "connection-read-model",
          },
        };

        const financialApplicationSuite = {
          readModelApplication: {
            kind:
              "financial-read-model",
          },
          financialIntelligenceApplication: {
            kind:
              "financial-intelligence",
          },
          forgeDashboardApplication: {
            kind:
              "forge-dashboard",
          },
        };

        const transactionReviewApplicationSuite = {
          manualAssignmentService: {
            kind:
              "manual-assignment",
          },
          bulkAssignmentService: {
            kind:
              "bulk-assignment",
          },
        };

        const canonicalIntelligenceContextBuilder = {
          kind:
            "canonical-context-builder",
        };

        mocks.createConnectionPlatformSuite
          .mockResolvedValue(
            connectionPlatformSuite,
          );

        mocks.createFinancialApplicationSuite
          .mockResolvedValue(
            financialApplicationSuite,
          );

        mocks.createTransactionReviewApplicationSuite
          .mockReturnValue(
            transactionReviewApplicationSuite,
          );

        const supabaseClient = {
          from:
            vi.fn(),
        };

        const currentOwnerId =
          async () => "owner-1";

        const suite =
          await createForgeApplicationSuite({
            supabaseClient,
            ownerId:
              "owner-1",
            currentOwnerId,
            canonicalIntelligenceContextBuilder,
          });

        expect(suite).toEqual({
          connectionPlatformSuite,
          financialApplicationSuite,
          transactionReviewApplicationSuite,

          connectionOperationsApplication:
            connectionPlatformSuite
              .connectionOperationsApplication,

          connectionReadModelApplication:
            connectionPlatformSuite
              .connectionReadModelApplication,

          financialReadModelApplication:
            financialApplicationSuite
              .readModelApplication,

          canonicalIntelligenceContextBuilder,

          forgeDashboardApplication:
            financialApplicationSuite
              .forgeDashboardApplication,
        });

        expect(
          mocks.createConnectionPlatformSuite,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.createConnectionPlatformSuite,
        ).toHaveBeenCalledWith({
          supabaseClient,
          ownerId:
            "owner-1",
          currentOwnerId,
        });

        expect(
          mocks.createFinancialApplicationSuite,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.createFinancialApplicationSuite,
        ).toHaveBeenCalledWith({
          supabaseClient,
          ownerId:
            "owner-1",
          currentOwnerId,
        });

        expect(
          mocks.createTransactionReviewApplicationSuite,
        ).toHaveBeenCalledTimes(1);

        expect(
          mocks.createTransactionReviewApplicationSuite,
        ).toHaveBeenCalledWith({
          supabaseClient,
          ownerId:
            "owner-1",
          currentOwnerId,
        });

        expect(
          Object.isFrozen(suite),
        ).toBe(true);
      },
    );

    it(
      "uses injected suites without composing defaults",
      async () => {
        const connectionPlatformSuite = {
          connectionOperationsApplication: {},
          connectionReadModelApplication: {},
        };

        const financialApplicationSuite = {
          readModelApplication: {},
          financialIntelligenceApplication: {},
          forgeDashboardApplication: {},
        };

        const transactionReviewApplicationSuite = {
          manualAssignmentService: {},
          bulkAssignmentService: {},
        };

        const suite =
          await createForgeApplicationSuite({
            connectionPlatformSuite,
            financialApplicationSuite,
            transactionReviewApplicationSuite,
            canonicalIntelligenceContextBuilder: {},
          });

        expect(
          suite.connectionPlatformSuite,
        ).toBe(
          connectionPlatformSuite,
        );

        expect(
          suite.financialApplicationSuite,
        ).toBe(
          financialApplicationSuite,
        );

        expect(
          suite.transactionReviewApplicationSuite,
        ).toBe(
          transactionReviewApplicationSuite,
        );

        expect(
          mocks.createConnectionPlatformSuite,
        ).not.toHaveBeenCalled();

        expect(
          mocks.createFinancialApplicationSuite,
        ).not.toHaveBeenCalled();

        expect(
          mocks.createTransactionReviewApplicationSuite,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
