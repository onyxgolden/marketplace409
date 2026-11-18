// External Accounts Register — restore a logically deleted account.
import { NextResponse } from "next/server";
import { registerErrorResponse, requireRegisterHousehold } from "../../_lib/registerRoute";

export async function POST(request, { params }) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;
  const { id } = await params;

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_account_restore",
    { p_account_id: id },
  );
  if (error) return registerErrorResponse(error);
  return NextResponse.json(
    { ok: true, message: "Restored.", id: data?.id ?? id },
    { status: 200 },
  );
}
