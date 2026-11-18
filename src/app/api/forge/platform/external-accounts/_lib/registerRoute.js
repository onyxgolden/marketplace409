// External Accounts Register — shared route helpers.
//
// Every register route is a thin, authenticated wrapper: the household
// gate runs first (non-household callers get the same non-disclosing
// 404 whether the row exists or not), then the request shape is
// validated, then a SECURITY DEFINER RPC or an RLS-scoped query does
// the work. Raw Postgres messages never reach the client, and a
// secret-like value is rejected by name, never echoed.
import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { isRegisterHouseholdActor } from "@/domains/externalAccounts/externalAccountHouseholdGate";

const ERROR_MAP = {
  FORGE_EXTERNAL_ACCOUNT_NOT_FOUND: [404, "Not found."],
  FORGE_EXTERNAL_ACCOUNT_VERSION_CONFLICT: [
    409,
    "That record changed since you opened it. Reload it and try again.",
  ],
  FORGE_EXTERNAL_ACCOUNT_NOT_DELETED: [
    409,
    "Delete it first — a record can only be erased permanently after it has been deleted.",
  ],
  FORGE_EXTERNAL_ACCOUNT_SECRET_REJECTED: [
    400,
    "That looks like a password, key, or token. Enter a location (like “1Password → FORGE”), never the secret itself.",
  ],
  FORGE_EXTERNAL_ACCOUNT_SEED_VERSION_REQUIRED: [400, "A seed version is required."],
  FORGE_EXTERNAL_ACCOUNT_REQUEST_ID_REQUIRED: [400, "A request id is required. Try again."],
  FORGE_EXTERNAL_ACCOUNT_PROVIDER_REQUIRED: [400, "A provider name is required."],
  FORGE_EXTERNAL_ACCOUNT_MESSAGE_REF_REQUIRED: [400, "A message reference is required."],
};

export function registerErrorResponse(error) {
  const message = String(error?.message || "");
  const code = Object.keys(ERROR_MAP).find((key) => message.includes(key));
  if (code) {
    const [status, text] = ERROR_MAP[code];
    return NextResponse.json({ error: text }, { status });
  }
  if (error?.code === "42501") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (error?.code === "23505") {
    return NextResponse.json({ error: "That already exists." }, { status: 409 });
  }
  console.error("external accounts route failed", error);
  return NextResponse.json({ error: "Unable to complete the request." }, { status: 400 });
}

/**
 * Authenticate and gate: returns { authenticated } on success, or a
 * NextResponse to return directly (401 signed-out, 404 non-household).
 * The 404 is deliberately the same whether the register, the row, or
 * the household exists — a non-household caller learns nothing.
 */
export async function requireRegisterHousehold() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return { response: authenticated.response };

  const allowed = await isRegisterHouseholdActor({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user?.id,
  });
  if (!allowed) {
    return { response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  return { authenticated };
}

/** Parse a JSON body; returns {} on empty/invalid JSON. */
export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
