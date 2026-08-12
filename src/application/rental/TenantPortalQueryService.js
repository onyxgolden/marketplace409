import { mapRentalTenantRowToRentalTenant } from "@/domains/rental-tenant/rental-tenant.mapper";
import { mapRentalLeaseRowsToRentalLease } from "@/domains/rental-lease/rental-lease.mapper";
import { mapRentalUnitRowToRentalUnit } from "@/domains/rental-unit/rental-unit.mapper";
import { mapRentScheduleRow } from "@/domains/rent-schedule";
import { mapRentChargeRow } from "@/domains/rent-charge";

export class TenantPortalQueryService {
  constructor(supabaseClient) {
    if (!supabaseClient?.from) throw new Error("TenantPortalQueryService requires a Supabase client.");
    this.supabase = supabaseClient;
  }
  async load(authUserId) {
    if (typeof authUserId !== "string" || authUserId.trim() === "") throw new Error("Tenant portal auth user id is required.");
    const { data: tenantRow, error: tenantError } = await this.supabase.from("rental_tenants").select("*")
      .eq("auth_user_id", authUserId.trim()).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenantRow) return null;

    const { data: memberships, error: membershipError } = await this.supabase.from("rental_lease_tenants")
      .select("owner_id, lease_id, tenant_id").eq("owner_id", tenantRow.owner_id).eq("tenant_id", tenantRow.id);
    if (membershipError) throw membershipError;
    const leaseIds = (memberships || []).map(({ lease_id }) => lease_id);
    if (leaseIds.length === 0) return Object.freeze({ tenant: mapRentalTenantRowToRentalTenant(tenantRow), rentals: Object.freeze([]) });

    const { data: leases, error: leaseError } = await this.supabase.from("rental_leases").select("*")
      .eq("owner_id", tenantRow.owner_id).in("id", leaseIds).order("start_date", { ascending: false });
    if (leaseError) throw leaseError;
    const rentals = await Promise.all((leases || []).map(async (leaseRow) => {
      const [unitResult, scheduleResult, chargeResult, paymentResult, insuranceRequirementResult, insurancePolicyResult] = await Promise.all([
        this.supabase.from("rental_units").select("*").eq("owner_id", tenantRow.owner_id).eq("id", leaseRow.unit_id).maybeSingle(),
        this.supabase.from("rent_schedules").select("*").eq("owner_id", tenantRow.owner_id).eq("lease_id", leaseRow.id).order("effective_start_date", { ascending: false }),
        this.supabase.from("rent_charges").select("*").eq("owner_id", tenantRow.owner_id).eq("lease_id", leaseRow.id).order("due_date", { ascending: false }),
        this.supabase.from("rental_payments").select("id, charge_id, amount_cents, currency_code, status, payment_method, receipt_reference, failure_message, created_at, succeeded_at, received_at")
          .eq("owner_id", tenantRow.owner_id).eq("lease_id", leaseRow.id).order("created_at", { ascending: false }),
        this.supabase.from("renters_insurance_requirements").select("required, minimum_liability_cents, purchase_url, jurisdiction_code")
          .eq("owner_id", tenantRow.owner_id).eq("lease_id", leaseRow.id).maybeSingle(),
        this.supabase.from("renters_insurance_policies").select("id, carrier_name, policy_number_masked, liability_limit_cents, effective_date, expiration_date, status, verified_at, last_checked_at")
          .eq("owner_id", tenantRow.owner_id).eq("lease_id", leaseRow.id).eq("tenant_id", tenantRow.id).order("expiration_date", { ascending: false }),
      ]);
      for (const result of [unitResult, scheduleResult, chargeResult, paymentResult, insuranceRequirementResult, insurancePolicyResult])
        if (result.error) throw result.error;
      const membershipRows = (memberships || []).filter(({ lease_id }) => lease_id === leaseRow.id);
      return Object.freeze({ lease: mapRentalLeaseRowsToRentalLease(leaseRow, membershipRows),
        unit: unitResult.data ? mapRentalUnitRowToRentalUnit(unitResult.data) : null,
        schedules: Object.freeze((scheduleResult.data || []).map(mapRentScheduleRow)),
        charges: Object.freeze((chargeResult.data || []).map(mapRentChargeRow)),
        payments: Object.freeze((paymentResult.data || []).map((row) => Object.freeze({ id: row.id, chargeId: row.charge_id,
          amountCents: Number(row.amount_cents), currencyCode: row.currency_code, status: row.status,
          paymentMethod: row.payment_method, receiptReference: row.receipt_reference,
          failureMessage: row.failure_message, createdAt: row.created_at, succeededAt: row.succeeded_at,
          receivedAt: row.received_at }))),
        insuranceRequirement: insuranceRequirementResult.data ? Object.freeze({ required: insuranceRequirementResult.data.required,
          minimumLiabilityCents: Number(insuranceRequirementResult.data.minimum_liability_cents),
          purchaseUrl: insuranceRequirementResult.data.purchase_url, jurisdictionCode: insuranceRequirementResult.data.jurisdiction_code }) : null,
        insurancePolicies: Object.freeze((insurancePolicyResult.data || []).map((row) => Object.freeze({ id: row.id,
          carrierName: row.carrier_name, policyNumberMasked: row.policy_number_masked,
          liabilityLimitCents: Number(row.liability_limit_cents), effectiveDate: row.effective_date,
          expirationDate: row.expiration_date, status: row.status, verifiedAt: row.verified_at, lastCheckedAt: row.last_checked_at }))) });
    }));
    return Object.freeze({ tenant: mapRentalTenantRowToRentalTenant(tenantRow), rentals: Object.freeze(rentals) });
  }
}
