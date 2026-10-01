import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  serializeCheckRun,
  validateCheckRunInput,
} from "@/application/rental/checkPrinting";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot print checks." }, { status: 403 });
  }
  return null;
}

const RUN_COLUMNS =
  "id, run_date, bank_account_id, check_count, total_amount_cents, created_at";
const RUN_ITEM_COLUMNS =
  "run_id, vendor_payment_id, seq, payee_name, amount_cents, check_number, payment_date, memo, bank_account_id";
const PAYMENT_COLUMNS =
  "id, payment_method, status, amount_cents, bank_account_id, check_number";

function isMissingTableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || message.includes("does not exist") || message.includes("could not find the table");
}

function mapRpcError(error) {
  if (!error) return null;
  const code = error.code;
  const message = typeof error.message === "string" ? error.message : "";
  if (code === "23505") return "duplicate";
  // No 42P01 (missing-table) mapping: R4 is a hard migration prerequisite,
  // so rental_vendor_payments / rental_vendors always exist when this runs.
  if (["22023", "22000", "P0002"].includes(code)) {
    return { status: 400, error: message || "The check run could not be created." };
  }
  return null;
}

async function findOwnedRun(supabaseClient, ownerId, runId) {
  const { data, error } = await supabaseClient
    .from("rental_check_print_runs")
    .select(RUN_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadItems(supabaseClient, ownerId, runIds) {
  if (runIds.length === 0) return [];
  const { data, error } = await supabaseClient
    .from("rental_check_print_items")
    .select(RUN_ITEM_COLUMNS)
    .eq("owner_id", ownerId)
    .in("run_id", runIds)
    .order("seq", { ascending: true });
  if (error) throw error;
  return data || [];
}

// GET /api/rental/check-runs — check-run history with items. Read-only members may read.
export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    let runs;
    try {
      const { data, error } = await supabaseClient
        .from("rental_check_print_runs")
        .select(RUN_COLUMNS)
        .eq("owner_id", effectiveOwnerId)
        .order("run_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      runs = data || [];
    } catch (error) {
      if (isMissingTableError(error)) return NextResponse.json({ success: true, runs: [] });
      throw error;
    }

    const items = await loadItems(supabaseClient, effectiveOwnerId, runs.map((r) => r.id));
    const itemsByRun = new Map();
    for (const item of items) {
      if (!itemsByRun.has(item.run_id)) itemsByRun.set(item.run_id, []);
      itemsByRun.get(item.run_id).push(item);
    }

    return NextResponse.json({
      success: true,
      runs: runs.map((row) => serializeCheckRun(row, { items: itemsByRun.get(row.id) || [] })),
    });
  } catch (error) {
    console.error("Check runs list error", error);
    return NextResponse.json({ error: "Unable to load check runs." }, { status: 500 });
  }
}

// POST /api/rental/check-runs — batch recorded check payments into one print run.
// Body: { id?, runDate, bankAccountId, paymentIds: [text] }.
// Printing never moves money; the RPC snapshots each check's face and
// re-validates every payment (method, live status, same bank account) inside
// its transaction. Read-only members cannot print.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerError = await requireWriter(authenticated);
    if (writerError) return writerError;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    let body = null;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
    }

    const paymentIds = [...new Set((body?.paymentIds || []).filter(Boolean))];
    let payments = [];
    if (paymentIds.length > 0) {
      // R4 is a hard migration prerequisite of this slice, so
      // rental_vendor_payments is guaranteed present — no missing-table
      // degradation here; a query failure is a real 500.
      const { data, error } = await supabaseClient
        .from("rental_vendor_payments")
        .select(PAYMENT_COLUMNS)
        .eq("owner_id", effectiveOwnerId)
        .in("id", paymentIds);
      if (error) throw error;
      payments = data || [];
    }

    const { valid, errors, value } = validateCheckRunInput(body, { payments });
    if (!valid) {
      return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    }
    const runId = value.id;

    // Idempotency: a retried submit returns the run already recorded.
    try {
      const existing = await findOwnedRun(supabaseClient, effectiveOwnerId, runId);
      if (existing) {
        const items = await loadItems(supabaseClient, effectiveOwnerId, [runId]);
        return NextResponse.json({
          success: true,
          deduplicated: true,
          run: serializeCheckRun(existing, { items }),
        });
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        return NextResponse.json({ error: "Check runs aren't available yet (the database update hasn't been applied)." }, { status: 503 });
      }
      throw error;
    }

    const { data: rpcData, error: rpcError } = await supabaseClient.rpc("create_check_print_run", {
      p_owner_id: effectiveOwnerId,
      p_run: {
        id: runId,
        runDate: value.runDate,
        bankAccountId: value.bankAccountId,
        paymentIds: value.payments.map((p) => p.paymentId),
      },
    });

    if (rpcError) {
      const mapped = mapRpcError(rpcError);
      if (mapped === "duplicate") {
        const winner = await findOwnedRun(supabaseClient, effectiveOwnerId, runId);
        if (winner) {
          const items = await loadItems(supabaseClient, effectiveOwnerId, [runId]);
          return NextResponse.json({
            success: true,
            deduplicated: true,
            run: serializeCheckRun(winner, { items }),
          });
        }
        return NextResponse.json({ error: "A check run with this id already exists." }, { status: 409 });
      }
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      console.error("create_check_print_run error", rpcError);
      return NextResponse.json({ error: "Unable to create the check run." }, { status: 500 });
    }

    const createdId = rpcData?.runId || runId;
    const created = await findOwnedRun(supabaseClient, effectiveOwnerId, createdId);
    if (!created) {
      console.error("create_check_print_run succeeded but the run row is missing", { createdId });
      return NextResponse.json({ error: "Unable to create the check run." }, { status: 500 });
    }
    const items = await loadItems(supabaseClient, effectiveOwnerId, [createdId]);

    return NextResponse.json(
      { success: true, run: serializeCheckRun(created, { items }) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Check run create error", error);
    return NextResponse.json({ error: "Unable to create the check run." }, { status: 500 });
  }
}
