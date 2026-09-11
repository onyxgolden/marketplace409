// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import PrivacySafeAnalyticsProvider from "./PrivacySafeAnalyticsProvider";
import { ANALYTICS_CONSENT_KEY } from "@/lib/analytics/consent";

const mocks = vi.hoisted(() => ({
  initializeAnalytics: vi.fn(),
  captureApprovedEvent: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/forge/rental/private-financing/account-id" }));
vi.mock("@/lib/analytics/client", () => mocks);

const ENV_KEYS = [
  "NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED",
  "NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
];

describe("PrivacySafeAnalyticsProvider", () => {
  let container;
  let root;

  beforeEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
    localStorage.clear();
    mocks.initializeAnalytics.mockReset();
    mocks.captureApprovedEvent.mockReset();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("renders FORGE without initializing analytics when configuration is absent", async () => {
    await act(async () => {
      root.render(<PrivacySafeAnalyticsProvider><main>FORGE</main></PrivacySafeAnalyticsProvider>);
    });
    expect(container.textContent).toBe("FORGE");
    expect(mocks.initializeAnalytics).not.toHaveBeenCalled();
  });

  it("does not initialize with valid configuration until consent is explicit", async () => {
    process.env.NEXT_PUBLIC_FORGE_ANALYTICS_ENABLED = "true";
    process.env.NEXT_PUBLIC_FORGE_ANALYTICS_KILL_SWITCH = "false";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_public_browser_key";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://us.i.posthog.com";

    await act(async () => {
      root.render(<PrivacySafeAnalyticsProvider><main>FORGE</main></PrivacySafeAnalyticsProvider>);
    });
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
    expect(mocks.initializeAnalytics).not.toHaveBeenCalled();
  });
});
