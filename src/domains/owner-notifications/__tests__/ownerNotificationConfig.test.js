import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_OWNER_NOTIFICATION_EMAIL,
  UPCOMING_AUTOPAY_LEAD_DAYS,
  resolveOwnerNotificationConfig,
  parseOwnerAllowlist,
  isOwnerNotificationAllowed,
} from "../ownerNotificationConfig";

beforeEach(() => {
  delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
  delete process.env.OWNER_PAYMENT_NOTIFICATION_EMAIL;
  delete process.env.RENTAL_EMAIL_SENDER;
  delete process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS;
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

  it("parses the owner allow-list from a comma-separated env var", () => {
    expect(parseOwnerAllowlist(undefined)).toEqual([]);
    expect(parseOwnerAllowlist("")).toEqual([]);
    expect(parseOwnerAllowlist("owner_a")).toEqual(["owner_a"]);
    expect(parseOwnerAllowlist("owner_a, owner_b ,,owner_c ")).toEqual(["owner_a", "owner_b", "owner_c"]);
  });

  it("exposes the allow-list on the resolved config", () => {
    expect(resolveOwnerNotificationConfig({}).allowedOwnerIds).toEqual([]);
    expect(
      resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATION_OWNER_IDS: "owner_a,owner_b" }).allowedOwnerIds,
    ).toEqual(["owner_a", "owner_b"]);
  });

  it("fails closed: nobody is allowed when the allow-list is empty or unset", () => {
    expect(isOwnerNotificationAllowed(resolveOwnerNotificationConfig({}), "owner_a")).toBe(false);
    expect(isOwnerNotificationAllowed({ allowedOwnerIds: [] }, "owner_a")).toBe(false);
    expect(isOwnerNotificationAllowed({ allowedOwnerIds: ["owner_a"] }, null)).toBe(false);
    expect(isOwnerNotificationAllowed({ allowedOwnerIds: ["owner_a"] }, undefined)).toBe(false);
  });

  it("allows only explicitly listed owners", () => {
    const config = resolveOwnerNotificationConfig({ OWNER_PAYMENT_NOTIFICATION_OWNER_IDS: "owner_a,owner_b" });
    expect(isOwnerNotificationAllowed(config, "owner_a")).toBe(true);
    expect(isOwnerNotificationAllowed(config, "owner_b")).toBe(true);
    expect(isOwnerNotificationAllowed(config, "owner_c")).toBe(false);
  });
});
