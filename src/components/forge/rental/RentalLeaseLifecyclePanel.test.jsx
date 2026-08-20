// @vitest-environment jsdom
import{describe,expect,it}from"vitest";import{renderToStaticMarkup}from"react-dom/server";import RentalLeaseLifecyclePanel,{calculateProrationCents,resolveLeaseIdentity,leaseOptionLabel}from"./RentalLeaseLifecyclePanel.jsx";describe("RentalLeaseLifecyclePanel",()=>{it("requires owner-controlled changes and fees",()=>{const html=renderToStaticMarkup(<RentalLeaseLifecyclePanel/>);expect(html).toContain("Renewals, amendments, and prorating");expect(html).toContain("only an explicit owner action");expect(html).toContain("qualified Texas counsel");});it("calculates and rounds daily proration deterministically",()=>{expect(calculateProrationCents(200000,10,31)).toBe(64516);expect(calculateProrationCents(200000,32,31)).toBeNull();});});

import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

const SANDBOX_LEASE_ID = "rental_lease_c151ed02-8b18-4534-baaa-b9aaf4aca219";
const OTHER_LEASE_ID = "rental_lease_a9f2b311-7c44-4e9a-9b1d-2a6e5f0c8d13";

const data = {
  leases: [
    { id: SANDBOX_LEASE_ID, unit_id: "unit_1", property_id: "property-1", status: "active", monthly_rent_cents: 130000 },
    { id: OTHER_LEASE_ID, unit_id: "unit_2", property_id: "property-2", status: "draft", monthly_rent_cents: 130000 },
  ],
  units: [
    { id: "unit_1", label: "TEST-", property_id: "property-1" },
    { id: "unit_2", label: "Main residence", property_id: "property-2" },
  ],
  tenants: [
    { id: "tenant_1", display_name: "Brandy Morgan" },
    { id: "tenant_2", display_name: "Anthony Babino" },
  ],
  leaseMemberships: [
    { lease_id: SANDBOX_LEASE_ID, tenant_id: "tenant_1" },
    { lease_id: OTHER_LEASE_ID, tenant_id: "tenant_2" },
  ],
  schedules: [
    { id: "schedule_1", lease_id: SANDBOX_LEASE_ID, status: "active", amount_cents: 130000 },
  ],
  leaseChanges: [], lateFeeRules: [], openCharges: [],
};

describe("resolveLeaseIdentity", () => {
  it("resolves tenant through lease memberships, unit through lease.unit_id, and property through the unit", () => {
    expect(resolveLeaseIdentity(data.leases[0], data)).toEqual({
      leaseId: SANDBOX_LEASE_ID, tenantLabel: "Brandy Morgan", unitLabel: "TEST-",
      propertyLabel: "property-1", monthlyRentCents: 130000, status: "active",
    });
  });

  it("prefers the authoritative active schedule's rent over the lease's own monthly_rent_cents", () => {
    const withDifferentScheduleRent = { ...data, schedules: [{ id: "schedule_1", lease_id: SANDBOX_LEASE_ID, status: "active", amount_cents: 150000 }] };
    expect(resolveLeaseIdentity(data.leases[0], withDifferentScheduleRent).monthlyRentCents).toBe(150000);
  });

  it("falls back to lease.monthly_rent_cents when no active schedule exists", () => {
    expect(resolveLeaseIdentity(data.leases[1], data).monthlyRentCents).toBe(130000);
  });

  it("ignores a non-active (e.g. draft) schedule and falls back to lease.monthly_rent_cents", () => {
    const withDraftSchedule = { ...data, schedules: [{ id: "schedule_x", lease_id: OTHER_LEASE_ID, status: "draft", amount_cents: 999999 }] };
    expect(resolveLeaseIdentity(data.leases[1], withDraftSchedule).monthlyRentCents).toBe(130000);
  });

  it("shows explicit Unknown warnings instead of silently omitting identity", () => {
    const orphan = { leases: [], units: [], tenants: [], leaseMemberships: [], schedules: [] };
    const unresolvableLease = { id: "rental_lease_orphan_1", unit_id: "unit_missing", property_id: null, status: "active", monthly_rent_cents: 50000 };
    expect(resolveLeaseIdentity(unresolvableLease, orphan)).toMatchObject({
      tenantLabel: "Unknown tenant", unitLabel: "Unknown unit", propertyLabel: "Unknown property",
    });
  });

  it("falls back to the lease's own property_id when the unit cannot be resolved", () => {
    const noUnits = { ...data, units: [] };
    expect(resolveLeaseIdentity(data.leases[0], noUnits).propertyLabel).toBe("property-1");
  });

  it("joins every tenant on a multi-tenant lease instead of guessing a single one", () => {
    const multiTenant = { ...data, leaseMemberships: [...data.leaseMemberships, { lease_id: SANDBOX_LEASE_ID, tenant_id: "tenant_2" }] };
    expect(resolveLeaseIdentity(data.leases[0], multiTenant).tenantLabel).toBe("Brandy Morgan, Anthony Babino");
  });
});

