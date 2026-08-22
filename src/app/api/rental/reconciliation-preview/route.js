import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { buildRentecReconciliationPreview } from "@/domains/rental-billing-cutover/rentecReconciliationPreview";

// PREPARATORY ONLY — not operationally ready. Read-only: never writes anything, never calls
// Rentec, never touches Stripe. Requires the caller to supply Rentec transaction evidence in the
// request body, because this app has no live Rentec-transaction fetch yet (only unit/tenant/lease
// import exists) and no production UI feeds this endpoint. It exposes no approval action of any
// kind — classifying a match here changes nothing in the database. No reconciliation may be
// treated as approved, and no external payment may be recorded as reconciled, until a separate,
// idempotent, owner-scoped external-payment write path exists (tracked as a follow-up; see
// rentecReconciliationPreview.js for the matching domain this write path would consume).
export async function POST(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const body = await request.json();
    const rentecTransactions = Array.isArray(body?.rentecTransactions) ? body.rentecTransactions : [];
    for (const transaction of rentecTransactions) {
      if (typeof transaction?.id !== "string" || transaction.id.trim() === "")
        return NextResponse.json({ error: "Every rentecTransactions entry requires an id." }, { status: 400 });
      if (typeof transaction?.leaseId !== "string" || transaction.leaseId.trim() === "")
        return NextResponse.json({ error: "Every rentecTransactions entry requires a leaseId." }, { status: 400 });
      if (!Number.isSafeInteger(transaction?.amountCents))
        return NextResponse.json({ error: "Every rentecTransactions entry requires an integer amountCents." }, { status: 400 });
    }

    const database = authenticated.supabaseClient;
    const ownerId = authenticated.user.id;
    const [chargesResult, schedulesResult] = await Promise.all([
      database.from("rent_charges").select("id, lease_id, period, amount_cents, paid_amount_cents, status, due_date")
        .eq("owner_id", ownerId),
      database.from("rent_schedules").select("id, lease_id, collection_mode, forge_cutover_date, effective_start_date")
        .eq("owner_id", ownerId),
    ]);
    if (chargesResult.error) throw chargesResult.error;
    if (schedulesResult.error) throw schedulesResult.error;

    const preview = buildRentecReconciliationPreview({
      rentecTransactions: rentecTransactions.map((t) => ({
        id: t.id, leaseId: t.leaseId, amountCents: t.amountCents,
        transactionDate: t.transactionDate ?? null, period: t.period ?? null,
      })),
      forgeCharges: (chargesResult.data || []).map((row) => ({
        id: row.id, leaseId: row.lease_id, period: row.period, amountCents: Number(row.amount_cents),
        paidAmountCents: Number(row.paid_amount_cents), status: row.status, dueDate: row.due_date,
      })),
      schedules: (schedulesResult.data || []).map((row) => ({
        id: row.id, leaseId: row.lease_id, collectionMode: row.collection_mode,
        forgeCutoverDate: row.forge_cutover_date, effectiveStartDate: row.effective_start_date,
      })),
      // No approved-reconciliation write path exists yet, so nothing has ever been marked
      // reconciled — every rerun today sees the full, current picture.
      alreadyReconciled: [],
    });

    return NextResponse.json({ success: true, status: "preview_only",
      notice: "Preparatory preview only — no data was written, and no production UI or Rentec fetch feeds this endpoint yet. Nothing here can be approved until a dedicated external-payment write path exists.",
      preview });
  } catch (error) {
    console.error("Rentec reconciliation preview error", error);
    return NextResponse.json({ error: "Unable to build the reconciliation preview." }, { status: 500 });
  }
}
