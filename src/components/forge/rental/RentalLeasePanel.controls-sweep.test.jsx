// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalLeasePanel from "./RentalLeasePanel";

const baseSetup = {
  units: [{ id: "unit_1", label: "1218 Wagner", property_id: "1218-wagner" }],
  tenants: [{ id: "tenant_1", display_name: "Anthony Babino", email: "a@example.com" }],
  schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active" }],
  leaseMemberships: [],
};

describe("RentalLeasePanel controls sweep — B1 end lease", () => {
  it("shows an End this lease action for an active lease", () => {
    const setup = { ...baseSetup, leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "active", monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("End this lease");
  });

  it("shows no End this lease action for draft or ended leases", () => {
    for (const status of ["draft", "ended", "cancelled"]) {
      const setup = { ...baseSetup, leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status, monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01" }] };
      const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
      expect(markup).not.toContain("End this lease");
    }
  });
});

describe("RentalLeasePanel controls sweep — G1 cancelled-lease early-pay guard", () => {
  it("hides the early-pay form and explains on a cancelled lease with a schedule", () => {
    const setup = { ...baseSetup, leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "cancelled", monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("early-pay window cannot be changed");
    expect(markup).not.toContain("How many days before the due date");
  });

  it("keeps the early-pay form on an active lease with a schedule", () => {
    const setup = { ...baseSetup, leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "1218-wagner", status: "active", monthly_rent_cents: 130000, rent_due_day: 1, start_date: "2026-08-01" }] };
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("How many days before the due date");
  });
});

describe("RentalLeasePanel controls sweep — G2 lease-side membership path", () => {
  const g2Tenants = [
    { id: "tenant_1", display_name: "Steven Crabtree", email: "s@example.com" },
    { id: "tenant_2", display_name: "Jessica Crabtree", email: "j@example.com" },
    { id: "tenant_3", display_name: "New Person", email: "n@example.com" },
  ];
  const g2Memberships = [
    { id: "m_1", lease_id: "lease_1", tenant_id: "tenant_1", role: "primary" },
    { id: "m_2", lease_id: "lease_1", tenant_id: "tenant_2", role: "co_tenant" },
  ];
  const g2Setup = (status) => ({
    units: [{ id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" }],
    tenants: g2Tenants,
    schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active" }],
    leaseMemberships: g2Memberships,
    leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "4225-barnhill", status, monthly_rent_cents: 180000, rent_due_day: 1, start_date: "2026-10-13" }],
  });

  it("lists members with roles and tenant-record links, plus Make primary, Remove, and Add", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={g2Setup("active")} loadOnMount={false} />);
    expect(markup).toContain("Tenants on this lease");
    expect(markup).toContain("Steven Crabtree");
    expect(markup).toContain("Jessica Crabtree");
    expect(markup).toContain("primary");
    expect(markup).toContain("co_tenant");
    expect(markup).toContain("section=tenants");
    expect(markup).toContain("recordId=tenant_2");
    expect(markup).toContain("Make primary");
    expect(markup).toContain("Remove co-tenant");
    expect(markup).toContain("Add co-tenant");
  });

  it("hides membership actions and explains on a cancelled lease", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={g2Setup("cancelled")} loadOnMount={false} />);
    expect(markup).toContain("This lease is cancelled — membership cannot be changed.");
    expect(markup).not.toContain("Make primary");
    expect(markup).not.toContain("Remove co-tenant");
    expect(markup).not.toContain("Add co-tenant");
  });

  it("hides the add form and names the primary-first gate when no primary exists", () => {
    const setup = g2Setup("active");
    setup.leaseMemberships = [{ id: "m_2", lease_id: "lease_1", tenant_id: "tenant_2", role: "co_tenant" }];
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />);
    expect(markup).toContain("has no primary tenant — make one primary below");
    expect(markup).not.toContain("Add co-tenant");
    expect(markup).toContain("Make primary");
  });
});

describe("RentalLeasePanel controls sweep — G2 lease-side add posts", () => {
  it("posts add-co-tenant and confirms with the tenant name", async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const posted = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = options?.body ? JSON.parse(options.body) : null;
      posted.push(body);
      return { ok: true, json: async () => ({ ok: true }) };
    };
    try {
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const setup = {
        units: [{ id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" }],
        tenants: [
          { id: "tenant_1", display_name: "Steven Crabtree", email: "s@example.com" },
          { id: "tenant_3", display_name: "New Person", email: "n@example.com" },
        ],
        schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active" }],
        leaseMemberships: [{ id: "m_1", lease_id: "lease_1", tenant_id: "tenant_1", role: "primary" }],
        leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "4225-barnhill", status: "active", monthly_rent_cents: 180000, rent_due_day: 1, start_date: "2026-10-13" }],
      };
      await act(async () => { root.render(<RentalLeasePanel initialSetup={setup} loadOnMount={false} />); });
      const detail = container.querySelector("[data-rental-lease-detail]");
      const form = [...detail.querySelectorAll("form")].find((candidate) => candidate.querySelector('select[name="coTenantId"]'));
      expect(form).toBeTruthy();
      form.querySelector('select[name="coTenantId"]').value = "tenant_3";
      await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
      const ops = posted.filter(Boolean);
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ operation: "add-co-tenant", leaseId: "lease_1", tenantId: "tenant_3" });
      expect(container.textContent).toContain("Co-tenant added: New Person.");
      await act(async () => { root.unmount(); });
      container.remove();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("RentalLeasePanel controls sweep — G3 cancelled-lease recovery", () => {
  const g3Setup = (status) => ({
    units: [{ id: "unit_1", label: "4225 Barnhill", property_id: "4225-barnhill" }],
    tenants: [{ id: "tenant_1", display_name: "Steven Crabtree", email: "s@example.com" }],
    schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "draft" }],
    leaseMemberships: [],
    leases: [{ id: "lease_1", unit_id: "unit_1", property_id: "4225-barnhill", status, monthly_rent_cents: 180000, rent_due_day: 1, start_date: "2026-10-13" }],
  });

  it("offers Restore plus a replacement pointer on a cancelled lease", () => {
    const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={g3Setup("cancelled")} loadOnMount={false} />);
    expect(markup).toContain("Restore this lease");
    expect(markup).toContain("cannot be edited");
    expect(markup).toContain("add a replacement lease");
  });

  it("offers no Restore on draft or active leases", () => {
    for (const status of ["draft", "active"]) {
      const markup = renderToStaticMarkup(<RentalLeasePanel initialSetup={g3Setup(status)} loadOnMount={false} />);
      expect(markup).not.toContain("Restore this lease");
    }
  });
});
