// Slice 2 warm-switch contract: the converted rental panels serve cached data on
// first paint with no loading flash, and keep last-good data when a refresh fails.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { clearSWRCache, fetchWithDedupe } from "../../../hooks/swrCache";
import TenantLedgerPage from "./TenantLedgerPage.jsx";
import RentalDocumentsPanel from "./RentalDocumentsPanel.jsx";
import RentalTenantPanel from "./RentalTenantPanel.jsx";

const ledgerPayload = {
  ledger: {
    entries: [{
      id: "entry_1", kind: "charge", date: "2026-09-01", label: "September rent",
      amountCents: 100000, balanceAfterCents: 100000, status: "open",
      unitLabel: "308 Paula", propertyLabel: "308 Paula", period: "2026-09",
      method: null, reference: null,
    }],
    balanceCents: 100000,
    unassigned: [],
  },
  deposits: { heldCents: 0, entries: [] },
  importedHistory: { rows: [], totalCents: 0 },
  openCharges: [],
};

const documentPayload = {
  documents: [{
    id: "doc_1", title: "Lease agreement", category: "lease", tenant_visible: false,
    property_id: null, lease_id: "lease_1", version_number: 1, is_current_version: true,
    document_date: "2026-08-15", created_at: "2026-08-15T10:00:00Z",
    original_filename: "lease.pdf", acknowledgements: [],
  }],
  schedules: [],
};

const masterPayload = {
  tenants: [{ id: "tenant_1", display_name: "Jane Tenant", email: "jane@example.com", status: "active" }],
  leases: [],
  leaseMemberships: [],
  units: [],
  openCharges: [],
};

beforeEach(() => { clearSWRCache(); });

describe("slice 2 warm-switch behavior", () => {
  it("renders the cached tenant ledger instantly with no loading flash", async () => {
    await fetchWithDedupe("tenant-ledger:tenant_1", () => Promise.resolve(ledgerPayload));
    const html = renderToStaticMarkup(
      <TenantLedgerPage tenantId="tenant_1" tenantName="Jane Tenant" unitLabel="308 Paula" onClose={() => {}} />,
    );
    expect(html).toContain("September rent");
    expect(html).not.toContain("Loading ledger");
  });

  it("shows the ledger skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(
      <TenantLedgerPage tenantId="cold-tenant" tenantName="Jane Tenant" onClose={() => {}} />,
    );
    expect(html).toContain("Loading ledger…");
  });

  it("keeps the last good ledger visible when a refresh fails", async () => {
    await fetchWithDedupe("tenant-ledger:tenant_1", () => Promise.resolve(ledgerPayload));
    await fetchWithDedupe("tenant-ledger:tenant_1", () => Promise.reject(new Error("refresh failed"))).catch(() => {});
    const html = renderToStaticMarkup(
      <TenantLedgerPage tenantId="tenant_1" tenantName="Jane Tenant" onClose={() => {}} />,
    );
    expect(html).toContain("September rent");
    expect(html).not.toContain("Loading ledger");
  });

  it("renders the cached document library instantly with no loading flash", async () => {
    await fetchWithDedupe("rental-documents:all", () => Promise.resolve(documentPayload));
    const html = renderToStaticMarkup(<RentalDocumentsPanel />);
    expect(html).toContain("Lease agreement");
    expect(html).not.toContain("Loading documents");
  });

  it("shows the document skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalDocumentsPanel />);
    expect(html).toContain("Loading documents…");
  });

  it("renders the cached tenant list instantly with no loading flash", async () => {
    await fetchWithDedupe("rental:tenants", () => Promise.resolve(masterPayload));
    const html = renderToStaticMarkup(<RentalTenantPanel initialTenants={[]} />);
    expect(html).toContain("Jane Tenant");
    expect(html).not.toContain("Loading tenants");
  });

  it("shows the tenant skeleton only when nothing is cached", () => {
    const html = renderToStaticMarkup(<RentalTenantPanel initialTenants={[]} />);
    expect(html).toContain("Loading tenants…");
  });
});
