import {
  buildBootstrapPrompt,
} from "./buildBootstrapPrompt.mjs";

import {
  buildContextCompression,
} from "./buildContextCompression.mjs";

import {
  buildConversationState,
} from "./buildConversationState.mjs";

import {
  buildPromptRecommendations,
} from "./buildPromptRecommendations.mjs";

import {
  buildRepositorySummary,
} from "./buildRepositorySummary.mjs";

function assertFunction(value, location) {
  if (typeof value !== "function") {
    throw new TypeError(
      `${location} must be a function`,
    );
  }
}

function deepFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (const childValue of Object.values(value)) {
    deepFreeze(childValue);
  }

  return Object.freeze(value);
}

export function runConversationPreparation({
  conversationStateOptions = {},
  buildConversationStateFn =
    buildConversationState,
  buildRepositorySummaryFn =
    buildRepositorySummary,
  buildBootstrapPromptFn =
    buildBootstrapPrompt,
  buildContextCompressionFn =
    buildContextCompression,
  buildPromptRecommendationsFn =
    buildPromptRecommendations,
} = {}) {
  assertFunction(
    buildConversationStateFn,
    "buildConversationStateFn",
  );

  assertFunction(
    buildRepositorySummaryFn,
    "buildRepositorySummaryFn",
  );

  assertFunction(
    buildBootstrapPromptFn,
    "buildBootstrapPromptFn",
  );

  assertFunction(
    buildContextCompressionFn,
    "buildContextCompressionFn",
  );

  assertFunction(
    buildPromptRecommendationsFn,
    "buildPromptRecommendationsFn",
  );

  const conversationState =
    buildConversationStateFn(
      conversationStateOptions,
    );

  const repositorySummary =
    buildRepositorySummaryFn(
      conversationState,
    );

  const bootstrapPrompt =
    buildBootstrapPromptFn(
      repositorySummary,
    );

  const contextCompression =
    buildContextCompressionFn(
      repositorySummary,
    );

  const promptRecommendations =
    buildPromptRecommendationsFn(
      repositorySummary,
    );

  return deepFreeze({
    schemaVersion: "1.0",

    generatedAt:
      conversationState.generatedAt,

    conversationState,
    repositorySummary,
    bootstrapPrompt,
    contextCompression,
    promptRecommendations,
  });
}
