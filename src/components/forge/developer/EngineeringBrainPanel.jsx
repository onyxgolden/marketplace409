"use client";
import { useCallback, useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const SOURCE_TYPES = [
  "application_source_file", "application_source_symbol", "api_route_file", "api_route_symbol",
  "test_file", "sql_table", "sql_rls_policy", "sql_trigger", "sql_rpc_function", "sql_migration_file",
  "synchronized_document_section", "governance_state", "validation_evidence", "historical_snapshot",
  "reviewed_decision", "package_manifest_file", "dependency_version",
];

const AUTHORITY_LEVELS = [
  "current", "validation_evidence", "governance_state", "synchronized_document",
  "reviewed_decision", "historical_snapshot",
];

const CONFIDENCE_CLASS = {
  high: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  medium: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200",
  low: "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300",
  unverifiable: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
};

function shortSha(sha) {
  return sha ? sha.slice(0, 12) : "";
}

export default function EngineeringBrainPanel() {
  const [queryText, setQueryText] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [authorityLevel, setAuthorityLevel] = useState("");
  const [response, setResponse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const search = useCallback(() => {
    const params = new URLSearchParams();
    if (queryText) params.set("q", queryText);
    if (sourceType) params.set("sourceType", sourceType);
    if (authorityLevel) params.set("authorityLevel", authorityLevel);
    return fetch(`/api/forge/engineering-brain/query?${params.toString()}`)
      .then((res) => res.json().then((payload) => ({ res, payload })))
      .then(({ res, payload }) => {
        if (!res.ok) throw new Error(payload.error || "Unable to query the engineering brain.");
        setResponse(payload);
      })
      .catch((searchError) => setError(searchError.message))
      .finally(() => setLoading(false));
  }, [queryText, sourceType, authorityLevel]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    search();
  }

  return (
    <main data-engineering-brain-panel className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 dark:bg-slate-950 dark:text-slate-100 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400">
            Private Programmer Tools
          </div>
          <h1 className="mt-2 text-2xl font-black">FORGE Engineering Brain</h1>
          <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-400">
            Deterministic search over the repository&apos;s own indexed source, migrations, tests, and governance
            documents. Results are citations (path, symbol, authority, commit, hash) ranked by authority and match
            strength -- never a fabricated answer. This view does not show inline content excerpts (that requires
            local git access this deployed app doesn&apos;t have); follow the path to read the source itself.
          </p>
          {response?.latestRun ? (
            <p className="mt-3 text-xs font-bold text-slate-500 dark:text-slate-400">
              Indexed at commit {shortSha(response.latestRun.commitSha)}, generated {new Date(response.latestRun.generatedAt).toLocaleString()}.
            </p>
          ) : null}
        </header>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Search</span>
            <input
              type="text"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="e.g. has_workspace_access, invite_workspace_member, tenant isolation"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <label>
            <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Source type</span>
            <select
              value={sourceType}
              onChange={(event) => setSourceType(event.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
            >
              <option value="">Any</option>
              {SOURCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Authority</span>
            <select
              value={authorityLevel}
              onChange={(event) => setAuthorityLevel(event.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
            >
              <option value="">Any</option>
              {AUTHORITY_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <button type="submit" disabled={loading} className={`rounded-lg px-5 py-2 text-sm font-black transition ${goldControlClassName}`}>
            Search
          </button>
        </form>

        {loading ? <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Searching…</p> : null}
        {error ? <p role="alert" className="mt-4 text-sm font-bold text-red-700 dark:text-red-400">{error}</p> : null}

        {!loading && response?.insufficient_evidence ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Insufficient evidence: {response.reason}
          </p>
        ) : null}

        {!loading && response?.conflicts?.length > 0 ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
            <p className="font-black">{response.conflicts.length} unresolved conflict(s) across authority tiers:</p>
            {response.conflicts.map((conflict) => (
              <p key={conflict.subject} className="mt-1">
                &quot;{conflict.subject}&quot;: {conflict.winner.authority_level} ({conflict.winner.source_path}) outranks{" "}
                {conflict.outranked.map((o) => `${o.authority_level} (${o.source_path})`).join(", ")}
              </p>
            ))}
          </div>
        ) : null}

        {!loading && response?.results?.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-3">
            {response.results.map((result) => (
              <li key={`${result.source_path}#${result.symbol_or_section}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-bold text-slate-950 dark:text-white">
                      {result.source_path}{result.symbol_or_section ? ` :: ${result.symbol_or_section}` : ""}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {result.source_type} · authority={result.authority_level} · freshness={result.freshness}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-black ${CONFIDENCE_CLASS[result.confidence] || CONFIDENCE_CLASS.low}`}>
                    {result.confidence}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs text-slate-400 dark:text-slate-500">
                  commit {shortSha(result.commit_sha)} · hash {shortSha(result.content_hash)}
                  {result.version ? ` · v${result.version}` : ""}
                </p>
                {result.unresolved_conflict ? (
                  <p className="mt-2 text-xs font-bold text-rose-700 dark:text-rose-400">
                    ⚠ unresolved conflict ({result.unresolved_conflict.outranked_by_or_outranks})
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  );
}
