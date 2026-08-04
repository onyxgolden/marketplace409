import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import {
  TransactionReviewApplication,
} from "../../../application/financial";

import {
  BulkPropertyAssignmentService,
  ManualPropertyAssignmentService,
  PropertyRuleManagementService,
  SupabasePropertyRuleRepository,
} from "../../../domains/property";

import {
  createTransactionReviewApplicationSuite,
} from "../createTransactionReviewApplicationSuite.js";

describe(
  "createTransactionReviewApplicationSuite",
  () => {
    it(
      "builds the default suite with the injected Supabase client",
      () => {
        const supabaseClient = {
          from:
            vi.fn(),
        };

        const suite =
          createTransactionReviewApplicationSuite({
            supabaseClient,
          });

        expect(
          suite.reviewApplication,
        ).toBeInstanceOf(
          TransactionReviewApplication,
        );

        expect(
          suite.ruleRepository,
        ).toBeInstanceOf(
          SupabasePropertyRuleRepository,
        );

        expect(
          suite.ruleManagementService,
        ).toBeInstanceOf(
          PropertyRuleManagementService,
        );

        expect(
          suite.manualAssignmentService,
        ).toBeInstanceOf(
          ManualPropertyAssignmentService,
        );

        expect(
          suite.bulkAssignmentService,
        ).toBeInstanceOf(
          BulkPropertyAssignmentService,
        );

        expect(
          Object.isFrozen(suite),
        ).toBe(true);
      },
    );

    it(
      "fails when no repository or Supabase client is available",
      () => {
        expect(() =>
          createTransactionReviewApplicationSuite(),
        ).toThrow(
          "SupabasePropertyRuleRepository requires a Supabase client.",
        );
      },
    );

    it(
      "injects the rule repository through the service graph",
      () => {
        const ruleRepository = {
          findRules:
            async () => [],
          save:
            async (rule) => rule,
          saveMany:
            async (rules) => rules,
        };

        const suite =
          createTransactionReviewApplicationSuite({
            ruleRepository,
          });

        expect(
          suite.ruleRepository,
        ).toBe(
          ruleRepository,
        );

        expect(
          suite.ruleManagementService.ruleRepository,
        ).toBe(
          ruleRepository,
        );
      },
    );

    it(
      "allows complete application and service injection",
      () => {
        const reviewApplication = {};
        const ruleRepository = {};
        const ruleManagementService = {};
        const manualAssignmentService = {};
        const bulkAssignmentService = {};

        const suite =
          createTransactionReviewApplicationSuite({
            reviewApplication,
            ruleRepository,
            ruleManagementService,
            manualAssignmentService,
            bulkAssignmentService,
          });

        expect(
          suite.reviewApplication,
        ).toBe(
          reviewApplication,
        );

        expect(
          suite.ruleRepository,
        ).toBe(
          ruleRepository,
        );

        expect(
          suite.ruleManagementService,
        ).toBe(
          ruleManagementService,
        );

        expect(
          suite.manualAssignmentService,
        ).toBe(
          manualAssignmentService,
        );

        expect(
          suite.bulkAssignmentService,
        ).toBe(
          bulkAssignmentService,
        );
      },
    );
  },
);
