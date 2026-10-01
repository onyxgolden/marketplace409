import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  DEFAULT_CONSENT_TEXT,
  DEFAULT_FORM_SECTIONS,
  normalizeFormInput,
  validateFormInput,
} from "@/domains/rental-listings/applicationForms";

export const runtime = "nodejs";

// Rentec parity R21 — application-form builder (free layer). GET readable by
// every workspace member; writes are owner/co-owner only (read-only 403).
// POST with no input seeds the standard default form for the workspace.

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

export function rowToForm(row) {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
    sections: { ...DEFAULT_FORM_SECTIONS, ...(row.sections || {}) },
    customQuestions: row.custom_questions || [],
    feeAmountCents: row.fee_amount_cents,
    consentText: row.consent_text || DEFAULT_CONSENT_TEXT,
    updatedAt: row.updated_at,
  };
}

async function ensureSeeded(authenticated) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_listing_forms")
    .select("id").eq("owner_id", authenticated.effectiveOwnerId).eq("is_default", true).limit(1);
  if (error) throw error;
  if (data?.length) return;
  const timestamp = new Date().toISOString();
  const { error: insertError } = await authenticated.supabaseClient.from("rental_listing_forms").insert({
    owner_id: authenticated.effectiveOwnerId,
    name: "Standard rental application",
    is_default: true,
    sections: DEFAULT_FORM_SECTIONS,
    custom_questions: [],
    fee_amount_cents: 0,
    consent_text: DEFAULT_CONSENT_TEXT,
    created_by: authenticated.user.id,
    created_at: timestamp,
    updated_at: timestamp,
  });
  if (insertError) throw insertError;
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    await ensureSeeded(authenticated);
    const { data, error } = await authenticated.supabaseClient
      .from("rental_listing_forms")
      .select("id, name, is_default, sections, custom_questions, fee_amount_cents, consent_text, updated_at")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .order("is_default", { ascending: false }).order("name");
    if (error) throw error;
    return NextResponse.json({ success: true, forms: (data || []).map(rowToForm) });
  } catch (error) {
    console.error("Application forms load error", error);
    return NextResponse.json({ error: "Unable to load application forms." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot create application forms." }, { status: 403 });
    }
    const body = await request.json();
    const errors = validateFormInput(body?.form);
    if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    await ensureSeeded(authenticated);
    const normalized = normalizeFormInput(body.form);
    const timestamp = new Date().toISOString();
    const { data, error } = await authenticated.supabaseClient.from("rental_listing_forms").insert({
      owner_id: authenticated.effectiveOwnerId,
      name: normalized.name,
      is_default: normalized.isDefault,
      sections: normalized.sections,
      custom_questions: normalized.customQuestions,
      fee_amount_cents: normalized.feeAmountCents,
      consent_text: normalized.consentText,
      created_by: authenticated.user.id,
      created_at: timestamp,
      updated_at: timestamp,
    }).select("id, name, is_default, sections, custom_questions, fee_amount_cents, consent_text, updated_at").single();
    if (error) throw error;
    return NextResponse.json({ success: true, form: rowToForm(data) });
  } catch (error) {
    console.error("Application form create error", error);
    return NextResponse.json({ error: "Unable to create the application form." }, { status: 500 });
  }
}
