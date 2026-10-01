// Shared data loader for the tenant ledger read model.
// Extracted from GET /api/rental/tenant-ledger so the statement-email route
// (Rentec parity R2) builds its email from the exact same record sets — one
// data path, no forked statement.
//
// Returns raw rows; callers run the pure builders (buildTenantPaymentLedger,
// buildTenantDepositHistory, buildImportedRentecHistory) themselves.
export async function loadTenantLedgerData(supabaseClient, effectiveOwnerId, tenantId) {
  const { data: tenant, error: tenantError } = await supabaseClient
    .from("rental_tenants")
    .select("id, display_name, email, status, source_record_id")
    .eq("owner_id", effectiveOwnerId)
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) {
    const notFound = new Error("Tenant was not found.");
    notFound.code = "TENANT_NOT_FOUND";
    throw notFound;
  }

  const renterId = tenant.source_record_id ? String(tenant.source_record_id) : null;
  const importedHistoryQuery = renterId
    ? supabaseClient.from("financial_events")
      .select("id, event_date, description, amount, transaction_kind, normalized_category, property_id, source_record_id, metadata, status, is_deleted")
      .eq("owner_id", effectiveOwnerId)
      .eq("transaction_kind", "income")
      .eq("is_deleted", false)
      .filter("metadata->>rentec_renter_id", "eq", renterId)
    : Promise.resolve({ data: [], error: null });

  const [
    chargesResult, paymentsResult, settlementsResult, leasesResult, membershipsResult,
    unitsResult, rentecResult, depositsResult, depositTransactionsResult, importedHistoryResult,
    creditsResult, creditApplicationsResult,
  ] = await Promise.all([
    supabaseClient.from("rent_charges")
      .select("id, lease_id, schedule_id, period, due_date, amount_cents, paid_amount_cents, currency_code, status, charge_type")
      .eq("owner_id", effectiveOwnerId).order("due_date", { ascending: true }),
    supabaseClient.from("rental_payments")
      .select("id, charge_id, lease_id, tenant_id, provider, provider_payment_id, amount_cents, refunded_amount_cents, currency_code, status, payment_method, receipt_reference, notes, received_at, succeeded_at, created_at, deposit_state, deposited_at, convenience_fee_cents, convenience_fee_bps")
      .eq("owner_id", effectiveOwnerId).eq("tenant_id", tenant.id).order("created_at", { ascending: true }),
    supabaseClient.from("rental_settlements")
      .select("id, payment_id, status, net_amount_cents, provider_payout_id")
      .eq("owner_id", effectiveOwnerId),
    supabaseClient.from("rental_leases").select("id, unit_id, property_id, status, start_date, end_date")
      .eq("owner_id", effectiveOwnerId),
    supabaseClient.from("rental_lease_tenants").select("lease_id, tenant_id, occupancy_role")
      .eq("owner_id", effectiveOwnerId),
    supabaseClient.from("rental_units").select("id, property_id, label, status")
      .eq("owner_id", effectiveOwnerId),
    supabaseClient.from("rentec_transaction_imports")
      .select("id, rentec_transaction_id, lease_id, charge_id, payment_id, amount_cents, transaction_date, category_name, status")
      .eq("owner_id", effectiveOwnerId).eq("status", "applied"),
    supabaseClient.from("rental_security_deposits").select("*")
      .eq("owner_id", effectiveOwnerId).eq("tenant_id", tenant.id),
    supabaseClient.from("rental_security_deposit_transactions").select("*")
      .eq("owner_id", effectiveOwnerId).order("occurred_at", { ascending: true }),
    importedHistoryQuery,
    supabaseClient.from("rental_tenant_credits")
      .select("id, tenant_id, lease_id, amount_cents, remaining_cents, source, source_payment_id, status, notes, voided_at, voided_by, void_reason, created_at, updated_at")
      .eq("owner_id", effectiveOwnerId).eq("tenant_id", tenant.id).order("created_at", { ascending: true }),
    supabaseClient.from("rental_credit_applications")
      .select("id, credit_id, tenant_id, lease_id, charge_id, amount_cents, applied_at, notes")
      .eq("owner_id", effectiveOwnerId).eq("tenant_id", tenant.id).order("applied_at", { ascending: true }),
  ]);
  const failed = [chargesResult, paymentsResult, settlementsResult, leasesResult, membershipsResult,
    unitsResult, rentecResult, depositsResult, depositTransactionsResult, importedHistoryResult,
    creditsResult, creditApplicationsResult].find((r) => r.error)?.error;
  if (failed) throw failed;

  return {
    tenant,
    charges: chargesResult.data || [],
    payments: paymentsResult.data || [],
    settlements: settlementsResult.data || [],
    leases: leasesResult.data || [],
    leaseMemberships: membershipsResult.data || [],
    units: unitsResult.data || [],
    rentecImports: rentecResult.data || [],
    deposits: depositsResult.data || [],
    depositTransactions: depositTransactionsResult.data || [],
    importedHistoryEvents: importedHistoryResult.data || [],
    renterId,
    credits: creditsResult.data || [],
    creditApplications: creditApplicationsResult.data || [],
  };
}
