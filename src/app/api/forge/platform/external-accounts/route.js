// External Accounts Register — list + create.
//
// GET /api/forge/platform/external-accounts — the household's accounts
// (deleted hidden unless ?include_deleted=1), provider order.
// POST — create one account through forge_external_account_create.
// A duplicate provider+purpose returns 409 naming the existing row
// (the RPC's conflict answer), never a silent second row.
import { NextResponse } from "next/server";
import { validateExternalAccountPayload } from "@/domains/externalAccounts/externalAccountValidation";
import {
  readJsonBody,
  registerErrorResponse,
  requireRegisterHousehold,
} from "./_lib/registerRoute";

export const ACCOUNT_COLUMNS =
  "id,seed_key,provider_name,purpose,associated_app,work_thread_label,account_email,plan_status,billing_arrangement,api_integration_status,still_needed,credential_location,record_status,setup_status,source_kind,source_reference,notes,last_verified_at,version,created_at,updated_at,deleted_at";

export async function GET(request) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;

  const url = new URL(request.url);
  const includeDeleted = url.searchParams.get("include_deleted") === "1";

  let query = authenticated.supabaseClient
    .from("forge_external_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("platform_owner_id", authenticated.effectiveOwnerId)
    .order("provider_name", { ascending: true });
  if (!includeDeleted) query = query.is("deleted_at", null);

  const { data, error } = await query;
  if (error) return registerErrorResponse(error);
  return NextResponse.json({ ok: true, accounts: data ?? [] }, { status: 200 });
}

export async function POST(request) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;

  const body = await readJsonBody(request);
  const payload = body.payload ?? body;
  const { ok, errors } = validateExternalAccountPayload(payload);
  if (!ok) {
    return NextResponse.json(
      { error: `Check these fields and try again: ${errors.join("; ")}.` },
      { status: 400 },
    );
  }

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_account_create",
    { p_payload: payload },
  );
  if (error) return registerErrorResponse(error);
  if (data?.conflict) {
    return NextResponse.json(
      {
        error:
          "An account for that provider and purpose already exists. Open the existing one instead of adding a second.",
        existing_id: data.existing_id ?? null,
      },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { ok: true, message: `Saved ${payload.provider_name}.`, id: data?.id ?? null },
    { status: 201 },
  );
}
