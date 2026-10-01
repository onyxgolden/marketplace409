import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { validateTemplateInput } from "@/domains/rental-messaging/messageTemplates";
import { rowToTemplate } from "../route";

export const runtime = "nodejs";

// Single-template read/update/delete. System templates are read-only:
// PUT/DELETE on one returns 403 with the duplicate-to-customize pointer,
// matching Rentec (system rows have no trash-can; yours do).

const SYSTEM_GUARD_MESSAGE = "System templates cannot be changed — duplicate one to customize it.";

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

async function loadTemplate(authenticated, id) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_message_templates")
    .select("id, system_key, is_system, name, kind, audience, subject, body, updated_at")
    .eq("owner_id", authenticated.effectiveOwnerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const { id } = await params;
  try {
    const template = await loadTemplate(authenticated, id);
    if (!template) return NextResponse.json({ error: "Template was not found." }, { status: 404 });
    return NextResponse.json({ success: true, template: rowToTemplate(template) });
  } catch (error) {
    console.error("Message template load error", error);
    return NextResponse.json({ error: "Unable to load the message template." }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage message templates." }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    const template = await loadTemplate(authenticated, id);
    if (!template) return NextResponse.json({ error: "Template was not found." }, { status: 404 });
    if (template.is_system) return NextResponse.json({ error: SYSTEM_GUARD_MESSAGE }, { status: 403 });
    const validated = validateTemplateInput(body);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { data, error } = await authenticated.supabaseClient
      .from("rental_message_templates")
      .update({ ...validated.clean, updated_at: new Date().toISOString() })
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", id)
      .select("id, system_key, is_system, name, kind, audience, subject, body, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, template: rowToTemplate(data) });
  } catch (error) {
    console.error("Message template update error", error);
    return NextResponse.json({ error: "Unable to save the message template." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage message templates." }, { status: 403 });
  }
  const { id } = await params;
  try {
    const template = await loadTemplate(authenticated, id);
    if (!template) return NextResponse.json({ error: "Template was not found." }, { status: 404 });
    if (template.is_system) return NextResponse.json({ error: SYSTEM_GUARD_MESSAGE }, { status: 403 });
    const { error } = await authenticated.supabaseClient
      .from("rental_message_templates")
      .delete()
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    console.error("Message template delete error", error);
    return NextResponse.json({ error: "Unable to delete the message template." }, { status: 500 });
  }
}
