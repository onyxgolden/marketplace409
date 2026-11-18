// External Accounts Register — move a work thread to a new state.
import { NextResponse } from "next/server";
import {
  EXTERNAL_ACCOUNT_THREAD_STATES,
  findSecretLikeFields,
} from "@/domains/externalAccounts/externalAccountValidation";
import {
  readJsonBody,
  registerErrorResponse,
  requireRegisterHousehold,
} from "../../_lib/registerRoute";

export async function PATCH(request, { params }) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;
  const { threadId } = await params;

  const body = await readJsonBody(request);
  const state = body.state;
  if (!EXTERNAL_ACCOUNT_THREAD_STATES.includes(state)) {
    return NextResponse.json(
      { error: "That thread state isn't recognized." },
      { status: 400 },
    );
  }
  const secretFields = findSecretLikeFields(body, ["next_action"]);
  if (secretFields.length > 0) {
    return NextResponse.json(
      {
        error:
          "The next action looks like it contains a secret. Enter a description instead, never the secret itself.",
      },
      { status: 400 },
    );
  }

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_account_thread_set_state",
    {
      p_thread_id: threadId,
      p_state: state,
      p_next_action: body.next_action ?? null,
      p_next_review_on: body.next_review_on ?? null,
    },
  );
  if (error) return registerErrorResponse(error);
  return NextResponse.json(
    { ok: true, message: `Thread moved to ${state}.`, id: data?.id ?? threadId },
    { status: 200 },
  );
}
