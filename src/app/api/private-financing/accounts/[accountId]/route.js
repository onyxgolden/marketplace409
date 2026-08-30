import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import { computeAccountBalanceSummary } from "@/domains/private-financing/accountBalanceSummary";
import { computeAccountPayoffEstimate } from "@/domains/private-financing/payoffEstimate";
import { computeDueState, UnsupportedDueStateError } from "@/domains/private-financing/dueState";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function rowToAccount(row) {
  return {
    id: row.id,
    product: row.product,
    status: row.status,
    openedDate: row.opened_date,
    originationPrincipalCents: row.origination_principal_cents,
    lateFeePolicy: row.late_fee_policy,
    interestDayCountConvention: row.interest_day_count_convention,
    platformFeeCents: row.platform_fee_cents,
    feePayer: row.fee_payer,
  };
}

// Seller-only borrower membership summary -- deliberately minimal. private_financing_borrowers has no
// SSN, birth date, or other identity-document column anywhere in its schema (see the migration's own
// Revision 1 comment), so "no hidden identity fields" is true by construction here, not by redaction:
// there is nothing further to omit. phone and auth_user_id are intentionally left out of this read
// model even though the underlying table has them -- a seller viewing this summary needs to know WHO is
// on the account and their membership status, not their phone number or internal claim-linkage id.
function rowToBorrowerMembership(membershipRow, borrowersById) {
  const borrower = borrowersById.get(membershipRow.borrower_id);
  return {
    membershipId: membershipRow.id,
    borrowerId: membershipRow.borrower_id,
    displayName: borrower?.full_name || borrower?.email || "Unknown borrower",
    email: borrower?.email ?? null,
    role: membershipRow.role,
    status: membershipRow.status,
  };
}

// V1 Terms Generalization: an account has an ORDERED COLLECTION of one or more financing components --
// this maps whatever the account's own current components are, never assuming exactly two or any fixed
// named identity.
function rowToComponent(row) {
  return {
    id: row.id,
    componentKey: row.component_key,
    label: row.label,
    versionNumber: row.version_number,
    originalPrincipalCents: row.original_principal_cents,
    rateBps: row.rate_bps,
    dayCountConvention: row.day_count_convention,
    scheduledComponentAmountCents: row.scheduled_component_amount_cents,
    allocationPriority: row.allocation_priority,
    effectiveDate: row.effective_date,
    amendmentReason: row.amendment_reason,
  };
}

function rowToAccountTerms(row) {
  if (!row) return null;
  return {
    versionNumber: row.version_number,
    paymentFrequency: row.payment_frequency,
    firstPaymentDueDate: row.first_payment_due_date,
    regularScheduledPaymentAmountCents: row.regular_scheduled_payment_amount_cents,
    maturityDate: row.maturity_date,
    allocationPolicy: row.allocation_policy,
    extraPaymentAllocationPolicy: row.extra_payment_allocation_policy,
    prepaymentPolicy: row.prepayment_policy,
    dayCountConvention: row.day_count_convention,
    effectiveDate: row.effective_date,
    actingSellerId: row.acting_seller_id,
    amendmentReason: row.amendment_reason,
  };
}

function rowToServicingPolicy(row) {
  if (!row) return null;
  return {
    version: row.version,
    paymentAcceptancePolicy: row.payment_acceptance_policy,
    effectiveAt: row.effective_at,
    actingSellerId: row.acting_seller_id,
    reason: row.reason,
  };
}

