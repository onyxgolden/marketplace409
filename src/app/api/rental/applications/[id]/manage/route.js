import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";

export const runtime = "nodejs";

// Controls-sweep follow-up G21 (O-11): reopen and delete for applications
// whose decision is not final in a destructive way.
//
// - reopen: denied or withdrawn → pending. The 'reopened' audit row is
//   inserted BEFORE the status flip, so pre-migration (migration
//   20261101030000, which widens the decisions CHECK) the CHECK violation
//   (23514) surfaces as a plain 503 with the status untouched. The
//   original denied/withdrawn decision row is never deleted — the audit
//   trail keeps the denial.
// - delete: pending or withdrawn only, and only when no tenant or lease
//   was ever linked. Decision rows cascade-delete with the application
//   (FK on delete cascade). Approved applications cannot be deleted here:
//   the tenant record and draft lease already exist. Denied applications
//   cannot be deleted: the denial stays on the audit record — reopen it
//   instead.
//
// Owner/co-owner only (read-only members get 403), matching the decision
// route's gate.

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
      return NextResponse.json({ error: "Read-only members cannot change applications." }, { status: 403 });
    }
    const body = await request.json();
    const action = body?.action;
    if (!["reopen", "delete"].includes(action)) {
      return NextResponse.json({ error: "action must be reopen or delete." }, { status: 400 });
    }
    const { data: application, error: loadError } = await authenticated.supabaseClient
      .from("rental_applications").select("id, status, tenant_id, lease_id")
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", (await params).id).maybeSingle();
    if (loadError) throw loadError;
    if (!application) return NextResponse.json({ error: "Application was not found." }, { status: 404 });

    if (action === "reopen") {
      if (application.status === "pending") {
        return NextResponse.json({ error: "This application is already pending." }, { status: 409 });
      }
      if (application.status === "approved") {
        return NextResponse.json({ error: "An approved application cannot be reopened — the tenant record and draft lease already exist." }, { status: 409 });
      }
      const { error: auditError } = await authenticated.supabaseClient.from("rental_application_decisions").insert({
        owner_id: authenticated.effectiveOwnerId, application_id: application.id, action: "reopened",
        reason: typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : null,
        actor_user_id: authenticated.user.id,
      });
      if (auditError) {
        if (auditError.code === "23514") {
          return NextResponse.json({ error: "Application reopening has not been applied yet — the decision-history update is pending." }, { status: 503 });
        }
        throw auditError;
      }
      const { data, error } = await authenticated.supabaseClient.from("rental_applications")
        .update({ status: "pending", denial_reason: null, decided_by: null, decided_at: null, updated_at: new Date().toISOString() })
        .eq("owner_id", authenticated.effectiveOwnerId).eq("id", application.id)
        .select("id, status").single();
      if (error) throw error;
      return NextResponse.json({ success: true, application: data });
    }

    if (application.status === "approved") {
      return NextResponse.json({ error: "An approved application cannot be deleted — the tenant record and draft lease already exist." }, { status: 409 });
    }
    if (application.status === "denied") {
      return NextResponse.json({ error: "A denied application cannot be deleted — the denial stays on the audit record. Reopen it instead." }, { status: 409 });
    }
    if (application.tenant_id || application.lease_id) {
      return NextResponse.json({ error: "This application is already linked to a tenant or lease and cannot be deleted." }, { status: 409 });
    }
    const { error } = await authenticated.supabaseClient.from("rental_applications")
      .delete().eq("owner_id", authenticated.effectiveOwnerId).eq("id", application.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Application manage error", error);
    return NextResponse.json({ error: "Unable to change the application." }, { status: 500 });
  }
}
