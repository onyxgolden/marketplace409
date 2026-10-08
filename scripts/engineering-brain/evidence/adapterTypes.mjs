// Evidence adapter types (Slice 2) — read-only, fail-closed.
//
// Each adapter is an async function `(spec, deps, now) => result` where
// result is ALWAYS `{ ok: true, evidence }` or `{ ok: false, error }`.
// Adapters never throw, never return partial data as success, and never
// write: the Supabase adapter issues only `.select()`, the GitHub adapter
// only GET requests. I/O is injected through `deps` so tests run against
// fakes with no network.
//
// `now` is an injected epoch-ms timestamp (not read from the clock) so
// window arithmetic is deterministic in tests.

/**
 * Supabase table evidence: the latest row's time and the EXACT row count
 * inside the window, for one table + time column.
 *
 * spec: { table, timeColumn, windowHours, idColumn? }
 * deps: { supabase: { from(table): { select(cols, opts): { gte, order, limit } } } }
 *   — the fake/real client must support only the select chain used here.
 *
 * Two queries: a head-only exact count (no row cap — a capped count
 * reported as exact was the Slice 2 review finding) and the latest row.
 * The two must agree (count 0 <=> no latest row); disagreement fails
 * closed rather than reporting a half-truth.
 */
export async function fetchSupabaseTableEvidence(spec, deps, now) {
  const fail = (error) => ({ ok: false, error });
  try {
    if (!deps || !deps.supabase || typeof deps.supabase.from !== "function") {
      return fail("supabase client not provided");
    }
    const { table, timeColumn, windowHours } = spec;
    if (!table || !timeColumn || !Number.isFinite(windowHours) || windowHours <= 0) {
      return fail("spec needs table, timeColumn, and a positive windowHours");
    }
    const windowStart = new Date(now - windowHours * 3600 * 1000).toISOString();
    // Select exactly the columns needed: a renamed/missing column fails
    // loudly here (ok:false) instead of silently returning empty evidence.
    const idColumn = spec.idColumn || "id";
    const client = deps.supabase.from(table);

    const badShape = (which, detail) =>
      fail(`supabase ${which} query on ${table} returned a malformed response (${detail})`);

    // Query 1: exact count, head-only — no rows travel, no cap applies.
    const countRes = await client
      .select(idColumn, { count: "exact", head: true })
      .gte(timeColumn, windowStart);
    if (!countRes || typeof countRes !== "object" || Array.isArray(countRes)) {
      return badShape("count", "not an object");
    }
    if (countRes.error) {
      return fail(`supabase count query failed on ${table}: ${countRes.error.message || countRes.error}`);
    }
    if (!Number.isInteger(countRes.count)) {
      return badShape("count", "count is not an integer");
    }

    // Query 2: latest row in the window.
    const latestRes = await client
      .select(`${idColumn},${timeColumn}`)
      .gte(timeColumn, windowStart)
      .order(timeColumn, { ascending: false })
      .limit(1);
    if (!latestRes || typeof latestRes !== "object" || Array.isArray(latestRes)) {
      return badShape("latest-row", "not an object");
    }
    if (latestRes.error) {
      return fail(`supabase latest-row query failed on ${table}: ${latestRes.error.message || latestRes.error}`);
    }
    if (!Array.isArray(latestRes.data)) {
      // The Slice 2 review finding: non-array data must fail, never
      // silently become "zero rows".
      return badShape("latest-row", "data is not an array");
    }
    let latestAt = null;
    if (latestRes.data.length > 0) {
      const row = latestRes.data[0];
      if (!row || typeof row !== "object" || typeof row[timeColumn] !== "string") {
        return badShape("latest-row", `row is missing a usable "${timeColumn}"`);
      }
      latestAt = row[timeColumn];
    }

    // The two queries must agree; a race or a lying client fails closed.
    if ((countRes.count === 0) !== (latestAt === null)) {
      return fail(
        `supabase evidence on ${table} is inconsistent: count=${countRes.count} but latestAt=${latestAt}`
      );
    }

    return {
      ok: true,
      evidence: {
        source: `supabase:${table}`,
        table,
        timeColumn,
        windowHours,
        rowCount: countRes.count,
        latestAt,
        // latestAt null with rowCount 0 means "no evidence in window" —
        // a finding for Slice 3, not an adapter failure.
      },
    };
  } catch (e) {
    return fail(`supabase adapter threw: ${e && e.message ? e.message : String(e)}`);
  }
}

/**
 * GitHub Actions evidence: the latest run of one workflow file.
 *
 * spec: { workflowFile }  (e.g. "rental-cron-sweeps.yml")
 * deps: { githubApi: { listWorkflowRuns(owner, repo, workflowFile): Promise<runs[]> } }
 *   runs[]: [{ conclusion, status, startedAt, htmlUrl }]
 */
export async function fetchGithubActionsEvidence(spec, deps, now) {
  const fail = (error) => ({ ok: false, error });
  try {
    if (!deps || !deps.githubApi || typeof deps.githubApi.listWorkflowRuns !== "function") {
      return fail("github api client not provided");
    }
    if (!spec.workflowFile) {
      return fail("spec needs workflowFile");
    }
    const runs = await deps.githubApi.listWorkflowRuns(spec.workflowFile);
    if (!Array.isArray(runs)) {
      return fail("github api returned a non-array run list");
    }
    if (runs.length === 0) {
      return { ok: true, evidence: { source: `github-actions:${spec.workflowFile}`, runCount: 0, latest: null } };
    }
    const latest = runs[0];
    for (const f of ["conclusion", "status", "startedAt"]) {
      if (latest[f] === undefined) {
        return fail(`latest run is missing field "${f}"`);
      }
    }
    return {
      ok: true,
      evidence: {
        source: `github-actions:${spec.workflowFile}`,
        runCount: runs.length,
        latest: {
          conclusion: latest.conclusion,
          status: latest.status,
          startedAt: latest.startedAt,
          url: latest.htmlUrl || null,
        },
      },
    };
  } catch (e) {
    return fail(`github adapter threw: ${e && e.message ? e.message : String(e)}`);
  }
}

/** Dispatch table: adapter type -> implementation. Unknown types fail closed. */
export const ADAPTER_TYPES = Object.freeze({
  "supabase-table": fetchSupabaseTableEvidence,
  "github-actions": fetchGithubActionsEvidence,
});
