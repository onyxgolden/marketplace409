import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { rowToForm, validateFormInput } from "@/domains/rental-forms/noticeLibrary";

export const runtime = "nodejs";

// Rentec parity R15: single custom form. System forms are read-only through
// the API (duplicate one to customize it); custom forms can be edited and
// deleted by owner/co-owner.

// Writes are owner/co-owner only: isOwnerOrActiveCoOwner is true for the
// primary owner (no workspace_members row) and an active co_owner, and false
// for manager, bookkeeper, and read_only staff.
async function ownerWriteBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}

async function loadForm(authenticated, id) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_custom_forms")
    .select("id, system_key, is_system, name, kind, body, updated_at")
    .eq("owner_id", authenticated.effectiveOwnerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const form = await loadForm(authenticated, params.id);
    if (!form) return NextResponse.json({ error: "Form was not found." }, { status: 404 });
    return NextResponse.json({ success: true, form: rowToForm(form) });
  } catch (error) {
    console.error("Custom form load error", error);
    return NextResponse.json({ error: "Unable to load the custom form." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await ownerWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Only the owner or co-owner can manage custom forms." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const validated = validateFormInput(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  try {
    const existing = await loadForm(authenticated, params.id);
    if (!existing) return NextResponse.json({ error: "Form was not found." }, { status: 404 });
    if (existing.is_system) {
      return NextResponse.json(
        { error: "System forms cannot be edited. Duplicate it to customize your own copy." },
        { status: 403 },
      );
    }
    const { data, error } = await authenticated.supabaseClient
      .from("rental_custom_forms")
      .update({ ...validated.clean, updated_at: new Date().toISOString() })
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", params.id)
      .select("id, system_key, is_system, name, kind, body, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, form: rowToForm(data) });
  } catch (error) {
    console.error("Custom form update error", error);
    return NextResponse.json({ error: "Unable to update the custom form." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await ownerWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Only the owner or co-owner can manage custom forms." }, { status: 403 });
  }
  try {
    const existing = await loadForm(authenticated, params.id);
    if (!existing) return NextResponse.json({ error: "Form was not found." }, { status: 404 });
    if (existing.is_system) {
      return NextResponse.json({ error: "System forms cannot be deleted." }, { status: 403 });
    }
    // Generated-notice log rows keep a form_name snapshot, so deleting the
    // template never rewrites history.
    const { error } = await authenticated.supabaseClient
      .from("rental_custom_forms")
      .delete()
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", params.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Custom form delete error", error);
    return NextResponse.json({ error: "Unable to delete the custom form." }, { status: 500 });
  }
}
