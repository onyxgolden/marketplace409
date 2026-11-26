// Slice 1 (Rental Partial Open) — data-parity ledger, in test form.
//
// The projections narrow the payload; they must not change a single displayed
// figure. This file proves it at the builder level: the same underlying rows,
// once in the monolith's full shape and once projected through the exact
// column lists the server selects, must build byte-identical summaries (and
// identical tenant-index derivations). The projector below is written
// independently from the builder's reads, NOT imported from the server module —
// the route-level test separately asserts the server's actual select strings.
// If the server drops a column the builder reads, the route test fails; if the
// column lists are insufficient, this test fails.
import { describe, expect, it } from "vitest";
import { buildRentalDashboardSummary } from "./buildRentalDashboardSummary";
import { mapWorkOrderToMaintenanceQueueItem, summaryPhotoRecordIds } from "./rentalReadProjections";

const TODAY = "2026-11-26";

// --- Monolith-shaped fixture (full rows, as GET /api/rental ships them) ---
const monolithUnits = [
  { id: "unit_1", property_id: "prop_a", label: "101 Main St", status: "occupied", photo_bucket: "rental-photos", photo_object_path: "u1.jpg", photo_url: "https://signed/u1.jpg" },
  { id: "unit_2", property_id: "prop_a", label: "102 Main St", status: "available", photo_bucket: "rental-photos", photo_object_path: "u2.jpg", photo_url: "https://signed/u2.jpg" },
  { id: "unit_3", property_id: "prop_b", label: "55 Oak Ave", status: "occupied", photo_bucket: null, photo_object_path: null, photo_url: null },
  { id: "unit_4", property_id: "prop_b", label: "56 Oak Ave", status: "available", photo_bucket: null, photo_object_path: null, photo_url: null },
  // Out-of-union units: beyond the first 8 in label order (unit_9, unit_10)
  // and beyond the first 6 vacant (unit_9 is the 7th vacant). The monolith
  // signs their photos; the projection must not — and the built summary must
  // still be identical, because the builder never reads those photo URLs.
  { id: "unit_5", property_id: "prop_b", label: "57 Oak Ave", status: "available", photo_bucket: null, photo_object_path: null, photo_url: null },
  { id: "unit_6", property_id: "prop_b", label: "58 Oak Ave", status: "available", photo_bucket: null, photo_object_path: null, photo_url: null },
  { id: "unit_7", property_id: "prop_b", label: "59 Oak Ave", status: "available", photo_bucket: null, photo_object_path: null, photo_url: null },
  { id: "unit_8", property_id: "prop_b", label: "60 Oak Ave", status: "available", photo_bucket: null, photo_object_path: null, photo_url: null },
  { id: "unit_9", property_id: "prop_b", label: "61 Oak Ave", status: "available", photo_bucket: "rental-photos", photo_object_path: "u9.jpg", photo_url: "https://signed/u9.jpg" },
  { id: "unit_10", property_id: "prop_b", label: "62 Oak Ave", status: "available", photo_bucket: "rental-photos", photo_object_path: "u10.jpg", photo_url: "https://signed/u10.jpg" },
];
const monolithLeases = [
  { id: "lease_1", unit_id: "unit_1", status: "active", start_date: "2026-01-01", end_date: "2026-12-15", monthly_rent_cents: 160000, property_id: "prop_a" },
  { id: "lease_2", unit_id: "unit_3", status: "active", start_date: "2026-03-01", end_date: "2027-06-01", monthly_rent_cents: 185000, property_id: "prop_b" },
  { id: "lease_3", unit_id: "unit_2", status: "ended", start_date: "2025-01-01", end_date: "2025-12-31", monthly_rent_cents: 150000, property_id: "prop_a" },
];
const monolithPayments = [
  { id: "pay_1", charge_id: "ch_1", lease_id: "lease_1", tenant_id: "t1", provider: "stripe", amount_cents: 160000, refunded_amount_cents: 0, currency_code: "USD", status: "succeeded", payment_method: "card", received_at: "2026-11-02T10:00:00Z", succeeded_at: "2026-11-02T10:00:00Z", created_at: "2026-11-02T10:00:00Z", deposit_state: "deposited", deposited_at: "2026-11-03T00:00:00Z" },
  { id: "pay_2", charge_id: "ch_2", lease_id: "lease_2", tenant_id: "t2", provider: "offline", amount_cents: 185000, refunded_amount_cents: 5000, currency_code: "USD", status: "succeeded", payment_method: "cash", received_at: "2026-11-05T10:00:00Z", succeeded_at: null, created_at: "2026-11-05T10:00:00Z", deposit_state: "received", deposited_at: null },
  { id: "pay_3", charge_id: "ch_3", lease_id: "lease_1", tenant_id: "t1", provider: "stripe", amount_cents: 160000, refunded_amount_cents: 0, currency_code: "USD", status: "failed", payment_method: "card", received_at: null, succeeded_at: null, created_at: "2026-10-01T10:00:00Z", deposit_state: "received", deposited_at: null },
];
const monolithSettlements = [
  { id: "set_1", payment_id: "pay_1", provider: "stripe", status: "paid_out", gross_amount_cents: 160000, fee_amount_cents: 4000, net_amount_cents: 156000, created_at: "2026-11-03T00:00:00Z" },
];
const monolithMaintenanceRequests = [
  { id: "mr_1", lease_id: "lease_1", unit_id: "unit_1", tenant_id: "t1", title: "Leaky faucet", description: "drips", priority: "urgent", status: "open", permission_to_enter: true, contact_phone: "555", owner_notes: "", submitted_at: "2026-11-20T09:00:00Z", updated_at: "2026-11-20T09:00:00Z", completed_at: null },
  { id: "mr_2", lease_id: "lease_2", unit_id: "unit_3", tenant_id: "t2", title: "AC filter", description: "", priority: "low", status: "completed", permission_to_enter: true, contact_phone: "", owner_notes: "", submitted_at: "2026-11-01T09:00:00Z", updated_at: "2026-11-10T09:00:00Z", completed_at: "2026-11-10T09:00:00Z" },
];
const monolithWorkOrders = [
  { id: "wo_1", owner_id: "owner_1", request_id: "mr_1", contractor_id: null, status: "in_progress", scope_of_work: "Replace faucet", scheduled_start: "2026-11-21T09:00:00Z", scheduled_end: null, entry_instructions: "", estimated_cost_cents: 12000, actual_cost_cents: null, invoice_reference: null, invoice_document_id: null, completion_document_id: null, completed_at: null, created_at: "2026-11-21T08:00:00Z", updated_at: "2026-11-21T08:00:00Z" },
  { id: "wo_2", owner_id: "owner_1", request_id: "mr_2", contractor_id: null, status: "completed", scope_of_work: "Filter swap", scheduled_start: null, scheduled_end: null, entry_instructions: "", estimated_cost_cents: 500, actual_cost_cents: 500, invoice_reference: null, invoice_document_id: null, completion_document_id: null, completed_at: "2026-11-10T09:00:00Z", created_at: "2026-11-09T08:00:00Z", updated_at: "2026-11-10T09:00:00Z" },
];
const monolithBody = {
  actingUserId: "owner_1",
  canonicalOwnerId: "owner_1",
  units: monolithUnits,
  leases: monolithLeases,
  payments: monolithPayments,
  settlements: monolithSettlements,
  maintenanceRequests: monolithMaintenanceRequests,
  workOrders: monolithWorkOrders,
  insurancePolicies: [
    { id: "ins_1", lease_id: "lease_1", status: "verified", expiration_date: "2027-01-01" },
    { id: "ins_2", lease_id: "lease_2", status: "expired", expiration_date: "2026-01-01" },
  ],
  deposits: [{ id: "dep_1", lease_id: "lease_1", created_at: "2026-01-01T00:00:00Z" }],
  inspections: [
    { id: "insp_1", lease_id: "lease_1", inspection_type: "move_in", status: "completed", inspection_date: "2026-01-02" },
    { id: "insp_2", lease_id: "lease_2", inspection_type: "move_in", status: "draft", inspection_date: "2026-03-02" },
  ],
  supportCases: [
    { id: "sc_1", status: "open", opened_at: "2026-11-15T00:00:00Z" },
    { id: "sc_2", status: "closed", opened_at: "2026-10-01T00:00:00Z" },
  ],
  schedules: [
    { id: "sch_1", lease_id: "lease_1", status: "active", amount_cents: 160000, collection_mode: "forge", collection_provider: "stripe", forge_cutover_date: "2026-01-01", payment_frequency: "monthly" },
    { id: "sch_2", lease_id: "lease_2", status: "active", amount_cents: 185000, collection_mode: "external", collection_provider: "rentec", forge_cutover_date: null, payment_frequency: "monthly" },
  ],
  billingEnabled: true,
  propertyFinancialSetups: [
    { property_id: "prop_a", purchase_date: "2020-01-01", purchase_price_cents: 14500000, down_payment_cents: 2000000, closing_costs_cents: 500000 },
  ],
  financialEvents: [
    { event_date: "2026-11-01", amount: 160000, transaction_kind: "income", source_system: "forge", status: "posted", is_deleted: false, business_scope: "rental", property_id: "prop_a", normalized_category: "rent", affects_noi: true, capitalized: false },
    { event_date: "2026-11-03", amount: -12000, transaction_kind: "expense", source_system: "forge", status: "posted", is_deleted: false, business_scope: "rental", property_id: "prop_a", normalized_category: "maintenance", affects_noi: true, capitalized: false },
  ],
};
const reportFixture = {
  summary: {
    overdueBalanceCents: 32000,
    openBalanceCents: 47000,
    externallyManagedCents: 15000,
    externallyManagedChargeCount: 1,
    monthlyScheduledCents: 345000,
    collectedCents: 340000,
  },
};

