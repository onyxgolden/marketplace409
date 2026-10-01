import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { checkRunPrintProblems, serializeCheckRun } from "@/application/rental/checkPrinting";

const RUN_COLUMNS =
  "id, run_date, bank_account_id, check_count, total_amount_cents, created_at";
const RUN_ITEM_COLUMNS =
  "run_id, vendor_payment_id, seq, payee_name, amount_cents, check_number, payment_date, memo, bank_account_id";

// GET /api/rental/check-runs/[id] — one run with its check snapshots, for the
// print view. Re-checks every payment's LIVE status before rendering: a check
// whose payment was voided after the run was created is refused (409), so a
// voided payment can never print. Read-only members may read.
export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const { data: run, error: runError } = await supabaseClient
      .from("rental_check_print_runs")
      .select(RUN_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("id", params.id)
      .maybeSingle();
    if (runError) throw runError;
    if (!run) return NextResponse.json({ error: "The check run was not found." }, { status: 404 });

    const { data: items, error: itemsError } = await supabaseClient
      .from("rental_check_print_items")
      .select(RUN_ITEM_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("run_id", run.id)
      .order("seq", { ascending: true });
    if (itemsError) throw itemsError;

    // Live void re-check: the snapshots freeze the check face, but the void
    // rule is enforced against the payment's current status. R4 is a hard
    // migration prerequisite of this slice, so rental_vendor_payments is
    // guaranteed present — no missing-table fallback.
    const { data: payments, error: paymentsError } = await supabaseClient
      .from("rental_vendor_payments")
      .select("id, payment_method, status")
      .eq("owner_id", effectiveOwnerId)
      .in("id", (items || []).map((item) => item.vendor_payment_id));
    if (paymentsError) throw paymentsError;
    const problems = checkRunPrintProblems(items || [], new Map((payments || []).map((p) => [p.id, p])));

    if (problems.length > 0) {
      return NextResponse.json({ error: problems[0], problems }, { status: 409 });
    }

    return NextResponse.json({ success: true, run: serializeCheckRun(run, { items: items || [] }) });
  } catch (error) {
    console.error("Check run detail error", error);
    return NextResponse.json({ error: "Unable to load the check run." }, { status: 500 });
  }
}
