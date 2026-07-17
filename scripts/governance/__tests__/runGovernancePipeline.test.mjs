import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  runGovernancePipeline,
} from "../runGovernancePipeline.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function createPipelineDependencies() {
  return {
    runShadowPipeline:
      vi.fn(),
    synchronizeAuthoritative:
      vi.fn(() => ({
        mode:
          "hybrid",
        status:
          "no-op",
        operationCount:
          0,
        updateCount:
          0,
        synchronizedCount:
          0,
        skippedCount:
          0,
        documentCount:
          0,
        updatedDocumentCount:
          0,
        verificationPassed:
          true,
        rollbackPerformed:
          false,
        documents: [],
        operations: [],
        skippedSections: [],
      })),
  };
}

describe(
  "runGovernancePipeline",
  () => {
    test(
      "locked mode exits without running either synchronization pipeline",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        const logSpy =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => {},
          );

        const result =
          runGovernancePipeline({
            mode:
              "locked",
            runShadowPipeline,
            synchronizeAuthoritative,
          });

        expect(result).toBeUndefined();

        expect(
          runShadowPipeline,
        ).not.toHaveBeenCalled();

        expect(
          synchronizeAuthoritative,
        ).not.toHaveBeenCalled();

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "FORGE governance mode: locked",
        );

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "Governance pipeline is locked. No snapshots, state, or governance documents were written.",
        );
      },
    );

    test(
      "shadow mode runs only the shadow governance pipeline",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        runGovernancePipeline({
          mode:
            "shadow",
          runShadowPipeline,
          synchronizeAuthoritative,
        });

        expect(
          runShadowPipeline,
        ).toHaveBeenCalledTimes(1);

        expect(
          synchronizeAuthoritative,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "hybrid mode runs shadow synchronization before delegated authoritative synchronization",
      () => {
        const executionOrder = [];

        const runShadowPipeline =
          vi.fn(() => {
            executionOrder.push(
              "shadow",
            );
          });

        const authoritativeResult = {
          mode:
            "hybrid",
          status:
            "synchronized",
          operationCount:
            1,
          updateCount:
            1,
          synchronizedCount:
            0,
          skippedCount:
            0,
          documentCount:
            1,
          updatedDocumentCount:
            1,
          verificationPassed:
            true,
          rollbackPerformed:
            false,
          documents: [],
          operations: [],
          skippedSections: [],
        };

        const synchronizeAuthoritative =
          vi.fn(() => {
            executionOrder.push(
              "authoritative",
            );

            return authoritativeResult;
          });

        const result =
          runGovernancePipeline({
            mode:
              "hybrid",
            runShadowPipeline,
            synchronizeAuthoritative,
          });

        expect(
          executionOrder,
        ).toEqual([
          "shadow",
          "authoritative",
        ]);

        expect(
          runShadowPipeline,
        ).toHaveBeenCalledTimes(1);

        expect(
          synchronizeAuthoritative,
        ).toHaveBeenCalledTimes(1);

        expect(result).toBe(
          authoritativeResult,
        );
      },
    );

    test(
      "authoritative mode runs authoritative synchronization without running shadow synchronization",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        const authoritativeResult = {
          mode:
            "authoritative",
          status:
            "synchronized",
          operationCount:
            1,
          updateCount:
            1,
          synchronizedCount:
            0,
          skippedCount:
            0,
          documentCount:
            1,
          updatedDocumentCount:
            1,
          verificationPassed:
            true,
          rollbackPerformed:
            false,
          documents: [],
          operations: [],
          skippedSections: [],
        };

        synchronizeAuthoritative
          .mockReturnValue(
            authoritativeResult,
          );

        const result =
          runGovernancePipeline({
            mode:
              "authoritative",
            runShadowPipeline,
            synchronizeAuthoritative,
          });

        expect(
          runShadowPipeline,
        ).not.toHaveBeenCalled();

        expect(
          synchronizeAuthoritative,
        ).toHaveBeenCalledTimes(1);

        expect(result).toBe(
          authoritativeResult,
        );
      },
    );

    test(
      "propagates shadow pipeline failures without attempting authoritative synchronization",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        const shadowFailure =
          new Error(
            "Shadow governance pipeline failed.",
          );

        runShadowPipeline
          .mockImplementation(
            () => {
              throw shadowFailure;
            },
          );

        expect(
          () =>
            runGovernancePipeline({
              mode:
                "hybrid",
              runShadowPipeline,
              synchronizeAuthoritative,
            }),
        ).toThrow(
          shadowFailure,
        );

        expect(
          synchronizeAuthoritative,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "propagates authoritative synchronization failures",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        const authoritativeFailure =
          new Error(
            "Authoritative synchronization failed.",
          );

        synchronizeAuthoritative
          .mockImplementation(
            () => {
              throw authoritativeFailure;
            },
          );

        expect(
          () =>
            runGovernancePipeline({
              mode:
                "hybrid",
              runShadowPipeline,
              synchronizeAuthoritative,
            }),
        ).toThrow(
          authoritativeFailure,
        );

        expect(
          runShadowPipeline,
        ).toHaveBeenCalledTimes(1);

        expect(
          synchronizeAuthoritative,
        ).toHaveBeenCalledTimes(1);
      },
    );

    test(
      "rejects unsupported modes before running either pipeline",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        vi.spyOn(
          console,
          "log",
        ).mockImplementation(
          () => {},
        );

        expect(
          () =>
            runGovernancePipeline({
              mode:
                "unsafe",
              runShadowPipeline,
              synchronizeAuthoritative,
            }),
        ).toThrow(
          "Unsupported governance mode: unsafe",
        );

        expect(
          runShadowPipeline,
        ).not.toHaveBeenCalled();

        expect(
          synchronizeAuthoritative,
        ).not.toHaveBeenCalled();
      },
    );

    test.each([
      [
        "runShadowPipeline",
        {
          runShadowPipeline:
            null,
        },
        "runShadowPipeline must be a function",
      ],
      [
        "synchronizeAuthoritative",
        {
          synchronizeAuthoritative:
            "invalid",
        },
        "synchronizeAuthoritative must be a function",
      ],
    ])(
      "rejects an invalid %s dependency",
      (
        _dependencyName,
        dependencyOverrides,
        expectedMessage,
      ) => {
        const dependencies =
          createPipelineDependencies();

        expect(
          () =>
            runGovernancePipeline({
              mode:
                "locked",
              ...dependencies,
              ...dependencyOverrides,
            }),
        ).toThrow(
          expectedMessage,
        );
      },
    );
  },
);