describe("leaseOptionLabel", () => {
  it("distinguishes two leases with opaque UUID ids and identical rent by tenant, unit, property, and status", () => {
    const labelOne = leaseOptionLabel(data.leases[0], data);
    const labelTwo = leaseOptionLabel(data.leases[1], data);
    expect(labelOne).not.toBe(labelTwo);
    expect(labelOne).toContain("Brandy Morgan");
    expect(labelOne).toContain("TEST-");
    expect(labelOne).toContain("property-1");
    expect(labelOne).toContain("active");
    expect(labelTwo).toContain("Anthony Babino");
    expect(labelTwo).toContain("Main residence");
    expect(labelTwo).toContain("property-2");
    expect(labelTwo).toContain("draft");
  });

  it("keeps the lease id present as a secondary detail", () => {
    expect(leaseOptionLabel(data.leases[0], data)).toContain(SANDBOX_LEASE_ID);
  });

  it("clearly identifies the sandbox TEST lease by its real production id without hard-coding it in the component", () => {
    const label = leaseOptionLabel(data.leases[0], data);
    expect(label).toContain("Brandy Morgan");
    expect(label).toContain("TEST-");
    expect(label).toContain(SANDBOX_LEASE_ID);
  });
});

describe("RentalLeaseLifecyclePanel Lease Changes selector", () => {
  it("shows human-readable identity for every lease option while keeping the raw lease id as the option value", () => {
    const markup = renderToStaticMarkup(<RentalLeaseLifecyclePanel initialData={data} />);
    expect(markup).toContain(`value="${SANDBOX_LEASE_ID}"`);
    expect(markup).toContain(`value="${OTHER_LEASE_ID}"`);
    expect(markup).toContain("Brandy Morgan");
    expect(markup).toContain("Anthony Babino");
    expect(markup).toContain(SANDBOX_LEASE_ID);
  });

  it("does not silently omit identity for a lease with no resolvable tenant, unit, or property", () => {
    const orphanLease = { id: "rental_lease_orphan_1", unit_id: "unit_missing", property_id: null, status: "active", monthly_rent_cents: 50000 };
    const orphanData = { ...data, leases: [orphanLease], leaseMemberships: [] };
    const markup = renderToStaticMarkup(<RentalLeaseLifecyclePanel initialData={orphanData} />);
    expect(markup).toContain("Unknown tenant");
    expect(markup).toContain("Unknown unit");
    expect(markup).toContain("Unknown property");
  });
});

