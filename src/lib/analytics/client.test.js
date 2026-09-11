const mocks = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));

vi.mock("posthog-js", () => ({ default: { init: mocks.init, capture: mocks.capture } }));

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
  beforeEach(() => {
    __resetAnalyticsForTests();
    mocks.init.mockReset();
    mocks.capture.mockReset();
    vi.stubGlobal("crypto", webcrypto);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("does not import or initialize PostHog while disabled", async () => {
    expect(await initializeAnalytics({ enabled: false })).toBeNull();
    expect(mocks.init).not.toHaveBeenCalled();
  });

  it("initializes with all automatic collection disabled and every recording field masked", async () => {
    await initializeAnalytics({
      enabled: true,
      apiKey: "phc_public_browser_key",
      apiHost: "https://us.i.posthog.com",
      sessionRecordingEnabled: false,
    });
    expect(mocks.init).toHaveBeenCalledWith(
      "phc_public_browser_key",
      expect.objectContaining({
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_exceptions: false,
        disable_session_recording: true,
        disable_surveys: true,
        person_profiles: "never",
        persistence: "memory",
        session_recording: { maskAllInputs: true, maskTextSelector: "*" },
      }),
    );
  });

  it("captures only approved data with pseudonymous scopes and never calls PostHog identify", async () => {
    await initializeAnalytics({
      enabled: true,
      apiKey: "phc_public_browser_key",
      apiHost: "https://us.i.posthog.com",
      sessionRecordingEnabled: false,
    });
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
    const properties = mocks.capture.mock.calls[0][1];
    expect(properties).toMatchObject({
      surface: "forge",
      feature: "navigation",
      action: "viewed",
      user_scope: expect.stringMatching(/^user_[a-f0-9]{32}$/),
      workspace_scope: expect.stringMatching(/^workspace_[a-f0-9]{32}$/),
    });
    expect(JSON.stringify(properties)).not.toMatch(/raw-|private@example|1000/);

    resetAnalyticsSubject();
    captureApprovedEvent(ANALYTICS_EVENTS.FEATURE_USED, {
      surface: "forge",
      feature: "navigation",
      action: "viewed",
    });
    expect(mocks.capture.mock.calls[1][1]).not.toHaveProperty("user_scope");
  });
});
