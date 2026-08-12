import { createRentalLease } from "./rental-lease.types";
import type { RentalLease, RentalLeaseStatus } from "./rental-lease.types";

export type RentalLeaseRow = Readonly<{
  id: string; owner_id: string; property_id: string; unit_id: string; status: RentalLeaseStatus;
  start_date: string; end_date: string | null; monthly_rent_cents: number; currency_code: string;
  rent_due_day: number; document_evidence_id: string | null; activated_at: string | null;
  ended_at: string | null; created_at: string; updated_at: string; notes: string | null;
}>;
export type RentalLeaseTenantRow = Readonly<{ owner_id: string; lease_id: string; tenant_id: string }>;

function ownerId(value: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Rental lease owner id is required.");
  return value.trim();
}

export function mapRentalLeaseRowsToRentalLease(row: RentalLeaseRow, tenantRows: readonly RentalLeaseTenantRow[]): RentalLease {
  return createRentalLease({ id: row.id, propertyId: row.property_id, unitId: row.unit_id,
    tenantIds: tenantRows.filter(({ lease_id }) => lease_id === row.id).map(({ tenant_id }) => tenant_id),
    status: row.status, startDate: row.start_date, endDate: row.end_date,
    monthlyRentCents: Number(row.monthly_rent_cents), currencyCode: row.currency_code,
    rentDueDay: Number(row.rent_due_day), documentEvidenceId: row.document_evidence_id,
    activatedAt: row.activated_at, endedAt: row.ended_at, createdAt: row.created_at,
    updatedAt: row.updated_at, notes: row.notes });
}

export function mapRentalLeaseToRows(lease: RentalLease, requiredOwnerId: string): Readonly<{
  lease: RentalLeaseRow; tenants: readonly RentalLeaseTenantRow[];
}> {
  const required = ownerId(requiredOwnerId);
  return Object.freeze({
    lease: Object.freeze({ id: lease.id, owner_id: required, property_id: lease.propertyId, unit_id: lease.unitId,
      status: lease.status, start_date: lease.startDate, end_date: lease.endDate,
      monthly_rent_cents: lease.monthlyRentCents, currency_code: lease.currencyCode,
      rent_due_day: lease.rentDueDay, document_evidence_id: lease.documentEvidenceId,
      activated_at: lease.activatedAt, ended_at: lease.endedAt, created_at: lease.createdAt,
      updated_at: lease.updatedAt, notes: lease.notes }),
    tenants: Object.freeze(lease.tenantIds.map((tenantId) => Object.freeze({ owner_id: required,
      lease_id: lease.id, tenant_id: tenantId }))),
  });
}
