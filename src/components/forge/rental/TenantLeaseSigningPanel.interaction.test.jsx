// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import TenantLeaseSigningPanel from "./TenantLeaseSigningPanel.jsx";

const rental = { lease: { id: "lease_1", startDate: "2026-10-01", endDate: null }, unit: { label: "1214 Wagner" },
  leaseSigning: { preparationId: "prep_1", versionNumber: 1, approvedAt: "2026-09-01T00:00:00Z",
    terms: { monthlyRent: "1500" }, changeSummary: "Initial terms", signedByMe: false, mySignedAt: null,
    totalTenants: 1, signatures: [] } };

describe("TenantLeaseSigningPanel interaction", () => {
  let container; let root;
  afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); vi.unstubAllGlobals(); });

  it("submits the typed name to the sign-lease operation and refreshes the portal on success", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, signature: { signatureId: "sig_1" } }) }));
    vi.stubGlobal("fetch", fetch);
    const onSigned = vi.fn();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<TenantLeaseSigningPanel rentals={[rental]} onSigned={onSigned} />));
    const form = container.querySelector("form");
    container.querySelector('input[name="signerName"]').value = "Jane Tenant";
    container.querySelector('input[name="acknowledged"]').checked = true;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(fetch).toHaveBeenCalledWith("/api/rental/portal", expect.objectContaining({ method: "POST",
      body: JSON.stringify({ operation: "sign-lease", leaseId: "lease_1", preparationId: "prep_1", versionNumber: 1, signerName: "Jane Tenant" }) }));
    expect(onSigned).toHaveBeenCalled();
  });

  it("shows the server's rejection message and does not call onSigned when signing fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ error: "Only the currently approved lease version can be signed." }) })));
    const onSigned = vi.fn();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<TenantLeaseSigningPanel rentals={[rental]} onSigned={onSigned} />));
    const form = container.querySelector("form");
    container.querySelector('input[name="signerName"]').value = "Jane Tenant";
    container.querySelector('input[name="acknowledged"]').checked = true;
    await act(async () => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain("Only the currently approved lease version can be signed.");
    expect(onSigned).not.toHaveBeenCalled();
  });

  it("does not render a signing form once this tenant has already signed", async () => {
    const signedRental = { ...rental, leaseSigning: { ...rental.leaseSigning, signedByMe: true, mySignedAt: "2026-09-05T10:00:00Z",
      signatures: [{ tenantId: "tenant_1", signerName: "Jane Tenant", signedAt: "2026-09-05T10:00:00Z", displayName: "Jane Tenant" }] } };
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    await act(async () => root.render(<TenantLeaseSigningPanel rentals={[signedRental]} onSigned={vi.fn()} />));
    expect(container.querySelector("form")).toBeNull();
  });
});
