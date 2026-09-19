import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

const DEBT_ACCOUNT_TYPES = new Set(["credit", "loan"]);

// Owner-confirmed debt terms: the APR + minimum payment the liability feed
// doesn't carry. Reversible metadata only -- upsert or delete, never a money
// movement. Validation is strict because these numbers drive the optimizer.
function validateTerms(body) {
  const financialAccountId =
    typeof body?.financialAccountId === "string" && body.financialAccountId.length > 0
      ? body.financialAccountId
      : null;
  if (!financialAccountId) return { error: "financialAccountId is required." };
  const apr = Number(body?.apr);
  if (!Number.isFinite(apr) || apr < 0 || apr > 100) {
    return { error: "apr must be a percent between 0 and 100." };
  }
  const minimumPayment = Number(body?.minimumPayment);
  if (!Number.isFinite(minimumPayment) || minimumPayment <= 0) {
    return { error: "minimumPayment must be a positive dollar amount." };
  }
  return {
    terms: {
      financialAccountId,
      apr,
      minimumPayment,
      taxDeductible: body?.taxDeductible === true,
    },
  };
}

async function findDebtAccount(suite, ownerId, financialAccountId) {
  const accounts = await suite.financialAccountRepository.findByOwnerId(ownerId);
  return (accounts ?? []).find(
    (account) =>
      account?.id === financialAccountId &&
      account?.active !== false &&
      DEBT_ACCOUNT_TYPES.has(account?.type),
  );
}

function missingTableError(error) {
  // Graceful when the migration hasn't been deployed yet.
  return NextResponse.json(
    { error: "Debt-terms storage is not available yet (migration pending)." },
    { status: 503 },
  );
}

export async function PUT(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const { terms, error: validationError } = validateTerms(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  try {
    const suite = await authenticated.getFinancialApplicationSuite();
    const account = await findDebtAccount(suite, authenticated.user.id, terms.financialAccountId);
    if (!account) {
      return NextResponse.json(
        { error: "Unknown debt account for this owner." },
        { status: 404 },
      );
    }
    const { error } = await authenticated.supabaseClient.from("debt_terms").upsert(
      {
        owner_id: authenticated.effectiveOwnerId,
        financial_account_id: terms.financialAccountId,
        apr: terms.apr,
        minimum_payment: terms.minimumPayment,
        tax_deductible: terms.taxDeductible,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,financial_account_id" },
    );
    if (error) {
      if (error.code === "42P01") return missingTableError(error);
      throw error;
    }
    return NextResponse.json({ success: true, data: { ...terms } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save debt terms." },
      { status: 500 },
    );
  }
}

export async function DELETE(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  const financialAccountId = new URL(request.url).searchParams.get("financialAccountId");
  if (!financialAccountId) {
    return NextResponse.json({ error: "financialAccountId is required." }, { status: 400 });
  }

  try {
    const { error } = await authenticated.supabaseClient
      .from("debt_terms")
      .delete()
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("financial_account_id", financialAccountId);
    if (error) {
      if (error.code === "42P01") return missingTableError(error);
      throw error;
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete debt terms." },
      { status: 500 },
    );
  }
}
