import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import { mapEventRowsForReplay } from "@/domains/private-financing/persistedRowMapping";
import { previewSellerConfirmedExternalPayment } from "@/domains/private-financing/externalPaymentPreview";
import { buildExternalPaymentRpcParams } from "@/domains/private-financing/externalPaymentRpcParams";
import {
  InvalidAdjustmentPreviewTokenError,
  StaleAdjustmentPreviewError,
  assertAdjustmentPreviewTokenFresh,
  decodeAdjustmentPreviewToken,
} from "@/domains/private-financing/adjustmentPreviewToken";
import { LedgerIntegrityViolationError } from "@/domains/private-financing/ledgerIntegrity";
import { MalformedPrivateFinancingContractError } from "@/domains/private-financing/privateFinancingContracts";

const ACTION_TYPE = "seller_confirmed_external_payment";
const STALE_CODE = "private_financing_stale_preview";

function tokenSecret() {
  return process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET;
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

function receipt(row, { idempotentRetry = false } = {}) {
  return {
    id: row.id,
    eventType: row.event_type,
    ledgerSequence: row.ledger_sequence,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    amountCents: row.amount_cents,
    paymentMethod: row.payment_method,
    sourceReference: row.source_reference,
    idempotentRetry,
  };
}

function exactExistingPayment(rows, inputs, effectiveDate) {
  return rows.find(
    (row) =>
      row.event_type === "payment_posted" &&
      row.event_origin === "manual_external" &&
      row.amount_cents === inputs.amountCents &&
      row.payment_method === inputs.paymentMethod &&
      row.source_reference === inputs.sourceReference &&
      row.effective_date === effectiveDate,
  );
}

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
  const internalNote =
    typeof body?.internalNote === "string" && body.internalNote.trim()
      ? body.internalNote.trim()
      : null;

  let token;
  try {
    token = decodeAdjustmentPreviewToken(body?.previewToken, { secret: tokenSecret() });
  } catch (error) {
    if (error instanceof InvalidAdjustmentPreviewTokenError) {
      return NextResponse.json(
        { error: "This preview is invalid or has expired. Please preview again.", code: STALE_CODE },
        { status: 409 },
      );
    }
    throw error;
  }

  // First validate every signed binding except live sequence. This distinguishes an exact network retry
  // from account/action/input/user tampering before any existing receipt can be returned.
  try {
    assertAdjustmentPreviewTokenFresh(token, {
      accountId,
      actionType: ACTION_TYPE,
      inputs,
      currentLedgerSequence: token.ledgerSequenceAtPreview,
      ownerId: authenticated.effectiveOwnerId,
      actingUserId: authenticated.user.id,
    });
  } catch (error) {
    if (error instanceof StaleAdjustmentPreviewError) {
      return NextResponse.json({ error: error.message, code: STALE_CODE }, { status: 409 });
    }
    throw error;
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
  const currentLedgerSequence = eventRows.reduce(
    (max, row) => Math.max(max, row.ledger_sequence ?? -1),
    -1,
  );

  if (currentLedgerSequence !== token.ledgerSequenceAtPreview) {
    const existing = exactExistingPayment(eventRows, inputs, token.asOfDate);
    if (existing) {
      return NextResponse.json({ success: true, event: receipt(existing, { idempotentRetry: true }) });
    }
    return NextResponse.json(
      { error: "The ledger has changed since this payment was previewed. Please preview again.", code: STALE_CODE },
      { status: 409 },
    );
  }

  let freshPreview;
  try {
    const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(
      eventRows,
      componentsResult.data || [],
      termsResult.data || [],
    );
    freshPreview = previewSellerConfirmedExternalPayment({
      events,
      componentVersions,
      accountTermsVersions,
      asOfDate: token.asOfDate,
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

  if (freshPreview.blockingValidation.length > 0 || !freshPreview.proposedEventPayload) {
    return NextResponse.json(
      {
        error: freshPreview.blockingValidation[0] || "This external payment cannot be posted.",
        blockers: freshPreview.blockingValidation,
        code: "private_financing_validation_failed",
      },
      { status: 400 },
    );
  }

  const rpcPayload = buildExternalPaymentRpcParams(freshPreview.proposedEventPayload, {
    ownerId: authenticated.effectiveOwnerId,
    accountId,
    paymentMethod: inputs.paymentMethod,
    sourceReference: inputs.sourceReference,
    externalEvidenceReference: inputs.externalEvidenceReference,
    internalNote,
  });

  const { data: eventRow, error: rpcError } = await authenticated.supabaseClient.rpc(
    "confirm_private_financing_external_payment",
    {
      p_owner_id: authenticated.effectiveOwnerId,
      p_account_id: accountId,
      p_expected_ledger_sequence: token.ledgerSequenceAtPreview,
      p_event_payload: rpcPayload,
    },
  );
  if (rpcError) {
    if (isMissingRemoteSchemaError(rpcError)) return privateFinancingSchemaUnavailableResponse();
    if (rpcError.code === "40001") {
      return NextResponse.json(
        { error: "The ledger changed while this payment was being confirmed. Please preview again.", code: STALE_CODE },
        { status: 409 },
      );
    }
    if (rpcError.code === "23505") {
      return NextResponse.json(
        { error: "That external payment reference is already in use for different payment details.", code: "private_financing_external_reference_conflict" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Unable to record this external payment." }, { status: 500 });
  }

  return NextResponse.json({ success: true, event: receipt(eventRow) });
}
