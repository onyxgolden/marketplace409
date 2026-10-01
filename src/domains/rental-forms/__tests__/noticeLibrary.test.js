import { describe, expect, it, vi } from "vitest";
import { renderNoticeTemplate } from "../formPlaceholders";
import {
  ensureSystemCustomForms,
  rowToForm,
  rowToNoticeLog,
  SYSTEM_FORMS,
  validateFormInput,
} from "../noticeLibrary";

const CONTEXT = {
  tenant: { name: "Eric Carrillo", email: "eric.carillo5@yahoo.com", phone: "555-0100" },
  property: { label: "308 Paula", address: "308 Paula St, Beaumont, TX 77705" },
  unit: { label: "A" },
  lease: { start: "Sep 1, 2026", end: "Aug 31, 2027", rent: "$1,600.00", due_day: "1" },
  balance: { due: "$1,600.00" },
  owner: { name: "409 Marketplace" },
  custom: {},
  today: "Oct 1, 2026",
};

describe("system notice library", () => {
  it("ships the standard notice family", () => {
    const keys = SYSTEM_FORMS.map((form) => form.systemKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        "pay_or_quit_notice",
        "late_rent_notice",
        "lease_violation_notice",
        "move_out_reminder",
        "rent_increase_notice",
        "notice_to_enter",
      ]),
    );
    for (const form of SYSTEM_FORMS) {
      expect(form.name, form.systemKey).toBeTruthy();
      expect(form.kind, form.systemKey).toBe("notice");
      expect(form.body, form.systemKey).toBeTruthy();
    }
  });

  it("renders every system notice against a full context with no unknown placeholders", () => {
    for (const form of SYSTEM_FORMS) {
      const { text, unknown } = renderNoticeTemplate(form.body, CONTEXT);
      expect(unknown, form.systemKey).toEqual([]);
      expect(text, form.systemKey).toContain("Eric Carrillo");
      expect(text, form.systemKey).not.toContain("{{");
    }
  });

  it("seed-upserts the catalog idempotently on (owner_id, system_key)", async () => {
    const calls = [];
    const supabaseClient = {
      from: vi.fn(() => ({
        upsert: (rows, options) => {
          calls.push([rows, options]);
          return Promise.resolve({ error: null });
        },
      })),
    };
    await ensureSystemCustomForms({ supabaseClient, ownerId: "owner_1" });
    expect(calls).toHaveLength(1);
    const [rows, options] = calls[0];
    expect(options).toMatchObject({ onConflict: "owner_id,system_key", ignoreDuplicates: true });
    expect(rows).toHaveLength(SYSTEM_FORMS.length);
    for (const row of rows) {
      expect(row.owner_id).toBe("owner_1");
      expect(row.is_system).toBe(true);
      expect(row.system_key).toBeTruthy();
    }
  });
});

describe("form input validation", () => {
  it("accepts a valid custom form", () => {
    const result = validateFormInput({ name: "Garage rules", kind: "form", body: "Hello {{tenant.name}}" });
    expect(result.ok).toBe(true);
    expect(result.clean).toEqual({ name: "Garage rules", kind: "form", body: "Hello {{tenant.name}}" });
  });
  it("defaults the kind to notice and rejects bad kinds", () => {
    expect(validateFormInput({ name: "X", body: "Y" }).clean.kind).toBe("notice");
    expect(validateFormInput({ name: "X", kind: "email", body: "Y" }).ok).toBe(false);
    expect(validateFormInput({ name: " ", body: "Y" }).ok).toBe(false);
    expect(validateFormInput({ name: "X", body: " " }).ok).toBe(false);
  });
});

describe("row mappers", () => {
  it("maps form and log rows to client shape", () => {
    expect(
      rowToForm({ id: "f1", system_key: "pay_or_quit_notice", is_system: true, name: "Pay or quit", kind: "notice", body: "B", updated_at: "t" }),
    ).toMatchObject({ id: "f1", systemKey: "pay_or_quit_notice", isSystem: true, name: "Pay or quit", kind: "notice", body: "B" });
    expect(
      rowToNoticeLog({ id: "n1", tenant_id: "t1", lease_id: "l1", form_id: "f1", form_name: "Pay or quit", rendered_body: "R", created_at: "t" }),
    ).toMatchObject({ id: "n1", tenantId: "t1", leaseId: "l1", formId: "f1", formName: "Pay or quit", renderedBody: "R" });
  });
});
