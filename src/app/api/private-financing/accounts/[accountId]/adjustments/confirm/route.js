import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import { mapEventRowsForReplay } from "@/domains/private-financing/persistedRowMapping";
import { computeAdjustmentPreview, isKnownAdjustmentActionType } from "@/domains/private-financing/adjustmentActionRegistry";
import { buildAppendEventRpcParams } from "@/domains/private-financing/appendEventRpcParams";
import {
  InvalidAdjustmentPreviewTokenError,
  StaleAdjustmentPreviewError,
  assertAdjustmentPreviewTokenFresh,
  decodeAdjustmentPreviewToken,
} from "@/domains/private-financing/adjustmentPreviewToken";
import { LedgerIntegrityViolationError } from "@/domains/private-financing/ledgerIntegrity";
import { MalformedPrivateFinancingContractError } from "@/domains/private-financing/privateFinancingContracts";

const STALE_PREVIEW_CODE = "private_financing_stale_preview";

function previewTokenSecret() {
  return process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET;
}

function rowToReceipt(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    ledgerSequence: row.ledger_sequence,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    amountCents: row.amount_cents,
    reason: row.reason,
  };
}

// The ONE place in this repository that appends an immutable Private Financing ledger event from a
// browser-authenticated request. Every value that matters for correctness or authorization is either
// re-derived from the database inside this handler or forced by append_private_financing_event() itself
// (SECURITY DEFINER) -- never trusted from the request body: p_owner_id comes from
// authenticated.effectiveOwnerId (the workspace resolver, never the client), p_event_origin is always
// "interactive_user" (baked into every SF-2D preview function's own proposedEventPayload, never a client
// field), and p_created_by is never sent at all (the RPC forces it from auth.uid()). ledgerSequence is
// never accepted as input anywhere in this file.
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
  const actionType = body?.actionType;
  const inputs = body && typeof body.inputs === "object" && body.inputs !== null ? body.inputs : {};
  const internalNote = typeof body?.internalNote === "string" && body.internalNote.trim().length > 0 ? body.internalNote.trim() : null;

  if (!isKnownAdjustmentActionType(actionType)) {
    return NextResponse.json({ error: "Unrecognized adjustment action type." }, { status: 400 });
  }

  let decodedToken;
  try {
    decodedToken = decodeAdjustmentPreviewToken(body?.previewToken, { secret: previewTokenSecret() });
  } catch (error) {
    if (error instanceof InvalidAdjustmentPreviewTokenError) {
      return NextResponse.json({ error: "This preview is invalid or has expired. Please preview again.", code: STALE_PREVIEW_CODE }, { status: 409 });
    }
    throw error;
  }

  const accountResult = await authenticated.supabaseClient.from("private_financing_accounts").select("id").eq("id", accountId).maybeSingle();
  if (accountResult.error && isMissingRemoteSchemaError(accountResult.error)) return privateFinancingSchemaUnavailableResponse();
  if (accountResult.error) return NextResponse.json({ error: "Unable to load this private financing account." }, { status: 500 });
  if (!accountResult.data) return NextResponse.json({ error: "Private financing account not found." }, { status: 404 });

  const [eventsResult, componentVersionsResult, termsVersionsResult] = await Promise.all([
    authenticated.supabaseClient.from("private_financing_events").select("*").eq("account_id", accountId).order("ledger_sequence", { ascending: true }),
    authenticated.supabaseClient.from("private_financing_components").select("*").eq("account_id", accountId),
    authenticated.supabaseClient.from("private_financing_account_terms_versions").select("*").eq("account_id", accountId),
  ]);
  if (eventsResult.error || componentVersionsResult.error || termsVersionsResult.error) {
    return NextResponse.json({ error: "Unable to load this account's ledger history." }, { status: 500 });
  }

  const eventRows = eventsResult.data || [];
  const currentLedgerSequence = eventRows.reduce((max, row) => Math.max(max, row.ledger_sequence ?? -1), -1);

  // Rejects: a different account (cross-account preview reuse), a different action or changed inputs
  // (tampering, or a stale form), and a moved ledger sequence (a new event posted since preview -- this
  // is ALSO what makes a double-click/double-submit safe: the first successful post advances the real
  // ledger sequence, so a second confirm reusing the same token fails here even with no separate
  // idempotency key, since interactive_user-origin events never carry one).
  try {
    assertAdjustmentPreviewTokenFresh(decodedToken, {
      accountId,
      actionType,
      inputs,
      currentLedgerSequence,
      ownerId: authenticated.effectiveOwnerId,
      actingUserId: authenticated.user.id,
    });
  } catch (error) {
    if (error instanceof StaleAdjustmentPreviewError) {
      return NextResponse.json({ error: error.message, code: STALE_PREVIEW_CODE }, { status: 409 });
    }
    throw error;
  }

  let freshPreview;
  try {
    const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(eventRows, componentVersionsResult.data || [], termsVersionsResult.data || []);
    freshPreview = computeAdjustmentPreview(actionType, { events, componentVersions, accountTermsVersions, asOfDate: decodedToken.asOfDate, inputs, createdBy: authenticated.user.id });
  } catch (error) {
    if (error instanceof LedgerIntegrityViolationError || error instanceof MalformedPrivateFinancingContractError) {
      return NextResponse.json({ error: error.message, code: "private_financing_invalid_adjustment_input" }, { status: 400 });
    }
    throw error;
  }

  if (freshPreview.blockingValidation.length > 0 || !freshPreview.proposedEventPayload) {
    return NextResponse.json(
      {
        error: freshPreview.blockingValidation[0] || "This adjustment cannot be posted.",
        blockers: freshPreview.blockingValidation,
        code: "private_financing_validation_failed",
      },
      { status: 400 },
    );
  }

  const rpcParams = buildAppendEventRpcParams(freshPreview.proposedEventPayload, {
    ownerId: authenticated.effectiveOwnerId,
    accountId,
    internalNote,
  });

  // The database takes the account row lock, re-checks the expected sequence, and appends in one
  // transaction. The signed confirmationId is also the event idempotency key. Application-level checks
  // above improve the error message; this RPC is the correctness boundary for concurrent confirms.
  const { data: eventRow, error: rpcError } = await authenticated.supabaseClient.rpc(
    "confirm_private_financing_adjustment",
    {
      p_owner_id: authenticated.effectiveOwnerId,
      p_account_id: accountId,
      p_expected_ledger_sequence: decodedToken.ledgerSequenceAtPreview,
      p_confirmation_id: decodedToken.confirmationId,
      p_event_payload: rpcParams,
    },
  );
  if (rpcError) {
    if (isMissingRemoteSchemaError(rpcError)) return privateFinancingSchemaUnavailableResponse();
    if (rpcError.code === "40001") {
      return NextResponse.json({ error: "The ledger changed while this adjustment was being confirmed. Please preview again.", code: STALE_PREVIEW_CODE }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to post this adjustment." }, { status: 500 });
  }

  return NextResponse.json({ success: true, event: rowToReceipt(eventRow) });
}
