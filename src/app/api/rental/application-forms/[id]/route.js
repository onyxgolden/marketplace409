import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  normalizeFormInput,
  validateFormInput,
} from "@/domains/rental-listings/applicationForms";
import { rowToForm } from "../route";

export const runtime = "nodejs";

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

async function loadForm(authenticated, id) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_listing_forms")
    .select("id, name, is_default, sections, custom_questions, fee_amount_cents, consent_text, updated_at")
    .eq("owner_id", authenticated.effectiveOwnerId).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const form = await loadForm(authenticated, (await params).id);
    if (!form) return NextResponse.json({ error: "Application form was not found." }, { status: 404 });
    return NextResponse.json({ success: true, form: rowToForm(form) });
  } catch (error) {
    console.error("Application form detail error", error);
    return NextResponse.json({ error: "Unable to load the application form." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot edit application forms." }, { status: 403 });
    }
    const form = await loadForm(authenticated, (await params).id);
    if (!form) return NextResponse.json({ error: "Application form was not found." }, { status: 404 });
    const body = await request.json();
    const errors = validateFormInput({ ...body?.form, name: body?.form?.name ?? form.name });
    if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
    const normalized = normalizeFormInput({ ...body.form, name: body?.form?.name ?? form.name });
    const patch = {
      name: normalized.name,
      sections: normalized.sections,
      custom_questions: normalized.customQuestions,
      fee_amount_cents: normalized.feeAmountCents,
      consent_text: normalized.consentText,
      updated_at: new Date().toISOString(),
    };
    // The default form's name stays standard; its sections/questions/fee are
    // still editable.
    if (form.is_default) patch.name = form.name;
    const { data, error } = await authenticated.supabaseClient
      .from("rental_listing_forms").update(patch)
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", form.id)
      .select("id, name, is_default, sections, custom_questions, fee_amount_cents, consent_text, updated_at").single();
    if (error) throw error;
    return NextResponse.json({ success: true, form: rowToForm(data) });
  } catch (error) {
    console.error("Application form update error", error);
    return NextResponse.json({ error: "Unable to update the application form." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot delete application forms." }, { status: 403 });
    }
    const form = await loadForm(authenticated, (await params).id);
    if (!form) return NextResponse.json({ error: "Application form was not found." }, { status: 404 });
    if (form.is_default) return NextResponse.json({ error: "The default form cannot be deleted." }, { status: 409 });
    const { data: inUse, error: inUseError } = await authenticated.supabaseClient
      .from("rental_listings").select("id").eq("owner_id", authenticated.effectiveOwnerId).eq("listing_form_id", form.id).limit(1);
    if (inUseError) throw inUseError;
    if (inUse?.length) {
      return NextResponse.json({ error: "This form is attached to a listing. Change the listing's form first." }, { status: 409 });
    }
    const { error } = await authenticated.supabaseClient
      .from("rental_listing_forms").delete()
      .eq("owner_id", authenticated.effectiveOwnerId).eq("id", form.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Application form delete error", error);
    return NextResponse.json({ error: "Unable to delete the application form." }, { status: 500 });
  }
}
