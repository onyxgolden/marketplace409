import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { projectBorrowerPayoff, UnsupportedBorrowerProjectionError } from "@/domains/private-financing/borrowerPayoffProjection";
import { computeDueState, UnsupportedDueStateError } from "@/domains/private-financing/dueState";
import { mapEventRowsForReplay } from "@/domains/private-financing/persistedRowMapping";
import { replayEvents } from "@/domains/private-financing/replayEvents";
import { resolveAccountTermsAsOf } from "@/domains/private-financing/financingTermsContracts";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

export function summarizeBorrowerEvents(events) {
  const payments = events.filter((event) => event.event_type === "payment_posted");
  let interestBearing = 0;
  let zeroInterest = 0;
  for (const event of events) {
    if (event.principal_remaining_interest_bearing_cents != null) interestBearing = Number(event.principal_remaining_interest_bearing_cents);
    if (event.principal_remaining_zero_interest_cents != null) zeroInterest = Number(event.principal_remaining_zero_interest_cents);
    if (event.corrected_component_principal_remaining_cents_after != null) {
      if (event.component_type === "interest_bearing") interestBearing = Number(event.corrected_component_principal_remaining_cents_after);
      if (event.component_type === "zero_interest") zeroInterest = Number(event.corrected_component_principal_remaining_cents_after);
    }
    if (event.corrected_component_principal_remaining_cents_after == null) {
      if (event.interest_bearing_delta_cents != null) interestBearing += Number(event.interest_bearing_delta_cents);
      if (event.zero_interest_delta_cents != null) zeroInterest += Number(event.zero_interest_delta_cents);
    }
  }
  return {
    paymentCount: payments.length,
    totalPaidCents: payments.reduce((sum, event) => sum + Number(event.amount_cents || 0), 0),
    interestPaidCents: payments.reduce((sum, event) => sum + Number(event.interest_paid_cents || 0), 0),
    principalRemainingCents: interestBearing + zeroInterest,
  };
}

export function buildBorrowerProjectionModel({ eventRows, componentRows, termsRows, asOfDate = todayISODate() }) {
  // The borrower-safe ledger RPC intentionally omits owner_id and created_by. Those fields are required
  // for structural contract validation but never participate in balance math, so hydrate them only inside
  // this server-side replay boundary from the already-authorized component owner. They are never returned.
  const replayOwnerId = componentRows[0]?.owner_id || termsRows[0]?.owner_id || "borrower-visible-owner";
  const replayEventRows = eventRows.map((event) => ({
    ...event,
    owner_id: replayOwnerId,
    created_by: event.event_origin === "interactive_user" || event.event_origin === "manual_external" ? replayOwnerId : null,
    // The safe RPC exposes the external source reference but not the internal idempotency key. Replay
    // validates provenance shape before doing math; use that already-authorized reference as a private,
    // in-memory validation placeholder. Neither value participates in allocation or leaves this route.
    idempotency_key: ["manual_import", "system_import", "manual_external"].includes(event.event_origin)
      ? event.source_reference || `${event.event_type}:${event.id}`
      : null,
  }));
  const mapped = mapEventRowsForReplay(replayEventRows, componentRows, termsRows);
  const snapshot = replayEvents({ ...mapped, asOfDate });
  const accountTerms = resolveAccountTermsAsOf(mapped.accountTermsVersions, asOfDate);
  const payments = eventRows.filter((event) => event.event_type === "payment_posted");
  const summary = {
    asOfDate,
    paymentCount: payments.length,
    totalPaidCents: payments.reduce((sum, event) => sum + Number(event.amount_cents || 0), 0),
    interestPaidCents: snapshot.cumulativeInterestPaidCents,
    cashPrincipalPaidCents: snapshot.cumulativeCashPrincipalPaidCents,
    principalCreditsCents: snapshot.cumulativePrincipalForgivenCents,
    principalRemainingCents: snapshot.totalPrincipalRemainingCents,
    accruedUnpaidInterestCents: snapshot.unpaidAccruedInterestCents,
  };

  try {
    const dueState = computeDueState({ snapshot, accountTerms, asOfDate });
    const projectionSeed = {
      snapshot: {
        asOfDate: snapshot.asOfDate,
        remainingPrincipalByComponentCents: snapshot.remainingPrincipalByComponentCents,
        unpaidAccruedInterestFractionalByComponentCents: snapshot.unpaidAccruedInterestFractionalByComponentCents,
        components: snapshot.components,
      },
      accountTerms: {
        paymentFrequency: accountTerms.paymentFrequency,
        allocationPolicy: accountTerms.allocationPolicy,
        extraPaymentAllocationPolicy: accountTerms.extraPaymentAllocationPolicy,
      },
      firstProjectedPaymentDate: dueState.nextDueDate,
    };
    const baseline = projectBorrowerPayoff({
      ...projectionSeed,
      paymentAmountCents: accountTerms.regularScheduledPaymentAmountCents,
    });
    return { summary, regularScheduledPaymentCents: accountTerms.regularScheduledPaymentAmountCents, projection: { seed: projectionSeed, baseline } };
  } catch (error) {
    if (error instanceof UnsupportedDueStateError || error instanceof UnsupportedBorrowerProjectionError) {
      return { summary, regularScheduledPaymentCents: accountTerms.regularScheduledPaymentAmountCents, projection: null };
    }
    throw error;
  }
}

