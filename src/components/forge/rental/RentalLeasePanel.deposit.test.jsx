// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import RentalLeasePanel from "./RentalLeasePanel";
import { invalidate } from "@/hooks/swrCache";

const unit = { id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" };
const tenant = { id: "tenant_1", display_name: "Steven Crabtree", email: "steven@example.com" };
const draftLease = { id: "lease_1", unit_id: "unit_1", property_id: "4225-barnhill", status: "draft", monthly_rent_cents: 180000, rent_due_day: 1, start_date: "2026-10-13", end_date: null };
const draftSchedule = { id: "schedule_1", lease_id: "lease_1", status: "draft" };

const createSetup = { units: [unit], tenants: [tenant], leases: [], schedules: [], leaseMemberships: [] };
const detailSetup = { units: [unit], tenants: [tenant], leases: [draftLease], schedules: [draftSchedule],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }], deposits: [] };
const detailWithDepositSetup = { ...detailSetup,
  deposits: [{ id: "deposit_1", lease_id: "lease_1", tenant_id: "tenant_1", required_amount_cents: 150000, status: "required" }] };
const detailWithJurisdictionSetup = { ...detailSetup,
  deposits: [{ id: "deposit_1", lease_id: "lease_1", tenant_id: "tenant_1", required_amount_cents: 150000, status: "required", jurisdiction_code: "TX" }] };

