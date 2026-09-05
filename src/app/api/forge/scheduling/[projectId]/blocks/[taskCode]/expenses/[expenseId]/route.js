import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

async function authenticatedContext() {
  return createAuthenticatedForgeApplication();
}

const ACCRUAL_TYPES = ["start", "end", "uniform"];

export async function PATCH(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { expenseId } = await params;
    const body = await request.json().catch(() => ({}));

    const patch = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return NextResponse.json({ error: "An expense name is required." }, { status: 400 });
      patch.name = name;
    }
    if ("budgetedCost" in body) {
      const budgetedCost = Number(body.budgetedCost);
      if (!Number.isFinite(budgetedCost) || budgetedCost < 0) return NextResponse.json({ error: "Budgeted cost must be a non-negative number." }, { status: 400 });
      patch.budgeted_cost = budgetedCost;
    }
    if ("actualCost" in body) {
      const actualCost = Number(body.actualCost);
      if (!Number.isFinite(actualCost) || actualCost < 0) return NextResponse.json({ error: "Actual cost must be a non-negative number." }, { status: 400 });
      patch.actual_cost = actualCost;
    }
    if ("accrualType" in body) {
      if (!ACCRUAL_TYPES.includes(body.accrualType)) return NextResponse.json({ error: "accrualType must be start, end, or uniform." }, { status: 400 });
      patch.accrual_type = body.accrualType;
    }
    if ("costAccountId" in body) patch.cost_account_id = body.costAccountId || null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    patch.updated_at = new Date().toISOString();

    const { data, error } = await authenticated.supabaseClient.from("schedule_expenses")
      .update(patch).eq("id", expenseId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Expense not found, or you don't own this project." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling expense update error", error);
    return NextResponse.json({ error: "Unable to update this expense." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { expenseId } = await params;

    const { data, error } = await authenticated.supabaseClient.from("schedule_expenses")
      .delete().eq("id", expenseId).eq("owner_id", authenticated.user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Expense not found, or you don't own this project." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Scheduling expense delete error", error);
    return NextResponse.json({ error: "Unable to remove this expense." }, { status: 500 });
  }
}
