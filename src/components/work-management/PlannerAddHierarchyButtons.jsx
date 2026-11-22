// New client / New site / New project controls for the Planner's
// project-scope bar (/forge/work and every page under it). Until now
// these add flows existed only in Planner Admin
// (PlannerHierarchyManager.jsx -> /forge/work/admin); a planner had no
// way to add hierarchy records without leaving the page they were
// working in. Jason asked twice (Nov 15, Nov 19) why the planner page
// has no add button for them -- this closes that gap.
//
// Reuses PlannerHierarchyManager's exact create flow rather than
// reimplementing it: the same shared emptyDraft/validateDraft/
// buildCreateBody (hierarchyFormShared.js) and the same field markup
// (HierarchyRecordFields.jsx) Admin's own create form renders. Same
// server authority too -- POST /api/forge/hierarchy, the same route
// and RPCs Admin calls; this component invents no new write path.
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
import { buildCreateBody, emptyDraft, newRequestId, validateDraft } from "./hierarchyFormShared.js";
import HierarchyRecordFields from "./HierarchyRecordFields.jsx";

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

export default function PlannerAddHierarchyButtons({ onProjectCreated }) {
  const [canManage, setCanManage] = useState(false);
  const [clients, setClients] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [openEntity, setOpenEntity] = useState(null); // null | "client" | "site" | "project"
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadInventory() {
    try {
      const { response, data } = await callJson("/api/forge/hierarchy?includeArchived=true");
      if (!response.ok) return; // Fails closed: no buttons rather than a broken add flow.
      const inventory = data.inventory || { canManage: false, clients: [] };
      setCanManage(inventory.canManage === true);
      setClients((inventory.clients || []).filter((c) => !c.isTest));
      setLoaded(true);
    } catch {
      // A network/fetch failure also fails closed: no buttons, never an
      // unhandled rejection or a half-broken add flow.
    }
  }

  useEffect(() => {
    loadInventory();
  }, []);

  const allSites = clients.flatMap((client) =>
    (client.sites || [])
      .filter((site) => !site.isTest)
      .map((site) => ({ ...site, clientName: client.name, clientId: client.id })),
  );

  function parentOptions(entity) {
    if (entity === "site") {
      return clients.map((client) => ({ id: client.id, label: client.name }));
    }
    if (entity === "project") {
      return allSites.map((site) => ({ id: site.id, label: `${site.name} — ${site.clientName}` }));
    }
    return [];
  }

  function openCreateForm(entity, parentId) {
    setError("");
    setNotice("");
    setOpenEntity(entity);
    setDraft(emptyDraft(entity, parentId));
  }

  function closeForm() {
    setOpenEntity(null);
    setDraft(null);
    setError("");
  }

  function updateDraft(field, value) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  async function saveForm() {
    if (!draft || busy) return;
    const validation = validateDraft(openEntity, draft);
    if (validation) {
      setError(validation.message);
      return;
    }
    setBusy(true);
    setError("");
    const requestId = newRequestId();
    const body = buildCreateBody(openEntity, draft, { isTest: false, requestId });
    let result;
    try {
      result = await callJson("/api/forge/hierarchy", { method: "POST", body });
    } catch {
      setBusy(false);
      setError("Request failed.");
      return;
    }
    setBusy(false);
    const { response, data } = result;
    if (!response.ok) {
      setError(data.error || "Request failed.");
      return;
    }
    const saved = data.client || data.site || data.project || null;
    const savedEntity = openEntity;
    await loadInventory(); // Refresh clients/sites so the new record is a parent option right away.
    setNotice(`${saved?.name || draft.name} created.`);
    if (savedEntity === "project" && saved) {
      // The new project is the direct forgeProject target -- hand it to
      // the scope bar, which navigates the same way picking it from the
      // selector would (D4 part of this build: on create, the new
      // record is what the planner lands on).
      closeForm();
      onProjectCreated?.(saved.id);
      return;
    }
    if (savedEntity === "client" && saved) {
      // No forgeProject exists for a bare client yet; the natural next
      // step -- and what "the new record is selected" means here -- is
      // adding its first site, pre-filled to this client.
      openCreateForm("site", saved.id);
      return;
    }
    if (savedEntity === "site" && saved) {
      openCreateForm("project", saved.id);
      return;
    }
    closeForm();
  }

  if (!loaded || !canManage) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="planner-add-hierarchy-buttons">
      <button type="button" className={btnGhost} onClick={() => openCreateForm("client", "")}>
        New client
      </button>
      <button type="button" className={btnGhost} onClick={() => openCreateForm("site", "")}>
        New site
      </button>
      <button type="button" className={btnGhost} onClick={() => openCreateForm("project", "")}>
        New project
      </button>
      {openEntity && draft && (
        <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="planner-add-hierarchy-form">
          <h3 className="text-sm font-semibold text-slate-800">New {ENTITY_LABELS[openEntity]}</h3>
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}
          <div className="mt-3">
            <HierarchyRecordFields
              entity={openEntity}
              draft={draft}
              parents={parentOptions(openEntity)}
              onChange={updateDraft}
              idPrefix="planner-add-hierarchy-form"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={saveForm}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className={btnGhost} disabled={busy} onClick={closeForm}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && !openEntity && (
        <p role="status" className="w-full text-sm text-slate-700">{notice}</p>
      )}
    </div>
  );
}
