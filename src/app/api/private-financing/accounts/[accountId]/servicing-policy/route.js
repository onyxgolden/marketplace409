import { NextResponse } from "next/server";
import { createAuthenticatedPrivateFinancingApplication } from "@/lib/supabase/createAuthenticatedPrivateFinancingApplication";
import { isMissingRemoteSchemaError } from "@/lib/supabase/isMissingRemoteSchemaError";
import { privateFinancingSchemaUnavailableResponse } from "@/lib/supabase/privateFinancingSchemaUnavailableResponse";
import { PAYMENT_ACCEPTANCE_POLICY } from "@/domains/private-financing/paymentAcceptancePolicy";

function mapPolicy(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    version: row.version,
    paymentAcceptancePolicy: row.payment_acceptance_policy,
    effectiveAt: row.effective_at,
    actingSellerId: row.acting_seller_id,
    reason: row.reason,
    recordedAt: row.recorded_at,
  };
}

export async function POST(request, { params }) {
  const authenticated = await createAuthenticatedPrivateFinancingApplication();
  if (authenticated.response) return authenticated.response;
  const { accountId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const policy = body?.paymentAcceptancePolicy;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const effectiveAt =
    typeof body?.effectiveAt === "string" && body.effectiveAt.length > 0
      ? body.effectiveAt
      : new Date().toISOString();

  if (!Object.values(PAYMENT_ACCEPTANCE_POLICY).includes(policy)) {
    return NextResponse.json(
      { error: "Unrecognized payment-acceptance policy.", code: "private_financing_invalid_payment_policy" },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { error: "A reason is required for a payment-policy change.", code: "private_financing_policy_reason_required" },
      { status: 400 },
    );
  }
  if (Number.isNaN(Date.parse(effectiveAt)) || new Date(effectiveAt).getTime() < Date.now() - 5_000) {
    return NextResponse.json(
      { error: "The policy effective time must be now or in the future.", code: "private_financing_policy_backdating_not_allowed" },
      { status: 400 },
    );
  }

  // effectiveOwnerId is resolved server-side; acting_seller_id and version are both forced by the
  // SECURITY DEFINER RPC. Borrower identities have no path through has_workspace_access.
  const { data, error } = await authenticated.supabaseClient.rpc(
    "append_private_financing_servicing_policy_version",
    {
      p_owner_id: authenticated.effectiveOwnerId,
      p_account_id: accountId,
      p_payment_acceptance_policy: policy,
      p_effective_at: effectiveAt,
      p_reason: reason,
    },
  );
  if (error) {
    if (isMissingRemoteSchemaError(error)) return privateFinancingSchemaUnavailableResponse();
    if (error.code === "42501") {
      return NextResponse.json({ error: "You do not have access to change this account." }, { status: 403 });
    }
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message, code: "private_financing_invalid_payment_policy" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to change the payment-acceptance policy." }, { status: 500 });
  }

  return NextResponse.json({ success: true, servicingPolicy: mapPolicy(data) });
}
