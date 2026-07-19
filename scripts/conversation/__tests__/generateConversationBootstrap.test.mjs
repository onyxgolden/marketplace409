import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  generateConversationBootstrap,
  renderChatBootstrap,
  renderConversationBootstrap,
} from "../generateConversationBootstrap.mjs";

function createConversationPreparation({
  warnings = [],
  authoritativeRecommendation,
} = {}) {
  const promptRecommendations = {
    schemaVersion: "1.0",

    generatedAt:
      "2026-07-17T18:30:00.000Z",

    readiness: {
      readyToContinue:
        warnings.length === 0,

      warningCount:
        warnings.length,
    },

    warnings,
  };

  if (
    authoritativeRecommendation !==
    undefined
  ) {
    promptRecommendations
      .authoritativeRecommendation =
      authoritativeRecommendation;
  }

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
      "",
      "Current objective",
      "Build a chat-ready conversation package.",
    ].join("\n"),

    contextCompression: {
      schemaVersion: "1.0",

      generatedAt:
        "2026-07-17T18:30:00.000Z",

      repositoryToken:
        "main|7247e47|7247e47|aligned|clean",

      attention: {
        required:
          warnings.length > 0,

        flags:
          warnings.map(
            (warning) =>
              warning.code,
          ),
      },
    },

    promptRecommendations,
  };
}

