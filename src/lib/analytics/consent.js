export const ANALYTICS_CONSENT_KEY = "forge.analytics.consent.v1";

export function hasAnalyticsConsent(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(ANALYTICS_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function grantAnalyticsConsent(storage = globalThis.localStorage) {
  try {
    storage?.setItem(ANALYTICS_CONSENT_KEY, "granted");
    return storage?.getItem(ANALYTICS_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function revokeAnalyticsConsent(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(ANALYTICS_CONSENT_KEY);
  } catch {
    // Revocation remains fail-closed even when browser storage is unavailable.
  }
}
