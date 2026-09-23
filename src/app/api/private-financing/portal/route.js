import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createStripeBillingProvider } from "@/infrastructure/billing/StripeBillingProvider";
import { validatePublishableKeyMode } from "@/infrastructure/billing/stripeMode";
import { projectBorrowerPayoff, UnsupportedBorrowerProjectionError } from "@/domains/private-financing/borrowerPayoffProjection";
import { computeDueState, UnsupportedDueStateError } from "@/domains/private-financing/dueState";
import { mapEventRowsForReplay } from "@/domains/private-financing/persistedRowMapping";
import { replayEvents } from "@/domains/private-financing/replayEvents";
import { resolveAccountTermsAsOf } from "@/domains/private-financing/financingTermsContracts";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Thrown by summarizeBorrowerEvents when the event data isn't safe to summarize without full
// replay -- callers must fail closed (surface "unavailable"), never treat a caught instance of
// this as "the balance is zero."
export class BorrowerSummaryUnavailableError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "BorrowerSummaryUnavailableError";
  }
}

function sumCentsMap(map, fieldName) {
  if (map == null) return 0;
  if (typeof map !== "object" || Array.isArray(map)) {
    throw new BorrowerSummaryUnavailableError(`${fieldName} is not a valid component-keyed cents map.`);
  }
  let sum = 0;
  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new BorrowerSummaryUnavailableError(`${fieldName}.${key} is not a valid integer cents amount.`);
    }
    sum += value;
  }
  return sum;
}

// A best-effort, replay-free summary used ONLY when buildBorrowerProjectionModel's authoritative
// full replay (replayEvents.js) itself failed to run -- e.g. malformed/incomplete component or
// event data reached this route. It is deliberately NOT a second implementation of the financial
// rules in replayEvents.js/paymentAllocation.js; it only re-reads the per-event snapshots the same
// write-path allocation logic already persisted (principal_remaining_by_component_cents on
// payment_posted/payment_reversal/payoff_concession, corrected_component_principal_remaining_cents_after
// on principal_correction), replacing per-component state on whichever event most recently wrote it,
// in ledger order. Any event type this walk does not know how to interpret safely this way --
// compensating_correction chief among them, since it only carries a delta relative to state this
// walk cannot reconstruct without replay -- throws BorrowerSummaryUnavailableError rather than
// silently omitting it and returning a wrong number.
export function summarizeBorrowerEvents(events) {
  const sorted = [...events].sort((a, b) => Number(a.ledger_sequence ?? 0) - Number(b.ledger_sequence ?? 0));

  const remainingByComponent = {};
  let sawSnapshot = false;

  for (const event of sorted) {
    if (event.event_type === "account_opened" || event.event_type === "interest_correction" || event.event_type === "account_closed") {
      continue; // none of these carry or change a principal-remaining snapshot
    }
    if (event.event_type === "payment_posted" || event.event_type === "payment_reversal" || event.event_type === "payoff_concession") {
      const map = event.principal_remaining_by_component_cents;
      if (map == null || typeof map !== "object" || Array.isArray(map)) {
        throw new BorrowerSummaryUnavailableError(
          `${event.event_type} "${event.id}" is missing a valid principal_remaining_by_component_cents snapshot.`,
        );
      }
      for (const [componentKey, value] of Object.entries(map)) {
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new BorrowerSummaryUnavailableError(`${event.event_type} "${event.id}"'s remaining balance for component "${componentKey}" is not a valid integer.`);
        }
        remainingByComponent[componentKey] = value;
      }
      sawSnapshot = true;
      continue;
    }
    if (event.event_type === "principal_correction") {
      const componentId = event.component_id;
      const after = event.corrected_component_principal_remaining_cents_after;
      if (!componentId || typeof after !== "number" || !Number.isInteger(after)) {
        throw new BorrowerSummaryUnavailableError(`principal_correction "${event.id}" is missing a valid corrected remaining-principal value.`);
      }
      remainingByComponent[componentId] = after;
      sawSnapshot = true;
      continue;
    }
    // compensating_correction and any other/future event type: this defensive walk cannot safely
    // interpret it without reimplementing replay math -- fail closed.
    throw new BorrowerSummaryUnavailableError(
      `Cannot safely summarize this account's balance without full replay: event "${event.id}" is a "${event.event_type}", which this fallback does not support.`,
    );
  }

  if (!sawSnapshot) {
    throw new BorrowerSummaryUnavailableError("No event carries a principal-remaining snapshot; cannot safely summarize this account's balance.");
  }

  const principalRemainingCents = Object.values(remainingByComponent).reduce((sum, value) => sum + value, 0);

  const payments = sorted.filter((event) => event.event_type === "payment_posted");
  const reversals = sorted.filter((event) => event.event_type === "payment_reversal");
  const interestPaidCents =
    payments.reduce((sum, event) => sum + sumCentsMap(event.interest_paid_by_component_cents, `payment_posted "${event.id}".interest_paid_by_component_cents`), 0) -
    reversals.reduce((sum, event) => sum + sumCentsMap(event.interest_paid_by_component_cents, `payment_reversal "${event.id}".interest_paid_by_component_cents`), 0);

  return {
    paymentCount: payments.length,
    totalPaidCents: payments.reduce((sum, event) => sum + Number(event.amount_cents || 0), 0),
    interestPaidCents,
    principalRemainingCents,
  };
}

