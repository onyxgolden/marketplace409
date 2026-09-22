// GET /api/auth/verify-location?token=...&action=approve|deny -- consumes a
// one-time token from a new-sign-in alert email and records the owner's
// approve/deny decision for that location.
//
// Security boundaries:
// - Only the SHA-256 hash of the token is looked up; the raw token never
//   touches storage. Responses are generic ("updated" / "invalid or
//   expired") so the endpoint is not an enumeration oracle.
// - The token is consumed (used_at set) BEFORE the action is applied, so a
//   replayed link cannot act twice. The consume is conditional on
//   used_at IS NULL, so two concurrent requests consume exactly once.

import { createLoginSafetyServiceClient } from "@/lib/supabase/createLoginSafetyServiceClient";
import { hashLocationActionToken, tokenHashEquals } from "@/lib/auth/loginSafetyTokens";

export const runtime = "nodejs";

function htmlPage(title, heading, paragraphs) {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1.5rem;color:#111;">` +
    `<h1>${heading}</h1>\n${body}</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  );
}

function invalidPage() {
  return htmlPage(
    "Link invalid or expired",
    "This link is invalid or expired.",
    [
      "Security links work only once and expire after 24 hours.",
      "If you need to review a recent sign-in, sign in to your 409 Marketplace account and contact support.",
    ]
  );
}

function approvedPage() {
  return htmlPage(
    "Location approved",
    "Your security preference has been updated.",
    [
      "That sign-in location is now recognized. We won't ask about it again.",
      "If you didn't make that choice, change your password right away and contact support.",
    ]
  );
}

function deniedPage(resetUrl) {
  return htmlPage(
    "Sign-in flagged",
    "Your security preference has been updated.",
    [
      "That sign-in location has been flagged. If this wasn't you, change your password right away: " +
      `<a href="${resetUrl}">reset your password</a>.`,
      "Then review your account for anything you don't recognize and contact support if you need help.",
    ]
  );
}

// approve -> location recognized; deny -> location flagged AND the exact
// sign-in event flagged suspicious. Both are simple status transitions on the
// known_login_locations baseline; nothing is blocked or revoked in this
// slice.
function statusForAction(action) {
  return action === "approve" ? "approved" : "denied";
}

export async function GET(request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const action = url.searchParams.get("action");

  if (!/^[0-9a-fA-F]{64}$/.test(token) || (action !== "approve" && action !== "deny")) {
    return invalidPage();
  }

  const service = createLoginSafetyServiceClient();
  const tokenHash = hashLocationActionToken(token);
  const lookup = await service.from("location_action_tokens").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (lookup.error || !lookup.data) return invalidPage();
  const row = lookup.data;

  // Defense-in-depth on top of the indexed hash lookup.
  if (!tokenHashEquals(tokenHash, row.token_hash)) return invalidPage();
  if (row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return invalidPage();

  // The token is bound to its action at mint time: an approve token can never
  // be replayed with action=deny (or vice versa). Reject BEFORE consuming so
  // the mismatched link burns nothing -- the owner can still use the correct
  // link from the same email.
  if (row.action !== action) return invalidPage();

  // Consume BEFORE applying the action (replay protection). Conditional on
  // used_at IS NULL so exactly one of two concurrent requests wins.
  const consumed = await service
    .from("location_action_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("used_at", null)
    .select("id");
  if (consumed.error || !consumed.data || consumed.data.length !== 1) return invalidPage();

  const status = statusForAction(action);
  // Update-first (NULL-safe: IS NULL for unknown geo), insert only if the
  // baseline row is somehow missing. A plain upsert(onConflict) would never
  // match an existing NULL country/city row under Postgres null semantics
  // and would duplicate the "unknown location" baseline instead.
  const statusPatch = {
    status,
    last_seen_at: new Date().toISOString(),
    ...(status === "approved" ? { approved_at: new Date().toISOString() } : {}),
  };
  let locationQuery = service.from("known_login_locations").update(statusPatch).eq("user_id", row.user_id);
  locationQuery = row.country == null ? locationQuery.is("country", null) : locationQuery.eq("country", row.country);
  locationQuery = row.city == null ? locationQuery.is("city", null) : locationQuery.eq("city", row.city);
  const updated = await locationQuery.select("id");
  if (updated.error) {
    console.error("Login safety location status update failed", updated.error);
    return invalidPage();
  }
  if (!updated.data || updated.data.length === 0) {
    const inserted = await service.from("known_login_locations").insert({
      user_id: row.user_id,
      country: row.country,
      city: row.city,
      ...statusPatch,
    });
    if (inserted.error) {
      console.error("Login safety location status insert failed", inserted.error);
      return invalidPage();
    }
  }

  if (action === "approve") return approvedPage();

  // "Wasn't me": flag the EXACT sign-in event that triggered the alert, not
  // just the location. The token row carries the login_history id from the
  // original event. A flag-update failure is logged but never blocks the
  // response -- alert-only, same as the email send path.
  if (row.login_history_id) {
    const flagged = await service
      .from("login_history")
      .update({ flagged_suspicious: true })
      .eq("id", row.login_history_id);
    if (flagged.error) {
      console.error("Login safety event flag failed", flagged.error);
    }
  }

  const origin = (process.env.NEXT_PUBLIC_SITE_URL || "https://409marketplace.online").replace(/\/$/, "");
  return deniedPage(`${origin}/auth/reset-password`);
}
