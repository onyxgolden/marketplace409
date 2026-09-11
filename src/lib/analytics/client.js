import { buildApprovedAnalyticsEvent, sanitizePostHogEvent } from "./policy";
import { pseudonymizeAnalyticsId } from "./identity";

let posthogClient = null;
let subjectContext = Object.freeze({});

export async function initializeAnalytics(config) {
  if (!config?.enabled || posthogClient) return posthogClient;

  const { default: posthog } = await import("posthog-js");
  posthog.init(config.apiKey, {
    api_host: config.apiHost,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    disable_session_recording: !config.sessionRecordingEnabled,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
    },
    disable_surveys: true,
    person_profiles: "never",
    persistence: "memory",
    before_send: sanitizePostHogEvent,
  });
  posthogClient = posthog;
  return posthogClient;
}

export function captureApprovedEvent(eventName, candidateProperties = {}) {
  const approved = buildApprovedAnalyticsEvent(eventName, { ...candidateProperties, ...subjectContext });
  if (!posthogClient || !approved) return false;
  posthogClient.capture(approved.eventName, approved.properties);
  return true;
}

export async function identifyAnalyticsSubject({ userId, workspaceId } = {}) {
  if (!posthogClient) return false;
  const [userScope, workspaceScope] = await Promise.all([
    pseudonymizeAnalyticsId("user", userId),
    pseudonymizeAnalyticsId("workspace", workspaceId),
  ]);
  if (!userScope) return false;
  subjectContext = Object.freeze({
    user_scope: userScope,
    ...(workspaceScope ? { workspace_scope: workspaceScope } : {}),
  });
  return true;
}

export function resetAnalyticsSubject() {
  subjectContext = Object.freeze({});
}

export function __resetAnalyticsForTests() {
  posthogClient = null;
  subjectContext = Object.freeze({});
}
