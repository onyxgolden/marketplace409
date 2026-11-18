// External Accounts Register — reconcile one Gmail lead.
//
// POST /api/forge/platform/external-accounts/reconcile
//   { lead: { provider, account_email?, message_ref, ... } }
// A Gmail finding is a review-queue lead, never an auto-confirmation:
// the RPC matches by provider+email (never provider alone), creates
// an unverified_lead only when nothing matches, and is idempotent on
// message_ref — the first decision wins, a repeat is a no-op.
import { NextResponse } from "next/server";
import {
  readJsonBody,
  registerErrorResponse,
  requireRegisterHousehold,
} from "../_lib/registerRoute";

export async function POST(request) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;

  const body = await readJsonBody(request);
  const lead = body.lead ?? body;
  if (!lead?.provider || !String(lead.provider).trim()) {
    return NextResponse.json({ error: "A provider name is required." }, { status: 400 });
  }
  if (!lead?.message_ref || !String(lead.message_ref).trim()) {
    return NextResponse.json({ error: "A message reference is required." }, { status: 400 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_accounts_reconcile_lead",
    { p_lead: lead },
  );
  if (error) return registerErrorResponse(error);
  return NextResponse.json(
    {
      ok: true,
      message:
        data?.decision === "created"
          ? `Added ${lead.provider} as an unverified lead for review.`
          : data?.decision === "matched"
            ? `Matched the existing ${lead.provider} account — nothing new added.`
            : "That message was already reconciled — nothing changed.",
      ...data,
    },
    { status: 200 },
  );
}
