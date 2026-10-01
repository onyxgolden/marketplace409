import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

export const runtime = "nodejs";

// Rentec parity R21 — approve/deny from the review queue. Owner/co-owner only
// (read-only members get 403). The decision is recorded through the
// decide_rental_application RPC, which locks the application row (FOR UPDATE),
// re-validates status = 'pending' under the lock, and performs the tenant
// insert + lease insert + link + status update + audit append in ONE
// transaction — concurrent decisions serialize (exactly one wins, the other
// gets 409) and a failure can never leave orphaned tenants/leases without a
// decision record.

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

export async function POST(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot decide applications." }, { status: 403 });
    }
    const body = await request.json();
    const action = body?.action;
    if (!["approve", "deny"].includes(action)) {
      return NextResponse.json({ error: "action must be approve or deny." }, { status: 400 });
    }

    // Pre-check for a clean 404 and (on approve) the applicant's contact
    // details. The RPC is the authority on pending-status under its row lock.
    const { data: application, error: loadError } = await authenticated.supabaseClient
      .from("rental_applications").select("id, listing_id, status, answers")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", (await params).id).maybeSingle();
    if (loadError) throw loadError;
    if (!application) return NextResponse.json({ error: "Application was not found." }, { status: 404 });

    let reason = null;
    let displayName = null;
    let email = null;
    let phone = null;
    let startDate = null;
    let endDate = null;
    let monthlyRentCents = null;
    let rentDueDay = 1;

    if (action === "deny") {
      reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) return NextResponse.json({ error: "A denial reason is required — it is stored on the audit row." }, { status: 400 });
    } else {
      // Approve: the listing's advertised rent is the default; the owner can
      // override per decision. All inputs are validated here for clean 400s;
      // the RPC validates independently as the trust boundary.
      const { data: listing, error: listingError } = await authenticated.supabaseClient
        .from("rental_listings").select("id, rent_cents")
        .eq("owner_id", authenticated.effectiveOwnerId).eq("id", application.listing_id).maybeSingle();
      if (listingError) throw listingError;
      if (!listing) return NextResponse.json({ error: "The listing for this application no longer exists." }, { status: 409 });

      const leaseInput = body?.lease || {};
      startDate = typeof leaseInput.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(leaseInput.startDate)
        ? leaseInput.startDate : null;
      if (!startDate) return NextResponse.json({ error: "A lease start date (YYYY-MM-DD) is required to approve." }, { status: 400 });
      endDate = typeof leaseInput.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(leaseInput.endDate)
        ? leaseInput.endDate : null;
      monthlyRentCents = leaseInput.monthlyRentCents ?? listing.rent_cents;
      if (!Number.isSafeInteger(monthlyRentCents) || monthlyRentCents <= 0) {
        return NextResponse.json({ error: "A positive monthly rent is required to approve." }, { status: 400 });
      }
      rentDueDay = leaseInput.rentDueDay ?? 1;
      if (!Number.isInteger(rentDueDay) || rentDueDay < 1 || rentDueDay > 28) {
        return NextResponse.json({ error: "rentDueDay must be between 1 and 28." }, { status: 400 });
      }
      const personal = application.answers?.personal || {};
      email = String(personal.email || "").trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        return NextResponse.json({ error: "The application has no valid email — a tenant record cannot be created." }, { status: 409 });
      }
      displayName = [personal.firstName, personal.lastName].filter(Boolean).join(" ").trim() || email;
      phone = typeof personal.phone === "string" && personal.phone.trim() ? personal.phone.trim() : null;
    }

    const { data, error: rpcError } = await authenticated.supabaseClient.rpc("decide_rental_application", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_application_id: application.id,
      p_action: action,
      p_reason: reason,
      p_tenant_display_name: displayName,
      p_tenant_email: email,
      p_tenant_phone: phone,
      p_lease_start_date: startDate,
      p_lease_end_date: endDate,
      p_monthly_rent_cents: monthlyRentCents,
      p_rent_due_day: rentDueDay,
    });
    if (rpcError) {
      // 42501: unauthenticated or read-only staff calling the RPC directly.
      if (rpcError.code === "42501") {
        return NextResponse.json({ error: "Deciding applications requires owner or co-owner access." }, { status: 403 });
      }
      // P0001: already decided / raced by a concurrent decision, or the
      // listing vanished between validation and the lock.
      if (rpcError.code === "P0001") {
        return NextResponse.json({ error: rpcError.message || "The application can no longer be decided." }, { status: 409 });
      }
      // 23505: unique(owner_id, email) — the applicant is already a tenant.
      if (rpcError.code === "23505") {
        return NextResponse.json({ error: "A tenant already exists with this email. Approve is blocked — merge with the existing record first." }, { status: 409 });
      }
      throw rpcError;
    }

    return NextResponse.json({
      success: true,
      decision: {
        id: data.decision_id,
        action: data.action,
        reason: action === "deny" ? reason : null,
        tenant_id: data.tenant_id,
        lease_id: data.lease_id,
      },
      tenantId: data.tenant_id,
      leaseId: data.lease_id,
    });
  } catch (error) {
    console.error("Application decision error", error);
    return NextResponse.json({ error: "Unable to record the decision." }, { status: 500 });
  }
}
