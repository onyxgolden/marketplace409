import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function normalizedDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^@/, "");
}

export function emailDeliveryReadiness(env = process.env) {
  const verifiedDomain = normalizedDomain(env.RENTAL_EMAIL_VERIFIED_DOMAIN);
  return Object.freeze({
    resendConfigured: Boolean(env.RESEND_API_KEY?.trim()),
    workerConfigured: Boolean(env.RENTAL_NOTIFICATION_DELIVERY_SECRET?.trim()),
    domainConfigured: Boolean(verifiedDomain),
    verifiedDomain: verifiedDomain || null,
  });
}

function emailDomain(email) {
  return String(email).trim().toLowerCase().split("@")[1] || "";
}

async function authenticatedContext() {
  return createAuthenticatedRentalManagerApplication();
}

export async function GET() {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const { data, error } = await authenticated.supabaseClient.from("rental_email_settings")
      .select("provider,sender_name,sender_email,verified_domain,status,transactional_enabled,reminders_enabled,updated_at")
      .eq("owner_id", authenticated.user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ success: true, settings: data, readiness: emailDeliveryReadiness() });
  } catch (error) {
    console.error("Rental email settings query error", error);
    return NextResponse.json({ error: "Unable to load rental email settings." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await authenticatedContext();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    const senderName = String(body.senderName || "").trim();
    const senderEmail = String(body.senderEmail || "").trim().toLowerCase();
    const status = String(body.status || "draft");
    if (!senderName || !EMAIL_PATTERN.test(senderEmail))
      return NextResponse.json({ error: "A sender name and valid sender email are required." }, { status: 400 });
    if (!['draft', 'active', 'paused'].includes(status))
      return NextResponse.json({ error: "A supported delivery status is required." }, { status: 400 });
    const readiness = emailDeliveryReadiness();
    if (status === "active") {
      if (!readiness.resendConfigured || !readiness.workerConfigured || !readiness.domainConfigured)
        return NextResponse.json({ error: "Email delivery cannot be activated until Resend, the worker secret, and the verified domain are configured." }, { status: 409 });
      if (emailDomain(senderEmail) !== readiness.verifiedDomain)
        return NextResponse.json({ error: `Sender email must use the verified ${readiness.verifiedDomain} domain.` }, { status: 409 });
    }
    const record = { owner_id: authenticated.user.id, provider: "resend", sender_name: senderName,
      sender_email: senderEmail, verified_domain: readiness.verifiedDomain, status,
      transactional_enabled: Boolean(body.transactionalEnabled), reminders_enabled: Boolean(body.remindersEnabled),
      updated_at: new Date().toISOString() };
    const { data, error } = await authenticated.supabaseClient.from("rental_email_settings")
      .upsert(record, { onConflict: "owner_id" }).select("provider,sender_name,sender_email,verified_domain,status,transactional_enabled,reminders_enabled,updated_at").single();
    if (error) throw error;
    return NextResponse.json({ success: true, settings: data, readiness });
  } catch (error) {
    console.error("Rental email settings save error", error);
    return NextResponse.json({ error: "Unable to save rental email settings." }, { status: 500 });
  }
}
