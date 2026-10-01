import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  buildRecipientId,
  encryptTin,
  maskTin,
  serializeRecipient,
  validateRecipientInput,
} from "@/application/rental/tax1099";

// R23 — 1099 recipients (who gets a 1099 this year).
// GET: list recipients. Read-only members may read. TINs are ALWAYS masked —
// the list response carries tinMasked/tinLast4 only, never tin_ciphertext.
// POST: create a recipient. Writer role only. A supplied TIN is encrypted with
// the server env key FORGE_1099_TIN_KEY (fail-closed when unconfigured).

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot manage 1099 recipients." }, { status: 403 });
  }
  return null;
}

const RECIPIENT_COLUMNS =
  "id, kind, linked_vendor_id, display_name, entity_type, address_line1, address_line2, city, state, zip, country, tin_ciphertext, tin_last4, tin_type, is_active, notes, created_at, updated_at";

function toTinKeyError(error) {
  if (error?.code === "TIN_KEY_MISSING") {
    return NextResponse.json({ error: "TIN encryption is not configured on the server (FORGE_1099_TIN_KEY). Ask Jason to configure it before collecting TINs." }, { status: 500 });
  }
  throw error;
}

export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const { data, error } = await supabaseClient
      .from("rental_1099_recipients")
      .select(RECIPIENT_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .order("display_name");
    if (error) throw error;

    // serializeRecipient strips tin_ciphertext — the full TIN can never leave
    // this endpoint, even accidentally.
    return NextResponse.json({ success: true, recipients: (data || []).map(serializeRecipient) });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load 1099 recipients." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const body = await request.json().catch(() => ({}));
    const validation = validateRecipientInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.errors[0], errors: validation.errors }, { status: 400 });
    }
    const value = validation.value;

    let tinCiphertext = null;
    let tinLast4 = null;
    if (value.tin) {
      try {
        tinCiphertext = encryptTin(value.tin);
        tinLast4 = value.tin.slice(-4);
      } catch (error) {
        return toTinKeyError(error);
      }
    }

    const row = {
      owner_id: effectiveOwnerId,
      id: buildRecipientId(),
      kind: value.kind,
      linked_vendor_id: value.linkedVendorId,
      display_name: value.displayName,
      entity_type: value.entityType,
      address_line1: value.addressLine1,
      address_line2: value.addressLine2,
      city: value.city,
      state: value.state,
      zip: value.zip,
      tin_ciphertext: tinCiphertext,
      tin_last4: tinLast4,
      tin_type: value.tinType,
      notes: value.notes,
    };

    const { data, error } = await supabaseClient
      .from("rental_1099_recipients")
      .insert(row)
      .select(RECIPIENT_COLUMNS)
      .single();
    if (error) throw error;

    return NextResponse.json({ success: true, recipient: serializeRecipient(data) }, { status: 201 });
  } catch (error) {
    if (error?.code === "TIN_KEY_MISSING") return toTinKeyError(error);
    return NextResponse.json({ error: "Unable to create the 1099 recipient." }, { status: 500 });
  }
}
