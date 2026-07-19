import {
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  ENGINEERING_CONVERSATION_SESSION_ORDER,
  ENGINEERING_CONVERSATION_SESSION_VERSION,
  runEngineeringConversationSession,
} from "../runEngineeringConversationSession.mjs";

function createEngineeringSession() {
  return {
    version:
      "1.0",

    status:
      "completed",

    conversation: {
      bootstrapPrompt:
        "FORGE bootstrap",

      contextCompression: {
        repositoryToken:
          "main|abc123",
      },

      promptRecommendations: {
        warnings: [],
      },
    },
  };
}

describe(
  "runEngineeringConversationSession",
  () => {
    test(
      "executes the canonical stages in deterministic order",
      () => {
        const executionOrder = [];

        const engineeringSession =
          createEngineeringSession();

        const runEngineeringSessionFn =
          vi.fn(
            () => {
              executionOrder.push(
                "engineeringSession",
              );

              return engineeringSession;
            },
          );

        const generateConversationBootstrapFn =
          vi.fn(
            ({
              engineeringSession:
                suppliedEngineeringSession,
            }) => {
              executionOrder.push(
                "conversationBootstrap",
              );

              expect(
                suppliedEngineeringSession,
              ).toBe(
                engineeringSession,
              );

              return "Rendered bootstrap";
            },
          );

        const result =
          runEngineeringConversationSession({
            runEngineeringSessionFn,
            generateConversationBootstrapFn,
          });

        expect(
          executionOrder,
        ).toEqual(
          ENGINEERING_CONVERSATION_SESSION_ORDER,
        );

        expect(
          result.executionOrder,
        ).toEqual(
          ENGINEERING_CONVERSATION_SESSION_ORDER,
        );

        expect(
          result.version,
        ).toBe(
          ENGINEERING_CONVERSATION_SESSION_VERSION,
        );

        expect(
          result.status,
        ).toBe(
          "completed",
        );

        expect(
          result.engineeringSession,
        ).toBe(
          engineeringSession,
        );

        expect(
          result.renderedBootstrap,
        ).toBe(
          "Rendered bootstrap",
        );
      },
    );

    test(
      "passes options and the engineering session to dependencies",
      () => {
        const engineeringSession =
          createEngineeringSession();

        const engineeringSessionOptions = {
          repositoryRoot:
            "/tmp/forge-repository",

          governancePipelineOptions: {
            mode:
              "shadow",
          },
        };

        const conversationBootstrapOptions = {
          conversationPreparationOptions: {
            custom:
              "preserve",
          },
        };

        const writeOutputFn =
          vi.fn();

        const runEngineeringSessionFn =
          vi.fn(
            () => engineeringSession,
          );

        const generateConversationBootstrapFn =
          vi.fn(
            () => "Rendered bootstrap",
          );

        runEngineeringConversationSession({
          engineeringSessionOptions,
          conversationBootstrapOptions,
          runEngineeringSessionFn,
          generateConversationBootstrapFn,
          writeOutputFn,
        });

        expect(
          runEngineeringSessionFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          runEngineeringSessionFn,
        ).toHaveBeenCalledWith({
          ...engineeringSessionOptions,
        });

        expect(
          generateConversationBootstrapFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          generateConversationBootstrapFn,
        ).toHaveBeenCalledWith({
          ...conversationBootstrapOptions,
          engineeringSession,
          writeOutputFn,
        });
      },
    );

    test(
      "does not rerun conversation preparation",
      () => {
        const engineeringSession =
          createEngineeringSession();

        const runConversationPreparationFn =
          vi.fn();

        const generateConversationBootstrapFn =
          vi.fn(
            ({
              engineeringSession:
                suppliedEngineeringSession,
            }) => {
              expect(
                suppliedEngineeringSession
                  .conversation,
              ).toBe(
                engineeringSession
                  .conversation,
              );

              return "Rendered bootstrap";
            },
          );

        runEngineeringConversationSession({
          conversationBootstrapOptions: {
            runConversationPreparationFn,
          },

          runEngineeringSessionFn:
            () => engineeringSession,

          generateConversationBootstrapFn,
        });

        expect(
          runConversationPreparationFn,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "uses read-only output behavior by default",
      () => {
        const engineeringSession =
          createEngineeringSession();

        const generateConversationBootstrapFn =
          vi.fn(
            ({
              writeOutputFn,
            }) => {
              expect(
                typeof writeOutputFn,
              ).toBe(
                "function",
              );

              expect(
                writeOutputFn(
                  "ignored output",
                ),
              ).toBeUndefined();

              return "Rendered bootstrap";
            },
          );

        runEngineeringConversationSession({
          runEngineeringSessionFn:
            () => engineeringSession,

          generateConversationBootstrapFn,
        });
      },
    );

    test(
      "deeply freezes the combined result",
      () => {
        const engineeringSession =
          createEngineeringSession();

        const result =
          runEngineeringConversationSession({
            runEngineeringSessionFn:
              () => engineeringSession,

            generateConversationBootstrapFn:
              () => "Rendered bootstrap",
          });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.executionOrder,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.engineeringSession,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.engineeringSession
              .conversation,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.engineeringSession
              .conversation
              .contextCompression,
          ),
        ).toBe(true);
      },
    );

    test(
      "propagates engineering session failures and stops rendering",
      () => {
        const failure =
          new Error(
            "Engineering session failed.",
          );

        const generateConversationBootstrapFn =
          vi.fn();

        expect(
          () =>
            runEngineeringConversationSession({
              runEngineeringSessionFn:
                () => {
                  throw failure;
                },

              generateConversationBootstrapFn,
            }),
        ).toThrow(
          failure,
        );

        expect(
          generateConversationBootstrapFn,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "propagates bootstrap rendering failures",
      () => {
        const failure =
          new Error(
            "Bootstrap rendering failed.",
          );

        expect(
          () =>
            runEngineeringConversationSession({
              runEngineeringSessionFn:
                () =>
                  createEngineeringSession(),

              generateConversationBootstrapFn:
                () => {
                  throw failure;
                },
            }),
        ).toThrow(
          failure,
        );
      },
    );

    test.each([
      [
        "runEngineeringSessionFn",
        "runEngineeringSessionFn",
      ],
      [
        "generateConversationBootstrapFn",
        "generateConversationBootstrapFn",
      ],
      [
        "writeOutputFn",
        "writeOutputFn",
      ],
    ])(
      "rejects an invalid %s dependency",
      (
        dependencyName,
        expectedLabel,
      ) => {
        expect(
          () =>
            runEngineeringConversationSession({
              [dependencyName]:
                null,
            }),
        ).toThrow(
          `${expectedLabel} must be a function`,
        );
      },
    );

    test.each([
      [
        "engineeringSessionOptions",
        null,
        "engineeringSessionOptions",
      ],
      [
        "conversationBootstrapOptions",
        [],
        "conversationBootstrapOptions",
      ],
    ])(
      "rejects invalid %s",
      (
        optionName,
        optionValue,
        expectedLabel,
      ) => {
        expect(
          () =>
            runEngineeringConversationSession({
              [optionName]:
                optionValue,
            }),
        ).toThrow(
          `${expectedLabel} must be an object`,
        );
      },
    );

    test(
      "rejects an invalid engineering session result",
      () => {
        expect(
          () =>
            runEngineeringConversationSession({
              runEngineeringSessionFn:
                () => null,

              generateConversationBootstrapFn:
                vi.fn(),
            }),
        ).toThrow(
          "engineeringSession must be an object",
        );
      },
    );

    test.each([
      "",
      "   ",
      null,
      {},
    ])(
      "rejects invalid rendered bootstrap output",
      (
        renderedBootstrap,
      ) => {
        expect(
          () =>
            runEngineeringConversationSession({
              runEngineeringSessionFn:
                () =>
                  createEngineeringSession(),

              generateConversationBootstrapFn:
                () => renderedBootstrap,
            }),
        ).toThrow(
          "renderedBootstrap must be a non-empty string",
        );
      },
    );
  },
);
