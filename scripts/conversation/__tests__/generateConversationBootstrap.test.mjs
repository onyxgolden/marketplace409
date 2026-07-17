import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  generateConversationBootstrap,
  renderConversationBootstrap,
} from "../generateConversationBootstrap.mjs";

function createConversationPreparation() {
  return {
    schemaVersion: "1.0",

    generatedAt:
      "2026-07-17T18:30:00.000Z",

    bootstrapPrompt: [
      "FORGE BOOTSTRAP",
      "",
      "Repository",
      "~/USMarketplace/marketplace409",
      "",
      "Branch",
      "main",
    ].join("\n"),

    contextCompression: {
      schemaVersion: "1.0",

      generatedAt:
        "2026-07-17T18:30:00.000Z",

      repositoryToken:
        "main|7247e47|7247e47|aligned|clean",

      attention: {
        required: false,
        flags: [],
      },
    },

    promptRecommendations: {
      schemaVersion: "1.0",

      generatedAt:
        "2026-07-17T18:30:00.000Z",

      readiness: {
        readyToContinue: true,
        warningCount: 0,
      },

      warnings: [],
    },
  };
}

describe(
  "renderConversationBootstrap",
  () => {
    it(
      "renders the bootstrap prompt and structured conversation sections",
      () => {
        const conversationPreparation =
          createConversationPreparation();

        const result =
          renderConversationBootstrap(
            conversationPreparation,
          );

        expect(result).toContain(
          "FORGE Conversation Bootstrap",
        );

        expect(result).toContain(
          conversationPreparation
            .bootstrapPrompt,
        );

        expect(result).toContain(
          "Context Compression",
        );

        expect(result).toContain(
          '"repositoryToken": "main|7247e47|7247e47|aligned|clean"',
        );

        expect(result).toContain(
          "Prompt Recommendations",
        );

        expect(result).toContain(
          '"readyToContinue": true',
        );
      },
    );

    it(
      "produces deterministic output for identical preparation values",
      () => {
        const first =
          renderConversationBootstrap(
            createConversationPreparation(),
          );

        const second =
          renderConversationBootstrap(
            createConversationPreparation(),
          );

        expect(second).toBe(first);
      },
    );

    it(
      "rejects invalid conversation preparation values",
      () => {
        expect(
          () =>
            renderConversationBootstrap(
              null,
            ),
        ).toThrow(
          "conversationPreparation must be an object",
        );

        expect(
          () =>
            renderConversationBootstrap({
              bootstrapPrompt: "",
              contextCompression: {},
              promptRecommendations: {},
            }),
        ).toThrow(
          "conversationPreparation.bootstrapPrompt must be a non-empty string",
        );

        expect(
          () =>
            renderConversationBootstrap({
              bootstrapPrompt:
                "FORGE BOOTSTRAP",

              contextCompression:
                null,

              promptRecommendations: {},
            }),
        ).toThrow(
          "conversationPreparation.contextCompression must be an object",
        );

        expect(
          () =>
            renderConversationBootstrap({
              bootstrapPrompt:
                "FORGE BOOTSTRAP",

              contextCompression: {},

              promptRecommendations:
                null,
            }),
        ).toThrow(
          "conversationPreparation.promptRecommendations must be an object",
        );
      },
    );
  },
);

describe(
  "generateConversationBootstrap",
  () => {
    it(
      "runs conversation preparation, writes the rendered output, and returns it",
      () => {
        const conversationPreparation =
          createConversationPreparation();

        const conversationPreparationOptions = {
          conversationStateOptions: {
            repositoryRoot:
              "/repository",
          },
        };

        const runConversationPreparationFn =
          vi.fn(
            () =>
              conversationPreparation,
          );

        const writeOutputFn =
          vi.fn();

        const result =
          generateConversationBootstrap({
            conversationPreparationOptions,
            runConversationPreparationFn,
            writeOutputFn,
          });

        expect(
          runConversationPreparationFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          runConversationPreparationFn,
        ).toHaveBeenCalledWith(
          conversationPreparationOptions,
        );

        expect(
          writeOutputFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          writeOutputFn,
        ).toHaveBeenCalledWith(
          result,
        );

        expect(result).toBe(
          renderConversationBootstrap(
            conversationPreparation,
          ),
        );
      },
    );

    it(
      "rejects invalid generator dependencies and options",
      () => {
        expect(
          () =>
            generateConversationBootstrap({
              conversationPreparationOptions:
                null,
            }),
        ).toThrow(
          "conversationPreparationOptions must be an object",
        );

        expect(
          () =>
            generateConversationBootstrap({
              runConversationPreparationFn:
                null,
            }),
        ).toThrow(
          "runConversationPreparationFn must be a function",
        );

        expect(
          () =>
            generateConversationBootstrap({
              writeOutputFn:
                null,
            }),
        ).toThrow(
          "writeOutputFn must be a function",
        );
      },
    );

    it(
      "does not mutate supplied generator options",
      () => {
        const conversationPreparationOptions = {
          conversationStateOptions: {
            repositoryRoot:
              "/repository",

            custom: {
              value: "preserve",
            },
          },
        };

        const original =
          structuredClone(
            conversationPreparationOptions,
          );

        generateConversationBootstrap({
          conversationPreparationOptions,

          runConversationPreparationFn:
            () =>
              createConversationPreparation(),

          writeOutputFn:
            () => {},
        });

        expect(
          conversationPreparationOptions,
        ).toEqual(original);
      },
    );
  },
);
