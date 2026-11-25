import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";

export const runtime = "nodejs";

// One invocation drains at most this many rows. The Vercel cron below runs
// once a day, so a single-row-per-call endpoint could never clear a backlog
// (and is exactly how the 4 trigger-created payment receipts sat queued for
// 5+ weeks in Oct–Nov 2026: nothing ever invoked this endpoint at all).
// The cap bounds one invocation's runtime; each row still goes through the
// same claim → send → complete path with the same failure semantics.
export const MAX_DELIVERIES_PER_RUN = 10;

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically and
// cannot send any other secret — so a cron-scheduled invocation would 401
// against a delivery-secret-only check. Accept either secret: CRON_SECRET
// for the Vercel cron (vercel.json), RENTAL_NOTIFICATION_DELIVERY_SECRET
// for the documented manual/authenticated-scheduler path. A secret that is
// unset never matches (an empty Bearer value is not a match).
//
// Vercel Cron triggers its configured paths with an HTTP GET request, so the
// cron entry point is GET. POST is retained for the documented manual
// scheduler path (docs/product/RENTAL_EMAIL_DELIVERY_ACTIVATION.md); both
// methods share the same fail-closed authorized handler below.
function isAuthorized(request) {
  const header = request.headers.get("authorization");
  if (!header) return false;
  const secrets = [process.env.CRON_SECRET, process.env.RENTAL_NOTIFICATION_DELIVERY_SECRET].filter(Boolean);
  return secrets.some((secret) => header === `Bearer ${secret}`);
}

// Deliver one claimed row. Returns { ok: true } on send, { ok: false } when
// the row's delivery failed and the failed outcome was recorded — the caller
// surfaces that loudly (502) exactly as a single-row invocation used to.
// Claim-RPC errors throw and surface as 500 via the caller's catch.
async function deliverClaimed(db, notification, reservationConfirmation) {
  try {
    const settings = await db.from("rental_email_settings").select("provider,sender_name,sender_email,status").eq("owner_id", notification.owner_id).eq("status", "active").single();
    if (settings.error) throw settings.error;
    if (settings.data.provider !== "resend") throw new Error("Rental email settings do not use the approved Resend provider.");
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://409marketplace.online").replace(/\/$/, "");
    const bodyText = reservationConfirmation ? notification.body_text.replace(/(^|\s)(\/book\/[^\s]+)/g, `$1${siteUrl}$2`) : notification.body_text;
    const sent = await createResendRentalEmailProvider().send({ id: notification.id, ownerId: notification.owner_id, senderName: settings.data.sender_name, senderEmail: settings.data.sender_email, recipient: notification.recipient, subject: notification.subject, bodyText });
    const completion = reservationConfirmation ? "complete_reservation_confirmation" : "complete_rental_email_delivery";
    const idKey = reservationConfirmation ? "p_id" : "p_notification_id";
    const done = await db.rpc(completion, { p_owner_id: notification.owner_id, [idKey]: notification.id, p_succeeded: true, p_provider_message_id: sent.messageId, p_failure_message: null });
    if (done.error) throw done.error;
    return { ok: true };
  } catch (error) {
    const completion = reservationConfirmation ? "complete_reservation_confirmation" : "complete_rental_email_delivery";
    const idKey = reservationConfirmation ? "p_id" : "p_notification_id";
    await db.rpc(completion, { p_owner_id: notification.owner_id, [idKey]: notification.id, p_succeeded: false, p_provider_message_id: null, p_failure_message: error instanceof Error ? error.message : "Provider delivery failed." });
    return { ok: false };
  }
}

async function handleDeliver(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient();
    const deliveredIds = [];
    for (let attempt = 0; attempt < MAX_DELIVERIES_PER_RUN; attempt += 1) {
      let claim = await db.rpc("claim_rental_email_notification"), reservationConfirmation = false;
      if (claim.error) throw claim.error;
      if (!claim.data?.id) { claim = await db.rpc("claim_reservation_confirmation"); reservationConfirmation = true; }
      if (claim.error) throw claim.error;
      if (!claim.data?.id) break;
      const notification = claim.data;
      const result = await deliverClaimed(db, notification, reservationConfirmation);
      if (!result.ok) {
        return NextResponse.json({ error: "Email delivery failed.", notificationId: notification.id, deliveredCount: deliveredIds.length }, { status: 502 });
      }
      deliveredIds.push(notification.id);
    }
    return NextResponse.json({ success: true, delivered: deliveredIds.length > 0, deliveredCount: deliveredIds.length, notificationIds: deliveredIds });
  } catch (error) {
    console.error("Rental email delivery error", error);
    return NextResponse.json({ error: "Unable to process rental email delivery." }, { status: 500 });
  }
}

// Vercel Cron invokes this path with GET; the documented manual scheduler
// path invokes it with POST. Both share the same handler.
export async function GET(request) {
  return handleDeliver(request);
}

export async function POST(request) {
  return handleDeliver(request);
}
