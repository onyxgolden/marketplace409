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
    enforce:
      vi.fn(() => ({
        valid:
          true,
      })),
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
  enforce,
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

expect(
  enforce,
).not.toHaveBeenCalled();

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
          enforce,
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        runGovernancePipeline({
          mode:
            "shadow",
          validationEvidencePath:
            "governance/validation/test-evidence.json",
          enforce,
          runShadowPipeline,
          synchronizeAuthoritative,
        });

        expect(
          enforce,
        ).toHaveBeenCalledTimes(1);

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

        const enforce =
          vi.fn(() => {
            executionOrder.push(
              "enforce",
            );

            return {
              valid:
                true,
            };
          });

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
            validationEvidencePath:
              "governance/validation/test-evidence.json",
            enforce,
            runShadowPipeline,
            synchronizeAuthoritative,
          });

        expect(
          executionOrder,
        ).toEqual([
          "enforce",
          "shadow",
          "authoritative",
        ]);

        expect(
          enforce,
        ).toHaveBeenCalledTimes(1);

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
          enforce,
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
            validationEvidencePath:
              "governance/validation/test-evidence.json",
            enforce,
            runShadowPipeline,
            synchronizeAuthoritative,
          });

        expect(
          enforce,
        ).toHaveBeenCalledTimes(1);

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
      "threads reviewedMetadataPath from the pipeline call through to the shadow pipeline",
      () => {
        const {
          enforce,
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        runGovernancePipeline({
          mode:
            "shadow",
          validationEvidencePath:
            "governance/validation/test-evidence.json",
          reviewedMetadataPath:
            "/tmp/reviewed-metadata.json",
          enforce,
          runShadowPipeline,
          synchronizeAuthoritative,
        });

        expect(
          runShadowPipeline,
        ).toHaveBeenCalledWith({
          reviewedMetadataPath:
            "/tmp/reviewed-metadata.json",
        });
      },
    );

    test(
      "defaults reviewedMetadataPath to null when not supplied",
      () => {
        const {
          enforce,
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        runGovernancePipeline({
          mode:
            "shadow",
          validationEvidencePath:
            "governance/validation/test-evidence.json",
          enforce,
          runShadowPipeline,
          synchronizeAuthoritative,
        });

        expect(
          runShadowPipeline,
        ).toHaveBeenCalledWith({
          reviewedMetadataPath:
            null,
        });
      },
    );

    test(
      "propagates shadow pipeline failures without attempting authoritative synchronization",
      () => {
        const {
          enforce,
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
              validationEvidencePath:
                "governance/validation/test-evidence.json",
              enforce,
              runShadowPipeline,
              synchronizeAuthoritative,
            }),
        ).toThrow(
          shadowFailure,
        );

        expect(
          enforce,
        ).toHaveBeenCalledTimes(1);

        expect(
          synchronizeAuthoritative,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "propagates authoritative synchronization failures",
      () => {
        const {
          enforce,
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
              validationEvidencePath:
                "governance/validation/test-evidence.json",
              enforce,
              runShadowPipeline,
              synchronizeAuthoritative,
            }),
        ).toThrow(
          authoritativeFailure,
        );

        expect(
          enforce,
        ).toHaveBeenCalledTimes(1);

        expect(
          runShadowPipeline,
        ).toHaveBeenCalledTimes(1);

        expect(
          synchronizeAuthoritative,
        ).toHaveBeenCalledTimes(1);
      },
    );

    test(
      "propagates enforcement failures without running either pipeline",
      () => {
        const {
          enforce,
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createPipelineDependencies();

        const enforcementFailure =
          new Error(
            "Governance enforcement failed.",
          );

        enforce.mockImplementation(
          () => {
            throw enforcementFailure;
          },
        );

        expect(
          () =>
            runGovernancePipeline({
              mode:
                "hybrid",
              validationEvidencePath:
                "governance/validation/test-evidence.json",
              enforce,
              runShadowPipeline,
              synchronizeAuthoritative,
            }),
        ).toThrow(
          enforcementFailure,
        );

        expect(
          enforce,
        ).toHaveBeenCalledTimes(1);

        expect(
          runShadowPipeline,
        ).not.toHaveBeenCalled();

        expect(
          synchronizeAuthoritative,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "rejects unsupported modes before running either pipeline",
      () => {
        const {
          enforce,
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
              enforce,
              runShadowPipeline,
              synchronizeAuthoritative,
            }),
        ).toThrow(
          "Unsupported governance mode: unsafe",
        );

        expect(
          enforce,
        ).not.toHaveBeenCalled();

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
        "enforce",
        {
          enforce:
            null,
        },
        "enforce must be a function",
      ],
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
