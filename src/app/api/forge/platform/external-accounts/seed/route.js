// External Accounts Register — idempotent seed.
//
// POST /api/forge/platform/external-accounts/seed
//   { action: "preview" } → what a seed run would do, no writes.
//   { action: "apply", request_id } → insert missing candidates only.
//     NEVER overwrites an owner-edited row (the RPC inserts creates
//     only). Threads ride along: the seed's 9 threads are added for
//     accounts that exist and lack a thread with that title, so a
//     rerun is a no-op.
//
// The candidate set comes from the server-side seed module, never
// from the request body — a caller cannot inject arbitrary rows.
// Owner-authorized operation only; never automatic on page load or
// deploy.
import { NextResponse } from "next/server";
import {
  EXTERNAL_ACCOUNT_SEED_VERSION,
  buildSeedCandidates,
  buildSeedThreads,
} from "@/domains/externalAccounts/externalAccountSeed";
import {
  readJsonBody,
  registerErrorResponse,
  requireRegisterHousehold,
} from "../_lib/registerRoute";

export async function POST(request) {
  const { authenticated, response } = await requireRegisterHousehold();
  if (response) return response;

  const body = await readJsonBody(request);
  const action = body.action;
  if (action !== "preview" && action !== "apply") {
    return NextResponse.json(
      { error: "Choose preview or apply." },
      { status: 400 },
    );
  }
  if (action === "apply" && !body.request_id) {
    return NextResponse.json(
      { error: "A request id is required. Try again." },
      { status: 400 },
    );
  }

  const candidates = buildSeedCandidates();

  if (action === "preview") {
    const { data, error } = await authenticated.supabaseClient.rpc(
      "forge_external_accounts_seed_preview",
      { p_seed_version: EXTERNAL_ACCOUNT_SEED_VERSION, p_candidates: candidates },
    );
    if (error) return registerErrorResponse(error);
    return NextResponse.json({ ok: true, preview: data }, { status: 200 });
  }

  const { data, error } = await authenticated.supabaseClient.rpc(
    "forge_external_accounts_seed_apply",
    {
      p_seed_version: EXTERNAL_ACCOUNT_SEED_VERSION,
      p_candidates: candidates,
      p_request_id: body.request_id,
    },
  );
  if (error) return registerErrorResponse(error);

  // Seed threads, idempotently by title: only for accounts that exist
  // now, only where no thread with that title exists yet.
  const threads = buildSeedThreads();
  let threadsAdded = 0;
  if (threads.length > 0) {
    const { data: accounts, error: accountsError } = await authenticated.supabaseClient
      .from("forge_external_accounts")
      .select("id,seed_key")
      .eq("platform_owner_id", authenticated.effectiveOwnerId)
      .is("deleted_at", null);
    if (accountsError) return registerErrorResponse(accountsError);
    const bySeedKey = new Map((accounts ?? []).map((a) => [a.seed_key, a.id]));
    for (const thread of threads) {
      const accountId = bySeedKey.get(thread.account_seed_key);
      if (!accountId) continue;
      const { data: existing, error: existingError } = await authenticated.supabaseClient
        .from("forge_external_account_threads")
        .select("id")
        .eq("account_id", accountId)
        .eq("title", thread.title)
        .limit(1);
      if (existingError) return registerErrorResponse(existingError);
      if ((existing ?? []).length > 0) continue;
      const { error: addError } = await authenticated.supabaseClient.rpc(
        "forge_external_account_thread_add",
        {
          p_account_id: accountId,
          p_payload: {
            title: thread.title,
            reference: thread.reference,
            state: thread.state,
            next_action: thread.next_action,
            owner: thread.owner,
            next_review_on: thread.next_review_on,
          },
        },
      );
      if (addError) return registerErrorResponse(addError);
      threadsAdded += 1;
    }
  }

  return NextResponse.json(
    {
      ok: true,
      message: `Seed applied: ${data?.created ?? 0} accounts added, ${threadsAdded} threads added. Existing rows were left untouched.`,
      created: data?.created ?? 0,
      threads_added: threadsAdded,
    },
    { status: 200 },
  );
}
