import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  createFixture,
  delegationsPath,
  governanceModePath,
  removeTemporaryRepositories,
} from "./fixtures/authoritativeSynchronizationFixture.mjs";

const {
  executeAuthoritativeSynchronizationPlanMock,
  planAuthoritativeSynchronizationMock,
} = vi.hoisted(() => ({
  executeAuthoritativeSynchronizationPlanMock:
    vi.fn(),
  planAuthoritativeSynchronizationMock:
    vi.fn(),
}));

vi.mock(
  "../planAuthoritativeSynchronization.mjs",
  () => ({
    planAuthoritativeSynchronization:
      planAuthoritativeSynchronizationMock,
  }),
);

vi.mock(
  "../executeAuthoritativeSynchronizationPlan.mjs",
  () => ({
    executeAuthoritativeSynchronizationPlan:
      executeAuthoritativeSynchronizationPlanMock,
  }),
);

import {
  synchronizeAuthoritativeGovernance,
} from "../synchronizeAuthoritativeGovernance.mjs";

function deeplyFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const nestedValue
    of Object.values(value)
  ) {
    deeplyFreeze(
      nestedValue,
    );
  }

  return Object.freeze(
    value,
  );
}

function createPlan({
  mode = "hybrid",
  status =
    mode === "authoritative"
      ? "authoritative-planning"
      : mode === "shadow"
        ? "shadow-only"
        : mode,
  operations = [],
  skippedSections = [],
} = {}) {
  const updateCount =
    operations.filter(
      (operation) =>
        operation.contentChanged,
    ).length;

  return deeplyFreeze({
    mode,
    status,
    configurationVersion:
      "1.0",
    defaultAuthority:
      "human",
    delegationScope:
      "section",
    automaticPromotion:
      false,
    hasAuthorizedOperations:
      operations.length > 0,
    hasRequiredUpdates:
      updateCount > 0,
    operationCount:
      operations.length,
    updateCount,
    synchronizedCount:
      operations.length -
      updateCount,
    skippedCount:
      skippedSections.length,
    documents: [],
    operations,
    skippedSections,
  });
}

