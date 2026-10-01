import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  buildVendorId,
  isDuplicateVendorName,
  serializeVendor,
  validateVendorInput,
} from "@/application/rental/vendors";

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot change vendors." }, { status: 403 });
  }
  return null;
}

const VENDOR_COLUMNS = "id, name, contact_name, email, phone, address, trade, tax_classification, tax_id_last4, notes, is_active, created_at, updated_at";

// GET /api/rental/vendors — the owner's vendor directory.
// ?search= filters name/contact/trade (case-insensitive); ?includeInactive=1
// keeps deactivated vendors in the list. Read-only members may read.
export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const params = new URL(request.url).searchParams;
    const search = String(params.get("search") || "").trim();
    const includeInactive = params.get("includeInactive") === "1";

    let query = supabaseClient
      .from("rental_vendors")
      .select(VENDOR_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .order("name", { ascending: true });
    if (!includeInactive) query = query.eq("is_active", true);
    if (search) {
      const like = `%${search.replaceAll("%", "").replaceAll(",", "")}%`;
      query = query.or(`name.ilike.${like},contact_name.ilike.${like},trade.ilike.${like}`);
    }
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ success: true, vendors: (data || []).map(serializeVendor) });
  } catch (error) {
    console.error("Vendors list error", error);
    return NextResponse.json({ error: "Unable to load vendors." }, { status: 500 });
  }
}

// POST /api/rental/vendors — add a vendor.
// Body: { name*, contactName?, email?, phone?, address?, trade?,
//         taxClassification?, taxIdLast4?, notes? }.
// Duplicate names (case-insensitive, same workspace) are rejected with a 409 —
// two "Acme Plumbing" records are a data-quality trap.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const forbidden = await requireWriter(authenticated);
    if (forbidden) return forbidden;
    const { supabaseClient, effectiveOwnerId, user } = authenticated;

    const body = await request.json();
    const check = validateVendorInput(body);
    if (!check.valid) return NextResponse.json({ error: check.errors.join(" ") }, { status: 400 });
    const value = check.value;

    const { data: existing, error: existingError } = await supabaseClient
      .from("rental_vendors")
      .select("name")
      .eq("owner_id", effectiveOwnerId);
    if (existingError) throw existingError;
    if (isDuplicateVendorName(value.name, (existing || []).map((row) => row.name))) {
      return NextResponse.json({ error: "A vendor with that name already exists." }, { status: 409 });
    }

    const id = buildVendorId();
    const { data, error } = await supabaseClient
      .from("rental_vendors")
      .insert({
        owner_id: effectiveOwnerId,
        id,
        name: value.name,
        contact_name: value.contactName,
        email: value.email,
        phone: value.phone,
        address: value.address,
        trade: value.trade,
        tax_classification: value.taxClassification,
        tax_id_last4: value.taxIdLast4,
        notes: value.notes,
        is_active: true,
      })
      .select(VENDOR_COLUMNS)
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, vendor: serializeVendor(data) }, { status: 201 });
  } catch (error) {
    console.error("Vendor create error", error);
    return NextResponse.json({ error: "Unable to save the vendor." }, { status: 500 });
  }
}
