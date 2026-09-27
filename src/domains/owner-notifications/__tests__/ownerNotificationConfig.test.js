import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_OWNER_NOTIFICATION_EMAIL,
  UPCOMING_AUTOPAY_LEAD_DAYS,
  resolveOwnerNotificationConfig,
} from "../ownerNotificationConfig";

beforeEach(() => {
  delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
  delete process.env.OWNER_PAYMENT_NOTIFICATION_EMAIL;
  delete process.env.RENTAL_EMAIL_SENDER;
});

describe("owner notification config", () => {
  it("defaults sending to DISABLED — nothing may send without the explicit flag", () => {
    expect(resolveOwnerNotificationConfig({}).enabled).toBe(false);
    expect(resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "" }).enabled).toBe(false);
    expect(resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "false" }).enabled).toBe(false);
    expect(resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "0" }).enabled).toBe(false);
  });

  it("enables sending only on the explicit true flag", () => {
    expect(resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "true" }).enabled).toBe(true);
    expect(resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATIONS_ENABLED: " TRUE " }).enabled).toBe(true);
  });

  it("defaults the destination to Brandy's email and honors the override", () => {
    expect(resolveOwnerNotificationConfig({}).recipientEmail).toBe(DEFAULT_OWNER_NOTIFICATION_EMAIL);
    expect(DEFAULT_OWNER_NOTIFICATION_EMAIL).toBe("Brandykaymorgan@gmail.com");
    expect(resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATION_EMAIL: "  someone@example.com " }).recipientEmail)
      .toBe("someone@example.com");
  });

  it("fixes the upcoming-autopay lead time at 3 days", () => {
    expect(UPCOMING_AUTOPAY_LEAD_DAYS).toBe(3);
    expect(resolveOwnerNotificationConfig({}).upcomingLeadDays).toBe(3);
  });

  it("reads the env by default", () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    expect(resolveOwnerNotificationConfig().enabled).toBe(true);
  });
});
