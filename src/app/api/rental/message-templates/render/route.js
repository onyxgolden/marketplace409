import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { renderMessageTemplate } from "@/domains/rental-messaging/messageTemplates";
import { resolveWorkOrderTemplateContext } from "@/domains/rental-messaging/messageTemplateContext";

export const runtime = "nodejs";

// Renders one template against server-resolved merge fields. The work-order
// message composer (R5) posts { templateId, workOrderId } and inserts the
// returned body into the draft — the composer never renders client-side, so
// every sender shares this single server-side renderer. Readable by every
// workspace member: rendering changes nothing.
//
// Response: { success, subject, body, missingFields, unknownFields }.
// missingFields names catalog fields with no value (rendered as ""); the
// composer surfaces them so the sender can fix data before sending.

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const body = await request.json().catch(() => ({}));
  if (!body.templateId || typeof body.templateId !== "string") {
    return NextResponse.json({ error: "A templateId is required." }, { status: 400 });
  }
  try {
    const { data: template, error } = await authenticated.supabaseClient
      .from("rental_message_templates")
      .select("id, subject, body")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("id", body.templateId)
      .maybeSingle();
    if (error) throw error;
    if (!template) return NextResponse.json({ error: "Template was not found." }, { status: 404 });

    const fields = body.workOrderId
      ? await resolveWorkOrderTemplateContext({
          supabaseClient: authenticated.supabaseClient,
          ownerId: authenticated.effectiveOwnerId,
          workOrderId: body.workOrderId,
        })
      : {};

    const renderedBody = renderMessageTemplate(template.body, fields);
    const renderedSubject = template.subject ? renderMessageTemplate(template.subject, fields) : null;
    const missing = new Set([...renderedBody.missing, ...(renderedSubject?.missing || [])]);
    const unknown = new Set([...renderedBody.unknown, ...(renderedSubject?.unknown || [])]);
    return NextResponse.json({
      success: true,
      subject: renderedSubject ? renderedSubject.text : null,
      body: renderedBody.text,
      missingFields: [...missing],
      unknownFields: [...unknown],
    });
  } catch (error) {
    console.error("Message template render error", error);
    return NextResponse.json({ error: "Unable to render the message template." }, { status: 500 });
  }
}
