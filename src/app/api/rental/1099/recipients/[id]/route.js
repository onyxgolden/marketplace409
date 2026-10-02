import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  encryptTin,
  serializeRecipient,
  validateRecipientInput,
} from "@/application/rental/tax1099";

// R23 — single 1099 recipient.
// GET/PATCH/DELETE. Read-only members may read; writes need the writer role.
// TIN update semantics: PATCH with an empty/absent `tin` leaves the stored TIN
// untouched; a supplied 9-digit TIN replaces it (re-encrypted). The response
// is always the masked serializer — no full TIN ever leaves this route.
// DELETE archives the recipient (is_active = false) — reversal-friendly, never
// a hard delete, so filed-year history stays intact.

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot manage 1099 recipients." }, { status: 403 });
  }
  return null;
}

const RECIPIENT_COLUMNS =
  "id, kind, linked_vendor_id, display_name, entity_type, address_line1, address_line2, city, state, zip, country, tin_ciphertext, tin_last4, tin_type, is_active, notes, created_at, updated_at";

async function findRecipient(supabaseClient, ownerId, recipientId) {
  const { data, error } = await supabaseClient
    .from("rental_1099_recipients")
    .select(RECIPIENT_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("id", recipientId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(_request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const recipient = await findRecipient(supabaseClient, effectiveOwnerId, params.id);
    if (!recipient) return NextResponse.json({ error: "Recipient not found." }, { status: 404 });
    return NextResponse.json({ success: true, recipient: serializeRecipient(recipient) });
  } catch {
    return NextResponse.json({ error: "Unable to load the 1099 recipient." }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const existing = await findRecipient(supabaseClient, effectiveOwnerId, params.id);
    if (!existing) return NextResponse.json({ error: "Recipient not found." }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    // Merge with existing values so partial updates validate cleanly; TIN is
    // handled separately below (empty string = keep existing).
    const validation = validateRecipientInput({
      kind: body.kind ?? existing.kind,
      displayName: body.displayName ?? existing.display_name,
      entityType: body.entityType ?? existing.entity_type,
      tinType: body.tinType ?? existing.tin_type,
      tin: body.tin === undefined || body.tin === null || String(body.tin).trim() === "" ? undefined : body.tin,
      linkedVendorId: body.linkedVendorId !== undefined ? body.linkedVendorId : existing.linked_vendor_id,
      addressLine1: body.addressLine1 !== undefined ? body.addressLine1 : existing.address_line1,
      addressLine2: body.addressLine2 !== undefined ? body.addressLine2 : existing.address_line2,
      city: body.city !== undefined ? body.city : existing.city,
      state: body.state !== undefined ? body.state : existing.state,
      zip: body.zip !== undefined ? body.zip : existing.zip,
      notes: body.notes !== undefined ? body.notes : existing.notes,
    });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });
    }
    const value = validation.value;

    const patch = {
      kind: value.kind,
      display_name: value.displayName,
      entity_type: value.entityType,
      tin_type: value.tinType,
      linked_vendor_id: value.linkedVendorId,
      address_line1: value.addressLine1,
      address_line2: value.addressLine2,
      city: value.city,
      state: value.state,
      zip: value.zip,
      notes: value.notes,
    };
    if (value.tin) {
      try {
        patch.tin_ciphertext = encryptTin(value.tin);
        patch.tin_last4 = value.tin.slice(-4);
      } catch (error) {
        if (error?.code === "TIN_KEY_MISSING") {
          return NextResponse.json({ error: "TIN encryption is not configured on the server (FORGE_1099_TIN_KEY)." }, { status: 500 });
        }
        throw error;
      }
    }

    const { data, error } = await supabaseClient
      .from("rental_1099_recipients")
      .update(patch)
      .eq("owner_id", effectiveOwnerId)
      .eq("id", params.id)
      .select(RECIPIENT_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, recipient: serializeRecipient(data) });
  } catch {
    return NextResponse.json({ error: "Unable to update the 1099 recipient." }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const existing = await findRecipient(supabaseClient, effectiveOwnerId, params.id);
    if (!existing) return NextResponse.json({ error: "Recipient not found." }, { status: 404 });

    const { data, error } = await supabaseClient
      .from("rental_1099_recipients")
      .update({ is_active: false })
      .eq("owner_id", effectiveOwnerId)
      .eq("id", params.id)
      .select(RECIPIENT_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, recipient: serializeRecipient(data) });
  } catch {
    return NextResponse.json({ error: "Unable to archive the 1099 recipient." }, { status: 500 });
  }
}
