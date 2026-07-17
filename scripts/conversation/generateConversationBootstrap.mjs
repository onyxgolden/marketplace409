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

function formatJson(value) {
  return JSON.stringify(
    value,
    null,
    2,
  );
}

export function renderConversationBootstrap(
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

  const separator =
    "================================================";

  return [
    separator,
    "FORGE Conversation Bootstrap",
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

  const conversationPreparation =
    runConversationPreparationFn(
      conversationPreparationOptions,
    );

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