export function borrowerIdentityIds(rows) {
  return [...new Set((rows || []).map((row) => row.id).filter(Boolean))];
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
    return { ...buildBorrowerProjectionModel({ eventRows, componentRows, termsRows, asOfDate }), progressAvailable: true, summaryAvailable: true };
  } catch (error) {
    console.error("Private financing borrower projection unavailable", {
      code: error?.code || error?.name || "unknown",
    });
    const currentTerms = [...termsRows]
      .filter((terms) => !terms.effective_date || terms.effective_date <= asOfDate)
      .sort((left, right) => Number(right.version_number || 0) - Number(left.version_number || 0))[0];
    const regularScheduledPaymentCents = Number(currentTerms?.regular_scheduled_payment_amount_cents || 0);
    try {
      const summary = summarizeBorrowerEvents(eventRows);
      return {
        summary: { ...summary, asOfDate },
        regularScheduledPaymentCents,
        projection: null,
        progressAvailable: false,
        summaryAvailable: true,
      };
    } catch (summaryError) {
      // Neither full replay nor the defensive snapshot walk could produce a trustworthy number --
      // fail closed. The caller must not display $0.00 (or any figure) as this account's balance.
      console.error("Private financing borrower summary unavailable", {
        code: summaryError?.name || "unknown",
      });
      return {
        summary: null,
        regularScheduledPaymentCents,
        projection: null,
        progressAvailable: false,
        summaryAvailable: false,
        summaryUnavailableReason: summaryError.message,
      };
    }
  }
}

// Builds "/auth?next=/forge/private-financing/portal[&email=...]" -- the invited email (read from
// this request's own ?email= query param, set by the invitation link) rides along so the sign-in
// page can pre-fill and lock it, and so a mismatch can be explained by comparing it against
// whichever email the borrower actually authenticates with.
function signInUrl(invitedEmail) {
  const params = new URLSearchParams({ next: "/forge/private-financing/portal" });
  if (invitedEmail) params.set("email", invitedEmail);
  return `/auth?${params.toString()}`;
}

