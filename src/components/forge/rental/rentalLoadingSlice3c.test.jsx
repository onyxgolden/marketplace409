// Slice C warm-switch contract: the converted rentec-import, reservation, and
// tenant-portal panels serve cached data on first paint with no loading flash,
// keep last-good data when a refresh fails, and use ForgeStates for initial
// loading / error / empty states.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import RentecPaymentImportPanel from "./RentecPaymentImportPanel.jsx";
import ReservationInventoryPanel from "./ReservationInventoryPanel.jsx";
import ReservationOperationsDashboard from "./ReservationOperationsDashboard.jsx";
import ReservationsPanel from "./ReservationsPanel.jsx";
import TenantDocumentsPanel from "./TenantDocumentsPanel.jsx";
import TenantPortal from "./TenantPortal.jsx";

const linkedPropertiesPayload = [{ id: "prop_1", label: "308 Paula" }];

const inventoryPayload = {
  units: [{ id: "unit_1", label: "Unit A" }],
  inventory: [{
    unit_id: "unit_1", public_name: "Lakeside Cabin", inventory_type: "cabin",
    maximum_guests: 4, minimum_nights: 2, booking_status: "active",
    public_booking_slug: "lakeside-cabin",
  }],
};

const dashboardPayload = {
  dashboard: {
    summary: {
      totalActiveInventory: 2, availableInventory: 1, occupiedInventory: 1, blockedInventory: 0,
      occupancyRate: 0.5, occupiedNights: 45, capacityNights: 90,
      expectedRevenueCents: 450000, upcomingArrivals: 3, upcomingDepartures: 2,
    },
    occupancyTrend: [],
    revenueByType: [{ type: "cabin", amountCents: 450000 }],
  },
};

const reservationsPayload = {
  inventory: [{ unit_id: "unit_1", public_name: "Lakeside Cabin", booking_status: "active" }],
  reservations: [{
    id: "res_1", unit_id: "unit_1",
    reservation_inventory_settings: { public_name: "Lakeside Cabin" },
    reservation_guests: { display_name: "Jane Guest", email: "jane@example.com", phone: "" },
    check_in_date: "2026-10-01", check_out_date: "2026-10-03", guest_count: 2,
    owner_notes: "", total_due_cents: 30000, status: "confirmed", financial: null,
    reservation_financial_contracts: null,
  }],
  events: [],
};

const tenantDocumentsPayload = {
  documents: [{
    id: "doc_1", title: "Lease agreement", category: "lease", original_filename: "lease.pdf",
    download_url: "/api/rental/documents/doc_1", acknowledgements: [],
  }],
  preparations: [],
};

const tenantPortalPayload = {
  tenant: { displayName: "Jane Tenant" },
  rentals: [],
  billingEnabled: true,
  conversation: { messages: [] },
};

beforeEach(() => { clearSWRCache(); });
afterEach(() => { clearSWRCache(); });

describe("slice C warm-switch behavior", () => {
  it("renders the cached Rentec-linked property list instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:rentec-linked-properties", () => Promise.resolve(linkedPropertiesPayload));
    const html = renderToStaticMarkup(<RentecPaymentImportPanel />);
    expect(html).toContain("308 Paula");
    expect(html).not.toContain("Loading your Rentec-linked properties");
  });

  it("shows the Rentec property skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentecPaymentImportPanel />);
    expect(html).toContain("Loading your Rentec-linked properties…");
  });

  it("keeps the last good property list visible when a refresh fails", async () => {
    await fetchWithDedupe("rental:rentec-linked-properties", () => Promise.resolve(linkedPropertiesPayload));
    await fetchWithDedupe("rental:rentec-linked-properties", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<RentecPaymentImportPanel />);
    expect(html).toContain("308 Paula");
    expect(html).not.toContain("Loading your Rentec-linked properties");
  });

  it("renders the cached reservation inventory instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:reservation-inventory", () => Promise.resolve(inventoryPayload));
    const html = renderToStaticMarkup(<ReservationInventoryPanel />);
    expect(html).toContain("Lakeside Cabin");
    expect(html).not.toContain("Loading reservation inventory");
  });

  it("shows the inventory skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<ReservationInventoryPanel />);
    expect(html).toContain("Loading reservation inventory…");
  });

  it("renders the cached operations dashboard instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:reservations-dashboard:90", () => Promise.resolve(dashboardPayload));
    const html = renderToStaticMarkup(<ReservationOperationsDashboard />);
    expect(html).toContain("Reservation dashboard");
    expect(html).toContain("$4,500");
    expect(html).not.toContain("Loading reservation operations");
  });

  it("shows the dashboard skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<ReservationOperationsDashboard />);
    expect(html).toContain("Loading reservation operations…");
  });

  it("renders the cached reservation list instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:reservations", () => Promise.resolve(reservationsPayload));
    const html = renderToStaticMarkup(<ReservationsPanel />);
    expect(html).toContain("Jane Guest");
    expect(html).not.toContain("Loading reservations");
  });

  it("shows the reservations skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<ReservationsPanel />);
    expect(html).toContain("Loading reservations…");
  });

  it("shows the honest empty state when the cached reservation list is empty", async () => {
    await fetchWithDedupe("rental:reservations", () => Promise.resolve({ inventory: [], reservations: [], events: [] }));
    const html = renderToStaticMarkup(<ReservationsPanel />);
    expect(html).toContain("No reservations yet.");
    expect(html).not.toContain("Loading reservations");
  });

  it("shows the shared error state when the reservations load fails with nothing cached", async () => {
    await fetchWithDedupe("rental:reservations", () => Promise.reject(new Error("network down"))).catch(() => {});
    const html = renderToStaticMarkup(<ReservationsPanel />);
    expect(html).toContain("Unable to load reservations.");
    expect(html).toContain("network down");
  });

  it("renders the cached tenant documents instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:tenant-documents", () => Promise.resolve(tenantDocumentsPayload));
    const html = renderToStaticMarkup(<TenantDocumentsPanel />);
    expect(html).toContain("Lease agreement");
    expect(html).not.toContain("Loading documents");
  });

  it("shows the documents skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<TenantDocumentsPanel />);
    expect(html).toContain("Loading documents…");
  });

  it("keeps the last good documents visible when a refresh fails", async () => {
    await fetchWithDedupe("rental:tenant-documents", () => Promise.resolve(tenantDocumentsPayload));
    await fetchWithDedupe("rental:tenant-documents", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(<TenantDocumentsPanel />);
    expect(html).toContain("Lease agreement");
    expect(html).not.toContain("Loading documents");
  });

  it("renders the cached tenant portal instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:tenant-portal", () => Promise.resolve(tenantPortalPayload));
    const html = renderToStaticMarkup(<TenantPortal />);
    expect(html).toContain("Jane Tenant");
    expect(html).not.toContain("Loading your tenant portal");
  });

  it("shows the portal skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<TenantPortal />);
    expect(html).toContain("Loading your tenant portal…");
  });

  it("shows the shared error state when the portal load fails with nothing cached", async () => {
    await fetchWithDedupe("rental:tenant-portal", () => Promise.reject(new Error("network down"))).catch(() => {});
    const html = renderToStaticMarkup(<TenantPortal />);
    expect(html).toContain("Unable to load your tenant portal.");
    expect(html).toContain("network down");
  });
});
