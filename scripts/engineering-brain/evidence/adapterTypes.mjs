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
 * Supabase table evidence: the latest row's time and the row count inside
 * the window, for one table + time column.
 *
 * spec: { table, timeColumn, windowHours, idColumn? }
 * deps: { supabase: { from(table): { select(cols): { gte, order, limit } } } }
 *   — the fake/real client must support only the select chain used here.
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
    const res = await deps.supabase
      .from(table)
      .select(`${idColumn},${timeColumn}`)
      .gte(timeColumn, windowStart)
      .order(timeColumn, { ascending: false })
      .limit(1000);
    if (res.error) {
      return fail(`supabase query failed on ${table}: ${res.error.message || res.error}`);
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    const latestAt = rows.length > 0 ? rows[0][timeColumn] || null : null;
    return {
      ok: true,
      evidence: {
        source: `supabase:${table}`,
        table,
        timeColumn,
        windowHours,
        rowCount: rows.length,
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
