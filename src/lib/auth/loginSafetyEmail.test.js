import { describe, expect, it } from "vitest";

import {
  buildNewSignInAlertEmail,
  deviceHintFromUserAgent,
  formatSignInTime,
  locationLabel,
  verifyLocationUrl,
} from "./loginSafetyEmail.js";

describe("locationLabel", () => {
  it("joins city and country", () => {
    expect(locationLabel("US", "Austin")).toBe("Austin, US");
  });

  it("falls back to Unknown location when geo is absent", () => {
    expect(locationLabel(null, null)).toBe("Unknown location");
    expect(locationLabel(undefined, "")).toBe("Unknown location");
  });

  it("handles partial geo", () => {
    expect(locationLabel("US", null)).toBe("US");
  });
});

describe("deviceHintFromUserAgent", () => {
  it("parses common browser/OS combos", () => {
    expect(deviceHintFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"))
      .toBe("Chrome on Windows");
    expect(deviceHintFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"))
      .toBe("Safari on iPhone");
    expect(deviceHintFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0"))
      .toBe("Edge on Mac");
  });

  it("falls back to Unknown device", () => {
    expect(deviceHintFromUserAgent(null)).toBe("Unknown device");
    expect(deviceHintFromUserAgent("")).toBe("Unknown device");
    expect(deviceHintFromUserAgent("curl/8.0")).toBe("Unknown device");
  });
});

describe("formatSignInTime", () => {
  it("formats in Central time with a zone label", () => {
    const text = formatSignInTime(new Date("2026-09-22T03:55:00Z"));
    expect(text).toContain("September 21, 2026");
    expect(text).toMatch(/CDT/);
  });

  it("handles invalid input", () => {
    expect(formatSignInTime("not-a-date")).toBe("Unknown time");
  });
});

describe("verifyLocationUrl", () => {
  it("points at the real API endpoint with token and action", () => {
    expect(verifyLocationUrl("https://409marketplace.online", "abc123", "approve")).toBe(
      "https://409marketplace.online/api/auth/verify-location?token=abc123&action=approve"
    );
    expect(verifyLocationUrl("https://409marketplace.online/", "def456", "deny")).toBe(
      "https://409marketplace.online/api/auth/verify-location?token=def456&action=deny"
    );
  });

  it("never builds a /auth/verify-location UI path (no such page exists)", () => {
    const url = verifyLocationUrl("https://409marketplace.online", "t", "approve");
    expect(url).not.toMatch(/online\/auth\/verify-location/);
  });
});

describe("buildNewSignInAlertEmail", () => {
  const base = {
    id: "login-safety-alert-1",
    senderName: "409 Marketplace Security",
    senderEmail: "security@409marketplace.online",
    recipient: "owner@example.com",
    country: "US",
    city: "Austin",
    occurredAt: new Date("2026-09-22T03:55:00Z"),
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0",
    approveUrl: "https://409marketplace.online/auth/verify-location?token=aaa&action=approve",
    denyUrl: "https://409marketplace.online/auth/verify-location?token=bbb&action=deny",
    resetUrl: "https://409marketplace.online/auth/reset-password",
  };

  it("builds the Resend message shape with approve/deny links", () => {
    const message = buildNewSignInAlertEmail(base);
    expect(message.id).toBe("login-safety-alert-1");
    expect(message.senderEmail).toBe("security@409marketplace.online");
    expect(message.recipient).toBe("owner@example.com");
    expect(message.subject).toContain("New sign-in");
    expect(message.bodyText).toContain("Austin, US");
    expect(message.bodyText).toContain("Chrome on Windows");
    expect(message.bodyText).toContain("action=approve");
    expect(message.bodyText).toContain("action=deny");
    expect(message.bodyText).toContain("token=aaa");
    expect(message.bodyText).toContain("token=bbb");
    expect(message.bodyText).toContain("/auth/reset-password");
  });

  it("never includes the raw IP address", () => {
    const message = buildNewSignInAlertEmail(base);
    expect(message.bodyText).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
  });

  it("labels unknown locations explicitly", () => {
    const message = buildNewSignInAlertEmail({ ...base, country: null, city: null });
    expect(message.bodyText).toContain("Unknown location");
  });

  it("requires recipient and action URLs", () => {
    expect(() => buildNewSignInAlertEmail({ ...base, recipient: "" })).toThrow();
    expect(() => buildNewSignInAlertEmail({ ...base, approveUrl: "" })).toThrow();
    expect(() => buildNewSignInAlertEmail({ ...base, denyUrl: "" })).toThrow();
  });
});
