import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalPaymentsPanel, { buildRentActivity, paymentDisplayTimestamp, paymentReceiptReference } from "./RentalPaymentsPanel.jsx";
import RentalMaintenancePanel from "./RentalMaintenancePanel.jsx";
import RentalDocumentsPanel from "./RentalDocumentsPanel.jsx";

describe("rental daily workflows", () => {
  it("combines charges and payments with settlement state", () => {
    const rows = buildRentActivity([{ id: "charge_1" }], [{ id: "payment_1" }], [{ payment_id: "payment_1", status: "available" }]);
    expect(rows.map((row) => row.id)).toEqual(["charge:charge_1", "payment:payment_1"]);
    expect(rows[1].settlement.status).toBe("available");
  });

  it("uses successful payment evidence and a short receipt reference", () => {
    const payment = { sourceId: "rental_payment_e7f578e2-61b1-40f8-94c5-0be06b722fe3", received_at: null, succeeded_at: "2026-08-12T20:30:00Z", created_at: "2026-08-11T20:30:00Z" };
    expect(paymentDisplayTimestamp(payment)).toBe("2026-08-12T20:30:00Z");
    expect(paymentReceiptReference(payment)).toBe("FORGE-6B722FE3");
    expect(paymentReceiptReference(payment)).not.toContain("rental_payment");
  });

  it("renders selected rent detail and hides setup and offline entry", () => {
    const markup = renderToStaticMarkup(<RentalPaymentsPanel initialAccount={{ status: "enabled" }} initialData={{ openCharges: [{ id: "charge_1", period: "2026-08", due_date: "2026-08-01", amount_cents: 200000, paid_amount_cents: 50000, status: "partially_paid", charge_type: "rent" }], payments: [], settlements: [], schedules: [] }} />);
    expect(markup).toContain("Selected charge");
    expect(markup).toContain("$1,500.00");
    expect(markup).not.toContain('aria-label="Record offline payment"');
    expect(markup).not.toContain("Lease activation and charge generation");
  });

  it("renders one selected maintenance request and hides setup forms", () => {
    const markup = renderToStaticMarkup(<RentalMaintenancePanel initialData={{ maintenanceRequests: [{ id: "request_1", title: "Leaking sink", description: "Water below cabinet", status: "submitted", priority: "high", permission_to_enter: true }], contractors: [], workOrders: [], workEvents: [] }} />);
    expect(markup).toContain("Selected request");
    expect(markup).toContain("Leaking sink");
    expect(markup).toContain("No work order has been created");
    expect(markup).not.toContain('aria-label="Add contractor"');
    expect(markup).not.toContain('aria-label="Create work order"');
  });

  it("renders selected document access without exposing storage identifiers", () => {
    const markup = renderToStaticMarkup(<RentalDocumentsPanel initialData={{ schedules: [], documents: [{ id: "document_1", lease_id: "lease_1", title: "Signed lease", category: "lease", tenant_visible: false, original_filename: "lease.pdf", download_url: "/signed", acknowledgements: [], bucket: "secret-bucket", object_path: "owner/secret-path" }] }} />);
    expect(markup).toContain("Selected document");
    expect(markup).toContain("Private to landlord");
    expect(markup).toContain("No tenant acknowledgement recorded");
    expect(markup).not.toContain("secret-bucket");
    expect(markup).not.toContain("secret-path");
    expect(markup).not.toContain('aria-label="Upload rental document"');
  });
});
