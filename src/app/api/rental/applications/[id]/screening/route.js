import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import {
  canTransitionScreening,
  generateScreeningToken,
  listProviderStatus,
  requestScreeningReport,
  screeningConsentIsRecorded,
  screeningHasResults,
  suggestRecommendation,
  validateManualResults,
  validateRecommendation,
} from "@/domains/rental-screening/screening";

export const runtime = "nodejs";

// Rentec parity R22 — screening workflow on an R21 application (free layer).
//
// POST   → request screening (fail-closed: 409 without recorded applicant
//          consent; 403 for non owner/co-owner members)
// GET    → screening state + audit events + provider catalog (always gated)
// PATCH  → { action } one of:
//          mark_in_progress | record_results | set_recommendation |
//          complete | regenerate_token | request_provider_report (stub:
//          always 501 "not_connected", audited as provider_attempt_blocked)
//
// Every state transition + its audit event append happens inside ONE
// database transaction via the R22 RPCs (request_screening /
// transition_screening in
// supabase/migrations/20261001143000_rental_screening_atomic_transitions.sql):
// a screening mutation can never commit without its audit event. The route
// keeps its prechecks for fast, specific 400/409 UX; the RPC is the
// enforcement boundary.
//
// The actual approve/deny still goes through R21's
// POST /api/rental/applications/[id]/decision — this slice never decides.

const SCREENING_COLUMNS = "id, application_id, status, screening_token, consent_verified_on_application, consent_recorded, consent_recorded_at, requested_by, requested_at, provider_status, provider_key, credit_score, credit_band, criminal_flag, criminal_notes, eviction_flag, eviction_notes, applicant_provided, recommendation, recommendation_reasons, results_recorded_by, results_recorded_at, completed_by, completed_at, created_at, updated_at";

// R22: screening writes are owner/co-owner only (the Rentec parity contract).
// Staff — manager, bookkeeper, read_only — may not request screening or
// mutate a screening. isOwnerOrActiveCoOwner answers exactly this: the
// primary owner (no membership row) or an active co_owner is the owning
// household, never staff.
async function ownerOnlyWriteBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}

// The RPCs raise SCREENING_CONFLICT / SCREENING_INVALID with a human message
// after the prefix; anything else is a genuine failure (500). The route's
// own prechecks produce the specific 400/409 UX first — this mapping is the
// backstop for races and direct RPC callers.
function mapRpcError(rpcError) {
  const message = String(rpcError?.message || "");
  const human = message.replace(/^[^:]+:\s*/, "");
  if (/SCREENING_CONFLICT/i.test(message)) {
    return NextResponse.json({ error: human }, { status: 409 });
  }
  if (/SCREENING_INVALID/i.test(message)) {
    return NextResponse.json({ error: human }, { status: 400 });
  }
  return null;
}

