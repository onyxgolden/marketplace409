import { readAnalyticsConfig } from "./config";

const valid = {
  NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED: "true",
  NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH: "false",
  NEXT_PUBLIC_POSTHOG_KEY: "phc_public_browser_key",
  NEXT_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
};

describe("analytics configuration", () => {
  it("is disabled by default", () => {
    expect(readAnalyticsConfig({})).toMatchObject({ enabled: false, killed: true, configured: false });
  });

  it("requires explicit enablement and explicit kill-switch release", () => {
    expect(readAnalyticsConfig({ ...valid, NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED: "false" }).enabled).toBe(false);
    expect(readAnalyticsConfig({ ...valid, NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH: "true" }).enabled).toBe(false);
    expect(readAnalyticsConfig(valid).enabled).toBe(true);
  });

  it("rejects unknown hosts and malformed keys", () => {
    expect(readAnalyticsConfig({ ...valid, NEXT_PUBLIC_POSTHOG_HOST: "https://example.com" }).enabled).toBe(false);
    expect(readAnalyticsConfig({ ...valid, NEXT_PUBLIC_POSTHOG_KEY: "secret-value" }).enabled).toBe(false);
  });

  it("keeps session recording code-disabled even when an environment value requests it", () => {
    expect(readAnalyticsConfig({ ...valid, NEXT_PUBLIC_POSTHOG_SESSION_RECORDING_ENABLED: "true" }).sessionRecordingEnabled).toBe(false);
  });
});
