import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

function toCents(value) {
  if (value === null || value === undefined || value === "") return null;
  const cents = Math.round(Number(value) * 100);
  return Number.isFinite(cents) ? cents : null;
}

function toBps(percent) {
  if (percent === null || percent === undefined || percent === "") return null;
  const bps = Math.round(Number(percent) * 100);
  return Number.isFinite(bps) ? bps : null;
}

export async function GET(request) {
  const a = await createAuthenticatedForgeApplication();
  if (a.response) return a.response;
  const propertyId = new URL(request.url).searchParams.get("propertyId") || "";
  if (!propertyId) return NextResponse.json({ error: "A property is required." }, { status: 400 });

  const [setupResult, accountsResult] = await Promise.all([
    a.supabaseClient.from("property_financial_setups").select("*")
      .eq("owner_id", a.user.id).eq("property_id", propertyId).maybeSingle(),
    a.supabaseClient.from("financial_accounts").select("id,name,type").eq("owner_id", a.user.id).eq("active", true),
  ]);
  if (setupResult.error) throw setupResult.error;
  if (accountsResult.error) throw accountsResult.error;

  return NextResponse.json({
    success: true,
    setup: setupResult.data || null,
    available_accounts: accountsResult.data || [],
  });
}

export async function POST(request) {
  const a = await createAuthenticatedForgeApplication();
  if (a.response) return a.response;

  try {
    const body = await request.json();
    const propertyId = String(body?.propertyId || "").trim();
    if (!propertyId) return NextResponse.json({ error: "A property is required." }, { status: 400 });

    const purchasePriceCents = toCents(body?.purchasePrice);
    const downPaymentCents = toCents(body?.downPayment);
    if (purchasePriceCents === null || purchasePriceCents <= 0) {
      return NextResponse.json({ error: "A positive purchase price is required." }, { status: 400 });
    }
    if (downPaymentCents === null || downPaymentCents < 0) {
      return NextResponse.json({ error: "A down payment amount is required." }, { status: 400 });
    }

    const transactions = Array.isArray(body?.transactions) ? body.transactions : [];
    if (transactions.length > 200) {
      return NextResponse.json({ error: "Provide at most 200 acquisition/renovation transactions." }, { status: 400 });
    }
    for (const line of transactions) {
      const amountCents = toCents(line?.amount);
      if (!line?.date || !line?.description || amountCents === null || amountCents <= 0 || typeof line?.capitalized !== "boolean") {
        return NextResponse.json({
          error: "Every acquisition/renovation transaction requires a date, description, positive amount, and capital/operating classification.",
        }, { status: 400 });
      }
    }

    const { data, error } = await a.supabaseClient.rpc("save_property_financial_setup", {
      p_owner_id: a.user.id,
      p_property_id: propertyId,
      p_financial_account_id: body?.financialAccountId || null,
      p_purchase_date: body?.purchaseDate || null,
      p_purchase_price_cents: purchasePriceCents,
      p_down_payment_cents: downPaymentCents,
      p_closing_costs_cents: toCents(body?.closingCosts) ?? 0,
      p_initial_valuation_cents: toCents(body?.initialValuation),
      p_initial_valuation_date: body?.initialValuationDate || null,
      p_lender_name: body?.lenderName || null,
      p_loan_original_principal_cents: toCents(body?.loanOriginalPrincipal),
      p_loan_origination_date: body?.loanOriginationDate || null,
      p_loan_current_balance_cents: toCents(body?.loanCurrentBalance),
      p_loan_current_balance_as_of: body?.loanCurrentBalanceAsOf || null,
      p_loan_interest_rate_bps: toBps(body?.loanInterestRatePercent),
      p_transactions: transactions.map((line) => ({
        event_date: line.date,
        description: String(line.description).slice(0, 500),
        amount_cents: toCents(line.amount),
        capitalized: line.capitalized,
      })),
    });
    if (error) throw error;
    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    console.error("Property financial setup error", error);
    const message = error instanceof Error ? error.message : "Unable to save the property financial setup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
