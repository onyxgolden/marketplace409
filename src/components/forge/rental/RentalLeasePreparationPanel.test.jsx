// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "../../../hooks/swrCache";
import RentalLeasePreparationPanel from "./RentalLeasePreparationPanel.jsx";

const portalData = {
  leases: [{ id: "lease_1", start_date: "2026-10-01" }],
  leasePreparations: [{ id: "prep_1", lease_id: "lease_1", title: "Residential lease", status: "approved", current_version: 1, approved_version: 1 }],
  leasePreparationVersions: [{ preparation_id: "prep_1", version_number: 1, change_summary: "Initial terms" }],
  leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1" }, { lease_id: "lease_1", tenant_id: "tenant_2" }],
  leaseSignatures: [{ id: "sig_1", lease_id: "lease_1", preparation_id: "prep_1", version_number: 1, tenant_id: "tenant_1", signer_name: "Jane Tenant", signed_at: "2026-09-05T10:00:00Z" }],
  tenants: [{ id: "tenant_1", display_name: "Jane Tenant" }, { id: "tenant_2", display_name: "Co Tenant" }],
};

describe("RentalLeasePreparationPanel signature status", () => {
  let container; let root;
  afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.unstubAllGlobals(); clearSWRCache(); });

  it("shows each tenant's signing status once a version is approved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => portalData })));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalLeasePreparationPanel />));
    expect(container.textContent).toContain("Jane Tenant — signed");
    expect(container.textContent).toContain("Co Tenant — awaiting signature");
  });

  it("shows no signature roster for a version that has not been approved yet", async () => {
    const draftData = { ...portalData,
      leasePreparations: [{ id: "prep_1", lease_id: "lease_1", title: "Residential lease", status: "draft", current_version: 1, approved_version: null }] };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => draftData })));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<RentalLeasePreparationPanel />));
    expect(container.textContent).not.toContain("awaiting signature");
  });
});
