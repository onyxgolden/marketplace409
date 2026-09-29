import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_OWNER_NOTIFICATION_EMAIL,
  UPCOMING_AUTOPAY_LEAD_DAYS,
  parseQuietHour,
  resolveOwnerNotificationConfig,
  resolveRentalNotificationConfig,
  parseOwnerAllowlist,
  isOwnerNotificationAllowed,
  isTenantNotificationAllowed,
} from "../ownerNotificationConfig";

beforeEach(() => {
  delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
  delete process.env.OWNER_PAYMENT_NOTIFICATION_EMAIL;
  delete process.env.RENTAL_EMAIL_SENDER;
  delete process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS;
  delete process.env.OWNER_NOTIFICATION_QUIET_START;
  delete process.env.OWNER_NOTIFICATION_QUIET_END;
  delete process.env.OWNER_NOTIFICATION_QUIET_TZ;
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

  it("defaults quiet hours to 23:00-07:00 America/Chicago", () => {
    const config = resolveOwnerNotificationConfig({});
    expect(config.quietStartHour).toBe(23);
    expect(config.quietEndHour).toBe(7);
    expect(config.quietTimeZone).toBe("America/Chicago");
  });

  it("honors quiet-hour overrides from env", () => {
    const config = resolveOwnerNotificationConfig({
      OWNER_NOTIFICATION_QUIET_START: "22",
      OWNER_NOTIFICATION_QUIET_END: " 6 ",
      OWNER_NOTIFICATION_QUIET_TZ: "America/Denver",
    });
    expect(config.quietStartHour).toBe(22);
    expect(config.quietEndHour).toBe(6);
    expect(config.quietTimeZone).toBe("America/Denver");
  });

  it("falls back to the default window on garbage quiet-hour input", () => {
    expect(parseQuietHour(undefined, 23)).toBe(23);
    expect(parseQuietHour("", 23)).toBe(23);
    expect(parseQuietHour("nope", 23)).toBe(23);
    expect(parseQuietHour("24", 23)).toBe(23);
    expect(parseQuietHour("-1", 23)).toBe(23);
    expect(parseQuietHour("22.5", 23)).toBe(23);
    expect(parseQuietHour("22", 23)).toBe(22);
    expect(parseQuietHour("0", 7)).toBe(0);
  });
});

describe("rental tenant allowlist (recipient-level rollout restriction)", () => {
  it("parses RENTAL_NOTIFICATION_TENANT_IDS into allowedTenantIds", () => {
    const config = resolveRentalNotificationConfig({
      RENTAL_NOTIFICATION_TENANT_IDS: " tenant_a ,tenant_b ",
    });
    expect(config.allowedTenantIds).toEqual(["tenant_a", "tenant_b"]);
  });

  it("defaults allowedTenantIds to an empty list", () => {
    expect(resolveRentalNotificationConfig({}).allowedTenantIds).toEqual([]);
  });

  it("inherits the owner-notification config fields", () => {
    const config = resolveRentalNotificationConfig({
      OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "true",
      RENTAL_NOTIFICATION_TENANT_IDS: "tenant_a",
    });
    expect(config.enabled).toBe(true);
    expect(config.senderName).toBe("FORGE Rental Manager");
  });

  it("allows an explicitly listed tenant", () => {
    const config = resolveRentalNotificationConfig({ RENTAL_NOTIFICATION_TENANT_IDS: "tenant_a" });
    expect(isTenantNotificationAllowed(config, "tenant_a")).toBe(true);
  });

  it("refuses a tenant who is not listed", () => {
    const config = resolveRentalNotificationConfig({ RENTAL_NOTIFICATION_TENANT_IDS: "tenant_a" });
    expect(isTenantNotificationAllowed(config, "tenant_b")).toBe(false);
  });

  it("fails closed when the list is empty or unset", () => {
    expect(isTenantNotificationAllowed(resolveRentalNotificationConfig({}), "tenant_a")).toBe(false);
    expect(
      isTenantNotificationAllowed(resolveRentalNotificationConfig({ RENTAL_NOTIFICATION_TENANT_IDS: "" }), "tenant_a"),
    ).toBe(false);
  });

  it("fails closed on a null or missing tenant id", () => {
    const config = resolveRentalNotificationConfig({ RENTAL_NOTIFICATION_TENANT_IDS: "tenant_a" });
    expect(isTenantNotificationAllowed(config, null)).toBe(false);
    expect(isTenantNotificationAllowed(config, undefined)).toBe(false);
  });

  it("fails closed on a missing config", () => {
    expect(isTenantNotificationAllowed(null, "tenant_a")).toBe(false);
    expect(isTenantNotificationAllowed(undefined, "tenant_a")).toBe(false);
  });
});
