import {
  __resetAnalyticsForTests,
  captureApprovedEvent,
  identifyAnalyticsSubject,
  initializeAnalytics,
  resetAnalyticsSubject,
} from "./client";
import { ANALYTICS_EVENTS } from "./policy";
import { webcrypto } from "node:crypto";

describe("analytics client", () => {
  let fetchImpl;

  beforeEach(() => {
    __resetAnalyticsForTests();
    fetchImpl = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("crypto", webcrypto);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("does not initialize a transport while disabled", async () => {
    expect(await initializeAnalytics({ enabled: false }, fetchImpl, webcrypto)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("initializes only the documented public single-event endpoint without sending a request", async () => {
    const client = await initializeAnalytics({
      enabled: true,
      apiKey: "phc_public_browser_key",
      apiHost: "https://us.i.posthog.com",
      sessionRecordingEnabled: false,
    }, fetchImpl, webcrypto);
    expect(client.endpoint).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(client.sessionDistinctId).toMatch(/^anonymous_[a-f0-9]{32}$/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("captures only approved anonymous data with pseudonymous scopes", async () => {
    await initializeAnalytics({
      enabled: true,
      apiKey: "phc_public_browser_key",
      apiHost: "https://us.i.posthog.com",
      sessionRecordingEnabled: false,
    }, fetchImpl, webcrypto);
    expect(await identifyAnalyticsSubject({ userId: "raw-user-id", workspaceId: "raw-workspace-id" })).toBe(true);
    expect(
      captureApprovedEvent(ANALYTICS_EVENTS.FEATURE_USED, {
        surface: "forge",
        feature: "navigation",
        action: "viewed",
        email: "private@example.com",
        balance: 1000,
      }),
    ).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://us.i.posthog.com/i/v0/e/");
    const request = fetchImpl.mock.calls[0][1];
    expect(request).toMatchObject({ method: "POST", credentials: "omit", referrerPolicy: "no-referrer", keepalive: true });
    const payload = JSON.parse(request.body);
    expect(payload.api_key).toBe("phc_public_browser_key");
    expect(payload.event).toBe("forge_feature_used");
    expect(payload.distinct_id).toMatch(/^user_[a-f0-9]{32}$/);
    const properties = payload.properties;
    expect(properties).toMatchObject({
      surface: "forge",
      feature: "navigation",
      action: "viewed",
      user_scope: expect.stringMatching(/^user_[a-f0-9]{32}$/),
      workspace_scope: expect.stringMatching(/^workspace_[a-f0-9]{32}$/),
      $process_person_profile: false,
    });
    expect(JSON.stringify(properties)).not.toMatch(/raw-|private@example|1000/);

    resetAnalyticsSubject();
    captureApprovedEvent(ANALYTICS_EVENTS.FEATURE_USED, {
      surface: "forge",
      feature: "navigation",
      action: "viewed",
    });
    const anonymousPayload = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(anonymousPayload.properties).not.toHaveProperty("user_scope");
    expect(anonymousPayload.distinct_id).toMatch(/^anonymous_[a-f0-9]{32}$/);
  });

  it("does not send unknown events", async () => {
    await initializeAnalytics({ enabled: true, apiKey: "phc_public_browser_key", apiHost: "https://us.i.posthog.com" }, fetchImpl, webcrypto);
    expect(captureApprovedEvent("$pageview", { email: "private@example.com" })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
