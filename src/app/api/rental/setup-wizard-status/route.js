import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { buildSetupWizardStatus } from "@/application/rental/setupWizard";

// Read-only status feed for the guided setup wizard (Rentec-parity slice R16).
// Cheap count-only queries — no mutations, no PII beyond row counts. The
// response's step completion is derived from real data (see setupWizard.js),
// so a step that reads "done" means the underlying record actually exists.
export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const [unitsResult, tenantsResult, accountsResult, billingResult, emailResult, lateFeeRuleResult, membersResult] = await Promise.all([
      // rental_units / rental_tenants are RLS-scoped like the main /api/rental route (no explicit
      // owner filter) — a co-owner sees the shared books, never a private fallback workspace.
      supabaseClient.from("rental_units").select("id, status").order("id", { ascending: true }),
      supabaseClient.from("rental_tenants").select("id").order("id", { ascending: true }),
      // Mirrors /api/rental/bank-accounts: effectiveOwnerId is the canonical owner id, so a
      // co-owner sees the shared books' accounts.
      supabaseClient
        .from("financial_accounts")
        .select("id")
        .eq("owner_id", effectiveOwnerId)
        .eq("active", true)
        .in("type", ["depository", "credit", "loan"]),
      supabaseClient.from("rental_billing_settings").select("owner_id").eq("owner_id", effectiveOwnerId).maybeSingle(),
      supabaseClient.from("rental_email_settings").select("owner_id").eq("owner_id", effectiveOwnerId).maybeSingle(),
      supabaseClient.from("rental_late_fee_rules").select("id").eq("owner_id", effectiveOwnerId).limit(1),
      // Mirrors /api/workspace/members: RLS scopes the rows, so the count is the members
      // visible to the caller. Suspended members are not a live team.
      supabaseClient.from("workspace_members").select("id, status").neq("status", "suspended"),
    ]);
    const error =
      unitsResult.error || tenantsResult.error || accountsResult.error || billingResult.error ||
      emailResult.error || lateFeeRuleResult.error || membersResult.error;
    if (error) throw error;

    const status = buildSetupWizardStatus({
      units: unitsResult.data || [],
      tenants: tenantsResult.data || [],
      bankAccountCount: (accountsResult.data || []).length,
      settingsConfigured:
        Boolean(billingResult.data) || Boolean(emailResult.data) || (lateFeeRuleResult.data || []).length > 0,
      memberCount: (membersResult.data || []).length,
    });
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    console.error("Setup wizard status error", error);
    return NextResponse.json({ error: "Unable to load setup progress." }, { status: 500 });
  }
}
