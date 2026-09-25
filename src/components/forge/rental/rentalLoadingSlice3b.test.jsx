// Slice B no-blank-screens contract: the converted rental panels serve cached
// data on first paint with no loading flash, keep last-good data when a
// refresh fails, and only show the shared Forge loading/error/empty states
// when there is genuinely nothing to display yet.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import RentalAutopayPanel from "./RentalAutopayPanel.jsx";
import RentalReconciliationPanel from "./RentalReconciliationPanel.jsx";
import RentalSupportPanel from "./RentalSupportPanel.jsx";
import RentalPaymentsPanel from "./RentalPaymentsPanel.jsx";
import RentalReportsPanel from "./RentalReportsPanel.jsx";
import RentalSetupPanel from "./RentalSetupPanel.jsx";
import RentalLeasePreparationPanel from "./RentalLeasePreparationPanel.jsx";
import RentalMaintenancePanel from "./RentalMaintenancePanel.jsx";
import RentalLeasePanel from "./RentalLeasePanel.jsx";
import RentalPhotoUpload from "./RentalPhotoUpload.jsx";
import RentecFileInventoryPanel from "./RentecFileInventoryPanel.jsx";
import RentecFinancialHistoryImportPanel from "./RentecFinancialHistoryImportPanel.jsx";

const autopayPayload = [{
  id: "enroll_1", status: "active", lease_id: "lease_1",
  payment_method_type: "bank_account", charge_day: 1,
  consented_at: "2026-09-01T10:00:00Z", cancelled_at: null,
}];

const reconciliationPayload = {
  payments: [{ id: "pay_1", provider: "stripe", status: "succeeded", amount_cents: 150000 }],
  settlements: [{ payment_id: "pay_1", status: "paid", net_amount_cents: 148500 }],
};

const supportPayload = [{
  id: "case_1", title: "Failed autopay retry", case_type: "failed_payment",
  priority: "high", status: "investigating",
}];

const paymentsPayload = {
  openCharges: [{
    id: "charge_1", period: "2026-09", due_date: "2026-09-01", amount_cents: 150000,
    paid_amount_cents: 0, charge_type: "rent", status: "open",
    lease_id: "lease_1", schedule_id: "sched_1",
  }],
  payments: [],
  settlements: [],
  schedules: [{
    id: "sched_1", lease_id: "lease_1", status: "active", amount_cents: 150000,
    due_day: 1, effective_start_date: "2026-08-29",
  }],
  billingEnabled: true,
  leases: [{ id: "lease_1", unit_id: "unit_1", status: "active" }],
  units: [{ id: "unit_1", label: "308 Paula", property_id: "308-paula" }],
  tenants: [{ id: "tenant_1", display_name: "Eric Carrillo" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
};

const stripeAccountPayload = { status: "enabled", requirements_due: [] };

const reportPayload = {
  reportKeyAtFetch: "",
  report: {
    summary: {
      monthlyScheduledCents: 150000, collectedCents: 150000, openBalanceCents: 0,
      overdueBalanceCents: 0, activeLeases: 1, occupiedUnits: 1,
      externallyManagedCents: 0, externallyManagedChargeCount: 0,
    },
    rentRoll: [],
  },
};
// Default filters produce an empty params string, so the rent-roll key is
// `rental:reports::0` (key format is `rental:reports:<params>:<refreshToken>`).
const RENT_ROLL_KEY = "rental:reports::0";

const setupPayload = {
  units: [{
    id: "unit_1", label: "308 Paula", property_id: "308-paula", status: "active",
    photo_url: null, bedrooms: 3, bathrooms: 2, square_feet: 1400, notes: null,
  }],
  leases: [], leaseMemberships: [], tenants: [], openCharges: [],
};

const leasePreparationPayload = {
  leases: [{ id: "lease_1", start_date: "2026-09-01" }],
  leasePreparations: [], leasePreparationVersions: [],
  leaseMemberships: [], leaseSignatures: [], tenants: [],
};

const maintenancePayload = {
  maintenanceRequests: [{
    id: "req_1", title: "Leaky faucet", description: "Kitchen faucet drips",
    status: "submitted", priority: "normal", permission_to_enter: true,
    submitted_at: "2026-09-20T10:00:00Z", contact_phone: "555-0100", owner_notes: null,
  }],
  contractors: [], workOrders: [], workEvents: [],
};

const leaseSetupPayload = {
  units: [{ id: "unit_1", label: "308 Paula", property_id: "308-paula" }],
  tenants: [{ id: "tenant_1", display_name: "Eric Carrillo" }],
  leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", start_date: "2026-08-29" }],
  schedules: [], leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }],
};

beforeEach(() => { clearSWRCache(); });

