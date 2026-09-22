// POST /api/auth/record-login -- records a sign-in event for login-safety
// alerting. Alert-only: this route NEVER rejects, delays, or gates the login;
// it only records and, for a first-seen location, fires a "new sign-in"
// email with one-tap approve/deny links.
//
// Security boundaries:
// - user_id comes EXCLUSIVELY from the verified session (getUser). A
//   user_id in the request body is ignored entirely.
// - IP and user-agent are captured server-side from request headers.
// - The (user_id, session_id, result) unique key + ON CONFLICT DO NOTHING
//   (record_login_event RPC) dedups repeated reports of the same event.
// - Email send is fire-and-forget: delivery failure never fails this request.

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createLoginSafetyServiceClient } from "@/lib/supabase/createLoginSafetyServiceClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { createLocationActionToken, locationActionTokenExpiry } from "@/lib/auth/loginSafetyTokens";
import { buildNewSignInAlertEmail } from "@/lib/auth/loginSafetyEmail";

export const runtime = "nodejs";

// Captured server-side, never trusted from the client -- the recorded IP is
// what the request actually arrived with, not whatever a caller could claim.
// (Same rule as the rental portal signature capture.)
function requestIpAddress(request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor ? forwardedFor.split(",")[0].trim() : "";
  return first || request.headers.get("x-real-ip") || null;
}

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://409marketplace.online").replace(/\/$/, "");
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user?.id) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  // user.id is the ONLY identity used below -- a user_id in the body is
  // deliberately ignored (it cannot be trusted).
  const userId = user.id;

  const body = await readJsonBody(request);
  const rawSessionId = body && typeof body.session_id === "string" ? body.session_id.trim() : "";
  // session_id is dedup-only, never identity; cap length for the DB column.
  const sessionId = rawSessionId && rawSessionId.length <= 128 ? rawSessionId : null;

  const ipAddress = requestIpAddress(request);
  const userAgent = request.headers.get("user-agent");
  const country = request.headers.get("x-vercel-ip-country");
  const city = request.headers.get("x-vercel-ip-city");

  // 1. Record the event, deduping repeats of the same session event.
  const recorded = await supabase.rpc("record_login_event", {
    p_session_id: sessionId,
    p_ip_address: ipAddress,
    p_user_agent: userAgent,
    p_country: country,
    p_city: city,
    p_result: "success",
  });
  if (recorded.error) {
    console.error("Login safety record failed", recorded.error);
    return NextResponse.json({ error: "Unable to record sign-in." }, { status: 500 });
  }
  const eventRow = recorded.data?.[0];
  if (!eventRow?.login_id) {
    console.error("Login safety record returned no row");
    return NextResponse.json({ error: "Unable to record sign-in." }, { status: 500 });
  }
  if (eventRow.was_duplicate) return NextResponse.json({ success: true, deduped: true });

  // 2. Refresh (or discover) the known-location baseline.
  const located = await supabase.rpc("upsert_known_login_location", { p_country: country, p_city: city });
  if (located.error) {
    console.error("Login safety location upsert failed", located.error);
    return NextResponse.json({ success: true, alerted: false });
  }
  const isNewLocation = located.data?.[0]?.is_new === true;

  // 3. Per-account preference (defaults: alert on, never restrict).
  let alertOnNewLocation = true;
  const settings = await supabase.from("user_security_settings").select("alert_on_new_location").eq("user_id", userId).maybeSingle();
  if (settings.error) {
    console.error("Login safety settings read failed", settings.error);
    return NextResponse.json({ success: true, alerted: false });
  }
  if (!settings.data) {
    const created = await supabase.from("user_security_settings").insert({ user_id: userId }).select("alert_on_new_location").single();
    if (!created.error && created.data) alertOnNewLocation = created.data.alert_on_new_location !== false;
  } else {
    alertOnNewLocation = settings.data.alert_on_new_location !== false;
  }

  if (!isNewLocation || !alertOnNewLocation) return NextResponse.json({ success: true, alerted: false });

  // 4. Mint one-time approve/deny tokens (hashes only are stored).
  const senderEmail = process.env.SECURITY_EMAIL_FROM?.trim();
  if (!senderEmail) {
    console.error("Login safety alert skipped: SECURITY_EMAIL_FROM is not configured.");
    return NextResponse.json({ success: true, alerted: false });
  }
  const service = createLoginSafetyServiceClient();
  const approve = createLocationActionToken();
  const deny = createLocationActionToken();
  const expiresAt = locationActionTokenExpiry();
  const tokens = await service.from("location_action_tokens").insert([
    { user_id: userId, token_hash: approve.tokenHash, action: "approve", login_history_id: eventRow.login_id, country, city, expires_at: expiresAt },
    { user_id: userId, token_hash: deny.tokenHash, action: "deny", login_history_id: eventRow.login_id, country, city, expires_at: expiresAt },
  ]).select("id");
  if (tokens.error || !tokens.data || tokens.data.length !== 2) {
    console.error("Login safety token minting failed", tokens.error);
    return NextResponse.json({ success: true, alerted: false });
  }

  // 5. Fire-and-forget alert email -- delivery failure never fails or delays
  // this response; the login already succeeded.
  const origin = siteUrl();
  const message = buildNewSignInAlertEmail({
    id: `login-safety-alert-${eventRow.login_id}`,
    senderName: "409 Marketplace Security",
    senderEmail,
    recipient: user.email,
    country,
    city,
    occurredAt: new Date(),
    userAgent,
    approveUrl: `${origin}/auth/verify-location?token=${approve.token}&action=approve`,
    denyUrl: `${origin}/auth/verify-location?token=${deny.token}&action=deny`,
    resetUrl: `${origin}/auth/reset-password`,
  });
  try {
    createResendRentalEmailProvider().send(message).catch((error) => {
      console.error("Login safety alert email failed", error);
    });
  } catch (error) {
    // Synchronous provider setup failure (e.g. missing RESEND_API_KEY) --
    // still never fails the login record.
    console.error("Login safety alert email failed", error);
  }

  return NextResponse.json({ success: true, alerted: true });
}
