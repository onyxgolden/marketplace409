import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createPublicScreeningClient } from "@/lib/supabase/createPublicScreeningClient";
import {
  isPublicLinkRateLimited,
  normalizeApplicantScreeningInput,
  SCREENING_PUBLIC_RATE_LIMIT,
  validateApplicantScreeningInput,
} from "@/domains/rental-screening/screening";

export const runtime = "nodejs";

// Rentec parity R22 — the tenant-initiated screening link (no login).
//
// GET  /api/rental/screening-public/<token> → limited status for the page
// POST /api/rental/screening-public/<token> → applicant submits screening
//        info + consent. No report is ever pulled here — the data waits for
//        the owner's manual review.
//
// Guards: unknown tokens → 404 (indistinguishable from a bad token);
// per-token+IP rate limit (DB-backed, 15/hour) → 429; the link only works
// while the screening is requested/in_progress.

function clientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const first = forwarded.split(",")[0].trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

function ipHash(ip) {
  return createHash("sha256").update(`screening-public|${ip}`).digest("hex");
}

async function loadScreeningByToken(supabase, token) {
  const { data, error } = await supabase
    .from("rental_application_screenings")
    .select("id, owner_id, application_id, status, consent_recorded, applicant_provided")
    .eq("screening_token", token)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function recordAttempt(supabase, screening, request) {
  const { error } = await supabase.from("rental_screening_public_attempts").insert({
    owner_id: screening.owner_id,
    screening_token: screening.id,
    ip_hash: ipHash(clientIp(request)),
  });
  if (error) throw error;
}

async function checkRateLimit(supabase, screening, request) {
  const windowStart = new Date(Date.now() - SCREENING_PUBLIC_RATE_LIMIT.windowMs).toISOString();
  const { data, error } = await supabase
    .from("rental_screening_public_attempts")
    .select("attempted_at")
    .eq("owner_id", screening.owner_id)
    .eq("screening_token", screening.id)
    .eq("ip_hash", ipHash(clientIp(request)))
    .gte("attempted_at", windowStart)
    .order("attempted_at", { ascending: false })
    .limit(SCREENING_PUBLIC_RATE_LIMIT.maxAttempts);
  if (error) throw error;
  const recentAttempts = (data || []).map((row) => new Date(row.attempted_at).getTime());
  return isPublicLinkRateLimited({ recentAttempts });
}

export async function GET(request, { params }) {
  try {
    const supabase = createPublicScreeningClient();
    const token = (await params).token;
    const screening = await loadScreeningByToken(supabase, token);
    if (!screening) return NextResponse.json({ error: "This screening link is not valid." }, { status: 404 });
    if (await checkRateLimit(supabase, screening, request)) {
      return NextResponse.json({ error: "Too many attempts — try again later." }, { status: 429 });
    }
    await recordAttempt(supabase, screening, request);
    // Deliberately minimal: the page needs status + whether info is still
    // needed, never the owner's results or notes.
    return NextResponse.json({
      success: true,
      status: screening.status,
      consentRecorded: screening.consent_recorded,
      infoReceived: screening.applicant_provided && Object.keys(screening.applicant_provided).length > 0,
      acceptsSubmissions: ["requested", "in_progress"].includes(screening.status),
    });
  } catch (error) {
    console.error("Public screening link error", error);
    return NextResponse.json({ error: "Unable to load the screening link." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const supabase = createPublicScreeningClient();
    const token = (await params).token;
    const screening = await loadScreeningByToken(supabase, token);
    if (!screening) return NextResponse.json({ error: "This screening link is not valid." }, { status: 404 });
    if (await checkRateLimit(supabase, screening, request)) {
      return NextResponse.json({ error: "Too many attempts — try again later." }, { status: 429 });
    }
    await recordAttempt(supabase, screening, request);
    if (!["requested", "in_progress"].includes(screening.status)) {
      return NextResponse.json({ error: "This screening is closed — contact the property owner." }, { status: 410 });
    }

    const body = await request.json();
    const errors = validateApplicantScreeningInput(body || {});
    if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

    const applicantProvided = normalizeApplicantScreeningInput(body);
    // Atomic: the consent/info update and BOTH audit events
    // ('consent_recorded' and 'applicant_info_received') commit in one
    // transaction — consent can never be recorded without its audit trail.
    // The service-role client bypasses RLS; the 24-char random token is the
    // authorization, scoped to this screening. Token + status are
    // re-verified inside the transaction, so a direct RPC caller cannot
    // skip them.
    const { data: result, error: rpcError } = await supabase.rpc("record_applicant_screening_info", {
      p_token: token,
      p_consent_text: typeof body?.consentText === "string" ? body.consentText.slice(0, 4000) : null,
      p_applicant_provided: applicantProvided,
    });
    if (rpcError) {
      const message = String(rpcError?.message || "");
      if (/SCREENING_NOT_FOUND/i.test(message)) {
        return NextResponse.json({ error: "This screening link is not valid." }, { status: 404 });
      }
      if (/SCREENING_CLOSED/i.test(message)) {
        return NextResponse.json({ error: "This screening is closed — contact the property owner." }, { status: 410 });
      }
      throw rpcError;
    }
    return NextResponse.json({ success: true, infoReceived: result?.info_received === true });
  } catch (error) {
    console.error("Public screening submit error", error);
    return NextResponse.json({ error: "Unable to submit your screening info." }, { status: 500 });
  }
}
