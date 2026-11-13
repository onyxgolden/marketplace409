// Rental property ledger — work packages for one property.
//
// PR B fix round 1: this is the separate explicit Rental boundary
// for the owner-wide, property-filtered work-package read the Rental
// property ledger needs. It replaces the legacy unscoped branch that
// used to live behind the Planner list route
// (GET /api/work-packages with no ?forgeProject=): a caller can no
// longer reach an owner-wide list by omitting a Planner query
// parameter, because the Planner route now fails closed to the
// chooser state and this read lives on its own Rental path.
//
// Authorization is unchanged from the legacy read: an authenticated
// caller acting within the effective workspace (owner or active
// member — resolveEffectiveOwnerId), owner-scoped, filtered by the
// exact canonical property slug. Read-only: no package lifecycle
// action is reachable here. Rental gains no project selection here —
// PR F scopes Rental; until then this route answers only "which
// packages belong to this property in this workspace?"
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { listWorkPackagesForRentalLedger } from "@/application/work-management/workPackages";

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const propertyId = new URL(request.url).searchParams.get("propertyId");
    if (!propertyId || !propertyId.trim()) {
      return NextResponse.json(
        { error: "A property is required to list its work packages." },
        { status: 400 },
      );
    }
    const result = await listWorkPackagesForRentalLedger(authenticated.supabaseClient, {
      ownerId: authenticated.effectiveOwnerId,
      propertyId,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus || 400 });
    }
    return NextResponse.json({ ok: true, packages: result.packages });
  } catch (error) {
    console.error("Rental work packages list error", error);
    return NextResponse.json({ error: "Unable to complete the request." }, { status: 500 });
  }
}
