import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import { mapEventRowsForReplay } from "@/domains/private-financing/persistedRowMapping";
import { previewSellerConfirmedExternalPayment } from "@/domains/private-financing/externalPaymentPreview";
import { encodeAdjustmentPreviewToken } from "@/domains/private-financing/adjustmentPreviewToken";
import { LedgerIntegrityViolationError } from "@/domains/private-financing/ledgerIntegrity";
import { MalformedPrivateFinancingContractError } from "@/domains/private-financing/privateFinancingContracts";

const ACTION_TYPE = "seller_confirmed_external_payment";

function tokenSecret() {
  return process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET;
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizedInputs(body) {
  return {
    amountCents: body?.amountCents,
    paymentMethod: body?.paymentMethod,
    sourceReference: typeof body?.sourceReference === "string" ? body.sourceReference.trim() : body?.sourceReference,
    reason: typeof body?.reason === "string" ? body.reason.trim() : body?.reason,
    borrowerVisibleExplanation:
      typeof body?.borrowerVisibleExplanation === "string" && body.borrowerVisibleExplanation.trim()
        ? body.borrowerVisibleExplanation.trim()
        : null,
    externalEvidenceReference:
      typeof body?.externalEvidenceReference === "string" && body.externalEvidenceReference.trim()
        ? body.externalEvidenceReference.trim()
        : null,
    acknowledgeOverpayment: body?.acknowledgeOverpayment === true,
    selectedExtraComponentId:
      typeof body?.selectedExtraComponentId === "string" && body.selectedExtraComponentId.trim()
        ? body.selectedExtraComponentId.trim()
        : null,
  };
}

// Read-only preview. No table mutation and no append RPC. Duplicate candidates are advisory; exact
// idempotency remains the database's hard duplicate boundary at confirmation.
export async function POST(request, { params }) {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;

  const { accountId } = await params;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const inputs = normalizedInputs(body);
  const effectiveDate =
    typeof body?.effectiveDate === "string" && body.effectiveDate.length > 0
      ? body.effectiveDate
      : todayISODate();

  if (effectiveDate > todayISODate()) {
    return NextResponse.json(
      { error: "An external payment cannot be recorded before it has been received.", code: "private_financing_future_external_payment" },
      { status: 400 },
    );
  }

  const accountResult = await authenticated.supabaseClient
    .from("private_financing_accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (accountResult.error && isMissingRemoteSchemaError(accountResult.error)) {
    return privateFinancingSchemaUnavailableResponse();
  }
  if (accountResult.error) {
    return NextResponse.json({ error: "Unable to load this private financing account." }, { status: 500 });
  }
  if (!accountResult.data) {
    return NextResponse.json({ error: "Private financing account not found." }, { status: 404 });
  }

  const [eventsResult, componentsResult, termsResult] = await Promise.all([
    authenticated.supabaseClient
      .from("private_financing_events")
      .select("*")
      .eq("account_id", accountId)
      .order("ledger_sequence", { ascending: true }),
    authenticated.supabaseClient.from("private_financing_components").select("*").eq("account_id", accountId),
    authenticated.supabaseClient
      .from("private_financing_account_terms_versions")
      .select("*")
      .eq("account_id", accountId),
  ]);
  if (eventsResult.error || componentsResult.error || termsResult.error) {
    return NextResponse.json({ error: "Unable to load this account's ledger history." }, { status: 500 });
  }

  const eventRows = eventsResult.data || [];
  const latestEffectiveDate = eventRows.reduce(
    (latest, row) => (row.effective_date > latest ? row.effective_date : latest),
    "",
  );
  // Inserting before a later event would require recomputing every stored downstream allocation. V1
  // refuses that silently-dangerous path; historical imports use the separately reviewed import flow.
  if (latestEffectiveDate && effectiveDate < latestEffectiveDate) {
    return NextResponse.json(
      {
        error: "This payment date is earlier than an existing ledger event. Use the reviewed historical-import workflow instead.",
        code: "private_financing_external_payment_backdating_not_supported",
      },
      { status: 400 },
    );
  }

  const highestLedgerSequence = eventRows.reduce(
    (max, row) => Math.max(max, row.ledger_sequence ?? -1),
    -1,
  );

  let preview;
  try {
    const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(
      eventRows,
      componentsResult.data || [],
      termsResult.data || [],
    );
    preview = previewSellerConfirmedExternalPayment({
      events,
      componentVersions,
      accountTermsVersions,
      asOfDate: effectiveDate,
      amountCents: inputs.amountCents,
      paymentMethod: inputs.paymentMethod,
      sourceReference: inputs.sourceReference,
      reason: inputs.reason,
      borrowerVisibleExplanation: inputs.borrowerVisibleExplanation,
      acknowledgeOverpayment: inputs.acknowledgeOverpayment,
      selectedExtraComponentId: inputs.selectedExtraComponentId,
    });
  } catch (error) {
    if (
      error instanceof LedgerIntegrityViolationError ||
      error instanceof MalformedPrivateFinancingContractError ||
      error instanceof TypeError
    ) {
      return NextResponse.json(
        { error: error.message, code: "private_financing_invalid_external_payment" },
        { status: 400 },
      );
    }
    throw error;
  }

  const duplicateResult = await authenticated.supabaseClient.rpc(
    "find_private_financing_external_payment_duplicate_candidates",
    {
      p_owner_id: authenticated.effectiveOwnerId,
      p_account_id: accountId,
      p_amount_cents: inputs.amountCents,
      p_effective_date: effectiveDate,
      p_payment_method: inputs.paymentMethod,
      p_source_reference: inputs.sourceReference,
    },
  );
  if (duplicateResult.error && isMissingRemoteSchemaError(duplicateResult.error)) {
    return privateFinancingSchemaUnavailableResponse();
  }
  if (duplicateResult.error) {
    return NextResponse.json({ error: "Unable to check for possible duplicate payments." }, { status: 500 });
  }

  const previewToken = encodeAdjustmentPreviewToken(
    {
      accountId,
      actionType: ACTION_TYPE,
      inputs,
      ledgerSequenceAtPreview: highestLedgerSequence,
      asOfDate: effectiveDate,
      ownerId: authenticated.effectiveOwnerId,
      actingUserId: authenticated.user.id,
    },
    { secret: tokenSecret() },
  );

  return NextResponse.json({
    success: true,
    preview,
    previewToken,
    duplicateCandidates: duplicateResult.data || [],
  });
}
