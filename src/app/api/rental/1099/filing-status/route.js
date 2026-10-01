import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  FILING_STATUSES,
  FILING_STATUS_LABELS,
  canTransitionFilingStatus,
  resolveFormType,
} from "@/application/rental/tax1099";

// R23 — filing status per recipient + tax year.
// POST { recipientId, taxYear, toStatus, note? } — writer role only.
// Status machine: not_started -> ready -> exported -> filed_manually
// (ready <-> not_started reset and exported -> ready re-export allowed;
// filed_manually is terminal). Enforced in the domain (canTransitionFilingStatus)
// AND again here so no client can skip the machine.

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change 1099 filing status." }, { status: 403 });
  }
  return null;
}

const STATE_COLUMNS = "recipient_id, tax_year, status, form_type, note, decided_at, exported_at, filed_at, created_at, updated_at";

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const body = await request.json().catch(() => ({}));
    const recipientId = typeof body.recipientId === "string" ? body.recipientId.trim() : "";
    const taxYear = Number(body.taxYear);
    const toStatus = typeof body.toStatus === "string" ? body.toStatus.trim() : "";
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;

    if (!recipientId) return NextResponse.json({ error: "A recipient is required." }, { status: 400 });
    if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) {
      return NextResponse.json({ error: "Tax year must be a valid year (e.g. 2026)." }, { status: 400 });
    }
    if (!FILING_STATUSES.includes(toStatus)) {
      return NextResponse.json({ error: `Filing status must be one of: ${FILING_STATUSES.join(", ")}.` }, { status: 400 });
    }

    const { data: recipient, error: recipientError } = await supabaseClient
      .from("rental_1099_recipients")
      .select("id, kind")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", recipientId)
      .maybeSingle();
    if (recipientError) throw recipientError;
    if (!recipient) return NextResponse.json({ error: "Recipient not found." }, { status: 404 });

    const { data: current, error: stateError } = await supabaseClient
      .from("rental_1099_filing_states")
      .select(STATE_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("recipient_id", recipientId)
      .eq("tax_year", taxYear)
      .maybeSingle();
    if (stateError) throw stateError;

    const fromStatus = current?.status || "not_started";
    if (fromStatus === toStatus) {
      return NextResponse.json({ success: true, state: current || null, unchanged: true });
    }
    if (!canTransitionFilingStatus(fromStatus, toStatus)) {
      return NextResponse.json({
        error: `Cannot move filing status from "${FILING_STATUS_LABELS[fromStatus]}" to "${FILING_STATUS_LABELS[toStatus]}".`,
      }, { status: 400 });
    }

    const now = new Date().toISOString();
    const patch = { status: toStatus, note };
    if (toStatus === "ready") patch.decided_at = now;
    if (toStatus === "exported") patch.exported_at = now;
    if (toStatus === "filed_manually") patch.filed_at = now;

    let result;
    if (current) {
      const { data, error } = await supabaseClient
        .from("rental_1099_filing_states")
        .update(patch)
        .eq("owner_id", effectiveOwnerId)
        .eq("recipient_id", recipientId)
        .eq("tax_year", taxYear)
        .select(STATE_COLUMNS)
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabaseClient
        .from("rental_1099_filing_states")
        .insert({
          owner_id: effectiveOwnerId,
          recipient_id: recipientId,
          tax_year: taxYear,
          form_type: resolveFormType(recipient.kind),
          ...patch,
        })
        .select(STATE_COLUMNS)
        .single();
      if (error) throw error;
      result = data;
    }

    return NextResponse.json({ success: true, state: result });
  } catch {
    return NextResponse.json({ error: "Unable to update the 1099 filing status." }, { status: 500 });
  }
}
