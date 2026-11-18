// External Accounts Register — one account.
//
// GET /api/forge/platform/external-accounts/[id] — the account plus its
// threads and recent audit entries. A missing or foreign id returns
// the same 404 as a non-household caller: no presence signal.
// PATCH — partial update through forge_external_account_update.
// Requires expected_version (optimistic concurrency): a stale edit
// gets a 409 telling the user to reload, never a silent overwrite.
// DELETE — logical delete by default; ?permanent=1 erases permanently,
// and only after a logical delete (the RPC enforces the order).
import { NextResponse } from "next/server";
import { validateExternalAccountPayload } from "@/domains/externalAccounts/externalAccountValidation";
import {
  readJsonBody,
  registerErrorResponse,
  requireRegisterHousehold,
} from "../_lib/registerRoute";
import { ACCOUNT_COLUMNS } from "../route";

export async function GET(request, { params }) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;
  const { id } = await params;

  const { data: account, error } = await authenticated.supabaseClient
    .from("forge_external_accounts")
    .select(ACCOUNT_COLUMNS)
    .eq("platform_owner_id", authenticated.effectiveOwnerId)
    .eq("id", id)
    .maybeSingle();
  if (error) return registerErrorResponse(error);
  if (!account) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { data: threads, error: threadsError } = await authenticated.supabaseClient
    .from("forge_external_account_threads")
    .select("id,account_id,title,reference,state,next_action,owner,next_review_on,created_at,updated_at")
    .eq("account_id", id)
    .order("created_at", { ascending: true });
  if (threadsError) return registerErrorResponse(threadsError);

  const { data: audit, error: auditError } = await authenticated.supabaseClient
    .from("forge_external_account_audit")
    .select("id,action,changed_fields,created_at")
    .eq("account_id", id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (auditError) return registerErrorResponse(auditError);

  return NextResponse.json(
    { ok: true, account, threads: threads ?? [], audit: audit ?? [] },
    { status: 200 },
  );
}

export async function PATCH(request, { params }) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;
  const { id } = await params;

  const body = await readJsonBody(request);
  const payload = body.payload ?? {};
  const expectedVersion = body.expected_version;
  if (expectedVersion === undefined || expectedVersion === null) {
    return NextResponse.json(
      { error: "Reload the record and try again — its version is missing." },
      { status: 400 },
    );
  }
  const { ok, errors } = validateExternalAccountPayload(payload, { forUpdate: true });
  if (!ok) {
    return NextResponse.json(
      { error: `Check these fields and try again: ${errors.join("; ")}.` },
      { status: 400 },
    );
  }

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_account_update",
    { p_account_id: id, p_payload: payload, p_expected_version: expectedVersion },
  );
  if (error) return registerErrorResponse(error);
  return NextResponse.json(
    {
      ok: true,
      message: `Saved ${payload.provider_name ?? "the account"}.`,
      id: data?.id ?? id,
      version: data?.version ?? null,
    },
    { status: 200 },
  );
}

export async function DELETE(request, { params }) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;
  const { id } = await params;

  const url = new URL(request.url);
  const permanent = url.searchParams.get("permanent") === "1";

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_account_delete",
    { p_account_id: id, p_permanent: permanent },
  );
  if (error) return registerErrorResponse(error);
  return NextResponse.json(
    {
      ok: true,
      message: permanent
        ? "Erased permanently."
        : "Deleted. You can restore it from the deleted list.",
      id: data?.id ?? id,
    },
    { status: 200 },
  );
}
