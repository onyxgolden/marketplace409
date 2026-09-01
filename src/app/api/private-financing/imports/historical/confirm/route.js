import { NextResponse } from "next/server";
import { buildHistoricalPrivateFinancingImportPreview } from "@/domains/private-financing/historicalImportPreview";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";

function errorResponse(error) {
  if (isMissingRemoteSchemaError(error)) return privateFinancingSchemaUnavailableResponse();
  if (error?.code === "23505") {
    return NextResponse.json(
      { error: "This import key is already bound to a different historical plan.", code: "private_financing_import_conflict" },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : "Unable to import historical financing records." },
    { status: 400 },
  );
}

export async function POST(request) {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  if (body?.acknowledgeIrreversible !== true || body?.confirmationText !== "IMPORT") {
    return NextResponse.json(
      { error: 'Historical import requires acknowledgement and confirmationText "IMPORT".' },
      { status: 400 },
    );
  }

  try {
    const account = body.account;
    const preview = buildHistoricalPrivateFinancingImportPreview({
      calculationStartDate: body.calculationStartDate,
      asOfDate: body.asOfDate,
      components: account.components.map((component) => ({
        componentId: component.componentKey,
        originalPrincipalCents: component.originalPrincipalCents,
        rateBps: component.rateBps,
        scheduledComponentAmountCents: component.scheduledComponentAmountCents,
        allocationPriority: component.allocationPriority,
      })),
      payments: body.payments,
      proposedPrincipalCredits: body.proposedPrincipalCredits,
      allocationPolicy: account.allocationPolicy,
      extraPaymentAllocationPolicy: account.extraPaymentAllocationPolicy,
    });

    const payments = preview.paymentPreviews.map((payment) => ({
      ledgerOrder: payment.rowNumber,
      effectiveDate: payment.effectiveDate,
      sourceReference: payment.sourceReference,
      amountCents: payment.amountCents,
      interestPaidByComponentCents: payment.interestPaidByComponentCents,
      principalPaidByComponentCents: payment.principalPaidByComponentCents,
      unallocatedCents: payment.unallocatedCents,
      principalRemainingByComponentCents: payment.principalRemainingByComponentCents,
    }));

    const credits = preview.creditPreviews.map((credit, index) => {
      const source = body.proposedPrincipalCredits[index];
      return {
        ledgerOrder: payments.length + index + 1,
        effectiveDate: source.effectiveDate,
        sourceReference: source.sourceReference,
        componentId: credit.componentId,
        amountCents: credit.amountCents,
        correctionBasis: source.correctionBasis,
        correctedComponentPrincipalRemainingCentsAfter: credit.principalAfterCents,
        reason: source.reason,
        borrowerVisibleExplanation: source.borrowerVisibleExplanation,
      };
    });

    const { data, error } = await authenticated.supabaseClient.rpc(
      "import_private_financing_historical_account",
      {
        p_owner_id: authenticated.effectiveOwnerId,
        p_source_key: body.sourceKey,
        p_account: account,
        p_payments: payments,
        p_principal_credits: credits,
      },
    );
    if (error) return errorResponse(error);

    return NextResponse.json({
      success: true,
      import: data,
      reconciliation: {
        paymentCount: preview.paymentCount,
        totalCashCents: preview.totalCashCents,
        totalInterestPaidCents: preview.totalInterestPaidCents,
        totalCashAppliedToPrincipalCents: preview.totalCashAppliedToPrincipalCents,
        totalPrincipalCreditCents: preview.totalPrincipalCreditCents,
        principalAfterCreditsCents: preview.principalAfterCreditsCents,
        totalUnallocatedCents: preview.totalUnallocatedCents,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
