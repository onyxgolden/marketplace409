import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  ensureSystemMessageTemplates,
  validateTemplateInput,
} from "@/domains/rental-messaging/messageTemplates";

export const runtime = "nodejs";

// Rentec parity R6: the message templates library (Settings → Program →
// Message templates in Rentec's IA). GET is readable by every workspace
// member (read-only included) — reading the library is not a write.
// POST is owner/co-owner only. The list GET also performs the idempotent
// per-workspace seed of the system catalog, so every workspace always sees
// the full system set and re-reads can never duplicate it.

export function rowToTemplate(row) {
  return {
    id: row.id,
    systemKey: row.system_key,
    isSystem: row.is_system,
    name: row.name,
    kind: row.kind,
    audience: row.audience,
    subject: row.subject,
    body: row.body,
    updatedAt: row.updated_at,
  };
}

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
    await ensureSystemMessageTemplates({
      supabaseClient: authenticated.supabaseClient,
      ownerId: authenticated.effectiveOwnerId,
    });
    const { searchParams } = new URL(request.url);
    let query = authenticated.supabaseClient
      .from("rental_message_templates")
      .select("id, system_key, is_system, name, kind, audience, subject, body, updated_at")
      .eq("owner_id", authenticated.effectiveOwnerId);
    const kind = searchParams.get("kind");
    const audience = searchParams.get("audience");
    if (kind) query = query.eq("kind", kind);
    if (audience) query = query.eq("audience", audience);
    const { data, error } = await query.order("updated_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ success: true, templates: (data || []).map(rowToTemplate) });
  } catch (error) {
    console.error("Message templates load error", error);
    return NextResponse.json({ error: "Unable to load message templates." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot manage message templates." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    let input = body;
    if (body.duplicateFrom) {
      // Duplicate-and-customize: a system template's content becomes a new
      // custom template the workspace owns. A supplied name wins; otherwise
      // the copy is labeled.
      const { data: source, error: sourceError } = await authenticated.supabaseClient
        .from("rental_message_templates")
        .select("name, kind, audience, subject, body")
        .eq("owner_id", authenticated.effectiveOwnerId)
        .eq("id", body.duplicateFrom)
        .maybeSingle();
      if (sourceError) throw sourceError;
      if (!source) return NextResponse.json({ error: "Template was not found." }, { status: 404 });
      input = {
        name: body.name || `${source.name} (copy)`,
        kind: source.kind,
        audience: source.audience,
        subject: source.subject,
        body: source.body,
      };
    }
    const validated = validateTemplateInput(input);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { data, error } = await authenticated.supabaseClient
      .from("rental_message_templates")
      .insert({
        owner_id: authenticated.effectiveOwnerId,
        is_system: false, // the API never creates system templates
        created_by: authenticated.user.id,
        ...validated.clean,
      })
      .select("id, system_key, is_system, name, kind, audience, subject, body, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, template: rowToTemplate(data) }, { status: 201 });
  } catch (error) {
    console.error("Message template create error", error);
    return NextResponse.json({ error: "Unable to save the message template." }, { status: 500 });
  }
}