function createExecutionSummary({
  mode = "hybrid",
  status = "no-op",
  operationCount = 0,
  updateCount = 0,
  synchronizedCount = 0,
  skippedCount = 0,
  documentCount = 0,
  updatedDocumentCount = 0,
  rollbackPerformed = false,
} = {}) {
  return deeplyFreeze({
    mode,
    status,
    operationCount,
    updateCount,
    synchronizedCount,
    skippedCount,
    documentCount,
    updatedDocumentCount,
    verificationPassed:
      true,
    rollbackPerformed,
    documents: [],
    operations: [],
    skippedSections: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  removeTemporaryRepositories();
});

describe(
  "synchronizeAuthoritativeGovernance",
  () => {
    test(
      "normalizes the repository root before planning and execution",
      () => {
        const repositoryRoot =
          createFixture();

        const nonNormalizedRoot =
          path.join(
            repositoryRoot,
            ".",
            "nested",
            "..",
          );

        const plan =
          createPlan();

        const executionSummary =
          createExecutionSummary();

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot:
              nonNormalizedRoot,
            governanceModePath,
            delegationsPath,
          });

        const normalizedRepositoryRoot =
          path.resolve(
            nonNormalizedRoot,
          );

        expect(
          planAuthoritativeSynchronizationMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          planAuthoritativeSynchronizationMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            normalizedRepositoryRoot,
          governanceModePath,
          delegationsPath,
        });

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).toHaveBeenCalledTimes(1);

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            normalizedRepositoryRoot,
          plan,
        });

        expect(result).toBe(
          executionSummary,
        );
      },
    );

    test(
      "uses the default governance configuration paths",
      () => {
        const repositoryRoot =
          createFixture();

        const plan =
          createPlan();

        const executionSummary =
          createExecutionSummary();

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        synchronizeAuthoritativeGovernance({
          repositoryRoot,
        });

        expect(
          planAuthoritativeSynchronizationMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          governanceModePath:
            "governance/config/governance-mode.json",
          delegationsPath:
            "governance/config/authoritative-delegations.json",
        });
      },
    );

    test(
      "honors custom governance configuration paths",
      () => {
        const repositoryRoot =
          createFixture();

        const customGovernanceModePath =
          "governance/config/custom-mode.json";

        const customDelegationsPath =
          "governance/config/custom-delegations.json";

        const plan =
          createPlan();

        const executionSummary =
          createExecutionSummary();

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        synchronizeAuthoritativeGovernance({
          repositoryRoot,
          governanceModePath:
            customGovernanceModePath,
          delegationsPath:
            customDelegationsPath,
        });

        expect(
          planAuthoritativeSynchronizationMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          governanceModePath:
            customGovernanceModePath,
          delegationsPath:
            customDelegationsPath,
        });
      },
    );

    test(
      "passes a hybrid plan directly from planner to executor",
      () => {
        const repositoryRoot =
          createFixture({
            mode: "hybrid",
          });

        const plan =
          createPlan({
            mode: "hybrid",
            status:
              "hybrid-planning",
          });

        const executionSummary =
          createExecutionSummary({
            mode: "hybrid",
            status:
              "synchronized",
            operationCount:
              1,
            updateCount:
              1,
            documentCount:
              1,
            updatedDocumentCount:
              1,
          });

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          plan,
        });

        expect(result).toBe(
          executionSummary,
        );

        expect(result.mode).toBe(
          "hybrid",
        );
      },
    );

    test(
      "passes an authoritative plan directly from planner to executor",
      () => {
        const repositoryRoot =
          createFixture({
            mode:
              "authoritative",
          });

        const plan =
          createPlan({
            mode:
              "authoritative",
            status:
              "authoritative-planning",
          });

        const executionSummary =
          createExecutionSummary({
            mode:
              "authoritative",
            status:
              "synchronized",
            operationCount:
              1,
            updateCount:
              1,
            documentCount:
              1,
            updatedDocumentCount:
              1,
          });

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          plan,
        });

        expect(result).toBe(
          executionSummary,
        );

        expect(result.mode).toBe(
          "authoritative",
        );
      },
    );

    test(
      "passes a locked plan to the executor without expanding authority",
      () => {
        const repositoryRoot =
          createFixture({
            mode: "locked",
          });

        const plan =
          createPlan({
            mode: "locked",
            status: "locked",
            skippedSections: [
              deeplyFreeze({
                sectionId:
                  "repository_state",
                reason:
                  "governance-mode-prohibits-authoritative-planning",
              }),
            ],
          });

        const executionSummary =
          createExecutionSummary({
            mode: "locked",
            status: "no-op",
            skippedCount:
              1,
          });

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          plan,
        });

        expect(result).toBe(
          executionSummary,
        );

        expect(result.mode).toBe(
          "locked",
        );
      },
    );

    test(
      "passes a shadow plan to the executor without expanding authority",
      () => {
        const repositoryRoot =
          createFixture({
            mode: "shadow",
          });

        const plan =
          createPlan({
            mode: "shadow",
            status:
              "shadow-only",
          });

        const executionSummary =
          createExecutionSummary({
            mode: "shadow",
            status: "no-op",
          });

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          plan,
        });

        expect(result).toBe(
          executionSummary,
        );
      },
    );

    test(
      "propagates a no-op execution summary unchanged",
      () => {
        const repositoryRoot =
          createFixture();

        const plan =
          createPlan();

        const executionSummary =
          createExecutionSummary({
            mode: "hybrid",
            status: "no-op",
          });

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        expect(result).toBe(
          executionSummary,
        );

        expect(result).toMatchObject({
          status: "no-op",
          operationCount: 0,
          updateCount: 0,
          updatedDocumentCount:
            0,
          rollbackPerformed:
            false,
        });
      },
    );

    test(
      "propagates an immutable execution summary unchanged",
      () => {
        const repositoryRoot =
          createFixture();

        const plan =
          createPlan();

        const executionSummary =
          createExecutionSummary({
            status:
              "synchronized",
            operationCount:
              1,
            updateCount:
              1,
            documentCount:
              1,
            updatedDocumentCount:
              1,
          });

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockReturnValue(
            executionSummary,
          );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        expect(result).toBe(
          executionSummary,
        );

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.operations,
          ),
        ).toBe(true);

        expect(
          () => {
            result.operations.push(
              {},
            );
          },
        ).toThrow();
      },
    );

    test(
      "propagates planner failures without invoking the executor",
      () => {
        const repositoryRoot =
          createFixture();

        const plannerFailure =
          new Error(
            "Planner integration failure.",
          );

        planAuthoritativeSynchronizationMock
          .mockImplementation(
            () => {
              throw plannerFailure;
            },
          );

        expect(
          () =>
            synchronizeAuthoritativeGovernance({
              repositoryRoot,
              governanceModePath,
              delegationsPath,
            }),
        ).toThrow(
          plannerFailure,
        );

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "propagates executor rollback failures unchanged",
      () => {
        const repositoryRoot =
          createFixture();

        const plan =
          createPlan();

        const rollbackFailure =
          new Error(
            "Authoritative synchronization failed and rollback was performed.",
          );

        planAuthoritativeSynchronizationMock
          .mockReturnValue(
            plan,
          );

        executeAuthoritativeSynchronizationPlanMock
          .mockImplementation(
            () => {
              throw rollbackFailure;
            },
          );

        expect(
          () =>
            synchronizeAuthoritativeGovernance({
              repositoryRoot,
              governanceModePath,
              delegationsPath,
            }),
        ).toThrow(
          rollbackFailure,
        );

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          plan,
        });
      },
    );

    test.each([
      [
        "repositoryRoot",
        {
          repositoryRoot: "",
        },
        "repositoryRoot must be a non-empty string",
      ],
      [
        "governanceModePath",
        {
          governanceModePath:
            "   ",
        },
        "governanceModePath must be a non-empty string",
      ],
      [
        "delegationsPath",
        {
          delegationsPath:
            null,
        },
        "delegationsPath must be a non-empty string",
      ],
    ])(
      "rejects an invalid %s before invoking the planner",
      (
        _field,
        options,
        expectedMessage,
      ) => {
        expect(
          () =>
            synchronizeAuthoritativeGovernance(
              options,
            ),
        ).toThrow(
          expectedMessage,
        );

        expect(
          planAuthoritativeSynchronizationMock,
        ).not.toHaveBeenCalled();

        expect(
          executeAuthoritativeSynchronizationPlanMock,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