export async function GET(request) {
  const invitedEmail = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() || null;
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user?.id) {
    return NextResponse.json({ error: "Sign in to view your financing account.", signInUrl: signInUrl(invitedEmail), invitedEmail }, { status: 401 });
  }
  const claim = await db.rpc("claim_private_financing_borrower_portal");
  const identities = await db.from("private_financing_borrowers").select("id").eq("auth_user_id", user.id);
  const identityIds = borrowerIdentityIds(identities.data);
  const memberships = identities.error
    ? { data: null, error: identities.error }
    : identityIds.length
      ? await db.from("private_financing_account_borrowers").select("account_id,role,status,owner_id,borrower_id").eq("status", "active").in("borrower_id", identityIds)
      : { data: [], error: null };
  if (memberships.error) return NextResponse.json({ error: "Unable to load borrower access." }, { status: 500 });
  if (claim.error && !(memberships.data || []).length) {
    console.error("Private financing borrower claim failed", { code: claim.error.code || "unknown" });
    return NextResponse.json({ error: "Unable to match this signed-in account to a borrower invitation.", signedInEmail: user.email || null, invitedEmail, claimErrorCode: claim.error.code || "unknown", signInUrl: signInUrl(invitedEmail) }, { status: 400 });
  }
  // Authenticated, claim ran clean, but nothing matched -- almost always because the signed-in
  // email differs from the one this invitation was sent to (the claim RPC only links a borrower
  // identity to auth.uid() when they match). Surface both emails on the success payload so the
  // frontend can explain exactly what to fix, instead of a bare "no accounts".
  const mismatched = Boolean(!(memberships.data || []).length && invitedEmail && user.email && invitedEmail !== user.email.toLowerCase());

  const accounts = [];
  for (const membership of memberships.data || []) {
    const [accountResult, eventResult, componentResult, termsResult, settingsResult, pendingPaymentResult, autopayResult] = await Promise.all([
      db.from("private_financing_accounts").select("id,product,status,opened_date,origination_principal_cents").eq("id", membership.account_id).maybeSingle(),
      db.rpc("read_private_financing_borrower_events", { p_account_id: membership.account_id }),
      db.from("private_financing_components").select("*").eq("account_id", membership.account_id),
      db.from("private_financing_account_terms_versions").select("*").eq("account_id", membership.account_id),
      db.from("private_financing_online_payment_settings").select("enabled").eq("account_id", membership.account_id).maybeSingle(),
      // At most one row can match -- private_financing_one_pending_online_payment is a unique
      // index on (owner_id, account_id, borrower_id) covering exactly these statuses.
      db.from("private_financing_online_payments").select("id,status,amount_cents")
        .eq("owner_id", membership.owner_id).eq("account_id", membership.account_id).eq("borrower_id", membership.borrower_id)
        .in("status", ["created", "requires_payment_method", "requires_action", "processing"]).maybeSingle(),
      // Borrower-visible autopay state (RLS: pf_autopay_enrollments_borrower_read) -- drives
      // the Automatic payments section of the borrower portal.
      db.from("private_financing_autopay_enrollments")
        .select("id,status,payment_method_type,charge_day,retry_limit,reminder_days_before,consented_at,cancelled_at")
        .eq("owner_id", membership.owner_id).eq("account_id", membership.account_id).eq("borrower_id", membership.borrower_id)
        .in("status", ["setup_required", "active", "paused"]),
    ]);
    if (!accountResult.data || eventResult.error || componentResult.error || termsResult.error) continue;
    const model = buildBorrowerPortalModelSafely({
      eventRows: eventResult.data || [],
      componentRows: componentResult.data || [],
      termsRows: termsResult.data || [],
    });
    const pendingRow = pendingPaymentResult.error ? null : pendingPaymentResult.data;
    accounts.push({
      account: accountResult.data,
      role: membership.role,
      summary: model.summary,
      events: eventResult.data || [],
      regularScheduledPaymentCents: model.regularScheduledPaymentCents,
      projection: model.projection,
      progressAvailable: model.progressAvailable,
      summaryAvailable: model.summaryAvailable !== false,
      summaryUnavailableReason: model.summaryUnavailableReason ?? null,
      onlinePaymentsEnabled: settingsResult.data?.enabled === true,
      // Lets the portal offer "Resume payment" for an abandoned-but-still-completable attempt
      // instead of a dead-end "already pending" block -- resumable statuses mirror
      // payment-session/resume's own RESUMABLE_STATUSES; "processing" is pending but not resumable
      // (Stripe is actively settling that attempt).
      pendingPayment: pendingRow ? {
        id: pendingRow.id, status: pendingRow.status, amountCents: Number(pendingRow.amount_cents),
        resumable: ["created", "requires_payment_method", "requires_action"].includes(pendingRow.status),
      } : null,
      autopayEnrollments: (autopayResult.error ? [] : autopayResult.data || []).map((row) => ({
        id: row.id, status: row.status, paymentMethodType: row.payment_method_type, chargeDay: row.charge_day,
        retryLimit: row.retry_limit, reminderDaysBefore: row.reminder_days_before,
        consentedAt: row.consented_at, cancelledAt: row.cancelled_at,
      })),
    });
  }

  // Messaging is a borrower<->owner relationship, not per-loan -- a borrower with several accounts
  // under the same owner still has just one conversation covering all of them. Deduped by
  // (owner_id, borrower_id) since memberships.data can carry the same pair once per account.
  const borrowerOwnerPairs = [...new Map((memberships.data || [])
    .map((membership) => [`${membership.owner_id}:${membership.borrower_id}`, { ownerId: membership.owner_id, borrowerId: membership.borrower_id }]))
    .values()];
  const conversations = [];
  for (const { ownerId, borrowerId } of borrowerOwnerPairs) {
    const conversationResult = await db.from("private_financing_conversations")
      .select("id, last_message_at, last_message_sender_type, borrower_last_read_at")
      .eq("owner_id", ownerId).eq("borrower_id", borrowerId).maybeSingle();
    if (conversationResult.error) continue;
    const conversationRow = conversationResult.data;
    if (!conversationRow) { conversations.push({ ownerId, borrowerId, messages: [], hasUnread: false }); continue; }
    const messagesResult = await db.from("private_financing_conversation_messages")
      .select("id, sender_type, body, category, created_at")
      .eq("owner_id", ownerId).eq("conversation_id", conversationRow.id).order("created_at", { ascending: true });
    const hasUnread = conversationRow.last_message_sender_type === "owner"
      && (!conversationRow.borrower_last_read_at || conversationRow.borrower_last_read_at < conversationRow.last_message_at);
    conversations.push({
      ownerId, borrowerId,
      messages: (messagesResult.data || []).map((row) => ({
        id: row.id, senderType: row.sender_type, body: row.body, category: row.category, createdAt: row.created_at,
      })),
      hasUnread,
    });
  }

  return NextResponse.json({ success: true, email: user.email, invitedEmail, mismatched, accounts, conversations, claim: claim.data || null });
}

