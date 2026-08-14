import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";

export const runtime = "nodejs";

export async function POST(request) {
  if (!process.env.RENTAL_NOTIFICATION_DELIVERY_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.RENTAL_NOTIFICATION_DELIVERY_SECRET}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const db = createRentalWebhookClient(), claim = await db.rpc("claim_rental_email_notification");
    if (claim.error) throw claim.error;
    if (!claim.data?.id) return NextResponse.json({ success: true, delivered: false });
    const notification = claim.data;
    try {
      const settings = await db.from("rental_email_settings").select("provider,sender_name,sender_email,status").eq("owner_id", notification.owner_id).eq("status", "active").single();
      if (settings.error) throw settings.error;
      if (settings.data.provider !== "resend") throw new Error("Rental email settings do not use the approved Resend provider.");
      const sent = await createResendRentalEmailProvider().send({ id: notification.id, ownerId: notification.owner_id, senderName: settings.data.sender_name, senderEmail: settings.data.sender_email, recipient: notification.recipient, subject: notification.subject, bodyText: notification.body_text });
      const done = await db.rpc("complete_rental_email_delivery", { p_owner_id: notification.owner_id, p_notification_id: notification.id, p_succeeded: true, p_provider_message_id: sent.messageId, p_failure_message: null });
      if (done.error) throw done.error;
      return NextResponse.json({ success: true, delivered: true, notificationId: notification.id });
    } catch (error) {
      await db.rpc("complete_rental_email_delivery", { p_owner_id: notification.owner_id, p_notification_id: notification.id, p_succeeded: false, p_provider_message_id: null, p_failure_message: error instanceof Error ? error.message : "Provider delivery failed." });
      return NextResponse.json({ error: "Email delivery failed.", notificationId: notification.id }, { status: 502 });
    }
  } catch (error) {
    console.error("Rental email delivery error", error);
    return NextResponse.json({ error: "Unable to process rental email delivery." }, { status: 500 });
  }
}
