// New client / New site / New project controls for the Planner's
// project-scope bar (/forge/work and every page under it). Until now
// these add flows existed only in Planner Admin
// (PlannerHierarchyManager.jsx -> /forge/work/admin); a planner had no
// way to add hierarchy records without leaving the page they were
// working in. Jason asked twice (Nov 15, Nov 19) why the planner page
// has no add button for them -- this closes that gap.
//
// PR #848 review (2026-11-21, NEEDS CHANGES) found that sharing field
// markup and body-building helpers was not the same as reusing
// PlannerHierarchyManager's exact create flow: this component used to
// independently implement save/open/close/notice/busy/error handling.
// It now calls the SAME useHierarchyRecordForm hook Admin's create mode
// uses -- one real create-flow implementation, not two.
//
// canManage gating matches Admin exactly (same rule, no new
// permission model): read from the admin inventory's server-proven
// canManage flag (forge_hierarchy_admin_inventory ->
// forge.hierarchy.manage, owner/staff only). A user without it sees
// nothing here, same as Admin shows them nothing new.
//
// "New test client" is deliberately NOT offered here -- that stays
// Admin-only (owner-only test data never surfaces on the main planner
// page).
"use client";

import { useEffect, useState } from "react";
import { withWorkspaceQuery } from "./workspaceQuery.js";
import HierarchyRecordFields from "./HierarchyRecordFields.jsx";
import { useHierarchyRecordForm } from "./useHierarchyRecordForm.js";

const btnPrimary = "rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 min-h-11 sm:min-h-0";
const btnGhost = "rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 min-h-11 sm:min-h-0";

const ENTITY_LABELS = { client: "client", site: "site", project: "project" };

async function callJson(path, { method = "GET", body } = {}) {
  const response = await fetch(withWorkspaceQuery(path), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

/** onCreated(entity, savedRecord): fired after every successful create so
 *  the scope bar can preselect a just-created client/site (no project yet
 *  to navigate to) in the shared Client/Site/Project selector.
 *  onProjectCreated(projectId): fired after a project create, for the
 *  scope bar's existing navigation (same as picking it from the selector). */
export default function PlannerAddHierarchyButtons({ onCreated, onProjectCreated }) {
  const [canManage, setCanManage] = useState(false);
  const [clients, setClients] = useState([]);
  // "loading" | "ready" | "error" -- a load failure must stay visible
  // and offer a retry, never collapse to the same silent nothing an
  // unproven canManage renders (PR #848 review, P2).
  const [status, setStatus] = useState("loading");
  const [loadError, setLoadError] = useState("");
  // Section-level notice, outside the create-flow hook's own formNotice:
  // the hook's openCreateForm clears formNotice on every open (Admin's
  // existing, correct behavior for its own form), so advancing straight
  // from "client created" into the New site form would otherwise erase
  // the confirmation before anyone could read it (PR #848 review, P1).
  // This notice is untouched by the hook's open/close and survives the
  // advance, clearing only on the next save or the next explicit open.
  const [notice, setNotice] = useState("");

  async function loadInventory() {
    try {
      const { response, data } = await callJson("/api/forge/hierarchy?includeArchived=true");
      if (!response.ok) {
        setStatus("error");
        setLoadError(data.error || "Unable to load clients, sites, and projects.");
        return null;
      }
      const inventory = data.inventory || { canManage: false, clients: [] };
      setCanManage(inventory.canManage === true);
      setClients((inventory.clients || []).filter((c) => !c.isTest));
      setStatus("ready");
      return inventory;
    } catch {
      setStatus("error");
      setLoadError("Unable to load clients, sites, and projects.");
      return null;
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  function handleSaved(mode, entity, saved) {
    if (!saved) return;
    setNotice(`${saved.name} created.`);
    onCreated?.(entity, saved);
    if (entity === "project") {
      closeForm();
      onProjectCreated?.(saved.id);
      return;
    }
    // No forgeProject exists yet for a bare client or site; the natural
    // next step is adding its first site (or first project), pre-filled
    // to the record just created.
    const nextEntity = entity === "client" ? "site" : "project";
    openCreateForm(nextEntity, saved.id);
  }

  const { openForm, formError, busy, openCreateForm, closeForm, updateDraft, saveForm } = useHierarchyRecordForm({
    reload: loadInventory,
    onSaved: handleSaved,
  });

  const allSites = clients.flatMap((client) =>
    (client.sites || [])
      .filter((site) => !site.isTest)
      .map((site) => ({ ...site, clientName: client.name, clientId: client.id })),
  );

  function parentOptions(entity) {
    if (entity === "site") return clients.map((client) => ({ id: client.id, label: client.name }));
    if (entity === "project") return allSites.map((site) => ({ id: site.id, label: `${site.name} — ${site.clientName}` }));
    return [];
  }

  function startCreate(entity) {
    setNotice("");
    openCreateForm(entity, "");
  }

  if (status === "loading") return null;

  if (status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-red-700" data-testid="planner-add-hierarchy-error">
        <span role="alert">{loadError}</span>
        <button type="button" className={btnGhost} onClick={loadInventory}>Try again</button>
      </div>
    );
  }

  if (!canManage) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="planner-add-hierarchy-buttons">
      <button type="button" className={btnGhost} onClick={() => startCreate("client")}>
        New client
      </button>
      <button type="button" className={btnGhost} onClick={() => startCreate("site")}>
        New site
      </button>
      <button type="button" className={btnGhost} onClick={() => startCreate("project")}>
        New project
      </button>
      {openForm && (
        <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="planner-add-hierarchy-form">
          <h3 className="text-sm font-semibold text-slate-800">New {ENTITY_LABELS[openForm.entity]}</h3>
          {formError && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>
          )}
          <div className="mt-3">
            <HierarchyRecordFields
              entity={openForm.entity}
              draft={openForm.draft}
              parents={parentOptions(openForm.entity)}
              onChange={updateDraft}
              idPrefix="planner-add-hierarchy-form"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={saveForm}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={() => { closeForm(); setNotice(""); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className="w-full text-sm text-slate-700">{notice}</p>
      )}
    </div>
  );
}