function baseUrl(request) {
  const forwarded = request.headers.get("x-forwarded-host");
  const host = forwarded || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

export function applicantScreeningLink(request, token) {
  const base = baseUrl(request);
  return base ? `${base}/rentals/screening/${token}` : `/rentals/screening/${token}`;
}

function mapScreening(row) {
  if (!row) return null;
  return {
    id: row.id,
    applicationId: row.application_id,
    status: row.status,
    consentVerifiedOnApplication: row.consent_verified_on_application,
    consentRecorded: row.consent_recorded,
    consentRecordedAt: row.consent_recorded_at,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    providerStatus: row.provider_status,
    providerKey: row.provider_key,
    creditScore: row.credit_score,
    creditBand: row.credit_band,
    criminalFlag: row.criminal_flag,
    criminalNotes: row.criminal_notes,
    evictionFlag: row.eviction_flag,
    evictionNotes: row.eviction_notes,
    applicantProvided: row.applicant_provided || {},
    recommendation: row.recommendation,
    recommendationReasons: row.recommendation_reasons,
    resultsRecordedBy: row.results_recorded_by,
    resultsRecordedAt: row.results_recorded_at,
    completedBy: row.completed_by,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    // The token itself is only handed out where it is needed (request /
    // regenerate responses and the GET payload for the owner). It is never
    // part of a public response.
    token: row.screening_token,
  };
}

async function loadApplication(authenticated, applicationId) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_applications")
    .select("id, listing_id, status, answers")
    .eq("owner_id", authenticated.effectiveOwnerId).eq("id", applicationId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function loadScreening(authenticated, applicationId) {
  const { data, error } = await authenticated.supabaseClient
    .from("rental_application_screenings").select(SCREENING_COLUMNS)
    .eq("owner_id", authenticated.effectiveOwnerId).eq("application_id", applicationId)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function GET(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const applicationId = (await params).id;
    const application = await loadApplication(authenticated, applicationId);
    if (!application) return NextResponse.json({ error: "Application was not found." }, { status: 404 });

    const screening = await loadScreening(authenticated, applicationId);
    let events = [];
    if (screening) {
      const { data, error } = await authenticated.supabaseClient
        .from("rental_screening_events")
        .select("id, event, actor_user_id, note, created_at")
        .eq("owner_id", authenticated.effectiveOwnerId).eq("screening_id", screening.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      events = data || [];
    }
    return NextResponse.json({
      success: true,
      screening: mapScreening(screening),
      events,
      providers: listProviderStatus(),
      suggestion: screening ? suggestRecommendation({
        criminalFlag: screening.criminal_flag,
        evictionFlag: screening.eviction_flag,
        creditScore: screening.credit_score,
        creditBand: screening.credit_band,
      }) : null,
    });
  } catch (error) {
    console.error("Screening load error", error);
    return NextResponse.json({ error: "Unable to load screening." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await ownerOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Only the owner or co-owner can request screening." }, { status: 403 });
    }
    const applicationId = (await params).id;
    const application = await loadApplication(authenticated, applicationId);
    if (!application) return NextResponse.json({ error: "Application was not found." }, { status: 404 });
    if (application.status !== "pending") {
      return NextResponse.json({ error: "Screening can only be requested on a pending application." }, { status: 409 });
    }
    const existing = await loadScreening(authenticated, applicationId);
    if (existing && ["requested", "in_progress"].includes(existing.status)) {
      return NextResponse.json({ error: "A screening is already open on this application." }, { status: 409 });
    }
    // Fail closed: no screening without recorded applicant consent.
    const consentOnApplication = application.answers?.consent === true;
    const consentRecorded = consentOnApplication || screeningConsentIsRecorded(application, existing);
    if (!consentRecorded) {
      return NextResponse.json({
        error: "Applicant screening consent is not recorded on this application. Collect consent first — for example, send the applicant the tenant-initiated screening link — before requesting screening.",
      }, { status: 409 });
    }

    const token = generateScreeningToken();
    // Atomic: the screening insert and the 'requested' audit event commit in
    // one transaction — a screening can never exist without its event.
    const { data: screeningRow, error: rpcError } = await authenticated.supabaseClient.rpc("request_screening", {
      p_owner_id: authenticated.effectiveOwnerId,
      p_application_id: applicationId,
      p_token: token,
      p_consent_verified_on_application: consentOnApplication,
      p_consent_recorded: consentRecorded,
      p_requested_by: authenticated.user.id,
    });
    if (rpcError) {
      const mapped = mapRpcError(rpcError);
      if (mapped) return mapped;
      throw rpcError;
    }
    if (!screeningRow?.id) throw new Error("request_screening returned no screening row.");
    return NextResponse.json({
      success: true,
      screening: mapScreening(screeningRow),
      applicantLink: applicantScreeningLink(request, token),
    }, { status: 201 });
  } catch (error) {
    console.error("Screening request error", error);
    return NextResponse.json({ error: "Unable to request screening." }, { status: 500 });
  }
}

function badRequest(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Every transition funnels through transition_screening: the state mutation
// and its audit event are one database transaction. The prechecks in PATCH
// exist for fast, specific 400/409 UX; the RPC is the enforcement boundary.
async function applyTransition(authenticated, screeningId, action, payload) {
  const { data: screeningRow, error: rpcError } = await authenticated.supabaseClient.rpc("transition_screening", {
    p_owner_id: authenticated.effectiveOwnerId,
    p_screening_id: screeningId,
    p_action: action,
    p_actor_user_id: authenticated.user.id,
    p_payload: payload,
  });
  if (rpcError) {
    const mapped = mapRpcError(rpcError);
    if (mapped) return { mapped };
    throw rpcError;
  }
  if (!screeningRow?.id) throw new Error("transition_screening returned no screening row.");
  return { screeningRow };
}

export async function PATCH(request, { params }) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await ownerOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Only the owner or co-owner can update screening." }, { status: 403 });
    }
    const applicationId = (await params).id;
    const application = await loadApplication(authenticated, applicationId);
    if (!application) return NextResponse.json({ error: "Application was not found." }, { status: 404 });
    const body = await request.json();
    const action = body?.action;

    // request_provider_report is the audited provider stub: it never pulls.
    // The blocked attempt is recorded atomically via the RPC, then the stub
    // result is returned as the 501 (unchanged behavior).
    if (action === "request_provider_report") {
      const screening = await loadScreening(authenticated, applicationId);
      if (screening) {
        const { mapped, screeningRow } = await applyTransition(authenticated, screening.id, "provider_attempt_blocked", {
          provider_key: body?.providerKey || null,
        });
        if (mapped) return mapped;
        void screeningRow;
      }
      const result = requestScreeningReport({ providerKey: body?.providerKey });
      return NextResponse.json({ success: false, ...result }, { status: 501 });
    }

    const screening = await loadScreening(authenticated, applicationId);
    if (!screening) return badRequest("No screening has been requested on this application.", 404);

    let payload = {};
    if (action === "mark_in_progress") {
      if (!canTransitionScreening(screening.status, "in_progress")) {
        return badRequest(`Cannot mark in-progress from status "${screening.status}".`, 409);
      }
    } else if (action === "record_results") {
      if (!["requested", "in_progress"].includes(screening.status)) {
        return badRequest(`Results cannot be recorded on a "${screening.status}" screening.`, 409);
      }
      const errors = validateManualResults(body?.results || {});
      if (errors.length) return badRequest(errors.join(" "));
      const results = body.results;
      payload = {
        credit_score: results.creditScore ?? null,
        credit_band: results.creditBand ?? null,
        criminal_flag: results.criminalFlag === true,
        criminal_notes: typeof results.criminalNotes === "string" && results.criminalNotes.trim() ? results.criminalNotes.trim() : null,
        eviction_flag: results.evictionFlag === true,
        eviction_notes: typeof results.evictionNotes === "string" && results.evictionNotes.trim() ? results.evictionNotes.trim() : null,
      };
    } else if (action === "set_recommendation") {
      const errors = validateRecommendation(body?.recommendationInput || body || {});
      if (errors.length) return badRequest(errors.join(" "));
      const input = body.recommendationInput || body;
      payload = {
        recommendation: input.recommendation,
        reasons: typeof input.reasons === "string" && input.reasons.trim() ? input.reasons.trim() : null,
      };
    } else if (action === "complete") {
      if (!canTransitionScreening(screening.status, "complete")) {
        return badRequest(`Cannot complete a "${screening.status}" screening.`, 409);
      }
      if (!screeningHasResults(screening)) {
        return badRequest("Record manual results before completing the screening.", 409);
      }
    } else if (action === "regenerate_token") {
      const token = generateScreeningToken();
      const { mapped, screeningRow } = await applyTransition(authenticated, screening.id, action, { token });
      if (mapped) return mapped;
      return NextResponse.json({
        success: true, screening: mapScreening(screeningRow),
        applicantLink: applicantScreeningLink(request, token),
      });
    } else {
      return badRequest("Unknown screening action.");
    }

    const { mapped, screeningRow } = await applyTransition(authenticated, screening.id, action, payload);
    if (mapped) return mapped;
    return NextResponse.json({ success: true, screening: mapScreening(screeningRow) });
  } catch (error) {
    console.error("Screening update error", error);
    return NextResponse.json({ error: "Unable to update screening." }, { status: 500 });
  }
}