describe(
  "renderChatBootstrap",
  () => {
    it(
      "renders a paste-ready new conversation package",
      () => {
        const conversationPreparation =
          createConversationPreparation({
            authoritativeRecommendation: {
              code:
                "continue-phase",

              summary:
                "Continue Phase 15.8 implementation.",
            },
          });

        const result =
          renderChatBootstrap(
            conversationPreparation,
          );

        expect(result).toContain(
          "FORGE NEW CONVERSATION PACKAGE",
        );

        expect(result).toContain(
          "Purpose",
        );

        expect(result).toContain(
          "Continue FORGE development from the live repository and governance state captured below.",
        );

        expect(result).toContain(
          "Authoritative Bootstrap",
        );

        expect(result).toContain(
          conversationPreparation
            .bootstrapPrompt,
        );

        expect(result).toContain(
          "Recommended First Action",
        );

        expect(result).toContain(
          "Code: continue-phase",
        );

        expect(result).toContain(
          "Continue Phase 15.8 implementation.",
        );

        expect(result).toContain(
          "Compressed Machine Context",
        );

        expect(result).toContain(
          '"repositoryToken": "main|7247e47|7247e47|aligned|clean"',
        );

        expect(result).toContain(
          "Prompt Guidance",
        );

        expect(result).toContain(
          '"readyToContinue": true',
        );

        expect(result).toContain(
          "First Response Requirement",
        );
      },
    );

    it(
      "includes the required continuation instructions",
      () => {
        const result =
          renderChatBootstrap(
            createConversationPreparation(),
          );

        expect(result).toContain(
          "Continuation Instructions",
        );

        expect(result).toContain(
          "- Inspect current repository files before recommending edits.",
        );

        expect(result).toContain(
          "- Preserve unrelated modified and untracked work.",
        );

        expect(result).toContain(
          "- Run focused validation before broader subsystem validation.",
        );

        expect(result).toContain(
          "- Do not commit until the active phase is fully validated.",
        );
      },
    );

    it(
      "renders warning messages when warnings are present",
      () => {
        const result =
          renderChatBootstrap(
            createConversationPreparation({
              warnings: [
                {
                  code:
                    "dirty-working-tree",

                  message:
                    "Preserve and classify existing work before editing.",
                },

                {
                  code:
                    "validation-not-passing",

                  message:
                    "Run the appropriate validation before committing.",
                },
              ],
            }),
          );

        expect(result).toContain(
          "Warnings",
        );

        expect(result).toContain(
          "- Preserve and classify existing work before editing.",
        );

        expect(result).toContain(
          "- Run the appropriate validation before committing.",
        );

        expect(result).toContain(
          '"warningCount": 2',
        );
      },
    );

    it(
      "renders a no-warning message when warnings are absent",
      () => {
        const result =
          renderChatBootstrap(
            createConversationPreparation(),
          );

        expect(result).toContain(
          [
            "Warnings",
            "None recorded.",
          ].join("\n"),
        );
      },
    );

    it(
      "uses fallback recommendation text when no authoritative recommendation exists",
      () => {
        const result =
          renderChatBootstrap(
            createConversationPreparation(),
          );

        expect(result).toContain(
          "Recommended First Action",
        );

        expect(result).toContain(
          "Review the supplied FORGE bootstrap and continue from the recorded objective.",
        );
      },
    );

    it(
      "uses normalized fallback recommendation fields when recommendation values are invalid",
      () => {
        const result =
          renderChatBootstrap(
            createConversationPreparation({
              authoritativeRecommendation: {
                code: "",

                summary: "",
              },
            }),
          );

        expect(result).toContain(
          "Code: review-bootstrap",
        );

        expect(result).toContain(
          "Review the supplied FORGE bootstrap before continuing implementation.",
        );
      },
    );

    it(
      "produces deterministic output for identical preparation values",
      () => {
        const first =
          renderChatBootstrap(
            createConversationPreparation({
              authoritativeRecommendation: {
                code:
                  "continue-phase",

                summary:
                  "Continue Phase 15.8 implementation.",
              },
            }),
          );

        const second =
          renderChatBootstrap(
            createConversationPreparation({
              authoritativeRecommendation: {
                code:
                  "continue-phase",

                summary:
                  "Continue Phase 15.8 implementation.",
              },
            }),
          );

        expect(second).toBe(first);
      },
    );

    it(
      "rejects invalid conversation preparation values",
      () => {
        expect(
          () =>
            renderChatBootstrap(
              null,
            ),
        ).toThrow(
          "conversationPreparation must be an object",
        );

        expect(
          () =>
            renderChatBootstrap({
              bootstrapPrompt: "",
              contextCompression: {},
              promptRecommendations: {},
            }),
        ).toThrow(
          "conversationPreparation.bootstrapPrompt must be a non-empty string",
        );

        expect(
          () =>
            renderChatBootstrap({
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
            renderChatBootstrap({
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
  "renderConversationBootstrap",
  () => {
    it(
      "renders the chat-ready package and full structured sections",
      () => {
        const conversationPreparation =
          createConversationPreparation({
            authoritativeRecommendation: {
              code:
                "continue-phase",

              summary:
                "Continue Phase 15.8 implementation.",
            },
          });

        const result =
          renderConversationBootstrap(
            conversationPreparation,
          );

        expect(result).toContain(
          "FORGE Chat-Ready Conversation Package",
        );

        expect(result).toContain(
          "FORGE NEW CONVERSATION PACKAGE",
        );

        expect(result).toContain(
          "Full Conversation Bootstrap",
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
          createConversationPreparation({
            authoritativeRecommendation: {
              code:
                "continue-phase",

              summary:
                "Continue Phase 15.8 implementation.",
            },
          });

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
      "reuses an engineering session conversation package without rerunning conversation preparation",
      () => {
        const conversationPreparation =
          createConversationPreparation({
            authoritativeRecommendation: {
              code:
                "continue-phase",

              summary:
                "Continue Phase 15.15 implementation.",
            },
          });

        const runConversationPreparationFn =
          vi.fn();

        const writeOutputFn =
          vi.fn();

        const engineeringSession = {
          conversation:
            conversationPreparation,
        };

        const result =
          generateConversationBootstrap({
            engineeringSession,
            runConversationPreparationFn,
            writeOutputFn,
          });

        expect(
          runConversationPreparationFn,
        ).not.toHaveBeenCalled();

        expect(
          writeOutputFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          writeOutputFn,
        ).toHaveBeenCalledWith(
          result,
        );

        expect(
          result,
        ).toBe(
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
