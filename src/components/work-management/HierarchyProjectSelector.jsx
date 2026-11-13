// PR B: the shared Client -> Site -> Project selector for the Planner
// vertical (the hierarchy tree comes from GET /api/forge/hierarchy,
// which returns only non-archived rows — an archived project can never
// be picked here, and the server revalidates the pick on every load).
//
// Cascading: picking a client resets the site and project (an atomic
// reset — a stale site from another client can never ride along);
// picking a site resets the project. The site select stays disabled
// until a client is chosen, the project select until a site is chosen.
// `onSelect` fires only for a complete pick: a project id, "unassigned"
// (the Unassigned packages inbox), or "" when the selection is cleared.
// The current value's chain is pre-selected from the tree once it loads.
//
// Two uses: the Planner layout (navigate mode — the parent navigates on
// select) and the package assignment block (pick mode — the parent holds
// the picked value until the user confirms the save).
"use client";

import { useEffect, useMemo, useState } from "react";
import { withWorkspaceQuery } from "./workspaceQuery.js";

export const UNASSIGNED_VALUE = "unassigned";

function findChain(selector, projectId) {
  for (const client of selector?.clients || []) {
    for (const site of client.sites || []) {
      for (const project of site.projects || []) {
        if (project.id === projectId) return { client, site, project };
      }
    }
  }
  return null;
}

export default function HierarchyProjectSelector({
  value = "",
  onSelect,
  includeUnassigned = true,
  disabled = false,
  idPrefix = "forge-project",
}) {
  const [selector, setSelector] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [clientId, setClientId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(withWorkspaceQuery("/api/forge/hierarchy"))
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not load the project list.");
        return body.selector;
      })
      .then((loaded) => { if (!cancelled) setSelector(loaded); })
      .catch((caught) => { if (!cancelled) setLoadError(caught?.message || "Could not load the project list."); });
    return () => { cancelled = true; };
  }, []);

  // Pre-select the chain for the current value once the tree loads.
  // A value the tree does not contain (deleted/archived since the page
  // loaded) leaves the selects empty — never a silent substitute.
  // Adjusted during render (React's derived-state-from-props pattern):
  // the tree and the value are the only inputs, so a user pick — which
  // changes neither — is never clobbered by this sync.
  const [prevValue, setPrevValue] = useState(value);
  const [prevSelector, setPrevSelector] = useState(null);
  if (prevValue !== value || prevSelector !== selector) {
    setPrevValue(value);
    setPrevSelector(selector);
    if (selector) {
      const chain = value && value !== UNASSIGNED_VALUE ? findChain(selector, value) : null;
      setClientId(chain ? chain.client.id : "");
      setSiteId(chain ? chain.site.id : "");
      setProjectId(chain ? chain.project.id : "");
    }
  }

  const clients = useMemo(() => selector?.clients ?? [], [selector]);
  const client = useMemo(
    () => clients.find((entry) => entry.id === clientId) || null,
    [clients, clientId],
  );
  const sites = useMemo(() => client?.sites ?? [], [client]);
  const site = useMemo(
    () => sites.find((entry) => entry.id === siteId) || null,
    [sites, siteId],
  );
  const projects = site?.projects ?? [];
  const hasProjects = clients.some((entry) =>
    (entry.sites || []).some((entrySite) => (entrySite.projects || []).length > 0),
  );

  function pickClient(nextClientId) {
    // Atomic reset: a new client clears the site and project together.
    setClientId(nextClientId);
    setSiteId("");
    setProjectId("");
  }

  function pickSite(nextSiteId) {
    setSiteId(nextSiteId);
    setProjectId("");
  }

  function pickProject(nextProjectId) {
    setProjectId(nextProjectId);
    if (!nextProjectId) {
      onSelect?.("", null);
      return;
    }
    const chain = findChain(selector, nextProjectId);
    onSelect?.(nextProjectId, chain);
  }

  function pickUnassigned() {
    setClientId("");
    setSiteId("");
    setProjectId("");
    onSelect?.(UNASSIGNED_VALUE, null);
  }

  const selectClass =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="hierarchy-project-selector">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor={`${idPrefix}-client`}>
          Client
        </label>
        <select
          id={`${idPrefix}-client`}
          value={clientId}
          disabled={disabled || !selector || loadError !== ""}
          onChange={(event) => pickClient(event.target.value)}
          className={selectClass}
        >
          <option value="">{selector ? "Choose a client…" : "Loading projects…"}</option>
          {clients.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor={`${idPrefix}-site`}>
          Site
        </label>
        <select
          id={`${idPrefix}-site`}
          value={siteId}
          disabled={disabled || !client}
          onChange={(event) => pickSite(event.target.value)}
          className={selectClass}
        >
          <option value="">Choose a site…</option>
          {sites.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-300" htmlFor={`${idPrefix}-project`}>
          Project
        </label>
        <select
          id={`${idPrefix}-project`}
          value={projectId}
          disabled={disabled || !site}
          onChange={(event) => pickProject(event.target.value)}
          className={selectClass}
        >
          <option value="">Choose a project…</option>
          {projects.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.projectCode ? `${entry.name} (${entry.projectCode})` : entry.name}
            </option>
          ))}
        </select>
      </div>
      {includeUnassigned && (
        <button
          type="button"
          onClick={pickUnassigned}
          disabled={disabled || !selector || loadError !== ""}
          aria-pressed={value === UNASSIGNED_VALUE}
          className={
            value === UNASSIGNED_VALUE
              ? "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              : "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          }
        >
          Unassigned packages
        </button>
      )}
      {loadError && (
        <p role="alert" className="w-full text-sm text-red-700">{loadError}</p>
      )}
      {!loadError && selector && !hasProjects && (
        <p className="w-full text-sm text-slate-500">
          No projects yet — add a client, a site, and a project before assigning packages to one.
        </p>
      )}
    </div>
  );
}
