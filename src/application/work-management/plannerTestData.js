// FORGE Planner owner-only test data service.
// db-injected (a supabase-shaped `db` with `.rpc(name, args)`), mirroring
// hierarchy.js's convention. All three operations go through SECURITY
// DEFINER RPCs from migration 20261117130000, which prove the caller is
// the platform owner (auth.uid()::text = p_owner_id) inside the database.
// The service takes NO actor parameter: there is nothing caller-supplied
// that could forge an actor. The browser-supplied requestId is an
// idempotency key only (a fresh UUID per logical change).
//
// Error contract (plain words, non-disclosing): a non-owner, or a call
// naming a project/client that is not a test project/client, gets the
// same 404 as a missing row — never a 403 that would confirm test data
// exists. A real project/client named by the OWNER gets a 400 (the owner
// already sees their own real data, so the distinction is theirs).

const NOT_APPLIED_ERROR =
  "Test data is not set up yet — the planner test-data update has not been applied.";

function isMissingRpcError(error) {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = String(error.message || error || "");
  return message.includes("Could not find the function");
}

export function mapPlannerTestDataRpcError(error) {
  const message = String(error?.message || error || "");
  if (isMissingRpcError(error)) {
    return { ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR };
  }
  if (message.includes("FORGE_PLANNER_TEST_NOT_FOUND")) {
    return { ok: false, httpStatus: 404, error: "That test project or test client does not exist." };
  }
  if (message.includes("FORGE_PLANNER_TEST_NOT_A_TEST_PROJECT")) {
    return { ok: false, httpStatus: 400, error: "Choose a test project — that project is real data, not test data." };
  }
  if (message.includes("FORGE_PLANNER_TEST_REQUEST_ID_CONFLICT")) {
    return { ok: false, httpStatus: 409, error: "This request ID was already used for different test data — use a fresh request ID." };
  }
  if (message.includes("FORGE_PLANNER_TEST_DIGEST_MISMATCH")) {
    return { ok: false, httpStatus: 409, error: "The test data changed since the preview — preview again before deleting." };
  }
  if (message.includes("FORGE_PLANNER_TEST_CONFIRM_NAME_MISMATCH")) {
    return { ok: false, httpStatus: 409, error: "The typed name does not match the test client name." };
  }
  if (message.includes("FORGE_PLANNER_TEST_PURGE_BLOCKED")) {
    return { ok: false, httpStatus: 409, error: "This test client cannot be deleted yet — see the preview for what is blocking it." };
  }
  if (message.includes("FORGE_PLANNER_TEST_UNHANDLED_DEPENDENT")) {
    return { ok: false, httpStatus: 409, error: "Something else still points at this test data — the preview lists it." };
  }
  throw error;
}

function requireOwnerId(ownerId) {
  if (!ownerId || String(ownerId).trim() === "") {
    return { ok: false, httpStatus: 400, error: "A workspace owner id is required." };
  }
  return null;
}

function requireRequestId(requestId) {
  if (requestId === null || requestId === undefined || String(requestId).trim() === "") {
    return { ok: false, httpStatus: 400, error: "A request ID is required for this change." };
  }
  if (String(requestId).length > 128) {
    return { ok: false, httpStatus: 400, error: "Request ID must be 128 characters or fewer." };
  }
  return null;
}

async function callRpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) return mapPlannerTestDataRpcError(error);
  return { ok: true, data };
}

/** Load the six fictional sample packages / 31 steps into a test
 *  project. Idempotent: a repeat load with the same request id returns
 *  the stored result; a repeat with a new request id restores only
 *  missing samples and never overwrites edits. */
export async function loadPlannerTestSamples(db, { ownerId, projectId, requestId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  if (!projectId || String(projectId).trim() === "") {
    return { ok: false, httpStatus: 404, error: "That test project or test client does not exist." };
  }
  const result = await callRpc(db, "forge_planner_test_load_samples", {
    p_owner_id: ownerId,
    p_project_id: projectId,
    p_request_id: requestId,
  });
  if (!result.ok) return result;
  return { ok: true, load: result.data };
}

/** Preview a test-client purge: counts, blockers, and the digest the
 *  purge must be confirmed against. */
export async function previewPlannerTestPurge(db, { ownerId, clientId }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  if (!clientId || String(clientId).trim() === "") {
    return { ok: false, httpStatus: 404, error: "That test project or test client does not exist." };
  }
  const result = await callRpc(db, "forge_planner_test_purge_preview", {
    p_owner_id: ownerId,
    p_client_id: clientId,
  });
  if (!result.ok) return result;
  return { ok: true, preview: result.data };
}

/** Delete a test client and its sample packages, after a preview. The
 *  digest must match the preview's; the confirm name must equal the
 *  client name. Replaying an identical request returns the stored
 *  receipt. */
export async function purgePlannerTestData(db, { ownerId, clientId, digest, requestId, confirmName }) {
  const ownerError = requireOwnerId(ownerId);
  if (ownerError) return ownerError;
  const requestError = requireRequestId(requestId);
  if (requestError) return requestError;
  if (!clientId || String(clientId).trim() === "") {
    return { ok: false, httpStatus: 404, error: "That test project or test client does not exist." };
  }
  if (!digest || String(digest).trim() === "") {
    return { ok: false, httpStatus: 400, error: "Preview again before deleting — the preview is missing." };
  }
  if (!confirmName || String(confirmName).trim() === "") {
    return { ok: false, httpStatus: 400, error: "Type the test client name to confirm the delete." };
  }
  const result = await callRpc(db, "forge_planner_test_purge", {
    p_owner_id: ownerId,
    p_client_id: clientId,
    p_expected_digest: digest,
    p_request_id: requestId,
    p_confirm_name: confirmName,
  });
  if (!result.ok) return result;
  return { ok: true, purge: result.data };
}