function mapAutopayEnrollment(row) {
  return {
    id: row.id, status: row.status, paymentMethodType: row.payment_method_type, chargeDay: row.charge_day,
    retryLimit: row.retry_limit, reminderDaysBefore: row.reminder_days_before,
    consentedAt: row.consented_at, cancelledAt: row.cancelled_at,
  };
}

// Borrower identity for autopay operations: resolved from the authenticated user, then every
// subsequent query is explicitly scoped to (owner_id, borrower_id) — the service-role client
// bypasses RLS, so scoping mistakes here would cross borrower boundaries.
async function resolveAutopayBorrower(db, userId) {
  const { data, error } = await db.from("private_financing_borrowers")
    .select("owner_id,id,email,full_name").eq("auth_user_id", userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function assertActiveAutopayMembership(db, borrower, accountId) {
  const { data, error } = await db.from("private_financing_account_borrowers").select("status")
    .eq("owner_id", borrower.owner_id).eq("account_id", accountId).eq("borrower_id", borrower.id).eq("status", "active").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function ensureAutopayBillingCustomer(db, provider, borrower, connectedAccountId) {
  const existing = await db.from("private_financing_billing_customers").select("*")
    .eq("owner_id", borrower.owner_id).eq("borrower_id", borrower.id)
    .eq("provider", "stripe").eq("provider_mode", provider.mode).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await provider.createPrivateFinancingCustomer(
    { ownerId: borrower.owner_id, connectedAccountId },
    { borrowerId: borrower.id, email: borrower.email, displayName: borrower.full_name || borrower.email },
    `pf-customer:${provider.mode}:${borrower.owner_id}:${borrower.id}`);
  const saved = await db.from("private_financing_billing_customers").upsert({
    owner_id: borrower.owner_id, borrower_id: borrower.id, provider: "stripe", provider_mode: provider.mode,
    connected_account_id: connectedAccountId, customer_id: created.customerId,
  }, { onConflict: "owner_id,borrower_id,provider,provider_mode" }).select("*").single();
  if (saved.error) throw saved.error;
  return saved.data;
}

const AUTOPAY_CONSENT_TEXT = "I authorize recurring loan repayments from my US bank account under the schedule shown here. I understand enrollment is not active until Stripe securely verifies my bank account and debit mandate, and I may cancel future automatic payments at any time.";

export async function POST(request) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user?.id) return NextResponse.json({ error: "Sign in to send a message." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body?.operation === "send-message") {
    if (typeof body.body !== "string" || !body.body.trim())
      return NextResponse.json({ error: "A message body is required." }, { status: 400 });
    if (body.category !== undefined && body.category !== null && !["issue", "suggestion"].includes(body.category))
      return NextResponse.json({ error: "category must be \"issue\", \"suggestion\", or omitted." }, { status: 400 });
    // ownerId is only needed to disambiguate a borrower with more than one owner relationship
    // (see the migration's own comment on send_pf_conversation_borrower_message) -- omitted, the
    // RPC resolves cleanly whenever exactly one relationship exists.
    const { data, error } = await db.rpc("send_pf_conversation_borrower_message", {
      p_body: body.body.trim(), p_category: body.category || null, p_owner_id: body.ownerId || null,
    });
    if (error) return NextResponse.json({ error: "Unable to send this message." }, { status: 500 });
    return NextResponse.json({ success: true, message: data });
  }
  if (body?.operation === "mark-conversation-read") {
    const { error } = await db.rpc("mark_pf_conversation_read_by_borrower", { p_owner_id: body.ownerId || null });
    if (error) return NextResponse.json({ error: "Unable to mark this conversation as read." }, { status: 500 });
    return NextResponse.json({ success: true });
  }
  if (body?.operation === "request-autopay") {
    try {
      const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
      const chargeDay = Number(body.chargeDay);
      const reminderDaysBefore = Number(body.reminderDaysBefore);
      if (!accountId) return NextResponse.json({ error: "Financing account is required." }, { status: 400 });
      if (body.paymentMethodType && body.paymentMethodType !== "us_bank_account")
        return NextResponse.json({ error: "Only US bank account autopay is supported." }, { status: 400 });
      if (!Number.isSafeInteger(chargeDay) || chargeDay < 1 || chargeDay > 28)
        return NextResponse.json({ error: "Charge day must be between 1 and 28." }, { status: 400 });
      if (!Number.isSafeInteger(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 14)
        return NextResponse.json({ error: "Reminder must be between 0 and 14 days before." }, { status: 400 });
      if (body.consentConfirmed !== true)
        return NextResponse.json({ error: "Autopay consent is required." }, { status: 400 });
      const svc = createRentalWebhookClient();
      const provider = createStripeBillingProvider();
      const borrower = await resolveAutopayBorrower(svc, user.id);
      if (!borrower) return NextResponse.json({ error: "No borrower access is linked to this account." }, { status: 403 });
      if (!await assertActiveAutopayMembership(svc, borrower, accountId))
        return NextResponse.json({ error: "This financing account is not available to this borrower." }, { status: 403 });
      const settings = await svc.from("private_financing_online_payment_settings").select("enabled")
        .eq("owner_id", borrower.owner_id).eq("account_id", accountId).maybeSingle();
      if (settings.error) throw settings.error;
      if (!settings.data?.enabled)
        return NextResponse.json({ error: "Online payments are not active for this financing account." }, { status: 409 });
      const now = new Date().toISOString();
      const inserted = await svc.from("private_financing_autopay_enrollments").insert({
        owner_id: borrower.owner_id, id: `pf_autopay_${crypto.randomUUID()}`, account_id: accountId, borrower_id: borrower.id,
        status: "setup_required", payment_method_type: "us_bank_account", provider: "stripe", provider_mode: provider.mode,
        charge_day: chargeDay, reminder_days_before: reminderDaysBefore,
        consent_text: AUTOPAY_CONSENT_TEXT, consented_at: now, created_at: now, updated_at: now,
      }).select("*").single();
      if (inserted.error) {
        if (inserted.error.code === "23505")
          return NextResponse.json({ error: "This account already has an autopay enrollment." }, { status: 409 });
        throw inserted.error;
      }
      return NextResponse.json({ success: true, enrollment: mapAutopayEnrollment(inserted.data) });
    } catch (error) {
      console.error("Private financing autopay request error", { name: error?.name || "Error" });
      return NextResponse.json({ error: "Unable to start autopay enrollment." }, { status: 500 });
    }
  }
  if (body?.operation === "create-autopay-setup") {
    try {
      const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId.trim() : "";
      if (!enrollmentId) return NextResponse.json({ error: "enrollmentId is required." }, { status: 400 });
      const svc = createRentalWebhookClient();
      const provider = createStripeBillingProvider();
      validatePublishableKeyMode(provider.mode);
      const borrower = await resolveAutopayBorrower(svc, user.id);
      if (!borrower) return NextResponse.json({ error: "No borrower access is linked to this account." }, { status: 403 });
      const enrollmentResult = await svc.from("private_financing_autopay_enrollments").select("*")
        .eq("owner_id", borrower.owner_id).eq("id", enrollmentId).eq("borrower_id", borrower.id).maybeSingle();
      if (enrollmentResult.error) throw enrollmentResult.error;
      const enrollment = enrollmentResult.data;
      if (!enrollment) return NextResponse.json({ error: "Autopay enrollment was not found." }, { status: 404 });
      if (enrollment.status !== "setup_required" || enrollment.payment_method_type !== "us_bank_account")
        return NextResponse.json({ error: "This autopay enrollment is not awaiting bank setup." }, { status: 409 });
      const account = await svc.from("landlord_payment_accounts").select("*")
        .eq("owner_id", borrower.owner_id).eq("provider", "stripe").eq("provider_mode", provider.mode).maybeSingle();
      if (account.error) throw account.error;
      if (!account.data?.provider_account_id || account.data.status !== "enabled" || !account.data.charges_enabled || !account.data.payouts_enabled)
        return NextResponse.json({ error: "The seller payment account is not ready." }, { status: 409 });
      const customer = await ensureAutopayBillingCustomer(svc, provider, borrower, account.data.provider_account_id);
      const forwarded = request.headers.get("x-forwarded-for");
      const setup = await provider.createAutopaySetupIntent(
        { ownerId: borrower.owner_id, connectedAccountId: account.data.provider_account_id },
        { customerId: customer.customer_id, enrollmentId: enrollment.id,
          ipAddress: forwarded ? forwarded.split(",")[0].trim() : null, userAgent: request.headers.get("user-agent"),
          idempotencyKey: `pf-autopay-setup:${provider.mode}:${enrollment.id}` });
      const stored = await svc.from("private_financing_autopay_enrollments").update({
        setup_intent_id: setup.setupIntentId, updated_at: new Date().toISOString(),
      }).eq("owner_id", borrower.owner_id).eq("id", enrollment.id).eq("status", "setup_required").select("id").single();
      if (stored.error) throw stored.error;
      return NextResponse.json({ success: true, enrollmentId: enrollment.id, setupIntentId: setup.setupIntentId,
        clientSecret: setup.clientSecret, connectedAccountId: account.data.provider_account_id });
    } catch (error) {
      console.error("Private financing autopay setup error", { name: error?.name || "Error" });
      return NextResponse.json({ error: "Unable to start bank account setup." }, { status: 500 });
    }
  }
  if (body?.operation === "complete-autopay-setup") {
    try {
      const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId.trim() : "";
      const setupIntentId = typeof body.setupIntentId === "string" ? body.setupIntentId.trim() : "";
      if (!enrollmentId || !setupIntentId)
        return NextResponse.json({ error: "enrollmentId and setupIntentId are required." }, { status: 400 });
      const svc = createRentalWebhookClient();
      const provider = createStripeBillingProvider();
      const borrower = await resolveAutopayBorrower(svc, user.id);
      if (!borrower) return NextResponse.json({ error: "No borrower access is linked to this account." }, { status: 403 });
      const enrollmentResult = await svc.from("private_financing_autopay_enrollments").select("*")
        .eq("owner_id", borrower.owner_id).eq("id", enrollmentId).eq("borrower_id", borrower.id).maybeSingle();
      if (enrollmentResult.error) throw enrollmentResult.error;
      const enrollment = enrollmentResult.data;
      if (!enrollment) return NextResponse.json({ error: "Autopay enrollment was not found." }, { status: 404 });
      if (enrollment.status !== "setup_required")
        return NextResponse.json({ error: "This autopay enrollment is not awaiting bank setup." }, { status: 409 });
      if (enrollment.setup_intent_id !== setupIntentId)
        return NextResponse.json({ error: "This bank setup session does not match the enrollment." }, { status: 409 });
      const account = await svc.from("landlord_payment_accounts").select("*")
        .eq("owner_id", borrower.owner_id).eq("provider", "stripe").eq("provider_mode", provider.mode).maybeSingle();
      if (account.error) throw account.error;
      if (!account.data?.provider_account_id)
        return NextResponse.json({ error: "The seller payment account is not ready." }, { status: 409 });
      const customer = await ensureAutopayBillingCustomer(svc, provider, borrower, account.data.provider_account_id);
      const setup = await provider.retrieveSetupIntent({ connectedAccountId: account.data.provider_account_id }, setupIntentId);
      if (setup.status !== "succeeded" || !setup.paymentMethodId)
        return NextResponse.json({ error: "Bank account verification did not complete. Please try linking again." }, { status: 409 });
      const now = new Date().toISOString();
      const updated = await svc.from("private_financing_autopay_enrollments").update({
        provider_payment_method_id: setup.paymentMethodId, provider_mandate_id: setup.mandateId,
        provider_customer_id: customer.customer_id, status: "active", activated_at: now,
        consecutive_failures: 0, updated_at: now,
      }).eq("owner_id", borrower.owner_id).eq("id", enrollment.id).eq("status", "setup_required").select("*").single();
      if (updated.error) throw updated.error;
      if (!updated.data) return NextResponse.json({ error: "This autopay enrollment is not awaiting bank setup." }, { status: 409 });
      return NextResponse.json({ success: true, enrollment: mapAutopayEnrollment(updated.data) });
    } catch (error) {
      console.error("Private financing autopay completion error", { name: error?.name || "Error" });
      return NextResponse.json({ error: "Unable to activate autopay." }, { status: 500 });
    }
  }
  if (body?.operation === "cancel-autopay") {
    try {
      const enrollmentId = typeof body.enrollmentId === "string" ? body.enrollmentId.trim() : "";
      if (!enrollmentId) return NextResponse.json({ error: "enrollmentId is required." }, { status: 400 });
      const svc = createRentalWebhookClient();
      const borrower = await resolveAutopayBorrower(svc, user.id);
      if (!borrower) return NextResponse.json({ error: "No borrower access is linked to this account." }, { status: 403 });
      const now = new Date().toISOString();
      const updated = await svc.from("private_financing_autopay_enrollments").update({
        status: "cancelled", cancelled_at: now,
        cancellation_reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "Cancelled by borrower",
        updated_at: now,
      }).eq("owner_id", borrower.owner_id).eq("id", enrollmentId).eq("borrower_id", borrower.id)
        .in("status", ["setup_required", "active", "paused"]).select("*").single();
      if (updated.error) throw updated.error;
      if (!updated.data) return NextResponse.json({ error: "Autopay enrollment was not found." }, { status: 404 });
      return NextResponse.json({ success: true, enrollment: mapAutopayEnrollment(updated.data) });
    } catch (error) {
      console.error("Private financing autopay cancellation error", { name: error?.name || "Error" });
      return NextResponse.json({ error: "Unable to cancel autopay." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "A supported operation is required." }, { status: 400 });
}
