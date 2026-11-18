// External Accounts Register — status-report section.
//
// GET /api/forge/platform/external-accounts/report — the "External
// accounts and dependent work" section for a FORGE status report.
// POST accepts { previous_report } to diff provider changes since
// the prior report.
//
// The section is built from RLS-scoped reads. It NEVER carries an
// account email or a credential locator: the account query selects
// only the columns the builder needs, and the builder itself emits
// provider names, counts, and follow-ups only.
import { NextResponse } from "next/server";
import { buildExternalAccountStatusSection } from "@/domains/externalAccounts/externalAccountStatusReport";
import {
  readJsonBody,
  registerErrorResponse,
  requireRegisterHousehold,
} from "../_lib/registerRoute";

const REPORT_ACCOUNT_COLUMNS =
  "id,seed_key,provider_name,purpose,associated_app,work_thread_label,plan_status,api_integration_status,still_needed,record_status,setup_status,last_verified_at";

export async function GET() {
  return buildReport(null);
}

export async function POST(request) {
  const body = await readJsonBody(request);
  return buildReport(body.previous_report ?? null);
}

async function buildReport(previousReport) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;

  const { data: accounts, error: accountsError } = await authenticated.supabaseClient
    .from("forge_external_accounts")
    .select(REPORT_ACCOUNT_COLUMNS)
    .eq("platform_owner_id", authenticated.effectiveOwnerId)
    .is("deleted_at", null)
    .order("provider_name", { ascending: true });
  if (accountsError) return registerErrorResponse(accountsError);

  const { data: threads, error: threadsError } = await authenticated.supabaseClient
    .from("forge_external_account_threads")
    .select("id,account_id,title,reference,state,next_action,owner,next_review_on")
    .eq("platform_owner_id", authenticated.effectiveOwnerId)
    .order("created_at", { ascending: true });
  if (threadsError) return registerErrorResponse(threadsError);

  // The builder reads `provider` on accounts and `account_provider`
  // on threads; map the DB column names onto those.
  const providerByAccountId = new Map(
    (accounts ?? []).map((a) => [a.id, a.provider_name]),
  );
  const section = buildExternalAccountStatusSection({
    accounts: (accounts ?? []).map((a) => ({ ...a, provider: a.provider_name })),
    threads: (threads ?? []).map((t) => ({
      ...t,
      account_provider: providerByAccountId.get(t.account_id) ?? null,
    })),
    previousReport,
  });
  return NextResponse.json({ ok: true, section }, { status: 200 });
}
