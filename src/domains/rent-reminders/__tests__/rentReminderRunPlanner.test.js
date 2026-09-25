import { describe, expect, it } from "vitest";
import { planReminderRun } from "../rentReminderRunPlanner.js";

function tenant(overrides = {}) {
  return {
    tenantId: "tenant_eric", email: "Eric@Example.com", fullName: "Eric Carrillo", tenantStatus: "active",
    ...overrides,
  };
}

function charge(overrides = {}) {
  return {
    ownerId: "owner_1", chargeId: "charge_oct", leaseId: "lease_1",
    dueDate: "2026-10-01", amountCents: 160000, paidAmountCents: 0, status: "due",
    tenants: [tenant()], existingDeliveries: [],
    ...overrides,
  };
}

const sends = (results) => results.filter((entry) => entry.action === "send");

describe("planReminderRun", () => {
  it("emits one send per active tenant on the seven-day date", () => {
    const results = planReminderRun({ asOfDate: "2026-09-24", charges: [charge()], siteUrl: "https://example.test" });
    const sendEntries = sends(results);
    expect(sendEntries).toHaveLength(1);
    expect(sendEntries[0]).toMatchObject({
      chargeId: "charge_oct", tenantId: "tenant_eric", email: "eric@example.com",
      reminderType: "seven_days_before", remainingCents: 160000,
    });
    expect(sendEntries[0].emailBody).toContain("https://example.test/forge/rental/portal");
  });

  it("emits the due-day reminder on the due date", () => {
    const results = planReminderRun({
      asOfDate: "2026-10-01", charges: [charge()], siteUrl: "https://example.test",
    });
    expect(sends(results)[0].reminderType).toBe("due_date");
  });

  it("sends a separate delivery row per joint tenant", () => {
    const results = planReminderRun({
      asOfDate: "2026-09-24",
      charges: [charge({ tenants: [tenant(), tenant({ tenantId: "tenant_bob", email: "bob@example.com", fullName: "Bob" })] })],
    });
    const sendEntries = sends(results);
    expect(sendEntries).toHaveLength(2);
    expect(new Set(sendEntries.map((entry) => entry.tenantId))).toEqual(new Set(["tenant_eric", "tenant_bob"]));
  });

  it("normalizes duplicate emails to a single recipient", () => {
    const results = planReminderRun({
      asOfDate: "2026-09-24",
      charges: [charge({ tenants: [tenant(), tenant({ tenantId: "tenant_dup", email: " eric@example.com " })] })],
    });
    expect(sends(results)).toHaveLength(1);
    expect(results.find((entry) => entry.reason === "duplicate_email_in_lease")).toBeTruthy();
  });

  it("does not re-send an already delivered reminder", () => {
    const results = planReminderRun({
      asOfDate: "2026-09-24",
      charges: [charge({ existingDeliveries: [{
        tenantId: "tenant_eric", dueDate: "2026-10-01", reminderType: "seven_days_before", status: "sent",
      }] })],
    });
    expect(sends(results)).toHaveLength(0);
    expect(results.find((entry) => entry.action === "already_sent")).toBeTruthy();
  });

  it("retries a failed seven-day delivery on a later day still before the due date", () => {
    const results = planReminderRun({
      asOfDate: "2026-09-27",
      charges: [charge({ existingDeliveries: [{
        tenantId: "tenant_eric", dueDate: "2026-10-01", reminderType: "seven_days_before", status: "failed",
      }] })],
    });
    const sendEntries = sends(results);
    expect(sendEntries).toHaveLength(1);
    expect(sendEntries[0]).toMatchObject({ reminderType: "seven_days_before" });
  });

  it("retries a failed due-day delivery only on the due date", () => {
    const failed = [{ tenantId: "tenant_eric", dueDate: "2026-10-01", reminderType: "due_date", status: "failed" }];
    const sameDay = sends(planReminderRun({ asOfDate: "2026-10-01", charges: [charge({ existingDeliveries: failed })] }));
    expect(sameDay).toHaveLength(1);
    const nextDay = sends(planReminderRun({ asOfDate: "2026-10-02", charges: [charge({ existingDeliveries: failed })] }));
    expect(nextDay).toHaveLength(0);
  });

  it("re-plans a stale sending claim but skips a fresh in-progress one", () => {
    const stale = planReminderRun({
      asOfDate: "2026-10-01",
      charges: [charge({ existingDeliveries: [{
        tenantId: "tenant_eric", dueDate: "2026-10-01", reminderType: "due_date", status: "sending", staleSending: true,
      }] })],
    });
    expect(sends(stale)).toHaveLength(1);
    const fresh = planReminderRun({
      asOfDate: "2026-10-01",
      charges: [charge({ existingDeliveries: [{
        tenantId: "tenant_eric", dueDate: "2026-10-01", reminderType: "due_date", status: "sending", staleSending: false,
      }] })],
    });
    expect(sends(fresh)).toHaveLength(0);
    expect(fresh.find((entry) => entry.reason === "delivery_in_progress")).toBeTruthy();
  });

  it("suppresses a retry when the tenant paid between plan and send", () => {
    const results = planReminderRun({
      asOfDate: "2026-09-27",
      charges: [charge({ paidAmountCents: 160000, existingDeliveries: [{
        tenantId: "tenant_eric", dueDate: "2026-10-01", reminderType: "seven_days_before", status: "failed",
      }] })],
    });
    expect(sends(results)).toHaveLength(0);
  });

  it("excludes tenants who left the lease", () => {
    const results = planReminderRun({
      asOfDate: "2026-09-24",
      charges: [charge({ tenants: [tenant({ tenantStatus: "former" })] })],
    });
    expect(sends(results)).toHaveLength(0);
    expect(results.find((entry) => entry.reason === "no_active_tenants")).toBeTruthy();
  });

  it("does not emit the fresh grain twice when it also appears as a retry candidate", () => {
    const results = planReminderRun({
      asOfDate: "2026-09-24",
      charges: [charge({ existingDeliveries: [{
        tenantId: "tenant_eric", dueDate: "2026-10-01", reminderType: "seven_days_before", status: "failed",
      }] })],
    });
    expect(sends(results)).toHaveLength(1);
  });
});