export function buildBorrowerPortalModelSafely({ eventRows, componentRows, termsRows, asOfDate = todayISODate() }) {
  try {
    return { ...buildBorrowerProjectionModel({ eventRows, componentRows, termsRows, asOfDate }), progressAvailable: true };
  } catch (error) {
    console.error("Private financing borrower projection unavailable", {
      code: error?.code || error?.name || "unknown",
    });
    const summary = summarizeBorrowerEvents(eventRows);
    const currentTerms = [...termsRows]
      .filter((terms) => !terms.effective_date || terms.effective_date <= asOfDate)
      .sort((left, right) => Number(right.version_number || 0) - Number(left.version_number || 0))[0];
    return {
      summary: { ...summary, asOfDate },
      regularScheduledPaymentCents: Number(currentTerms?.regular_scheduled_payment_amount_cents || 0),
      projection: null,
      progressAvailable: false,
    };
  }
}

export async function GET() {
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user?.id) {
    return NextResponse.json({ error: "Sign in to view your financing account.", signInUrl: "/auth?next=/forge/private-financing/portal" }, { status: 401 });
  }
  const claim = await db.rpc("claim_private_financing_borrower_portal");
  const memberships = await db.from("private_financing_account_borrowers").select("account_id,role,status").eq("status", "active");
  if (memberships.error) return NextResponse.json({ error: "Unable to load borrower access." }, { status: 500 });
  if (claim.error && !(memberships.data || []).length) {
    console.error("Private financing borrower claim failed", { code: claim.error.code || "unknown" });
    return NextResponse.json({ error: "Unable to match this signed-in account to a borrower invitation.", signedInEmail: user.email || null, claimErrorCode: claim.error.code || "unknown", signInUrl: "/auth?next=/forge/private-financing/portal" }, { status: 400 });
  }

  const accounts = [];
  for (const membership of memberships.data || []) {
    const [accountResult, eventResult, componentResult, termsResult, settingsResult] = await Promise.all([
      db.from("private_financing_accounts").select("id,product,status,opened_date,origination_principal_cents").eq("id", membership.account_id).maybeSingle(),
      db.rpc("read_private_financing_borrower_events", { p_account_id: membership.account_id }),
      db.from("private_financing_components").select("*").eq("account_id", membership.account_id),
      db.from("private_financing_account_terms_versions").select("*").eq("account_id", membership.account_id),
      db.from("private_financing_online_payment_settings").select("enabled").eq("account_id", membership.account_id).maybeSingle(),
    ]);
    if (!accountResult.data || eventResult.error || componentResult.error || termsResult.error) continue;
    const model = buildBorrowerPortalModelSafely({
      eventRows: eventResult.data || [],
      componentRows: componentResult.data || [],
      termsRows: termsResult.data || [],
    });
    accounts.push({
      account: accountResult.data,
      role: membership.role,
      summary: model.summary,
      events: eventResult.data || [],
      regularScheduledPaymentCents: model.regularScheduledPaymentCents,
      projection: model.projection,
      progressAvailable: model.progressAvailable,
      onlinePaymentsEnabled: settingsResult.data?.enabled === true,
    });
  }
  return NextResponse.json({ success: true, email: user.email, accounts, claim: claim.data || null });
}
