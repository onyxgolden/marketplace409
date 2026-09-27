import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  ReconciliationError,
  listReconciliations,
  loadAccountRegister,
  saveReconciliation,
  undoReconciliation,
} from "@/application/rental/bankReconciliationService";

// Bank reconciliations for one account.
//   GET  ?bankAccountId=…            → register + saved reconciliations
//   POST { action: "save", …, confirm: "CONFIRM" }  → record a reconciliation
//   POST { action: "undo", id, reason, confirm: "CONFIRM" } → undo one
// Writes require the typed CONFIRM (the UI's human gate is re-checked here)
// and are refused for read-only workspace members. Effective-owner scoped.

function fail(error, fallback) {
  if (error instanceof ReconciliationError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request) {
  try {
    const a = await createAuthenticatedRentalManagerApplication();
    if (a.response) return a.response;
    const bankAccountId = (new URL(request.url).searchParams.get("bankAccountId") || "").trim();
    if (!bankAccountId) return NextResponse.json({ error: "bankAccountId is required." }, { status: 400 });
    const { account, ledger } = await loadAccountRegister(a.supabaseClient, a.effectiveOwnerId, bankAccountId);
    const { available, reconciliations } = await listReconciliations(a.supabaseClient, a.effectiveOwnerId, bankAccountId);
    return NextResponse.json({ success: true, account, ledger, available, reconciliations });
  } catch (error) {
    return fail(error, "Unable to load reconciliations.");
  }
}

export async function POST(request) {
  try {
    const a = await createAuthenticatedRentalManagerApplication();
    if (a.response) return a.response;
    if ((await getActiveWorkspaceRole({ supabaseClient: a.supabaseClient, actorUserId: a.user.id })) === "read_only") {
      return NextResponse.json({ error: "Read-only members cannot reconcile accounts." }, { status: 403 });
    }
    const body = await request.json().catch(() => null);
    if (!body || body.confirm !== "CONFIRM") {
      return NextResponse.json({ error: 'Type CONFIRM to save changes to cleared transactions.' }, { status: 400 });
    }
    const who = { ownerId: a.effectiveOwnerId, userId: a.user.id };
    if (body.action === "save") {
      const saved = await saveReconciliation(a.supabaseClient, who, body);
      return NextResponse.json({ success: true, ...saved });
    }
    if (body.action === "undo") {
      const undone = await undoReconciliation(a.supabaseClient, who, body);
      return NextResponse.json({ success: true, ...undone });
    }
    return NextResponse.json({ error: 'action must be "save" or "undo".' }, { status: 400 });
  } catch (error) {
    return fail(error, "Unable to update the reconciliation.");
  }
}
