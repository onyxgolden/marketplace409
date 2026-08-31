import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";

const ROLES = new Set(["primary_borrower", "co_borrower", "guarantor"]);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(request, { params }) {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;
  const { accountId } = await params;
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const role = typeof body.role === "string" ? body.role : "primary_borrower";
  if (!EMAIL.test(email) || !fullName || !ROLES.has(role)) return NextResponse.json({ error: "Name, valid email, and borrower role are required." }, { status: 400 });

  const { data, error } = await authenticated.supabaseClient.rpc("invite_private_financing_borrower", {
    p_owner_id: authenticated.effectiveOwnerId, p_account_id: accountId, p_email: email, p_full_name: fullName, p_role: role,
  });
  if (error) return NextResponse.json({ error: "Unable to create this borrower invitation." }, { status: error.code === "P0002" ? 404 : 400 });

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://marketplace409.vercel.app").replace(/\/$/, "");
  const senderEmail = process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online";
  try {
    const sent = await createResendRentalEmailProvider().send({
      id: `private-financing-${data.membershipId}-${Date.now()}`,
      senderName: "FORGE Private Financing", senderEmail, recipient: email,
      subject: "View your private financing account in FORGE",
      bodyText: `Hello ${fullName},\n\nYou have been invited to securely view your private financing account in FORGE. Sign in or create an account using this exact email address (${email}), confirm the email if prompted, then open:\n\n${siteUrl}/forge/private-financing/portal\n\nYour access is limited to the financing account shared with you.\n\nFORGE Private Financing`,
    });
    return NextResponse.json({ success: true, invitation: data, delivery: { sent: true, messageId: sent.messageId } });
  } catch (deliveryError) {
    console.error("Private financing invitation delivery failed", deliveryError);
    return NextResponse.json({ error: "Borrower access was created, but the invitation email could not be delivered. You can safely resend it.", invitation: data }, { status: 502 });
  }
}