// RLS scopes every query below via has_workspace_access(owner_id) -- matching the scheduling
// [projectId] route's own precedent (src/app/api/forge/scheduling/[projectId]/route.js): a miss on the
// account lookup means "doesn't exist" and "exists but isn't yours" alike, both correctly surfacing as
// 404, never leaking which one it was.
export async function GET(request, { params }) {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;

  const { accountId } = await params;

  const accountResult = await authenticated.supabaseClient
    .from("private_financing_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();

  if (accountResult.error && isMissingRemoteSchemaError(accountResult.error)) {
    return privateFinancingSchemaUnavailableResponse();
  }
  if (accountResult.error) {
    return NextResponse.json({ error: "Unable to load this private financing account." }, { status: 500 });
  }
  if (!accountResult.data) {
    return NextResponse.json({ error: "Private financing account not found." }, { status: 404 });
  }

  const [componentsResult, policyResult, allComponentVersionsResult, allTermsVersionsResult, currentTermsResult, eventsResult, membershipsResult] = await Promise.all([
    authenticated.supabaseClient.from("private_financing_current_components").select("*").eq("account_id", accountId),
    authenticated.supabaseClient.from("private_financing_current_servicing_policy").select("*").eq("account_id", accountId).maybeSingle(),
    authenticated.supabaseClient.from("private_financing_components").select("*").eq("account_id", accountId),
    authenticated.supabaseClient.from("private_financing_account_terms_versions").select("*").eq("account_id", accountId),
    authenticated.supabaseClient.from("private_financing_current_account_terms").select("*").eq("account_id", accountId).maybeSingle(),
    authenticated.supabaseClient.from("private_financing_events").select("*").eq("account_id", accountId).order("ledger_sequence", { ascending: true }),
    authenticated.supabaseClient.from("private_financing_account_borrowers").select("id, borrower_id, role, status").eq("account_id", accountId),
  ]);

  for (const result of [componentsResult, policyResult, allComponentVersionsResult, allTermsVersionsResult, currentTermsResult, eventsResult, membershipsResult]) {
    if (result.error) return NextResponse.json({ error: "Unable to load this private financing account's details." }, { status: 500 });
  }

  const memberships = membershipsResult.data || [];
  const borrowerIds = [...new Set(memberships.map((membership) => membership.borrower_id))];
  let borrowersById = new Map();
  if (borrowerIds.length > 0) {
    const borrowersResult = await authenticated.supabaseClient.from("private_financing_borrowers").select("id, full_name, email").in("id", borrowerIds);
    if (borrowersResult.error) return NextResponse.json({ error: "Unable to load this private financing account's details." }, { status: 500 });
    borrowersById = new Map((borrowersResult.data || []).map((row) => [row.id, row]));
  }

  const eventRows = eventsResult.data || [];
  const componentRows = allComponentVersionsResult.data || [];
  const termsRows = allTermsVersionsResult.data || [];
  const balance = computeAccountBalanceSummary(eventRows, componentRows, termsRows);
  const accountTerms = rowToAccountTerms(currentTermsResult.data);

  // The due-state engine (dueState.js) is the ONLY place "current amount due"/"past-due amount"/"next due
  // date" may ever be a real calculated value rather than the honest "Not tracked yet" placeholder -- and
  // only for an account whose own terms are within V1's closed support envelope (monthly frequency, a
  // prepayment policy other than "unsupported"). Any other account gets dueState: null here, and the UI
  // preserves the honest label, exactly as it did before this engine existed.
  let dueState = null;
  if (balance && accountTerms) {
    try {
      dueState = computeDueState({ snapshot: balance, accountTerms, asOfDate: todayISODate() });
    } catch (error) {
      if (!(error instanceof UnsupportedDueStateError)) throw error;
    }
  }

  return NextResponse.json({
    success: true,
    account: rowToAccount(accountResult.data),
    components: (componentsResult.data || []).map(rowToComponent),
    accountTerms,
    servicingPolicy: rowToServicingPolicy(policyResult.data),
    balance,
    dueState,
    payoffEstimate: computeAccountPayoffEstimate({ eventRows, componentRows, termsRows, accountId, balanceSummary: balance, lateFeePolicy: accountResult.data.late_fee_policy }),
    borrowers: memberships.map((membership) => rowToBorrowerMembership(membership, borrowersById)),
  });
}
