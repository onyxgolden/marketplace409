import {
  runEngineeringSession,
} from "../governance/runEngineeringSession.mjs";

import {
  generateConversationBootstrap,
} from "../conversation/generateConversationBootstrap.mjs";

export const ENGINEERING_CONVERSATION_SESSION_VERSION =
  "1.0";

export const ENGINEERING_CONVERSATION_SESSION_ORDER =
  Object.freeze([
    "engineeringSession",
    "conversationBootstrap",
  ]);

function assertPlainObject(
  value,
  label,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${label} must be an object`,
    );
  }
}

function assertFunction(
  value,
  label,
) {
  if (typeof value !== "function") {
    throw new TypeError(
      `${label} must be a function`,
    );
  }
}

function deepFreeze(
  value,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (
    const nestedValue
    of Object.values(value)
  ) {
    deepFreeze(
      nestedValue,
    );
  }

  return value;
}

function discardOutput() {}

export function runEngineeringConversationSession({
  engineeringSessionOptions = {},

  conversationBootstrapOptions = {},

  runEngineeringSessionFn =
    runEngineeringSession,

  generateConversationBootstrapFn =
    generateConversationBootstrap,

  writeOutputFn =
    discardOutput,
} = {}) {
  assertPlainObject(
    engineeringSessionOptions,
    "engineeringSessionOptions",
  );

  assertPlainObject(
    conversationBootstrapOptions,
    "conversationBootstrapOptions",
  );

  assertFunction(
    runEngineeringSessionFn,
    "runEngineeringSessionFn",
  );

  assertFunction(
    generateConversationBootstrapFn,
    "generateConversationBootstrapFn",
  );

  assertFunction(
    writeOutputFn,
    "writeOutputFn",
  );

  const engineeringSession =
    runEngineeringSessionFn({
      ...engineeringSessionOptions,
    });

  assertPlainObject(
    engineeringSession,
    "engineeringSession",
  );

  const renderedBootstrap =
    generateConversationBootstrapFn({
      ...conversationBootstrapOptions,

      engineeringSession,

      writeOutputFn,
    });

  if (
    typeof renderedBootstrap !==
      "string" ||
    renderedBootstrap.trim().length === 0
  ) {
    throw new TypeError(
      "renderedBootstrap must be a non-empty string",
    );
  }

  return deepFreeze({
    version:
      ENGINEERING_CONVERSATION_SESSION_VERSION,

    status:
      "completed",

    executionOrder: [
      ...ENGINEERING_CONVERSATION_SESSION_ORDER,
    ],

    engineeringSession,

    renderedBootstrap,
  });
}
