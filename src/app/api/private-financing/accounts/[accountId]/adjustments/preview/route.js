import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import { mapEventRowsForReplay } from "@/domains/private-financing/persistedRowMapping";
import { computeAdjustmentPreview, isKnownAdjustmentActionType } from "@/domains/private-financing/adjustmentActionRegistry";
import { encodeAdjustmentPreviewToken } from "@/domains/private-financing/adjustmentPreviewToken";
import { LedgerIntegrityViolationError } from "@/domains/private-financing/ledgerIntegrity";
import { MalformedPrivateFinancingContractError } from "@/domains/private-financing/privateFinancingContracts";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// PURE READ, NEVER A MUTATION: this endpoint never calls append_private_financing_event and never writes
// to any table. It exists only to compute (via adjustmentActionRegistry -> adjustmentPreview.js, SF-1's
// own pure engine) what an adjustment WOULD do if confirmed, and to hand back a previewToken binding that
// computation to the exact ledger state and inputs it saw -- see adjustmentPreviewToken.js. The confirm
// route re-derives everything fresh from the database before ever posting; nothing here is trusted at
// that point, this route's only job is to give the seller something accurate to look at first.
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
  const effectiveDate = body?.effectiveDate;

  if (!isKnownAdjustmentActionType(actionType)) {
    return NextResponse.json({ error: "Unrecognized adjustment action type.", code: "private_financing_unknown_action_type" }, { status: 400 });
  }

  const today = todayISODate();
  const resolvedEffectiveDate = typeof effectiveDate === "string" && effectiveDate.length > 0 ? effectiveDate : today;
  // SF-2D restricts to today/prospective dates only -- a real backdating engine (previewing the complete
  // downstream replay effect on every later event, requiring stronger confirmation) is deferred, per
  // explicit instruction, rather than half-built.
  if (resolvedEffectiveDate < today) {
    return NextResponse.json(
      { error: "Backdated effective dates are not supported yet -- choose today or a future date.", code: "private_financing_backdating_not_supported" },
      { status: 400 },
    );
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
  const highestLedgerSequence = eventRows.reduce((max, row) => Math.max(max, row.ledger_sequence ?? -1), -1);

  let preview;
  try {
    const { events, componentVersions, accountTermsVersions } = mapEventRowsForReplay(eventRows, componentVersionsResult.data || [], termsVersionsResult.data || []);
    // createdBy is only ever used to populate the preview's own display of who is about to act -- the
    // guarded RPC that actually posts an event ignores any created_by it's handed and forces its own from
    // auth.uid() regardless (see appendEventRpcParams.js), so this can never become a trusted value.
    preview = computeAdjustmentPreview(actionType, { events, componentVersions, accountTermsVersions, asOfDate: resolvedEffectiveDate, inputs, createdBy: authenticated.user.id });
  } catch (error) {
    if (error instanceof LedgerIntegrityViolationError || error instanceof MalformedPrivateFinancingContractError) {
      return NextResponse.json({ error: error.message, code: "private_financing_invalid_adjustment_input" }, { status: 400 });
    }
    throw error;
  }

  const previewToken = encodeAdjustmentPreviewToken({
    accountId,
    actionType,
    inputs,
    ledgerSequenceAtPreview: highestLedgerSequence,
    asOfDate: resolvedEffectiveDate,
  });

  return NextResponse.json({ success: true, preview, previewToken });
}
