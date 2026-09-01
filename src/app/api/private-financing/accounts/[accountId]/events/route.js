import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import {
  InvalidEventHistoryCursorError,
  decodeEventHistoryCursor,
  encodeEventHistoryCursor,
  resolveEventHistoryPageSize,
} from "@/domains/private-financing/eventHistoryCursor";

// The seller's own view of the ledger -- distinct from persistedRowMapping.js's mapping (which reshapes a
// row into the replay engine's input contract). This is a presentation read model: every column the
// seller-side RLS policy already grants (has_workspace_access(owner_id), full row, no redaction), unlike
// the borrower-safe read_private_financing_borrower_events() RPC which structurally omits internal_note/
// idempotency_key/created_by/external_evidence_reference. A seller is allowed to see all of it.
function rowToEvent(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    eventOrigin: row.event_origin,
    createdBy: row.created_by,
    sourceReference: row.source_reference,
    idempotencyKey: row.idempotency_key,
    ledgerSequence: row.ledger_sequence,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    reversesEventId: row.reverses_event_id,
    reason: row.reason,
    internalNote: row.internal_note,
    borrowerVisibleExplanation: row.borrower_visible_explanation,
    amountCents: row.amount_cents,
    // V1 Terms Generalization: per-component fields are jsonb maps keyed by componentKey now, not two
    // fixed named columns -- see the v1_terms_generalization migration.
    interestPaidByComponentCents: row.interest_paid_by_component_cents,
    principalPaidByComponentCents: row.principal_paid_by_component_cents,
    unallocatedCents: row.unallocated_cents,
    principalRemainingByComponentCents: row.principal_remaining_by_component_cents,
    selectedExtraComponentId: row.selected_extra_component_id,
    paymentMethod: row.payment_method,
    componentId: row.component_id,
    correctionBasis: row.correction_basis,
    deltaCents: row.delta_cents,
    correctedComponentPrincipalRemainingCentsAfter: row.corrected_component_principal_remaining_cents_after,
    deltaCentsByComponentCents: row.delta_cents_by_component_cents,
    closureReason: row.closure_reason,
    payoffConcessionEventId: row.payoff_concession_event_id,
  };
}

// RLS-scoped directly against private_financing_events (owner_select policy), exactly like the account
// detail route -- a seller never needs the guarded borrower RPC, which exists solely to redact/scope for
// a claimed borrower identity.
//
// Keyset-paginated on ledger_sequence (see eventHistoryCursor.js for why keyset, not offset). This route
// is display-only -- the account-detail route's own balance computation always replays the COMPLETE
// authorized event history internally, regardless of what page a caller of this endpoint happens to be
// viewing; nothing here ever feeds a partial page into replayEvents.
export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;

  const { accountId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const pageSize = resolveEventHistoryPageSize(searchParams.get("limit"));
  const rawCursor = searchParams.get("cursor");

  let afterLedgerSequence = null;
  if (rawCursor) {
    try {
      afterLedgerSequence = decodeEventHistoryCursor(rawCursor, { expectedAccountId: accountId }).ledgerSequence;
    } catch (cursorError) {
      if (cursorError instanceof InvalidEventHistoryCursorError) {
        return NextResponse.json({ error: "Invalid pagination cursor.", code: "private_financing_invalid_cursor" }, { status: 400 });
      }
      throw cursorError;
    }
  }

  let query = authenticated.supabaseClient
    .from("private_financing_events")
    .select("*")
    .eq("account_id", accountId);
  if (afterLedgerSequence !== null) query = query.gt("ledger_sequence", afterLedgerSequence);
  // Fetch one extra row beyond the page size, purely to detect whether another page exists without a
  // separate count query -- the extra row is stripped below and never returned to the caller.
  query = query.order("ledger_sequence", { ascending: true }).limit(pageSize + 1);

  const { data, error } = await query;

  if (error && isMissingRemoteSchemaError(error)) return privateFinancingSchemaUnavailableResponse();
  if (error) return NextResponse.json({ error: "Unable to load this account's ledger history." }, { status: 500 });

  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor = hasMore ? encodeEventHistoryCursor({ accountId, ledgerSequence: pageRows[pageRows.length - 1].ledger_sequence }) : null;

  return NextResponse.json({
    success: true,
    events: pageRows.map(rowToEvent),
    pageInfo: { hasMore, nextCursor, pageSize },
  });
}
