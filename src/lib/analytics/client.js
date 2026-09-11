import { buildApprovedAnalyticsEvent } from "./policy";
import { pseudonymizeAnalyticsId } from "./identity";

let analyticsClient = null;
let subjectContext = Object.freeze({});

export async function initializeAnalytics(config, fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto) {
  if (!config?.enabled || analyticsClient || typeof fetchImpl !== "function" || !cryptoImpl?.randomUUID) {
    return analyticsClient;
  }

  analyticsClient = Object.freeze({
    apiKey: config.apiKey,
    endpoint: `${config.apiHost}/i/v0/e/`,
    fetchImpl,
    sessionDistinctId: `anonymous_${cryptoImpl.randomUUID().replaceAll("-", "")}`,
  });
  return analyticsClient;
}

export function captureApprovedEvent(eventName, candidateProperties = {}) {
  const approved = buildApprovedAnalyticsEvent(eventName, { ...candidateProperties, ...subjectContext });
  if (!analyticsClient || !approved) return false;

  const distinctId = approved.properties.user_scope || analyticsClient.sessionDistinctId;
  const payload = {
    api_key: analyticsClient.apiKey,
    event: approved.eventName,
    distinct_id: distinctId,
    properties: { ...approved.properties, $process_person_profile: false },
  };
  analyticsClient.fetchImpl(analyticsClient.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    credentials: "omit",
    referrerPolicy: "no-referrer",
    keepalive: true,
  }).catch(() => undefined);
  return true;
}

export async function identifyAnalyticsSubject({ userId, workspaceId } = {}) {
  if (!analyticsClient) return false;
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
  analyticsClient = null;
  subjectContext = Object.freeze({});
}
