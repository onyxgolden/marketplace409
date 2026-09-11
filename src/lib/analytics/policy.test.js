import {
  ANALYTICS_EVENTS,
  buildApprovedAnalyticsEvent,
  sanitizePostHogEvent,
  surfaceFromPathname,
} from "./policy";

describe("privacy-safe analytics policy", () => {
  it("accepts only named events and enumerated properties", () => {
    expect(
      buildApprovedAnalyticsEvent(ANALYTICS_EVENTS.WORKFLOW_COMPLETED, {
        surface: "rental",
        workflow: "tenant_onboarding",
        outcome: "success",
        email: "private@example.com",
        amount: 125000,
        tenant: "Private Person",
        user_scope: "user_0123456789abcdef0123456789abcdef",
        workspace_scope: "workspace_0123456789abcdef0123456789abcdef",
      }),
    ).toEqual({
      eventName: "forge_workflow_completed",
      properties: {
        surface: "rental",
        workflow: "tenant_onboarding",
        outcome: "success",
        user_scope: "user_0123456789abcdef0123456789abcdef",
        workspace_scope: "workspace_0123456789abcdef0123456789abcdef",
      },
    });
    expect(buildApprovedAnalyticsEvent("arbitrary_event", { surface: "rental" })).toBeNull();
  });

  it("rejects raw or malformed identity values", () => {
    expect(
      buildApprovedAnalyticsEvent(ANALYTICS_EVENTS.FEATURE_USED, {
        surface: "forge",
        feature: "navigation",
        action: "viewed",
        user_scope: "internal-user-id",
        workspace_scope: "private@example.com",
      }).properties,
    ).toEqual({ surface: "forge", feature: "navigation", action: "viewed" });
  });

  it("drops unknown values rather than forwarding free-form data", () => {
    expect(
      buildApprovedAnalyticsEvent(ANALYTICS_EVENTS.ERROR_OBSERVED, {
        surface: "rental",
        error_code: "private@example.com",
      }),
    ).toEqual({ eventName: "forge_error_observed", properties: { surface: "rental" } });
  });

  it("strips URLs, titles, text, and nonessential automatic properties before sending", () => {
    const sanitized = sanitizePostHogEvent({
      event: ANALYTICS_EVENTS.NAVIGATION,
      properties: {
        surface: "financial",
        destination: "financial",
        $current_url: "https://example.test/borrower/private-id?email=private@example.com",
        $pathname: "/borrower/private-id",
        $title: "Private account",
        $token: "phc_public_browser_key",
        distinct_id: "anonymous-device-id",
      },
    });
    expect(sanitized.properties).toEqual({
      surface: "financial",
      destination: "financial",
      $token: "phc_public_browser_key",
      distinct_id: "anonymous-device-id",
    });
  });

  it("blocks every PostHog automatic event including recordings", () => {
    expect(sanitizePostHogEvent({ event: "$pageview", properties: {} })).toBeNull();
    expect(sanitizePostHogEvent({ event: "$snapshot", properties: {} })).toBeNull();
    expect(sanitizePostHogEvent({ event: "$exception", properties: {} })).toBeNull();
  });

  it("maps paths to coarse surfaces without retaining identifiers or query strings", () => {
    expect(surfaceFromPathname("/forge/rental/private-financing/accounts/private-id")).toBe("private_financing");
    expect(surfaceFromPathname("/forge/rental/reservations/123")).toBe("reservations");
    expect(surfaceFromPathname("/forge/transactions?account=private-id")).toBe("financial");
    expect(surfaceFromPathname("/register")).toBe("account");
  });
});
