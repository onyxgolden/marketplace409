import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  buildPayerProfileId,
  decryptTin,
  encryptTin,
  maskTin,
  validatePayerProfileInput,
} from "@/application/rental/tax1099";

// R23 — payer profile: the filer's business identity per tax year
// (business name/address/TIN as it appears on the 1099s). The TIN follows the
// same rule as recipients: encrypted at rest, masked on read, decrypted only
// inside the export endpoint (writer role only).
// GET: masked profile for a tax year (read-only members may read).
// POST: upsert profile for a tax year (writer role only).

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot edit the payer profile." }, { status: 403 });
  }
  return null;
}

const PROFILE_COLUMNS =
  "id, tax_year, business_name, address_line1, address_line2, city, state, zip, tin_ciphertext, tin_last4, tin_type, contact_name, contact_phone, created_at, updated_at";

function serializeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    taxYear: row.tax_year,
    businessName: row.business_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    zip: row.zip,
    tinMasked: row.tin_last4 ? maskTin(row.tin_last4) : "Not on file",
    tinLast4: row.tin_last4,
    tinOnFile: row.tin_ciphertext != null,
    tinType: row.tin_type,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
  };
}

function defaultTaxYear() {
  return new Date().getFullYear();
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const url = new URL(request.url);
    const taxYear = Number(url.searchParams.get("taxYear")) || defaultTaxYear();

    const { data, error } = await supabaseClient
      .from("rental_1099_payer_profiles")
      .select(PROFILE_COLUMNS)
      .eq("owner_id", effectiveOwnerId)
      .eq("tax_year", taxYear)
      .maybeSingle();
    if (error) throw error;

    return NextResponse.json({ success: true, profile: serializeProfile(data) });
  } catch {
    return NextResponse.json({ error: "Unable to load the payer profile." }, { status: 500 });
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
    const validation = validatePayerProfileInput(body);
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
        if (error?.code === "TIN_KEY_MISSING") {
          return NextResponse.json({ error: "TIN encryption is not configured on the server (FORGE_1099_TIN_KEY)." }, { status: 500 });
        }
        throw error;
      }
    }

    const base = {
      business_name: value.businessName,
      address_line1: value.addressLine1,
      address_line2: value.addressLine2,
      city: value.city,
      state: value.state,
      zip: value.zip,
      tin_type: value.tinType,
      contact_name: value.contactName,
      contact_phone: value.contactPhone,
    };
    if (tinCiphertext) {
      base.tin_ciphertext = tinCiphertext;
      base.tin_last4 = tinLast4;
    }

    const { data: existing, error: findError } = await supabaseClient
      .from("rental_1099_payer_profiles")
      .select("id")
      .eq("owner_id", effectiveOwnerId)
      .eq("tax_year", value.taxYear)
      .maybeSingle();
    if (findError) throw findError;

    let saved;
    if (existing) {
      const { data, error } = await supabaseClient
        .from("rental_1099_payer_profiles")
        .update(base)
        .eq("owner_id", effectiveOwnerId)
        .eq("tax_year", value.taxYear)
        .select(PROFILE_COLUMNS)
        .single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabaseClient
        .from("rental_1099_payer_profiles")
        .insert({ owner_id: effectiveOwnerId, id: buildPayerProfileId(), tax_year: value.taxYear, ...base })
        .select(PROFILE_COLUMNS)
        .single();
      if (error) throw error;
      saved = data;
    }

    return NextResponse.json({ success: true, profile: serializeProfile(saved) });
  } catch {
    return NextResponse.json({ error: "Unable to save the payer profile." }, { status: 500 });
  }
}

// Server-side helper for the export route: load the profile with its FULL
// payer TIN decrypted (export endpoint only — never called from a list view).
export async function loadPayerProfileForExport(supabaseClient, ownerId, taxYear) {
  const { data, error } = await supabaseClient
    .from("rental_1099_payer_profiles")
    .select(PROFILE_COLUMNS)
    .eq("owner_id", ownerId)
    .eq("tax_year", taxYear)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!data.tin_ciphertext) {
    const missing = new Error("Payer TIN is not on file for this tax year.");
    missing.code = "PAYER_TIN_MISSING";
    throw missing;
  }
  return {
    tin: decryptTin(data.tin_ciphertext),
    name: data.business_name,
    address: data.address_line1 || "",
    city: data.city || "",
    state: data.state || "",
    zip: data.zip || "",
  };
}