// --- Projection of the same rows through the server's column lists ---
function pick(row, columns) {
  const out = {};
  for (const column of columns) out[column] = row[column] ?? null;
  return out;
}
function projectSummaryBody(monolith) {
  const photoIds = summaryPhotoRecordIds(monolith.units, monolith.leases);
  return {
    actingUserId: monolith.actingUserId,
    canonicalOwnerId: monolith.canonicalOwnerId,
    units: monolith.units.map((unit) => ({
      ...pick(unit, ["id", "property_id", "label", "photo_bucket", "photo_object_path"]),
      photo_url: photoIds.has(unit.id) ? unit.photo_url : null,
    })),
    leases: monolith.leases.map((lease) => pick(lease, ["id", "unit_id", "status", "end_date"])),
    payments: monolith.payments.map((payment) => pick(payment, ["id", "status", "succeeded_at", "received_at", "created_at", "amount_cents", "refunded_amount_cents", "deposit_state"])),
    settlements: monolith.settlements.map((settlement) => pick(settlement, ["payment_id", "status"])),
    maintenanceRequests: monolith.maintenanceRequests.map((item) => pick(item, ["id", "title", "priority", "status", "submitted_at", "unit_id"])),
    workOrders: monolith.workOrders.map(mapWorkOrderToMaintenanceQueueItem),
    insurancePolicies: monolith.insurancePolicies.map((policy) => pick(policy, ["lease_id", "status"])),
    deposits: monolith.deposits.map((deposit) => pick(deposit, ["lease_id"])),
    inspections: monolith.inspections.map((inspection) => pick(inspection, ["lease_id", "inspection_type", "status"])),
    supportCases: monolith.supportCases.map((item) => pick(item, ["id", "status"])),
    schedules: monolith.schedules.map((schedule) => pick(schedule, ["collection_mode"])),
    billingEnabled: monolith.billingEnabled,
    propertyFinancialSetups: monolith.propertyFinancialSetups.map((setup) => pick(setup, ["property_id", "purchase_date", "purchase_price_cents", "down_payment_cents", "closing_costs_cents"])),
    financialEvents: monolith.financialEvents.map((event) => pick(event, ["event_date", "amount", "transaction_kind", "source_system", "status", "is_deleted", "business_scope", "property_id", "normalized_category", "affects_noi", "capitalized"])),
  };
}

