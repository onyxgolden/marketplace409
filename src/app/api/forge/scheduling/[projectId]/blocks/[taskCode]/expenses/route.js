import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { resolveOwnedBlock } from "../../../../scheduleProjectAssembly";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

const ACCRUAL_TYPES = ["start", "end", "uniform"];

export async function GET(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId, taskCode } = await params;
    const block = await resolveOwnedBlock(authenticated.supabaseClient, authenticated.user.id, projectId, taskCode);
    if (!block) return NextResponse.json({ error: "Block not found, or you don't own this project." }, { status: 404 });

    const { data, error } = await authenticated.supabaseClient.from("schedule_expenses").select("*").eq("block_id", block.id);
    if (error) throw error;
    return NextResponse.json({ success: true, expenses: data || [] });
  } catch (error) {
    console.error("Scheduling expense list error", error);
    return NextResponse.json({ error: "Unable to load this activity's expenses." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { projectId, taskCode } = await params;
    const body = await request.json().catch(() => ({}));

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "An expense name is required." }, { status: 400 });
    const budgetedCost = Number(body.budgetedCost);
    if (!Number.isFinite(budgetedCost) || budgetedCost < 0) return NextResponse.json({ error: "Budgeted cost must be a non-negative number." }, { status: 400 });
    const accrualType = ACCRUAL_TYPES.includes(body.accrualType) ? body.accrualType : "uniform";

    const block = await resolveOwnedBlock(authenticated.supabaseClient, authenticated.user.id, projectId, taskCode);
    if (!block) return NextResponse.json({ error: "Block not found, or you don't own this project." }, { status: 404 });

    const now = new Date().toISOString();
    const expense = {
      owner_id: authenticated.user.id,
      id: `expense_${crypto.randomUUID()}`,
      block_id: block.id,
      cost_account_id: body.costAccountId || null,
      name, accrual_type: accrualType,
      budgeted_cost: budgetedCost, actual_cost: 0,
      created_at: now, updated_at: now,
    };

    const { error } = await authenticated.supabaseClient.from("schedule_expenses").insert(expense);
    if (error) throw error;
    return NextResponse.json({ success: true, expenseId: expense.id });
  } catch (error) {
    console.error("Scheduling expense create error", error);
    return NextResponse.json({ error: "Unable to add this expense." }, { status: 500 });
  }
}
