import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { createTenantCharge } from "@/application/rental/tenantCharges";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change tenant charges." }, { status: 403 });
  }
  return null;
}

// POST /api/rental/tenant-charges — standalone ad-hoc tenant charge (damage,
// fee, utility, other). No expense is fabricated: this creates ONLY the
// schedule-less rent_charges row. For expense-linked charges, post through
// /api/rental/transactions with chargeTenant=true instead.
// Body: { leaseId, chargeType, amountCents, description, dueDate?, chargeDate? }.
// Owner-scoped to the effective workspace owner; read-only members get a 403.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;

    const body = await request.json();
    const charge = await createTenantCharge(authenticated.supabaseClient, {
      ownerId: authenticated.effectiveOwnerId,
      leaseId: body?.leaseId,
      chargeType: body?.chargeType,
      amountCents: body?.amountCents,
      description: body?.description,
      dueDate: body?.dueDate,
      chargeDate: body?.chargeDate,
    });
    return NextResponse.json({ success: true, charge });
  } catch (error) {
    console.error("Tenant charge create error", error);
    const message = error?.message || "Unable to save the tenant charge.";
    const status = /required|must be|was not found/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