function mountPanel(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, root };
}
function unmountPanel({ container, root }) {
  act(() => { root.unmount(); });
  container.remove();
}
function findButtonByText(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
  if (!button) throw new Error(`No button found with text "${text}"`);
  return button;
}
async function clickButtonAndFlush(button) {
  await act(async () => {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
function setControlledSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

const leaseData = {
  leases: [{ id: "rental_lease_1", unit_id: "unit_1", property_id: "property-1", status: "active", monthly_rent_cents: 130000 }],
  units: [{ id: "unit_1", label: "Main residence", property_id: "property-1" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino" }],
  leaseMemberships: [{ lease_id: "rental_lease_1", tenant_id: "tenant_1" }],
  schedules: [], leaseChanges: [], lateFeeRules: [], openCharges: [],
};

describe("RentalLeaseLifecyclePanel Lease Changes field labeling", () => {
  it("gives every Lease Changes field a persistent visible label, not just a placeholder", () => {
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;
    const labelTexts = Array.from(container.querySelectorAll("form")[0].querySelectorAll("label")).map((label) => label.textContent);
    expect(labelTexts.some((text) => text.includes("Lease"))).toBe(true);
    expect(labelTexts.some((text) => text.includes("Change type"))).toBe(true);
    expect(labelTexts.some((text) => text.includes("Effective date"))).toBe(true);
    expect(labelTexts.some((text) => text.includes("New lease end date"))).toBe(true);
    expect(labelTexts.some((text) => text.includes("New monthly rent"))).toBe(true);
    expect(labelTexts.some((text) => text.includes("New rent due day"))).toBe(true);
    expect(labelTexts.some((text) => text.includes("Supporting document ID"))).toBe(true);
    expect(labelTexts.some((text) => text.includes("Reason"))).toBe(true);
    unmountPanel(mounted);
  });

  it("marks the New lease end date field as clearly optional", () => {
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;
    const endDateLabel = Array.from(container.querySelectorAll("label")).find((label) => label.textContent.includes("New lease end date"));
    expect(endDateLabel).toBeTruthy();
    expect(endDateLabel.textContent.toLowerCase()).toContain("optional");
    unmountPanel(mounted);
  });

  it("distinguishes Effective date from New lease end date instead of leaving either date unlabeled", () => {
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;
    const dateInputs = Array.from(container.querySelectorAll('input[type="date"]'));
    expect(dateInputs).toHaveLength(2);
    const [effectiveDateInput, endDateInput] = dateInputs;
    expect(effectiveDateInput.closest("label").textContent).toContain("Effective date");
    expect(endDateInput.closest("label").textContent).toContain("New lease end date");
    unmountPanel(mounted);
  });

  it("does not present the amendment's effective date as starting a new lease", () => {
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;
    const dateInputs = Array.from(container.querySelectorAll('input[type="date"]'));
    const [effectiveDateInput] = dateInputs;
    const effectiveDateLabelText = effectiveDateInput.closest("label").textContent.toLowerCase();
    expect(effectiveDateLabelText).not.toContain("start");
    expect(effectiveDateLabelText).not.toContain("new lease");
    unmountPanel(mounted);
  });

  it("explains that an amendment modifies the existing lease rather than starting a new one", () => {
    const markup = renderToStaticMarkup(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    expect(markup.toLowerCase()).toContain("does not start a new lease");
  });
});

describe("RentalLeaseLifecyclePanel Lease Changes conditional fields", () => {
  it("shows rent, due-day, and end-date fields (and hides proration amount) for the default Renewal type", () => {
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;
    expect(container.querySelector('input[name="monthlyRent"]')).toBeTruthy();
    expect(container.querySelector('input[name="rentDueDay"]')).toBeTruthy();
    expect(container.querySelector('input[name="endDate"]')).toBeTruthy();
    expect(container.querySelector('input[name="prorationAmount"]')).toBeNull();
    unmountPanel(mounted);
  });

  it("shows rent, due-day, and end-date fields (and hides proration amount) for Amendment", () => {
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;
    act(() => { setControlledSelectValue(container.querySelector('select[name="changeType"]'), "amendment"); });
    expect(container.querySelector('input[name="monthlyRent"]')).toBeTruthy();
    expect(container.querySelector('input[name="rentDueDay"]')).toBeTruthy();
    expect(container.querySelector('input[name="endDate"]')).toBeTruthy();
    expect(container.querySelector('input[name="prorationAmount"]')).toBeNull();
    unmountPanel(mounted);
  });

  it("hides rent, due-day, and end-date fields and shows a required proration amount field for Proration", () => {
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;
    act(() => { setControlledSelectValue(container.querySelector('select[name="changeType"]'), "proration"); });
    expect(container.querySelector('input[name="monthlyRent"]')).toBeNull();
    expect(container.querySelector('input[name="rentDueDay"]')).toBeNull();
    expect(container.querySelector('input[name="endDate"]')).toBeNull();
    const prorationInput = container.querySelector('input[name="prorationAmount"]');
    expect(prorationInput).toBeTruthy();
    expect(prorationInput.required).toBe(true);
    unmountPanel(mounted);
  });
});

describe("RentalLeaseLifecyclePanel Lease Changes submission contract", () => {
  it("submits the exact same leaseId and payload shape as before when saving an amendment", async () => {
    const fetchMock = vi.fn((url, options) => {
      if (options?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ success: true, change: { id: "change_1" } }) });
      return Promise.resolve({ ok: true, json: async () => leaseData });
    });
    vi.stubGlobal("fetch", fetchMock);
    const mounted = mountPanel(<RentalLeaseLifecyclePanel initialData={leaseData} />);
    const { container } = mounted;

    container.querySelector('select[name="leaseId"]').value = "rental_lease_1";
    act(() => { setControlledSelectValue(container.querySelector('select[name="changeType"]'), "amendment"); });
    container.querySelector('input[name="effectiveDate"]').value = "2026-09-01";
    container.querySelector('input[name="endDate"]').value = "2027-09-01";
    container.querySelector('input[name="monthlyRent"]').value = "20.00";
    container.querySelector('input[name="rentDueDay"]').value = "5";
    container.querySelector('input[name="reason"]').value = "Test amendment reason";

    await clickButtonAndFlush(findButtonByText(container, "Save draft change"));

    const postCall = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall[1].body);
    expect(body).toEqual({
      operation: "save-lease-change",
      change: {
        leaseId: "rental_lease_1", changeType: "amendment", effectiveDate: "2026-09-01", endDate: "2027-09-01",
        monthlyRentCents: 2000, rentDueDay: 5, amountCents: null, reason: "Test amendment reason", documentEvidenceId: null,
      },
    });
    vi.unstubAllGlobals();
    unmountPanel(mounted);
  });
});