describe("Slice 1 Summary projection — data parity with the monolith", () => {
  it("builds a byte-identical summary from the projected body", () => {
    const fromMonolith = buildRentalDashboardSummary(monolithBody, reportFixture, TODAY);
    const fromProjection = buildRentalDashboardSummary(projectSummaryBody(monolithBody), reportFixture, TODAY);
    expect(fromProjection).toEqual(fromMonolith);
  });

  it("keeps the maintenance queue identical including work-order fallbacks", () => {
    const fromMonolith = buildRentalDashboardSummary(monolithBody, reportFixture, TODAY);
    const fromProjection = buildRentalDashboardSummary(projectSummaryBody(monolithBody), reportFixture, TODAY);
    expect(fromProjection.maintenanceQueue).toEqual(fromMonolith.maintenanceQueue);
    // The in-progress work order surfaces with the builder's fallback title,
    // normal priority and no unit label — exactly as the monolith produced.
    expect(fromProjection.maintenanceQueue.map((item) => item.id)).toContain("wo_1");
    expect(fromProjection.openMaintenance).toBe(fromMonolith.openMaintenance);
  });

  it("signs photos only for the portfolio strip + vacant details, with identical output", () => {
    const photoIds = summaryPhotoRecordIds(monolithUnits, monolithLeases);
    // First 8 in label order (unit_1..unit_8) + first 6 vacant
    // (unit_2, unit_4, unit_5, unit_6, unit_7, unit_8) — unit_9 (7th vacant)
    // and unit_10 (10th overall) are outside the union.
    expect([...photoIds].sort()).toEqual(["unit_1", "unit_2", "unit_3", "unit_4", "unit_5", "unit_6", "unit_7", "unit_8"]);
    const projected = projectSummaryBody(monolithBody);
    expect(projected.units.find((unit) => unit.id === "unit_1").photo_url).toBe("https://signed/u1.jpg");
    expect(projected.units.find((unit) => unit.id === "unit_2").photo_url).toBe("https://signed/u2.jpg");
    expect(projected.units.find((unit) => unit.id === "unit_3").photo_url).toBeNull();
    // Out-of-union units lose their signed URL in the projection — and the
    // built summary is still identical (asserted in the deep-equal test).
    expect(projected.units.find((unit) => unit.id === "unit_9").photo_url).toBeNull();
    expect(projected.units.find((unit) => unit.id === "unit_10").photo_url).toBeNull();
    expect(monolithBody.units.find((unit) => unit.id === "unit_9").photo_url).toBe("https://signed/u9.jpg");
  });

  it("maps a work order to the builder's fallback shape, not invented values", () => {
    expect(mapWorkOrderToMaintenanceQueueItem(monolithWorkOrders[0])).toEqual({
      id: "wo_1", title: null, priority: null, status: "in_progress", submitted_at: null, unit_id: null,
    });
  });
});
