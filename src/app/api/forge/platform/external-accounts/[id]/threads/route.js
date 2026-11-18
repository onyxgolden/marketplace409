// External Accounts Register — add a work thread to one account.
import { NextResponse } from "next/server";
import { validateExternalAccountThreadPayload } from "@/domains/externalAccounts/externalAccountValidation";
import {
  readJsonBody,
  registerErrorResponse,
  requireRegisterHousehold,
} from "../../_lib/registerRoute";

export async function POST(request, { params }) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;
  const { id } = await params;

  const body = await readJsonBody(request);
  const payload = body.payload ?? body;
  const { ok, errors } = validateExternalAccountThreadPayload(payload);
  if (!ok) {
    return NextResponse.json(
      { error: `Check these fields and try again: ${errors.join("; ")}.` },
      { status: 400 },
    );
  }

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_account_thread_add",
    { p_account_id: id, p_payload: payload },
  );
  if (error) return registerErrorResponse(error);
  return NextResponse.json(
    { ok: true, message: `Added the thread “${payload.title}”.`, id: data?.id ?? null },
    { status: 201 },
  );
}
