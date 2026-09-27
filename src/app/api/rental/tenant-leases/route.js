import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

// GET /api/rental/tenant-leases?tenantId= — the tenant's leases for the charge
// lease picker. Active leases first; the caller never guesses when several
// are active. Owner-scoped: a cross-workspace tenant id 404s.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const tenantId = new URL(request.url).searchParams.get("tenantId");
    if (!tenantId || !tenantId.trim()) {
      return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
    }

    const { data: tenant, error: tenantError } = await supabaseClient
      .from("rental_tenants").select("id").eq("owner_id", effectiveOwnerId).eq("id", tenantId.trim()).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });

    const { data: memberships, error: membershipError } = await supabaseClient
      .from("rental_lease_tenants").select("lease_id").eq("owner_id", effectiveOwnerId).eq("tenant_id", tenant.id);
    if (membershipError) throw membershipError;
    const leaseIds = [...new Set((memberships || []).map((m) => m.lease_id).filter(Boolean))];
    if (leaseIds.length === 0) return NextResponse.json({ success: true, leases: [] });

    const { data: leases, error: leaseError } = await supabaseClient
      .from("rental_leases").select("id, unit_id, property_id, status, start_date, end_date")
      .eq("owner_id", effectiveOwnerId).in("id", leaseIds);
    if (leaseError) throw leaseError;

    const unitIds = [...new Set((leases || []).map((l) => l.unit_id).filter(Boolean))];
    const { data: units, error: unitError } = unitIds.length
      ? await supabaseClient.from("rental_units").select("id, property_id, label")
        .eq("owner_id", effectiveOwnerId).in("id", unitIds)
      : { data: [], error: null };
    if (unitError) throw unitError;
    const unitById = new Map((units || []).map((u) => [u.id, u]));

    const statusRank = { active: 0, pending: 1 };
    const shaped = (leases || []).map((lease) => {
      const unit = unitById.get(lease.unit_id);
      return {
        id: lease.id,
        status: lease.status,
        startDate: lease.start_date,
        endDate: lease.end_date,
        label: `${unit?.label || lease.unit_id || "Unit"} · ${unit?.property_id || lease.property_id || ""}`.trim(),
      };
    }).sort((a, b) => (statusRank[a.status] ?? 2) - (statusRank[b.status] ?? 2));

    return NextResponse.json({ success: true, leases: shaped });
  } catch (error) {
    console.error("Tenant leases error", error);
    return NextResponse.json({ error: "Unable to load the tenant's leases." }, { status: 500 });
  }
}
