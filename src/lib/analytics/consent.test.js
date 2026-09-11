import { ANALYTICS_CONSENT_KEY, grantAnalyticsConsent, hasAnalyticsConsent, revokeAnalyticsConsent } from "./consent";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("analytics consent", () => {
  it("is denied until explicitly granted and returns to denied after revocation", () => {
    const store = storage();
    expect(hasAnalyticsConsent(store)).toBe(false);
    expect(grantAnalyticsConsent(store)).toBe(true);
    expect(store.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
    expect(hasAnalyticsConsent(store)).toBe(true);
    revokeAnalyticsConsent(store);
    expect(hasAnalyticsConsent(store)).toBe(false);
  });

  it("fails closed when storage cannot be read", () => {
    expect(hasAnalyticsConsent({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(grantAnalyticsConsent({ setItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
});