describe("RentalLeasePanel security deposit", () => {
  let container;
  let root;

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    invalidate("rental:lease-setup");
    vi.unstubAllGlobals();
  });

  async function mountPanel(setup) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />));
    return container;
  }

  function stubFetch({ depositOk = true } = {}) {
    const posts = [];
    const fetch = vi.fn(async (url, options) => {
      if (options?.method === "POST") {
        const body = JSON.parse(options.body);
        posts.push(body);
        if (body.operation === "save-lease") {
          return { ok: true, json: async () => ({ lease: { id: "lease_new", monthlyRentCents: 180000, rentDueDay: 1, startDate: "2026-10-13", endDate: null } }) };
        }
        if (body.operation === "save-schedule") return { ok: true, json: async () => ({ schedule: { id: "schedule_new" } }) };
        if (body.operation === "save-security-deposit") {
          return depositOk
            ? { ok: true, json: async () => ({ deposit: { id: "deposit_new" } }) }
            : { ok: false, json: async () => ({ error: "Deposit service unavailable" }) };
        }
        if (body.operation === "update-lease-terms") return { ok: true, json: async () => ({ success: true }) };
        return { ok: false, json: async () => ({ error: "unexpected operation" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetch);
    return posts;
  }

  function setSelectValue(select, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillCreateForm({ deposit = null, jurisdiction = null } = {}) {
    await act(async () => setSelectValue(container.querySelector('select[name="unitId"]'), "unit_1"));
    container.querySelector('select[name="tenantId"]').value = "tenant_1";
    container.querySelector('input[name="startDate"]').value = "2026-10-13";
    container.querySelector('input[name="monthlyRent"]').value = "1800";
    if (deposit !== null) container.querySelector('input[name="securityDeposit"]').value = deposit;
    if (jurisdiction !== null) container.querySelector('input[name="jurisdiction"]').value = jurisdiction;
  }

  async function submitForm(form) {
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  }

  it("shows an optional Security deposit field on the lease create form", async () => {
    stubFetch();
    await mountPanel(createSetup);
    const input = container.querySelector('input[name="securityDeposit"]');
    expect(input).not.toBeNull();
    expect(input.required).toBe(false);
    expect(container.textContent).toContain("Optional — leave blank if no deposit is required.");
  });

  it("create with a deposit amount chains a save-security-deposit call and confirms it", async () => {
    const posts = stubFetch();
    await mountPanel(createSetup);
    await fillCreateForm({ deposit: "1500" });
    await submitForm(container.querySelector('input[name="securityDeposit"]').form);
    const depositPost = posts.find((post) => post.operation === "save-security-deposit");
    expect(depositPost).toEqual({ operation: "save-security-deposit",
      deposit: { leaseId: "lease_new", tenantId: "tenant_1", requiredAmountCents: 150000, jurisdictionCode: null } });
    expect(container.textContent).toContain("Security deposit $1,500.00 recorded.");
  });

  it("create with the deposit field empty records no deposit", async () => {
    const posts = stubFetch();
    await mountPanel(createSetup);
    await fillCreateForm();
    await submitForm(container.querySelector('input[name="securityDeposit"]').form);
    expect(posts.some((post) => post.operation === "save-security-deposit")).toBe(false);
    expect(posts.some((post) => post.operation === "save-lease")).toBe(true);
    // The status message (not the still-open form) must carry no deposit mention.
    expect(container.querySelector('p[role="status"]').textContent).toBe("Lease saved: lease_new — Schedule: schedule_new");
  });

  it("edit with an existing deposit shows it read-only and saves no duplicate", async () => {
    const posts = stubFetch();
    await mountPanel(detailWithDepositSetup);
    expect(container.textContent).toContain("Deposit on file: $1,500.00 — manage it on the Security deposits screen.");
    expect(container.querySelector('input[name="securityDeposit"]')).toBeNull();
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Edit terms").click());
    const termsForm = container.querySelector('input[name="monthlyRent"]').form;
    await submitForm(termsForm);
    expect(posts.some((post) => post.operation === "update-lease-terms")).toBe(true);
    expect(posts.some((post) => post.operation === "save-security-deposit")).toBe(false);
  });

  it("edit with no deposit lets the landlord enter one and records it", async () => {
    const posts = stubFetch();
    await mountPanel(detailSetup);
    const input = container.querySelector('input[name="securityDeposit"]');
    expect(input).not.toBeNull();
    input.value = "1500";
    await submitForm(input.form);
    expect(posts).toContainEqual({ operation: "save-security-deposit",
      deposit: { leaseId: "lease_1", tenantId: "tenant_1", requiredAmountCents: 150000, jurisdictionCode: null } });
    expect(container.textContent).toContain("Security deposit $1,500.00 recorded.");
  });

  it("create with a deposit amount and jurisdiction passes the jurisdiction through", async () => {
    const posts = stubFetch();
    await mountPanel(createSetup);
    await fillCreateForm({ deposit: "1500", jurisdiction: "TX" });
    await submitForm(container.querySelector('input[name="securityDeposit"]').form);
    expect(posts).toContainEqual({ operation: "save-security-deposit",
      deposit: { leaseId: "lease_new", tenantId: "tenant_1", requiredAmountCents: 150000, jurisdictionCode: "TX" } });
  });

  it("create with a deposit amount and blank jurisdiction records a null jurisdiction, never an invented one", async () => {
    const posts = stubFetch();
    await mountPanel(createSetup);
    await fillCreateForm({ deposit: "1500" });
    await submitForm(container.querySelector('input[name="securityDeposit"]').form);
    expect(posts).toContainEqual({ operation: "save-security-deposit",
      deposit: { leaseId: "lease_new", tenantId: "tenant_1", requiredAmountCents: 150000, jurisdictionCode: null } });
  });

  it("edit with no deposit and a jurisdiction passes it through", async () => {
    const posts = stubFetch();
    await mountPanel(detailSetup);
    container.querySelector('input[name="securityDeposit"]').value = "1500";
    container.querySelector('input[name="jurisdiction"]').value = "TX";
    await submitForm(container.querySelector('input[name="securityDeposit"]').form);
    expect(posts).toContainEqual({ operation: "save-security-deposit",
      deposit: { leaseId: "lease_1", tenantId: "tenant_1", requiredAmountCents: 150000, jurisdictionCode: "TX" } });
  });

  it("edit read-only display shows the recorded jurisdiction when one exists", async () => {
    stubFetch();
    await mountPanel(detailWithJurisdictionSetup);
    expect(container.textContent).toContain("Deposit on file: $1,500.00 · TX — manage it on the Security deposits screen.");
    expect(container.querySelector('input[name="securityDeposit"]')).toBeNull();
  });

  it("a failed deposit save after a saved lease is surfaced, not silent", async () => {
    const posts = stubFetch({ depositOk: false });
    await mountPanel(createSetup);
    await fillCreateForm({ deposit: "1500" });
    await submitForm(container.querySelector('input[name="securityDeposit"]').form);
    expect(posts.some((post) => post.operation === "save-security-deposit")).toBe(true);
    expect(container.textContent).toContain("Lease saved, but the security deposit was NOT recorded: Deposit service unavailable");
    expect(container.textContent).not.toContain("Security deposit $1,500.00 recorded.");
  });
});
