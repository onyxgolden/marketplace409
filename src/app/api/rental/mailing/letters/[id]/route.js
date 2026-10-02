import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import {
  LETTER_STATUSES,
  assertLetterStatusTransition,
  assertMailingEvidenceRules,
  validateTrackingNumber,
} from "@/domains/rental-mailing/mailingLetters";

export const runtime = "nodejs";

// Rentec parity R20 — one letter (tracking + delivery status).
//
// GET   → the letter with its rendered body snapshot.
// PATCH → { status?, trackingNumber? }. Status moves through the guarded
//         machine (queued → mailed → delivered, with honest reversals);
//         anything else is a 422. Marking mailed stamps mailed_at; marking
//         delivered stamps delivered_at; reversing clears the stamp being
//         undone. The tracking number is manual entry — the owner mails at
//         the post office and types in the number from the receipt.
//
// Compliance (certified-mail evidence): a letter cannot enter mailed (and
// therefore delivered) without a tracking number — enter it in the same
// PATCH or record it first. Once delivery is recorded, the tracking number
// cannot be cleared or changed unless the delivery is first reversed under
// the correction workflow (delivered → mailed). Status moves and tracking
// changes are stamped into rental_mail_letter_events so corrections stay
// visible instead of silently rewriting the evidence. The database check
// constraint rental_mail_letters_tracking_required_for_mailed backs the
// mailed/delivered invariant independently of this route.
//
// Writes are owner/co-owner only (the Rentec parity contract): manager,
// bookkeeper, and read_only staff cannot mutate mailing status or tracking.

const LETTER_COLUMNS = "id, batch_id, template_id, tenant_id, tenant_name, recipient_address, return_address, subject, body, letter_date, status, tracking_number, mailed_at, delivered_at, document_id, created_at";

function rowToLetter(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    templateId: row.template_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    recipientAddress: row.recipient_address,
    returnAddress: row.return_address,
    subject: row.subject,
    body: row.body,
    letterDate: row.letter_date,
    status: row.status,
    trackingNumber: row.tracking_number,
    mailedAt: row.mailed_at,
    deliveredAt: row.delivered_at,
    documentId: row.document_id,
    createdAt: row.created_at,
  };
}

// R20: mailing writes are owner/co-owner only. isOwnerOrActiveCoOwner answers
// exactly this question: the primary owner (no membership row) or an active
// co_owner is the owning household, never staff.
async function ownerOnlyWriteBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}

async function findLetter(supabaseClient, ownerId, letterId) {
  const { data, error } = await supabaseClient
    .from("rental_mail_letters")
    .select(LETTER_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", letterId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const letter = await findLetter(authenticated.supabaseClient, authenticated.effectiveOwnerId, params.id);
    if (!letter) return NextResponse.json({ error: "The letter was not found." }, { status: 404 });
    return NextResponse.json({ success: true, letter: rowToLetter(letter) });
  } catch (error) {
    console.error("Mailing letter load error", error);
    return NextResponse.json({ error: "Unable to load the letter." }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await ownerOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Only the owner or co-owner can update mailings." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const letter = await findLetter(supabaseClient, effectiveOwnerId, params.id);
    if (!letter) return NextResponse.json({ error: "The letter was not found." }, { status: 404 });

    // Resolve the requested tracking value first: undefined = untouched,
    // null = clear, otherwise the cleaned number.
    let nextTrackingNumber;
    if (body.trackingNumber !== undefined) {
      const raw = String(body.trackingNumber ?? "").trim();
      if (!raw) {
        nextTrackingNumber = null;
      } else {
        try {
          nextTrackingNumber = validateTrackingNumber(raw);
        } catch (validationError) {
          return NextResponse.json({ error: validationError.message }, { status: 400 });
        }
      }
    }

    // Resolve the requested status move (null when the status is unchanged).
    let nextStatus = null;
    if (body.status !== undefined) {
      const next = String(body.status || "").trim();
      if (!LETTER_STATUSES.includes(next)) {
        return NextResponse.json({ error: `Status must be one of: ${LETTER_STATUSES.join(", ")}.` }, { status: 400 });
      }
      if (next !== letter.status) {
        try {
          assertLetterStatusTransition(letter.status, next);
        } catch (transitionError) {
          return NextResponse.json({ error: transitionError.message }, { status: 422 });
        }
        nextStatus = next;
      }
    }

    // Certified-mail evidence invariant: mailed/delivered requires a tracking
    // number, and delivered tracking cannot be rewritten without reversing
    // the delivery first. The route returns 422 with plain English; the
    // database constraint backs the mailed/delivered half independently.
    try {
      assertMailingEvidenceRules({ letter, nextStatus, nextTrackingNumber });
    } catch (evidenceError) {
      return NextResponse.json({ error: evidenceError.message }, { status: 422 });
    }

    if (nextStatus === null && nextTrackingNumber === undefined) {
      return NextResponse.json({ success: true, letter: rowToLetter(letter), unchanged: true });
    }

    // Atomic write: the letter mutation and the compliance audit event
    // insert(s) happen inside one transaction in update_mailing_letter_atomic.
    // Either everything commits or nothing does — a status/tracking correction
    // can never land without its audit row. The RPC locks the letter and
    // re-checks it against what was read above (compare-and-swap); a
    // concurrent change surfaces as 409. mailed_at/delivered_at are derived
    // from the transition inside the RPC so the stamps always match the
    // status that was actually written.
    const { data: updated, error: rpcError } = await supabaseClient.rpc("update_mailing_letter_atomic", {
      p_owner_id: effectiveOwnerId,
      p_letter_id: letter.id,
      p_expected_status: letter.status,
      p_expected_tracking: letter.tracking_number,
      p_next_status: nextStatus,
      p_tracking_touched: nextTrackingNumber !== undefined,
      p_next_tracking: nextTrackingNumber !== undefined ? nextTrackingNumber : null,
    });
    if (rpcError) {
      const code = rpcError.code || "";
      if (code === "P0001") {
        return NextResponse.json({ error: "The letter changed while you were editing it. Reload and try again." }, { status: 409 });
      }
      if (code === "42501") {
        return NextResponse.json({ error: "Only the owner or co-owner can update mailings." }, { status: 403 });
      }
      throw rpcError;
    }

    return NextResponse.json({ success: true, letter: rowToLetter(updated) });
  } catch (error) {
    console.error("Mailing letter update error", error);
    return NextResponse.json({ error: "Unable to update the letter." }, { status: 500 });
  }
}
