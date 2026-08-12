import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  dispatchGovernanceMode,
} from "../dispatchGovernanceMode.mjs";

afterEach(() => {
  vi.restoreAllMocks();
});

function createDependencies() {
  return {
    runShadowPipeline:
      vi.fn(),
    synchronizeAuthoritative:
      vi.fn(),
  };
}

describe(
  "dispatchGovernanceMode",
  () => {
    test(
      "dispatches shadow mode only to the shadow pipeline",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createDependencies();

        const shadowResult = {
          status:
            "completed",
        };

        runShadowPipeline
          .mockReturnValue(
            shadowResult,
          );

        const result =
          dispatchGovernanceMode({
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

        expect(result).toBe(
          shadowResult,
        );
      },
    );

    test(
      "dispatches locked mode without running either pipeline",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createDependencies();

        const logSpy =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => {},
          );

        const result =
          dispatchGovernanceMode({
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
          "Governance pipeline is locked. No snapshots, state, or governance documents were written.",
        );
      },
    );

    test(
      "dispatches hybrid mode in shadow then authoritative order",
      () => {
        const executionOrder = [];

        const runShadowPipeline =
          vi.fn(() => {
            executionOrder.push(
              "shadow",
            );
          });

        const authoritativeResult = {
          status:
            "synchronized",
        };

        const synchronizeAuthoritative =
          vi.fn((options) => {
            executionOrder.push(
              "authoritative",
            );

            expect(options).toEqual({
              mode:
                "hybrid",
            });

            return authoritativeResult;
          });

        const result =
          dispatchGovernanceMode({
            mode:
              "hybrid",
            runShadowPipeline,
            synchronizeAuthoritative,
          });

        expect(executionOrder).toEqual([
          "shadow",
          "authoritative",
        ]);

        expect(result).toBe(
          authoritativeResult,
        );
      },
    );

    test(
      "stops hybrid dispatch when the shadow pipeline fails",
      () => {
        const shadowFailure =
          new Error(
            "Shadow governance failed.",
          );

        const runShadowPipeline =
          vi.fn(() => {
            throw shadowFailure;
          });

        const synchronizeAuthoritative =
          vi.fn();

        expect(
          () =>
            dispatchGovernanceMode({
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
      "propagates hybrid authoritative failures",
      () => {
        const authoritativeFailure =
          new Error(
            "Authoritative governance failed.",
          );

        const runShadowPipeline =
          vi.fn();

        const synchronizeAuthoritative =
          vi.fn(() => {
            throw authoritativeFailure;
          });

        expect(
          () =>
            dispatchGovernanceMode({
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
      "dispatches authoritative mode without running shadow",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createDependencies();

        const authoritativeResult = {
          status:
            "synchronized",
        };

        synchronizeAuthoritative
          .mockReturnValue(
            authoritativeResult,
          );

        const result =
          dispatchGovernanceMode({
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
        ).toHaveBeenCalledWith({
          mode:
            "authoritative",
        });

        expect(result).toBe(
          authoritativeResult,
        );
      },
    );

    test(
      "threads reviewedMetadataPath into the shadow pipeline",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createDependencies();

        dispatchGovernanceMode({
          mode:
            "shadow",
          runShadowPipeline,
          synchronizeAuthoritative,
          reviewedMetadataPath:
            "/tmp/reviewed-metadata.json",
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
      "defaults reviewedMetadataPath to null for the shadow pipeline when not supplied",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createDependencies();

        dispatchGovernanceMode({
          mode:
            "shadow",
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
      "threads reviewedMetadataPath into the shadow pipeline during hybrid dispatch",
      () => {
        const runShadowPipeline =
          vi.fn();

        const synchronizeAuthoritative =
          vi.fn(() => ({
            status: "synchronized",
          }));

        dispatchGovernanceMode({
          mode:
            "hybrid",
          runShadowPipeline,
          synchronizeAuthoritative,
          reviewedMetadataPath:
            "/tmp/reviewed-metadata.json",
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
      "rejects unsupported governance modes",
      () => {
        const {
          runShadowPipeline,
          synchronizeAuthoritative,
        } =
          createDependencies();

        expect(
          () =>
            dispatchGovernanceMode({
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
  },
);
