export const ANALYTICS_CONSENT_KEY = "forge.analytics.consent.v1";

export const ANALYTICS_CONSENT = Object.freeze({
  GRANTED: "granted",
  DENIED: "denied",
  UNDECIDED: "undecided",
});

export function readAnalyticsConsent(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(ANALYTICS_CONSENT_KEY);
    return value === ANALYTICS_CONSENT.GRANTED || value === ANALYTICS_CONSENT.DENIED
      ? value
      : ANALYTICS_CONSENT.UNDECIDED;
  } catch {
    return ANALYTICS_CONSENT.DENIED;
  }
}

export function hasAnalyticsConsent(storage = globalThis.localStorage) {
  return readAnalyticsConsent(storage) === ANALYTICS_CONSENT.GRANTED;
}

export function grantAnalyticsConsent(storage = globalThis.localStorage) {
  try {
    storage?.setItem(ANALYTICS_CONSENT_KEY, "granted");
    return storage?.getItem(ANALYTICS_CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function denyAnalyticsConsent(storage = globalThis.localStorage) {
  try {
    storage?.setItem(ANALYTICS_CONSENT_KEY, ANALYTICS_CONSENT.DENIED);
    return storage?.getItem(ANALYTICS_CONSENT_KEY) === ANALYTICS_CONSENT.DENIED;
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
