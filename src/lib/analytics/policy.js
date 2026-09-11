export const ANALYTICS_EVENTS = Object.freeze({
  NAVIGATION: "forge_navigation",
  ONBOARDING_COMPLETED: "forge_onboarding_completed",
  WORKFLOW_COMPLETED: "forge_workflow_completed",
  ERROR_OBSERVED: "forge_error_observed",
  FEATURE_USED: "forge_feature_used",
});

const ALLOWED_VALUES = Object.freeze({
  surface: new Set([
    "marketplace",
    "forge",
    "financial",
    "rental",
    "private_financing",
    "reservations",
    "scheduling",
    "developer",
    "health",
    "account",
    "unknown",
  ]),
  destination: new Set([
    "marketplace",
    "forge",
    "financial",
    "rental",
    "private_financing",
    "reservations",
    "scheduling",
    "developer",
    "health",
    "account",
    "unknown",
  ]),
  onboarding: new Set([
    "account_registration",
    "account_sign_in",
    "tenant_onboarding",
    "borrower_claim",
    "property_setup",
  ]),
  workflow: new Set([
    "tenant_onboarding",
    "borrower_claim",
    "payment_setup",
    "payment_submission",
    "reservation_setup",
    "property_setup",
    "data_import",
    "schedule_update",
  ]),
  feature: new Set([
    "navigation",
    "onboarding",
    "rental_manager",
    "private_financing",
    "reservations",
    "scheduling",
    "financial_dashboard",
    "workspace_switcher",
  ]),
  action: new Set(["viewed", "started", "completed", "failed"]),
  outcome: new Set(["success", "failure", "cancelled", "blocked"]),
  error_code: new Set([
    "network_request_failed",
    "validation_failed",
    "authorization_failed",
    "unexpected_client_error",
  ]),
});

const EVENT_PROPERTIES = Object.freeze({
  [ANALYTICS_EVENTS.NAVIGATION]: ["surface", "destination"],
  [ANALYTICS_EVENTS.ONBOARDING_COMPLETED]: ["surface", "onboarding", "outcome"],
  [ANALYTICS_EVENTS.WORKFLOW_COMPLETED]: ["surface", "workflow", "outcome"],
  [ANALYTICS_EVENTS.ERROR_OBSERVED]: ["surface", "error_code"],
  [ANALYTICS_EVENTS.FEATURE_USED]: ["surface", "feature", "action"],
});

const PSEUDONYM_PATTERNS = Object.freeze({
  user_scope: /^user_[a-f0-9]{32}$/,
  workspace_scope: /^workspace_[a-f0-9]{32}$/,
});

export function buildApprovedAnalyticsEvent(eventName, candidateProperties = {}) {
  const approvedKeys = EVENT_PROPERTIES[eventName];
  if (!approvedKeys) return null;

  const properties = {};
  for (const key of approvedKeys) {
    const value = candidateProperties[key];
    if (ALLOWED_VALUES[key]?.has(value)) properties[key] = value;
  }
  for (const [key, pattern] of Object.entries(PSEUDONYM_PATTERNS)) {
    if (pattern.test(candidateProperties[key] || "")) properties[key] = candidateProperties[key];
  }

  return Object.freeze({ eventName, properties: Object.freeze(properties) });
}

export function sanitizePostHogEvent(event) {
  const approved = buildApprovedAnalyticsEvent(event?.event, event?.properties);
  if (!approved) return null;

  const properties = { ...approved.properties };
  for (const key of ["token", "$token", "distinct_id", "$device_id", "$session_id", "$lib", "$lib_version"]) {
    if (typeof event.properties?.[key] === "string") properties[key] = event.properties[key];
  }

  return { ...event, properties };
}

export function surfaceFromPathname(pathname) {
  const pathOnly = String(pathname || "").split(/[?#]/, 1)[0];
  const segments = pathOnly
    .split("/")
    .filter(Boolean);

  if (segments[0] !== "forge") return segments[0] === "login" || segments[0] === "register" ? "account" : "marketplace";
  if (segments[1] === "rental") {
    if (segments.includes("private-financing")) return "private_financing";
    if (segments.includes("reservations")) return "reservations";
    return "rental";
  }
  if (["scheduling", "developer", "health"].includes(segments[1])) return segments[1];
  if (["financial", "accounts", "transactions", "connections"].includes(segments[1])) return "financial";
  return "forge";
}
