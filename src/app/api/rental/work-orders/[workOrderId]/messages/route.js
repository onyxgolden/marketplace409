import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import {
  buildWorkOrderMessageEventKey,
  buildWorkOrderMessagePing,
  queueWorkOrderMessagePing,
} from "@/domains/rental-maintenance/workOrderMessagePing";

export const runtime = "nodejs";

// Rentec parity R5: the message thread attached to one maintenance work order.
// GET is readable by every workspace member (read-only included) -- opening the thread IS the
// read action, matching the general conversation route. POST is owner/co-owner only.
function rowToMessage(row) {
  return { id: row.id, senderType: row.sender_type, body: row.body, createdAt: row.created_at };
}

async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

async function loadWorkOrder(authenticated, workOrderId) {
  const { data, error } = await authenticated.supabaseClient.from("rental_maintenance_work_orders")
    .select("id, request_id").eq("owner_id", authenticated.effectiveOwnerId).eq("id", workOrderId).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  const { workOrderId } = await params;
  try {
    const workOrder = await loadWorkOrder(authenticated, workOrderId);
    if (!workOrder) return NextResponse.json({ error: "Work order was not found." }, { status: 404 });
    const conversation = await authenticated.supabaseClient.from("rental_conversations")
      .select("id").eq("owner_id", authenticated.effectiveOwnerId).eq("work_order_id", workOrderId).maybeSingle();
    if (conversation.error) throw conversation.error;
    if (!conversation.data) return NextResponse.json({ success: true, messages: [] });
    const { data, error } = await authenticated.supabaseClient.from("rental_conversation_messages")
      .select("id, sender_type, body, created_at").eq("conversation_id", conversation.data.id)
      .order("created_at", { ascending: true }).limit(500);
    if (error) throw error;
    const { error: readError } = await authenticated.supabaseClient.rpc("mark_rental_work_order_read_by_owner", { p_work_order_id: workOrderId });
    if (readError) throw readError;
    return NextResponse.json({ success: true, messages: (data || []).map(rowToMessage) });
  } catch (error) {
    console.error("Work-order messages load error", error);
    return NextResponse.json({ error: "Unable to load these messages." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await readOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Read-only members cannot message tenants." }, { status: 403 });
  }
  const { workOrderId } = await params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.body !== "string" || body.body.trim() === "") {
    return NextResponse.json({ error: "A message body is required." }, { status: 400 });
  }
  try {
    const workOrder = await loadWorkOrder(authenticated, workOrderId);
    if (!workOrder) return NextResponse.json({ error: "Work order was not found." }, { status: 404 });

    const { data, error } = await authenticated.supabaseClient.rpc("send_rental_work_order_owner_message", {
      p_work_order_id: workOrderId, p_body: body.body.trim(),
    });
    if (error) throw error;

    // Best-effort ping to the tenant. The message itself is already saved; a missing tenant
    // email only skips the ping, never the message.
    let ping = null;
    try {
      const tenantResult = await authenticated.supabaseClient.from("rental_tenants")
        .select("id, display_name, email").eq("owner_id", authenticated.effectiveOwnerId).eq("id", data.tenantId).maybeSingle();
      const requestResult = await authenticated.supabaseClient.from("rental_maintenance_requests")
        .select("id, lease_id, title").eq("owner_id", authenticated.effectiveOwnerId).eq("id", workOrder.request_id).maybeSingle();
      const tenant = tenantResult.data || null;
      const maintenanceRequest = requestResult.data || null;
      if (tenant?.email?.trim() && maintenanceRequest?.lease_id) {
        const rendered = buildWorkOrderMessagePing({
          direction: "owner_to_tenant",
          tenantName: tenant.display_name,
          workOrderScope: maintenanceRequest.title,
        });
        ping = await queueWorkOrderMessagePing({
          supabaseClient: authenticated.supabaseClient,
          ownerId: authenticated.effectiveOwnerId,
          tenantId: tenant.id,
          leaseId: maintenanceRequest.lease_id,
          eventKey: buildWorkOrderMessageEventKey({ messageId: data.messageId }),
          recipient: tenant.email.trim(),
          subject: rendered.subject,
          bodyText: rendered.bodyText,
        });
      }
    } catch (pingError) {
      console.error("Work-order message ping error", pingError);
    }
    return NextResponse.json({ success: true, message: data, ping });
  } catch (error) {
    console.error("Work-order message send error", error);
    return NextResponse.json({ error: "Unable to send this message." }, { status: 500 });
  }
}
