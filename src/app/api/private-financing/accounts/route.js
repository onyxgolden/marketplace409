import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import { computeAccountBalanceSummary } from "@/domains/private-financing/accountBalanceSummary";

function rowToAccount(row) {
  return {
    id: row.id,
    product: row.product,
    status: row.status,
    openedDate: row.opened_date,
    originationPrincipalCents: row.origination_principal_cents,
    lateFeePolicy: row.late_fee_policy,
    platformFeeCents: row.platform_fee_cents,
    feePayer: row.fee_payer,
  };
}

// A real, joined borrower label -- every membership row currently on record for this account (any
// status: invited, active, or suspended -- all are genuine facts already known to the seller; only
// "revoked" is excluded as no longer a live association), joined against borrower identity for a display
// name. Returns null (never a fabricated placeholder) when no borrower has been added yet.
function buildBorrowerLabel(accountId, memberships, borrowersById) {
  const names = memberships
    .filter((membership) => membership.account_id === accountId && membership.status !== "revoked")
    .map((membership) => {
      const borrower = borrowersById.get(membership.borrower_id);
      return borrower?.full_name || borrower?.email || null;
    })
    .filter(Boolean);
  return names.length > 0 ? names.join(", ") : null;
}

function groupRowsByAccountId(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.account_id) || [];
    list.push(row);
    grouped.set(row.account_id, list);
  }
  return grouped;
}

// RLS drives the scoping here, matching /api/workspace/members' own precedent: the seller-side
// private_financing_accounts_owner_all policy (has_workspace_access(owner_id)) returns every account the
// caller's effective workspace owns, with no separate .eq("owner_id", ...) filter needed. Every join
// query below (memberships/borrowers/policy/events/components) is likewise RLS-scoped by the same
// mechanism on each of those tables, so this route can never see another workspace's data even though it
// queries by a bulk .in(accountId) list rather than repeating has_workspace_access itself.
export async function GET() {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;

  const accountsResult = await authenticated.supabaseClient
    .from("private_financing_accounts")
    .select("*")
    .order("opened_date", { ascending: false });

  if (accountsResult.error && isMissingRemoteSchemaError(accountsResult.error)) return privateFinancingSchemaUnavailableResponse();
  if (accountsResult.error) return NextResponse.json({ error: "Unable to load private financing accounts." }, { status: 500 });

  const accountRows = accountsResult.data || [];
  const viewerRole = authenticated.user.id === authenticated.effectiveOwnerId ? "primary_owner" : "co_owner";

  if (accountRows.length === 0) {
    return NextResponse.json({ success: true, viewerRole, accounts: [] });
  }

  const accountIds = accountRows.map((row) => row.id);

  const [membershipsResult, policiesResult, eventsResult, componentVersionsResult, termsVersionsResult] = await Promise.all([
    authenticated.supabaseClient.from("private_financing_account_borrowers").select("account_id, borrower_id, status").in("account_id", accountIds),
    authenticated.supabaseClient.from("private_financing_current_servicing_policy").select("account_id, payment_acceptance_policy").in("account_id", accountIds),
    authenticated.supabaseClient.from("private_financing_events").select("*").in("account_id", accountIds).order("ledger_sequence", { ascending: true }),
    authenticated.supabaseClient.from("private_financing_components").select("*").in("account_id", accountIds),
    authenticated.supabaseClient.from("private_financing_account_terms_versions").select("*").in("account_id", accountIds),
  ]);

  for (const result of [membershipsResult, policiesResult, eventsResult, componentVersionsResult, termsVersionsResult]) {
    if (result.error) return NextResponse.json({ error: "Unable to load private financing accounts." }, { status: 500 });
  }

  const memberships = membershipsResult.data || [];
  const borrowerIds = [...new Set(memberships.map((membership) => membership.borrower_id))];
  let borrowersById = new Map();
  if (borrowerIds.length > 0) {
    const borrowersResult = await authenticated.supabaseClient.from("private_financing_borrowers").select("id, full_name, email").in("id", borrowerIds);
    if (borrowersResult.error) return NextResponse.json({ error: "Unable to load private financing accounts." }, { status: 500 });
    borrowersById = new Map((borrowersResult.data || []).map((row) => [row.id, row]));
  }

  const policyByAccountId = new Map((policiesResult.data || []).map((row) => [row.account_id, row.payment_acceptance_policy]));
  const eventsByAccountId = groupRowsByAccountId(eventsResult.data || []);
  const componentVersionsByAccountId = groupRowsByAccountId(componentVersionsResult.data || []);
  const termsVersionsByAccountId = groupRowsByAccountId(termsVersionsResult.data || []);

  const accounts = accountRows.map((row) => ({
    ...rowToAccount(row),
    borrowerLabel: buildBorrowerLabel(row.id, memberships, borrowersById),
    paymentAcceptancePolicy: policyByAccountId.get(row.id) ?? null,
    balance: computeAccountBalanceSummary(
      eventsByAccountId.get(row.id) || [],
      componentVersionsByAccountId.get(row.id) || [],
      termsVersionsByAccountId.get(row.id) || [],
    ),
    // This schema has no due-date/payment-cadence concept anywhere yet (see accountBalanceSummary.js) --
    // explicit and honest, so a caller never infers a due date or past-due status that isn't real.
    dueDateTrackingAvailable: false,
  }));

  return NextResponse.json({ success: true, viewerRole, accounts });
}
