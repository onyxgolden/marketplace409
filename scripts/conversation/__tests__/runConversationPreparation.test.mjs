import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  runConversationPreparation,
} from "../runConversationPreparation.mjs";

function createConversationState() {
  return {
    schemaVersion: "1.0",

    generatedAt:
      "2026-07-17T18:30:00.000Z",

    repository: {
      branch: "main",
    },
  };
}

function createRepositorySummary() {
  return {
    schemaVersion: "1.0",

    generatedAt:
      "2026-07-17T18:30:00.000Z",

    repository: {
      branch: "main",
    },
  };
}

describe(
  "runConversationPreparation",
  () => {
    it(
      "composes the conversation builders in deterministic dependency order",
      () => {
        const conversationState =
          createConversationState();

        const repositorySummary =
          createRepositorySummary();

        const bootstrapPrompt =
          "FORGE BOOTSTRAP";

        const contextCompression = {
          repositoryToken:
            "main|abc1234",
        };

        const promptRecommendations = {
          readiness: {
            readyToContinue: true,
          },
        };

        const conversationStateOptions = {
          repositoryRoot:
            "/repository",
        };

        const buildConversationStateFn =
          vi.fn(
            () => conversationState,
          );

        const buildRepositorySummaryFn =
          vi.fn(
            () => repositorySummary,
          );

        const buildBootstrapPromptFn =
          vi.fn(
            () => bootstrapPrompt,
          );

        const buildContextCompressionFn =
          vi.fn(
            () => contextCompression,
          );

        const buildPromptRecommendationsFn =
          vi.fn(
            () => promptRecommendations,
          );

        const result =
          runConversationPreparation({
            conversationStateOptions,
            buildConversationStateFn,
            buildRepositorySummaryFn,
            buildBootstrapPromptFn,
            buildContextCompressionFn,
            buildPromptRecommendationsFn,
          });

        expect(
          buildConversationStateFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          buildConversationStateFn,
        ).toHaveBeenCalledWith(
          conversationStateOptions,
        );

        expect(
          buildRepositorySummaryFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          buildRepositorySummaryFn,
        ).toHaveBeenCalledWith(
          conversationState,
        );

        expect(
          buildBootstrapPromptFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          buildBootstrapPromptFn,
        ).toHaveBeenCalledWith(
          repositorySummary,
        );

        expect(
          buildContextCompressionFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          buildContextCompressionFn,
        ).toHaveBeenCalledWith(
          repositorySummary,
        );

        expect(
          buildPromptRecommendationsFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          buildPromptRecommendationsFn,
        ).toHaveBeenCalledWith(
          repositorySummary,
        );

        expect(result).toEqual({
          schemaVersion: "1.0",

          generatedAt:
            "2026-07-17T18:30:00.000Z",

          conversationState,
          repositorySummary,
          bootstrapPrompt,
          contextCompression,
          promptRecommendations,
        });
      },
    );

    it(
      "returns a deeply immutable conversation preparation object",
      () => {
        const conversationState = {
          schemaVersion: "1.0",

          generatedAt:
            "2026-07-17T18:30:00.000Z",

          repository: {
            branch: "main",
          },
        };

        const repositorySummary = {
          repository: {
            workingTree: {
              modifiedFiles: [],
            },
          },
        };

        const contextCompression = {
          attention: {
            flags: [],
          },
        };

        const promptRecommendations = {
          warnings: [],
        };

        const result =
          runConversationPreparation({
            buildConversationStateFn:
              () => conversationState,

            buildRepositorySummaryFn:
              () => repositorySummary,

            buildBootstrapPromptFn:
              () => "FORGE BOOTSTRAP",

            buildContextCompressionFn:
              () => contextCompression,

            buildPromptRecommendationsFn:
              () => promptRecommendations,
          });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.conversationState,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.conversationState
              .repository,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.repositorySummary
              .repository
              .workingTree
              .modifiedFiles,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.contextCompression
              .attention.flags,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.promptRecommendations
              .warnings,
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects non-function builder dependencies",
      () => {
        expect(
          () =>
            runConversationPreparation({
              buildConversationStateFn:
                null,
            }),
        ).toThrow(
          "buildConversationStateFn must be a function",
        );

        expect(
          () =>
            runConversationPreparation({
              buildRepositorySummaryFn:
                null,
            }),
        ).toThrow(
          "buildRepositorySummaryFn must be a function",
        );

        expect(
          () =>
            runConversationPreparation({
              buildBootstrapPromptFn:
                null,
            }),
        ).toThrow(
          "buildBootstrapPromptFn must be a function",
        );

        expect(
          () =>
            runConversationPreparation({
              buildContextCompressionFn:
                null,
            }),
        ).toThrow(
          "buildContextCompressionFn must be a function",
        );

        expect(
          () =>
            runConversationPreparation({
              buildPromptRecommendationsFn:
                null,
            }),
        ).toThrow(
          "buildPromptRecommendationsFn must be a function",
        );
      },
    );

    it(
      "produces deterministic output for identical builder results",
      () => {
        const createDependencies =
          () => ({
            buildConversationStateFn:
              () => ({
                schemaVersion: "1.0",

                generatedAt:
                  "2026-07-17T18:30:00.000Z",

                repository: {
                  branch: "main",
                },
              }),

            buildRepositorySummaryFn:
              () => ({
                schemaVersion: "1.0",

                generatedAt:
                  "2026-07-17T18:30:00.000Z",

                repository: {
                  branch: "main",
                },
              }),

            buildBootstrapPromptFn:
              () => "FORGE BOOTSTRAP",

            buildContextCompressionFn:
              () => ({
                repositoryToken:
                  "main|abc1234",
              }),

            buildPromptRecommendationsFn:
              () => ({
                warnings: [],
              }),
          });

        const first =
          runConversationPreparation(
            createDependencies(),
          );

        const second =
          runConversationPreparation(
            createDependencies(),
          );

        expect(second).toEqual(first);
      },
    );

    it(
      "does not mutate supplied conversation state options",
      () => {
        const conversationStateOptions = {
          repositoryRoot:
            "/repository",

          custom: {
            value: "preserve",
          },
        };

        const original =
          structuredClone(
            conversationStateOptions,
          );

        runConversationPreparation({
          conversationStateOptions,

          buildConversationStateFn:
            () => ({
              generatedAt:
                "2026-07-17T18:30:00.000Z",
            }),

          buildRepositorySummaryFn:
            () => ({}),

          buildBootstrapPromptFn:
            () => "",

          buildContextCompressionFn:
            () => ({}),

          buildPromptRecommendationsFn:
            () => ({}),
        });

        expect(
          conversationStateOptions,
        ).toEqual(original);
      },
    );

    it(
      "forwards engineering state without mutating conversation state options",
      () => {
        const conversationStateOptions = {
          repositoryRoot:
            "/repository",

          custom: {
            value: "preserve",
          },
        };

        const originalOptions =
          structuredClone(
            conversationStateOptions,
          );

        const engineeringState = {
          repository: {
            branch: "main",
            head: "abc123",
            originMain: "abc123",
            headMatchesOriginMain: true,
            workingTreeClean: true,
            modifiedFiles: [],
            gitStatus: [],
          },
        };

        const buildConversationStateFn =
          vi.fn(
            () => ({
              generatedAt:
                "2026-07-17T18:30:00.000Z",
            }),
          );

        runConversationPreparation({
          conversationStateOptions,
          engineeringState,
          buildConversationStateFn,

          buildRepositorySummaryFn:
            () => ({}),

          buildBootstrapPromptFn:
            () => "",

          buildContextCompressionFn:
            () => ({}),

          buildPromptRecommendationsFn:
            () => ({}),
        });

        expect(
          buildConversationStateFn,
        ).toHaveBeenCalledWith({
          ...conversationStateOptions,
          engineeringState,
        });

        expect(
          conversationStateOptions,
        ).toEqual(originalOptions);
      },
    );
  },
);
