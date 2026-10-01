import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { ensureSystemCustomForms, rowToForm, validateFormInput } from "@/domains/rental-forms/noticeLibrary";

export const runtime = "nodejs";

// Rentec parity R15: the custom forms / notice builder library (Rentec's
// forms-in-settings, mirrored on R6's message-templates routes). GET is
// readable by every workspace member — reading the library is not a write.
// POST is owner/co-owner only. The list GET performs the idempotent
// per-workspace seed of the system notice catalog, so every workspace always
// sees the full system set and re-reads can never duplicate it.

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    await ensureSystemCustomForms({
      supabaseClient: authenticated.supabaseClient,
      ownerId: authenticated.effectiveOwnerId,
    });
    const { searchParams } = new URL(request.url);
    let query = authenticated.supabaseClient
      .from("rental_custom_forms")
      .select("id, system_key, is_system, name, kind, body, updated_at")
      .eq("owner_id", authenticated.effectiveOwnerId);
    const kind = searchParams.get("kind");
    if (kind) query = query.eq("kind", kind);
    const { data, error } = await query
      .order("is_system", { ascending: false })
      .order("name", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, forms: (data || []).map(rowToForm) });
  } catch (error) {
    console.error("Custom forms load error", error);
    return NextResponse.json({ error: "Unable to load custom forms." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage custom forms." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    let input = body;
    if (body.duplicateFrom) {
      // Duplicate-and-customize: a system form's content becomes a new
      // custom form the workspace owns. A supplied name wins; otherwise the
      // copy is labeled.
      const { data: source, error: sourceError } = await authenticated.supabaseClient
        .from("rental_custom_forms")
        .select("name, kind, body")
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("id", body.duplicateFrom)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!source) return NextResponse.json({ error: "Form was not found." }, { status: 404 });
      input = { name: body.name || `${source.name} (copy)`, kind: source.kind, body: source.body };
    }
    const validated = validateFormInput(input);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { data, error } = await authenticated.supabaseClient
      .from("rental_custom_forms")
      .insert({
        owner_id: authenticated.effectiveOwnerId,
        is_system: false, // the API never creates system forms
        created_by: authenticated.user.id,
        ...validated.clean,
      })
      .select("id, system_key, is_system, name, kind, body, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, form: rowToForm(data) }, { status: 201 });
  } catch (error) {
    console.error("Custom form create error", error);
    return NextResponse.json({ error: "Unable to save the custom form." }, { status: 500 });
  }
}
