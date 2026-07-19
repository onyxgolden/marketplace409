import path from "node:path";
import {
  pathToFileURL,
} from "node:url";

import {
  runConversationPreparation,
} from "./runConversationPreparation.mjs";

function assertPlainObject(
  value,
  location,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${location} must be an object`,
    );
  }
}

function assertNonEmptyString(
  value,
  location,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
    );
  }
}

function assertFunction(
  value,
  location,
) {
  if (typeof value !== "function") {
    throw new TypeError(
      `${location} must be a function`,
    );
  }
}

function validateConversationPreparation(
  conversationPreparation,
) {
  assertPlainObject(
    conversationPreparation,
    "conversationPreparation",
  );

  assertNonEmptyString(
    conversationPreparation
      .bootstrapPrompt,
    "conversationPreparation.bootstrapPrompt",
  );

  assertPlainObject(
    conversationPreparation
      .contextCompression,
    "conversationPreparation.contextCompression",
  );

  assertPlainObject(
    conversationPreparation
      .promptRecommendations,
    "conversationPreparation.promptRecommendations",
  );
}

function formatJson(value) {
  return JSON.stringify(
    value,
    null,
    2,
  );
}

function formatWarningSummary(
  promptRecommendations,
) {
  const warnings =
    promptRecommendations.warnings;

  if (
    !Array.isArray(warnings) ||
    warnings.length === 0
  ) {
    return [
      "Warnings",
      "None recorded.",
    ];
  }

  return [
    "Warnings",
    ...warnings.map(
      (warning) => {
        if (
          typeof warning === "object" &&
          warning !== null &&
          typeof warning.message ===
            "string"
        ) {
          return `- ${warning.message}`;
        }

        return `- ${String(warning)}`;
      },
    ),
  ];
}

function formatRecommendedAction(
  promptRecommendations,
) {
  const recommendation =
    promptRecommendations
      .authoritativeRecommendation;

  if (
    typeof recommendation !==
      "object" ||
    recommendation === null ||
    Array.isArray(recommendation)
  ) {
    return [
      "Recommended First Action",
      "Review the supplied FORGE bootstrap and continue from the recorded objective.",
    ];
  }

  const code =
    typeof recommendation.code ===
      "string" &&
    recommendation.code.trim().length >
      0
      ? recommendation.code
      : "review-bootstrap";

  const summary =
    typeof recommendation.summary ===
      "string" &&
    recommendation.summary.trim()
      .length > 0
      ? recommendation.summary
      : "Review the supplied FORGE bootstrap before continuing implementation.";

  return [
    "Recommended First Action",
    `Code: ${code}`,
    summary,
  ];
}

function formatContinuationInstructions() {
  return [
    "Continuation Instructions",
    "- Treat this package as the authoritative starting context for the new conversation.",
    "- Inspect current repository files before recommending edits.",
    "- Preserve unrelated modified and untracked work.",
    "- Continue from the recorded current and next objectives.",
    "- Prefer deterministic builders and repository-native tooling.",
    "- Do not introduce filesystem writes unless explicitly required by the orchestration layer.",
    "- Run focused validation before broader subsystem validation.",
    "- Do not commit until the active phase is fully validated.",
  ];
}

export function renderChatBootstrap(
  conversationPreparation,
) {
  validateConversationPreparation(
    conversationPreparation,
  );

  const {
    bootstrapPrompt,
    contextCompression,
    promptRecommendations,
  } = conversationPreparation;

  return [
    "FORGE NEW CONVERSATION PACKAGE",
    "",
    "Purpose",
    "Continue FORGE development from the live repository and governance state captured below.",
    "",
    ...formatContinuationInstructions(),
    "",
    "Authoritative Bootstrap",
    "",
    bootstrapPrompt,
    "",
    ...formatRecommendedAction(
      promptRecommendations,
    ),
    "",
    ...formatWarningSummary(
      promptRecommendations,
    ),
    "",
    "Compressed Machine Context",
    "",
    "```json",
    formatJson(
      contextCompression,
    ),
    "```",
    "",
    "Prompt Guidance",
    "",
    "```json",
    formatJson(
      promptRecommendations,
    ),
    "```",
    "",
    "First Response Requirement",
    "Begin by confirming the repository baseline, identifying the active objective, and requesting or performing only the inspections needed for the next safe implementation decision.",
  ].join("\n");
}

export function renderConversationBootstrap(
  conversationPreparation,
) {
  validateConversationPreparation(
    conversationPreparation,
  );

  const separator =
    "================================================";

  return [
    separator,
    "FORGE Chat-Ready Conversation Package",
    separator,
    "",
    renderChatBootstrap(
      conversationPreparation,
    ),
    "",
    separator,
    "Full Conversation Bootstrap",
    separator,
    "",
    conversationPreparation
      .bootstrapPrompt,
    "",
    separator,
    "Context Compression",
    separator,
    "",
    formatJson(
      conversationPreparation
        .contextCompression,
    ),
    "",
    separator,
    "Prompt Recommendations",
    separator,
    "",
    formatJson(
      conversationPreparation
        .promptRecommendations,
    ),
  ].join("\n");
}

export function generateConversationBootstrap({
  engineeringSession,
  conversationPreparationOptions = {},
  runConversationPreparationFn =
    runConversationPreparation,
  writeOutputFn =
    console.log,
} = {}) {
  assertPlainObject(
    conversationPreparationOptions,
    "conversationPreparationOptions",
  );

  assertFunction(
    runConversationPreparationFn,
    "runConversationPreparationFn",
  );

  assertFunction(
    writeOutputFn,
    "writeOutputFn",
  );

  if (engineeringSession !== undefined) {
    assertPlainObject(
      engineeringSession,
      "engineeringSession",
    );

    assertPlainObject(
      engineeringSession.conversation,
      "engineeringSession.conversation",
    );
  }

  const conversationPreparation =
    engineeringSession === undefined
      ? runConversationPreparationFn(
          conversationPreparationOptions,
        )
      : engineeringSession.conversation;

  const renderedBootstrap =
    renderConversationBootstrap(
      conversationPreparation,
    );

  writeOutputFn(
    renderedBootstrap,
  );

  return renderedBootstrap;
}

function isDirectExecution() {
  const invokedScriptPath =
    process.argv[1];

  if (!invokedScriptPath) {
    return false;
  }

  return (
    import.meta.url ===
    pathToFileURL(
      path.resolve(
        invokedScriptPath,
      ),
    ).href
  );
}

if (isDirectExecution()) {
  try {
    generateConversationBootstrap();
  } catch (error) {
    console.error(
      `FAIL: ${error.message}`,
    );

    process.exit(1);
  }
}
