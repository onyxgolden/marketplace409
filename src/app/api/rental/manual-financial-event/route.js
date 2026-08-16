import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { validateManualFinancialEvent } from "@/application/financial/validateManualFinancialEvent";
import { SupabaseFinancialEventRepository } from "@/domains/financial-event/SupabaseFinancialEventRepository";

export async function POST(request) {
  try {
    const a = await createAuthenticatedForgeApplication();
    if (a.response) return a.response;

    const body = await request.json();
    const { valid, errors } = validateManualFinancialEvent(body);
    if (!valid) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

    const paymentMethod = String(body.paymentMethod ?? "cash");
    const repository = new SupabaseFinancialEventRepository({ supabaseClient: a.supabaseClient });
    const [saved] = await repository.saveMany([
      {
        owner_id: a.user.id,
        property_id: body.propertyId ? String(body.propertyId) : null,
        event_date: body.eventDate,
        description: String(body.description).trim(),
        amount: Math.abs(Number(body.amount)),
        transaction_kind: body.transactionKind,
        normalized_category: body.normalizedCategory,
        tax_deductible: body.taxDeductible ?? body.transactionKind === "expense",
        affects_noi: body.affectsNoi ?? true,
        capitalized: false,
        source_system: "manual",
        metadata: { payment_method: paymentMethod },
        status: "active",
        is_deleted: false,
        created_by: a.user.id,
        updated_by: a.user.id,
      },
    ]);

    return NextResponse.json({ success: true, event: saved });
  } catch (error) {
    console.error("Manual financial event error", error);
    return NextResponse.json({ error: "Unable to save the manual entry." }, { status: 500 });
  }
}