describe("slice B warm-switch behavior", () => {
  it("renders cached autopay enrollments instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:autopay", () => Promise.resolve(autopayPayload));
    const html = renderToStaticMarkup(<RentalAutopayPanel />);
    expect(html).toContain("lease_1");
    expect(html).not.toContain("Loading autopay");
  });

  it("shows the autopay skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalAutopayPanel />);
    expect(html).toContain("Loading autopay authorizations…");
  });

  it("keeps the last good autopay data visible when a refresh fails", async () => {
    await fetchWithDedupe("rental:autopay", () => Promise.resolve(autopayPayload));
    await fetchWithDedupe("rental:autopay", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<RentalAutopayPanel />);
    expect(html).toContain("lease_1");
    expect(html).not.toContain("Loading autopay");
  });

  it("renders the cached reconciliation table instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:reconciliation", () => Promise.resolve(reconciliationPayload));
    const html = renderToStaticMarkup(<RentalReconciliationPanel />);
    expect(html).toContain("pay_1");
    expect(html).toContain("$1,500.00");
    expect(html).not.toContain("Loading reconciliation");
  });

  it("shows the reconciliation skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalReconciliationPanel />);
    expect(html).toContain("Loading reconciliation…");
  });

  it("renders cached support cases instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:support", () => Promise.resolve(supportPayload));
    const html = renderToStaticMarkup(<RentalSupportPanel />);
    expect(html).toContain("Failed autopay retry");
    expect(html).not.toContain("Loading support cases");
  });

  it("shows the shared empty state when there are no support cases", async () => {
    await fetchWithDedupe("rental:support", () => Promise.resolve([]));
    const html = renderToStaticMarkup(<RentalSupportPanel />);
    expect(html).toContain("No open support cases");
  });

  it("shows the support skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalSupportPanel />);
    expect(html).toContain("Loading support cases…");
  });

  it("renders cached rent collection instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:payments", () => Promise.resolve(paymentsPayload));
    await fetchWithDedupe("rental:stripe-account", () => Promise.resolve(stripeAccountPayload));
    const html = renderToStaticMarkup(<RentalPaymentsPanel />);
    expect(html).toContain("2026-09");
    expect(html).toContain("Rent &amp; payments");
    expect(html).not.toContain("Loading rent collection");
  });

  it("shows the rent collection skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalPaymentsPanel />);
    expect(html).toContain("Loading rent collection…");
  });

  it("renders the cached rent roll instantly with no loading flash", async () => {
    await fetchWithDedupe(RENT_ROLL_KEY, () => Promise.resolve(reportPayload));
    const html = renderToStaticMarkup(<RentalReportsPanel />);
    expect(html).toContain("Monthly scheduled");
    expect(html).toContain("$1,500.00");
    expect(html).not.toContain("Loading report");
  });

  it("shows the report skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalReportsPanel />);
    expect(html).toContain("Loading report…");
  });

  it("renders cached rental units instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:setup", () => Promise.resolve(setupPayload));
    // initialUnits seeds the SSR-safe selection; the cached SWR payload drives the list.
    const html = renderToStaticMarkup(<RentalSetupPanel initialUnits={setupPayload.units} />);
    expect(html).toContain("308 Paula");
    expect(html).not.toContain("Loading rental units");
  });

  it("renders cached lease preparations instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:lease-preparation", () => Promise.resolve(leasePreparationPayload));
    const html = renderToStaticMarkup(<RentalLeasePreparationPanel />);
    expect(html).toContain("lease_1");
    expect(html).not.toContain("Loading lease preparations");
  });

  it("renders cached maintenance requests instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:maintenance", () => Promise.resolve(maintenancePayload));
    const html = renderToStaticMarkup(<RentalMaintenancePanel />);
    expect(html).toContain("Leaky faucet");
    expect(html).not.toContain("Loading maintenance");
  });

  it("renders cached leases instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:lease-setup", () => Promise.resolve(leaseSetupPayload));
    const html = renderToStaticMarkup(<RentalLeasePanel />);
    expect(html).toContain("Leases and rent schedules");
    expect(html).not.toContain("Loading leases");
  });
});

describe("slice B action-only panels need no conversion", () => {
  // These panels have no mount-time fetch — every network call sits behind an
  // explicit user action (photo upload/remove, "Inspect Rentec files", "Run
  // preview" / per-year approval). The no-blank contract is satisfied by
  // construction: first paint is complete static content with no loading
  // flash, and mounting fires zero requests.
  const stubFetch = () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("RentalPhotoUpload renders the placeholder and add button without fetching", () => {
    const fetchMock = stubFetch();
    try {
      const html = renderToStaticMarkup(
        <RentalPhotoUpload entityType="unit" entityId="unit_1" photoUrl={null} onUploaded={() => {}} />
      );
      expect(html).toContain("No photo");
      expect(html).toContain("Add photo");
      expect(html).not.toContain("Loading");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("RentecFileInventoryPanel renders the inspect CTA without fetching", () => {
    const fetchMock = stubFetch();
    try {
      const html = renderToStaticMarkup(<RentecFileInventoryPanel />);
      expect(html).toContain("Rentec files and renter photos");
      expect(html).toContain("Inspect Rentec files");
      expect(html).not.toContain("Loading");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("RentecFinancialHistoryImportPanel renders the preview CTA without fetching", () => {
    const fetchMock = stubFetch();
    try {
      const html = renderToStaticMarkup(<RentecFinancialHistoryImportPanel />);
      expect(html).toContain("Import Rentec financial history");
      expect(html).toContain("Run preview");
      expect(html).not.toContain("Loading");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
