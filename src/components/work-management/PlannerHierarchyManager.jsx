// Planner hierarchy management page (Clients / Sites / Projects).
// Brief: planner-hierarchy-management-page-build-brief-2026-11-15
// (drop b11bfe82; Jason approved the read extension + full CRUD
// Nov 15 13:37 CST).
//
// The manager reads the full inventory from GET
// /api/forge/hierarchy?includeArchived=true — every record in any
// status, with complete identity fields and optimistic-concurrency
// versions, plus a server-proven canManage flag — and writes through
// the existing POST/PATCH/DELETE route. The server and its SECURITY
// DEFINER RPCs remain the authority on every call: this component
// only decides what to show and what to send.
//
// Standing rules honored here: every save confirms in plain words
// beside the Save action (names, not raw IDs), including truthful
// no-change saves; archive first, hard-delete only after an explicit
// second confirmation; never cascade, never silently reassign; all
// secondary panels start closed; no dead-end pages (direct links back
// to Planner, Unassigned packages, and Planner Admin).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CLIENT_STATUSES,
  PROJECT_STATUSES,
  SITE_STATUSES,
  SITE_TYPES,
  validateClientInput,
  validateProjectInput,
  validateSiteInput,
} from "@/domains/forge-shared-hierarchy/hierarchy.js";
import { withWorkspaceQuery } from "./workspaceQuery.js";

const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;
const btnDanger = `${btn} bg-red-600 text-white hover:bg-red-500`;
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";
const label = "block text-xs font-medium text-slate-600 mb-1";

const STATUS_LABELS = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
  planned: "Planned",
  on_hold: "On hold",
  complete: "Complete",
};

const ENTITY_LABELS = { client: "client", site: "site", project: "project" };

// Brief §5: the sentence shown when the server blocks a hard delete
// because the record still has items under it. The 409 from the
// server is the authority — the sentence only explains it in the
// brief's words, keyed by the entity being deleted.
const DELETE_BLOCK_MESSAGE = {
  client: "Remove or move the sites first.",
  site: "Remove or move the projects first.",
  project: "Unassign or explicitly move packages first.",
};

function newRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

function blank(value) {
  return value === null || value === undefined ? "" : String(value);
}

function sameText(a, b) {
  return blank(a).trim() === blank(b).trim();
}

async function callJson(path, { method = "GET", body } = {}) {
  const response = await fetch(withWorkspaceQuery(path), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function emptyDraft(entity, parentId) {
  if (entity === "client") {
    return { name: "", externalReference: "", notes: "", status: "active" };
  }
  if (entity === "site") {
    return {
      parentId: parentId || "",
      name: "",
      siteType: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      region: "",
      postalCode: "",
      countryCode: "",
      status: "active",
    };
  }
  return {
    parentId: parentId || "",
    name: "",
    projectCode: "",
    description: "",
    projectType: "",
    plannedStart: "",
    plannedFinish: "",
    status: "planned",
  };
}

function draftFromRecord(entity, record) {
  if (entity === "client") {
    return {
      name: blank(record.name),
      externalReference: blank(record.externalReference),
      notes: blank(record.notes),
      status: record.status,
    };
  }
  if (entity === "site") {
    return {
      parentId: blank(record.clientId),
      name: blank(record.name),
      siteType: blank(record.siteType),
      addressLine1: blank(record.addressLine1),
      addressLine2: blank(record.addressLine2),
      city: blank(record.city),
      region: blank(record.region),
      postalCode: blank(record.postalCode),
      countryCode: blank(record.countryCode),
      status: record.status,
    };
  }
  return {
    parentId: blank(record.siteId),
    name: blank(record.name),
    projectCode: blank(record.projectCode),
    description: blank(record.description),
    projectType: blank(record.projectType),
    plannedStart: blank(record.plannedStart),
    plannedFinish: blank(record.plannedFinish),
    status: record.status,
  };
}

/** True when the draft matches the record on every field — a save
 *  with no changes writes nothing and confirms truthfully instead. */
/** True when the draft matches the record on every field — a save
 *  with no changes writes nothing and confirms truthfully instead. */
function draftIsUnchanged(entity, draft, record) {
  if (!record) return false;
  const fields =
    entity === "client"
      ? ["name", "externalReference", "notes", "status"]
      : entity === "site"
        ? ["name", "siteType", "addressLine1", "addressLine2", "city", "region", "postalCode", "countryCode", "status"]
        : ["name", "projectCode", "description", "projectType", "plannedStart", "plannedFinish", "status"];
  const recordFields = draftFromRecord(entity, record);
  if (!fields.every((field) => sameText(draft[field], recordFields[field]))) return false;
  if (entity === "site") return draft.parentId === blank(record.clientId);
  if (entity === "project") return draft.parentId === blank(record.siteId);
  return true;
}

function validateDraft(entity, draft) {
  if (entity === "client") return validateClientInput(draft);
  if (entity === "site") return validateSiteInput(draft);
  return validateProjectInput(draft);
}

export default function PlannerHierarchyManager() {
  const [inventory, setInventory] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // openForm: null | { mode: "create"|"edit", entity, id, version,
  //   parentId, draft, record } — every form starts closed.
  const [openForm, setOpenForm] = useState(null);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [staleInfo, setStaleInfo] = useState(null);
  const [sectionNotice, setSectionNotice] = useState("");
  const [sectionError, setSectionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null); // { title, body, onConfirm }
  const confirmTriggerRef = useRef(null);

  async function loadInventory(silent) {
    if (!silent) {
      setLoading(true);
      setLoadError("");
    }
    let result;
    try {
      result = await callJson("/api/forge/hierarchy?includeArchived=true");
    } catch {
      if (!silent) {
        setLoading(false);
        setLoadError("Unable to load clients, sites, and projects.");
      }
      return null;
    }
    const { response, data } = result;
    if (!silent) setLoading(false);
    if (!response.ok) {
      setLoadError(data.error || "Unable to load clients, sites, and projects.");
      return null;
    }
    const loaded = data.inventory || { ownerId: null, canManage: false, clients: [] };
    // Clone: a fetch layer that hands back the same object reference
    // (cache, mock) must not leave the memoized tree reading stale
    // spread copies — every reload stores a fresh object graph.
    setInventory(structuredClone(loaded));
    setCanManage(loaded.canManage === true);
    return loaded;
  }

  // Load on mount. setState runs inside the fetch callback, not
  // synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    callJson("/api/forge/hierarchy?includeArchived=true")
      .then(({ response, data }) => {
        if (cancelled) return;
        setLoading(false);
        if (!response.ok) {
          setLoadError(data.error || "Unable to load clients, sites, and projects.");
          return;
        }
        const loaded = data.inventory || { ownerId: null, canManage: false, clients: [] };
        setInventory(structuredClone(loaded));
        setCanManage(loaded.canManage === true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setLoadError("Unable to load clients, sites, and projects.");
      });
    return () => { cancelled = true; };
  }, []);

  // Escape closes the confirm dialog (never mid-request); focus returns
  // to whatever triggered it — the PlannerAdminClient convention.
  useEffect(() => {
    if (!confirm) return undefined;
    const trigger = confirmTriggerRef.current;
    function onKeyDown(event) {
      if (event.key === "Escape" && !busy) closeConfirm();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [confirm, busy]);

  function closeConfirm() {
    setConfirm(null);
  }

  function askConfirm({ title, body, onConfirm }, triggerEl) {
    confirmTriggerRef.current = triggerEl || null;
    setConfirm({ title, body, onConfirm });
  }

  const allClients = useMemo(() => inventory?.clients ?? [], [inventory]);

  const allSites = useMemo(
    () => allClients.flatMap((client) => (client.sites ?? []).map((site) => ({ ...site, clientName: client.name, clientId: client.id }))),
    [allClients],
  );

  const counts = useMemo(() => {
    let sites = 0;
    let projects = 0;
    for (const client of allClients) {
      for (const site of client.sites ?? []) {
        sites += 1;
        projects += (site.projects ?? []).length;
      }
    }
    return { clients: allClients.length, sites, projects };
  }, [allClients]);

  function findRecord(entity, id) {
    for (const client of allClients) {
      if (entity === "client" && client.id === id) return { record: client, parent: null };
      for (const site of client.sites ?? []) {
        if (entity === "site" && site.id === id) return { record: site, parent: client };
        for (const project of site.projects ?? []) {
          if (entity === "project" && project.id === id) return { record: project, parent: site };
        }
      }
    }
    return { record: null, parent: null };
  }

  // --- Filtering -------------------------------------------------------
  // A row matches when its own name/code/status matches, or any
  // descendant does — a matching project keeps its site and client
  // visible. The row holding the open form is always kept, so a
  // search can never unmount the form being edited.
  const openFormId = openForm?.id || null;
  const visibleClients = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const statusOk = (status) => statusFilter === "all" || status === statusFilter;
    function projectMatches(project) {
      if (project.id === openFormId) return true;
      if (!statusOk(project.status)) return false;
      if (!query) return true;
      return (
        project.name.toLowerCase().includes(query) ||
        (project.projectCode || "").toLowerCase().includes(query) ||
        statusLabel(project.status).toLowerCase().includes(query)
      );
    }
    function siteMatches(site) {
      if (site.id === openFormId) return true;
      const self =
        statusOk(site.status) &&
        (!query ||
          site.name.toLowerCase().includes(query) ||
          statusLabel(site.status).toLowerCase().includes(query));
      return self || (site.projects ?? []).some(projectMatches);
    }
    return allClients
      .map((client) => ({
        ...client,
        sites: (client.sites ?? [])
          .map((site) => ({ ...site, projects: (site.projects ?? []).filter(projectMatches) }))
          .filter(siteMatches),
      }))
      .filter((client) => {
        if (client.id === openFormId) return true;
        const self =
          statusOk(client.status) &&
          (!query ||
            client.name.toLowerCase().includes(query) ||
            statusLabel(client.status).toLowerCase().includes(query));
        return self || client.sites.length > 0;
      });
  }, [allClients, searchText, statusFilter, openFormId]);

  // --- Forms -----------------------------------------------------------
  function openCreateForm(entity, parentId) {
    setFormError("");
    setFormNotice("");
    setStaleInfo(null);
    setOpenForm({ mode: "create", entity, id: null, version: null, parentId: parentId || "", draft: emptyDraft(entity, parentId), record: null });
  }

  function openEditForm(entity, id) {
    const { record } = findRecord(entity, id);
    if (!record) return;
    setFormError("");
    setFormNotice("");
    setStaleInfo(null);
    setOpenForm({
      mode: "edit",
      entity,
      id,
      version: record.version,
      parentId: entity === "site" ? record.clientId : entity === "project" ? record.siteId : "",
      draft: draftFromRecord(entity, record),
      record,
    });
  }

  function closeForm() {
    setOpenForm(null);
    setFormError("");
    setFormNotice("");
    setStaleInfo(null);
  }

  function updateDraft(field, value) {
    setOpenForm((form) => (form ? { ...form, draft: { ...form.draft, [field]: value } } : form));
    setFormNotice("");
  }

  async function saveForm() {
    if (!openForm || busy) return;
    const { mode, entity, id, draft } = openForm;
    const validation = validateDraft(entity, draft);
    if (validation) {
      setFormError(validation.message);
      return;
    }
    const displayName = draft.name.trim();
    if (mode === "edit" && draftIsUnchanged(entity, draft, openForm.record)) {
      // Client-detected no-op: no write, truthful confirmation.
      setFormError("");
      setStaleInfo(null);
      setFormNotice(`No changes to ${displayName} — nothing needed saving.`);
      return;
    }
    setBusy(true);
    setFormError("");
    setFormNotice("");
    setStaleInfo(null);
    const requestId = newRequestId();
    let result;
    try {
      if (mode === "create") {
        const body =
          entity === "client"
            ? { entity, name: draft.name, externalReference: draft.externalReference || null, notes: draft.notes || null, requestId }
            : entity === "site"
              ? {
                  entity,
                  clientId: draft.parentId,
                  name: draft.name,
                  siteType: draft.siteType || null,
                  addressLine1: draft.addressLine1 || null,
                  addressLine2: draft.addressLine2 || null,
                  city: draft.city || null,
                  region: draft.region || null,
                  postalCode: draft.postalCode || null,
                  countryCode: draft.countryCode || null,
                  requestId,
                }
              : {
                  entity,
                  siteId: draft.parentId,
                  name: draft.name,
                  projectCode: draft.projectCode || null,
                  description: draft.description || null,
                  projectType: draft.projectType || null,
                  plannedStart: draft.plannedStart || null,
                  plannedFinish: draft.plannedFinish || null,
                  requestId,
                };
        result = await callJson("/api/forge/hierarchy", { method: "POST", body });
      } else {
        const body =
          entity === "client"
            ? { entity, id, name: draft.name, externalReference: draft.externalReference || null, notes: draft.notes || null, status: draft.status, expectedVersion: openForm.version, requestId }
            : entity === "site"
              ? {
                  entity,
                  id,
                  clientId: draft.parentId,
                  name: draft.name,
                  siteType: draft.siteType || null,
                  addressLine1: draft.addressLine1 || null,
                  addressLine2: draft.addressLine2 || null,
                  city: draft.city || null,
                  region: draft.region || null,
                  postalCode: draft.postalCode || null,
                  countryCode: draft.countryCode || null,
                  status: draft.status,
                  expectedVersion: openForm.version,
                  requestId,
                }
              : {
                  entity,
                  id,
                  siteId: draft.parentId,
                  name: draft.name,
                  projectCode: draft.projectCode || null,
                  description: draft.description || null,
                  projectType: draft.projectType || null,
                  plannedStart: draft.plannedStart || null,
                  plannedFinish: draft.plannedFinish || null,
                  status: draft.status,
                  expectedVersion: openForm.version,
                  requestId,
                };
        result = await callJson("/api/forge/hierarchy", { method: "PATCH", body });
      }
    } catch {
      setBusy(false);
      setFormError("Request failed.");
      return;
    }
    setBusy(false);
    const { response, data } = result;
    if (!response.ok) {
      if (response.status === 409 && (data.error || "").includes("changed by someone else")) {
        // Stale version: reload the fresh record, keep the user's
        // draft for reconciliation, never blind overwrite.
        const reloaded = await loadInventory(true);
        const fresh = reloaded ? findRecordIn(reloaded, entity, id) : null;
        if (fresh) {
          setOpenForm((form) =>
            form ? { ...form, version: fresh.version, record: fresh } : form,
          );
          setStaleInfo({ name: fresh.name, version: fresh.version, status: fresh.status });
        }
        setFormError(
          `This record was changed by someone else${fresh ? ` (now version ${fresh.version}, ${statusLabel(fresh.status)})` : ""}. Your changes are kept below — review them and save again.`,
        );
        return;
      }
      setFormError(data.error || "Request failed.");
      return;
    }
    const saved = data.client || data.site || data.project || null;
    const savedName = saved?.name || displayName;
    // Reload for fresh versions, then re-point the form at the saved
    // record so a second save carries the new version.
    const reloaded = await loadInventory(true);
    if (mode === "create") {
      setOpenForm((form) => (form ? { ...form, draft: emptyDraft(entity, form.parentId) } : form));
    } else if (saved && reloaded) {
      const fresh = findRecordIn(reloaded, entity, id);
      if (fresh) {
        setOpenForm((form) =>
          form ? { ...form, version: fresh.version, record: fresh, draft: draftFromRecord(entity, fresh) } : form,
        );
      }
    }
    setFormNotice(`${savedName} saved.`);
  }

  function findRecordIn(loaded, entity, id) {
    for (const client of loaded.clients ?? []) {
      if (entity === "client" && client.id === id) return client;
      for (const site of client.sites ?? []) {
        if (entity === "site" && site.id === id) return site;
        for (const project of site.projects ?? []) {
          if (entity === "project" && project.id === id) return project;
        }
      }
    }
    return null;
  }

  // --- Row actions: archive / restore / delete ------------------------
  async function changeStatus(entity, id, status, verb) {
    if (busy) return;
    const { record } = findRecord(entity, id);
    if (!record) return;
    setBusy(true);
    setSectionNotice("");
    setSectionError("");
    let result;
    try {
      result = await callJson("/api/forge/hierarchy", {
        method: "PATCH",
        body: { entity, id, status, expectedVersion: record.version, requestId: newRequestId() },
      });
    } catch {
      setBusy(false);
      setSectionError("Request failed.");
      return;
    }
    setBusy(false);
    const { response, data } = result;
    if (!response.ok) {
      if (response.status === 409 && (data.error || "").includes("changed by someone else")) {
        setSectionError("This record was changed by someone else. Reloading current state.");
        await loadInventory(true);
        return;
      }
      setSectionError(data.error || "Request failed.");
      return;
    }
    setSectionNotice(`${verb} "${record.name}".`);
    await loadInventory(true);
  }

  function askDelete(entity, id, triggerEl) {
    const { record } = findRecord(entity, id);
    if (!record) return;
    const label = ENTITY_LABELS[entity];
    askConfirm(
      {
        title: `Permanently delete this ${label}?`,
        body: `This permanently deletes the ${label} "${record.name}". This cannot be undone. Nothing else is deleted — its parent stays exactly as it is.`,
        onConfirm: async () => {
          setBusy(true);
          setSectionNotice("");
          setSectionError("");
          let result;
          try {
            result = await callJson("/api/forge/hierarchy", {
              method: "DELETE",
              body: { entity, id, expectedVersion: record.version, requestId: newRequestId() },
            });
          } catch {
            setBusy(false);
            closeConfirm();
            setSectionError("Request failed.");
            return;
          }
          setBusy(false);
          closeConfirm();
          const { response, data } = result;
          if (!response.ok) {
            if (response.status === 409) {
              if ((data.error || "").includes("changed by someone else")) {
                setSectionError("This record was changed by someone else. Reloading current state.");
                await loadInventory(true);
                return;
              }
              if ((data.error || "").includes("still has items under it")) {
                setSectionError(DELETE_BLOCK_MESSAGE[entity]);
                return;
              }
              if ((data.error || "").includes("Archive the record first")) {
                setSectionError(`Archive "${record.name}" first — only archived records can be permanently deleted.`);
                return;
              }
            }
            setSectionError(data.error || "Request failed.");
            return;
          }
          setSectionNotice(`Deleted "${record.name}".`);
          await loadInventory(true);
        },
      },
      triggerEl,
    );
  }

  // --- Render helpers ---------------------------------------------------
  function deleteBlocker(entity, record, childCount) {
    if (record.status !== "archived") {
      return { blocked: true, reason: `Archive "${record.name}" first — only archived records can be permanently deleted.` };
    }
    if (entity === "client" && childCount > 0) {
      return { blocked: true, reason: `This client still has ${childCount} site${childCount === 1 ? "" : "s"}. ${DELETE_BLOCK_MESSAGE.client}` };
    }
    if (entity === "site" && childCount > 0) {
      return { blocked: true, reason: `This site still has ${childCount} project${childCount === 1 ? "" : "s"}. ${DELETE_BLOCK_MESSAGE.site}` };
    }
    if (entity === "project" && (record.packageCount || 0) > 0) {
      return { blocked: true, reason: `This project still has ${record.packageCount} assigned package${record.packageCount === 1 ? "" : "s"}. ${DELETE_BLOCK_MESSAGE.project}` };
    }
    return { blocked: false, reason: "" };
  }

  function rowActions(entity, record, childCount) {
    if (!canManage) return null;
    const blocker = deleteBlocker(entity, record, childCount);
    const archived = record.status === "archived";
    return (
      <span className="flex flex-wrap items-center gap-1">
        <button type="button" className={btnGhost} disabled={busy} aria-label={`Edit ${record.name}`} onClick={() => openEditForm(entity, record.id)}>
          Edit
        </button>
        {archived ? (
          <button type="button" className={btnGhost} disabled={busy} aria-label={`Restore ${record.name}`} onClick={() => changeStatus(entity, record.id, "active", "Restored")}>
            Restore
          </button>
        ) : (
          <button type="button" className={btnGhost} disabled={busy} aria-label={`Archive ${record.name}`} onClick={() => changeStatus(entity, record.id, "archived", "Archived")}>
            Archive
          </button>
        )}
        <span className="flex flex-col items-start gap-1">
          <button
            type="button"
            className={btnDanger}
            disabled={busy || blocker.blocked}
            aria-label={`Delete ${record.name}`}
            title={blocker.blocked ? blocker.reason : undefined}
            onClick={(event) => askDelete(entity, record.id, event.currentTarget)}
          >
            Delete
          </button>
          {blocker.blocked && <span className="max-w-64 text-xs text-slate-500">{blocker.reason}</span>}
        </span>
      </span>
    );
  }

  function parentOptions(entity) {
    if (entity === "site") {
      return allClients.map((client) => ({ id: client.id, label: `${client.name} (${statusLabel(client.status)})` }));
    }
    if (entity === "project") {
      return allSites.map((site) => ({ id: site.id, label: `${site.name} — ${site.clientName}` }));
    }
    return [];
  }

  function renderForm() {
    if (!openForm) return null;
    const { mode, entity, draft } = openForm;
    const title =
      mode === "create"
        ? `New ${ENTITY_LABELS[entity]}`
        : `Edit ${ENTITY_LABELS[entity]} ${openForm.record?.name || ""}`;
    const statuses = entity === "client" ? CLIENT_STATUSES : entity === "site" ? SITE_STATUSES : PROJECT_STATUSES;
    const parents = parentOptions(entity);
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" data-testid="hierarchy-form">
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {staleInfo && (
          <p role="alert" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            This record was changed by someone else (now version {staleInfo.version}, {statusLabel(staleInfo.status)}).
            Your changes are kept below — review them and save again.
          </p>
        )}
        {formError && (
          <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {entity !== "client" && (
            <div className="sm:col-span-2">
              <label className={label} htmlFor="hierarchy-form-parent">
                {entity === "site" ? "Parent client" : "Parent site"}
              </label>
              <select
                id="hierarchy-form-parent"
                className={input}
                value={draft.parentId}
                onChange={(event) => updateDraft("parentId", event.target.value)}
              >
                <option value="">{entity === "site" ? "Choose a client…" : "Choose a site…"}</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>{parent.label}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={label} htmlFor="hierarchy-form-name">Name</label>
            <input
              id="hierarchy-form-name"
              className={input}
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
            />
          </div>
          {entity === "client" && (
            <div>
              <label className={label} htmlFor="hierarchy-form-external-reference">External reference</label>
              <input
                id="hierarchy-form-external-reference"
                className={input}
                value={draft.externalReference}
                onChange={(event) => updateDraft("externalReference", event.target.value)}
              />
            </div>
          )}
          {entity === "site" && (
            <div>
              <label className={label} htmlFor="hierarchy-form-site-type">Site type</label>
              <select
                id="hierarchy-form-site-type"
                className={input}
                value={draft.siteType}
                onChange={(event) => updateDraft("siteType", event.target.value)}
              >
                <option value="">Choose a type…</option>
                {SITE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
          )}
          {entity === "project" && (
            <div>
              <label className={label} htmlFor="hierarchy-form-project-code">Project code</label>
              <input
                id="hierarchy-form-project-code"
                className={input}
                value={draft.projectCode}
                onChange={(event) => updateDraft("projectCode", event.target.value)}
              />
            </div>
          )}
          {entity === "client" && (
            <div className="sm:col-span-2">
              <label className={label} htmlFor="hierarchy-form-notes">Notes</label>
              <textarea
                id="hierarchy-form-notes"
                className={input}
                rows={2}
                value={draft.notes}
                onChange={(event) => updateDraft("notes", event.target.value)}
              />
            </div>
          )}
          {entity === "site" && (
            <>
              <div>
                <label className={label} htmlFor="hierarchy-form-address-line1">Address line 1</label>
                <input id="hierarchy-form-address-line1" className={input} value={draft.addressLine1} onChange={(event) => updateDraft("addressLine1", event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-address-line2">Address line 2</label>
                <input id="hierarchy-form-address-line2" className={input} value={draft.addressLine2} onChange={(event) => updateDraft("addressLine2", event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-city">City</label>
                <input id="hierarchy-form-city" className={input} value={draft.city} onChange={(event) => updateDraft("city", event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-region">Region</label>
                <input id="hierarchy-form-region" className={input} value={draft.region} onChange={(event) => updateDraft("region", event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-postal-code">Postal code</label>
                <input id="hierarchy-form-postal-code" className={input} value={draft.postalCode} onChange={(event) => updateDraft("postalCode", event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-country-code">Country code</label>
                <input id="hierarchy-form-country-code" className={input} value={draft.countryCode} onChange={(event) => updateDraft("countryCode", event.target.value)} placeholder="US" />
              </div>
            </>
          )}
          {entity === "project" && (
            <>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="hierarchy-form-description">Description</label>
                <textarea
                  id="hierarchy-form-description"
                  className={input}
                  rows={2}
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-project-type">Project type</label>
                <input id="hierarchy-form-project-type" className={input} value={draft.projectType} onChange={(event) => updateDraft("projectType", event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-planned-start">Planned start</label>
                <input id="hierarchy-form-planned-start" type="date" className={input} value={draft.plannedStart} onChange={(event) => updateDraft("plannedStart", event.target.value)} />
              </div>
              <div>
                <label className={label} htmlFor="hierarchy-form-planned-finish">Planned finish</label>
                <input id="hierarchy-form-planned-finish" type="date" className={input} value={draft.plannedFinish} onChange={(event) => updateDraft("plannedFinish", event.target.value)} />
              </div>
            </>
          )}
          <div>
            <label className={label} htmlFor="hierarchy-form-status">Status</label>
            <select
              id="hierarchy-form-status"
              className={input}
              value={draft.status}
              onChange={(event) => updateDraft("status", event.target.value)}
            >
              {statuses.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className={btnPrimary} disabled={busy} onClick={saveForm}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className={btnGhost} disabled={busy} onClick={closeForm}>
            Cancel
          </button>
          {formNotice && (
            <p role="status" className="min-w-48 flex-1 text-sm text-slate-700">{formNotice}</p>
          )}
        </div>
      </div>
    );
  }

  function renderProject(project, site) {
    const formIsHere = openForm?.entity === "project" && openForm?.id === project.id;
    return (
      <li key={project.id} data-testid={`hierarchy-row-project-${project.id}`} className="border-t border-slate-100 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-700">
            <span className="font-medium">{project.name}</span>
            {project.projectCode && <span className="ml-1 text-xs text-slate-500">({project.projectCode})</span>}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{statusLabel(project.status)}</span>
            {(project.packageCount || 0) > 0 && (
              <span className="ml-2 text-xs text-slate-500">
                {project.packageCount} assigned package{project.packageCount === 1 ? "" : "s"}
              </span>
            )}
          </span>
          {rowActions("project", project, 0)}
        </div>
        {formIsHere && <div className="mt-3">{renderForm()}</div>}
      </li>
    );
  }

  function renderSite(site, client) {
    const formIsHere = openForm?.entity === "site" && openForm?.id === site.id;
    const createFormIsHere = openForm?.mode === "create" && openForm?.entity === "project" && openForm?.parentId === site.id;
    return (
      <li key={site.id} data-testid={`hierarchy-row-site-${site.id}`} className="border-t border-slate-100 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-slate-700">
            <span className="font-medium">{site.name}</span>
            {site.siteType && <span className="ml-1 text-xs text-slate-500">({site.siteType})</span>}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{statusLabel(site.status)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1">
            {canManage && (
              <button type="button" className={btnGhost} disabled={busy} aria-label={`New project under ${site.name}`} onClick={() => openCreateForm("project", site.id)}>
                New project
              </button>
            )}
            {rowActions("site", site, (site.projects ?? []).length)}
          </span>
        </div>
        {formIsHere && <div className="mt-3">{renderForm()}</div>}
        {createFormIsHere && <div className="mt-3">{renderForm()}</div>}
        <ul className="ml-4 mt-1 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {(site.projects ?? []).map((project) => renderProject(project, site))}
        </ul>
      </li>
    );
  }

  function renderClient(client) {
    const formIsHere = openForm?.entity === "client" && openForm?.id === client.id;
    const createFormIsHere = openForm?.mode === "create" && openForm?.entity === "site" && openForm?.parentId === client.id;
    return (
      <li key={client.id} data-testid={`hierarchy-row-client-${client.id}`} className="rounded-lg border border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="text-sm text-slate-700">
            <span className="font-medium">{client.name}</span>
            {client.externalReference && <span className="ml-1 text-xs text-slate-500">({client.externalReference})</span>}
            <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{statusLabel(client.status)}</span>
          </span>
          <span className="flex flex-wrap items-center gap-1">
            {canManage && (
              <button type="button" className={btnGhost} disabled={busy} aria-label={`New site under ${client.name}`} onClick={() => openCreateForm("site", client.id)}>
                New site
              </button>
            )}
            {rowActions("client", client, (client.sites ?? []).length)}
          </span>
        </div>
        {formIsHere && <div className="px-3 pb-3">{renderForm()}</div>}
        {createFormIsHere && <div className="px-3 pb-3">{renderForm()}</div>}
        <ul className="ml-4 mr-3 mb-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
          {(client.sites ?? []).map((site) => renderSite(site, client))}
        </ul>
      </li>
    );
  }

  if (loading) return <p className="mt-6 text-sm text-slate-500">Loading clients, sites, and projects…</p>;
  if (loadError) {
    return (
      <section aria-labelledby="planner-hierarchy-heading" data-testid="planner-hierarchy-manager" className="mt-6">
        <h2 id="planner-hierarchy-heading" className="text-lg font-semibold">Clients, sites &amp; projects</h2>
        <div className="mt-3 rounded-lg bg-red-50 p-4 text-sm text-red-700">{loadError}</div>
      </section>
    );
  }

  const createClientFormOpen = openForm?.mode === "create" && openForm?.entity === "client";

  return (
    <section aria-labelledby="planner-hierarchy-heading" data-testid="planner-hierarchy-manager" className="mt-6">
      <h2 id="planner-hierarchy-heading" className="text-lg font-semibold">Clients, sites &amp; projects</h2>
      <p className="mt-1 text-sm text-slate-500">
        Add a client, then sites under it, then projects under each site. Archived records stay here
        until they are restored or permanently deleted — they never appear in the project picker.
      </p>
      <p className="mt-2 text-sm">
        <Link className="text-blue-700 underline" href={withWorkspaceQuery("/forge/work")}>Planner</Link>
        {" · "}
        <Link className="text-blue-700 underline" href={withWorkspaceQuery("/forge/work?forgeProject=unassigned")}>Unassigned packages</Link>
        {" · "}
        <Link className="text-blue-700 underline" href={withWorkspaceQuery("/forge/work/admin")}>Planner Admin</Link>
      </p>

      {sectionNotice && (
        <p role="status" className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{sectionNotice}</p>
      )}
      {sectionError && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sectionError}</p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className={label} htmlFor="hierarchy-search">Search clients, sites, and projects</label>
          <input
            id="hierarchy-search"
            className={input}
            style={{ width: "16rem" }}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Name, code, or status…"
          />
        </div>
        <div>
          <label className={label} htmlFor="hierarchy-status-filter">Filter by status</label>
          <select
            id="hierarchy-status-filter"
            className={input}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
            <option value="planned">Planned</option>
            <option value="on_hold">On hold</option>
            <option value="complete">Complete</option>
          </select>
        </div>
        {canManage && (
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => openCreateForm("client", "")}>
            New client
          </button>
        )}
      </div>

      {!canManage && (
        <p className="mt-3 text-sm text-slate-500">
          You can view the hierarchy but cannot change it — managing clients, sites, and projects needs the hierarchy permission.
        </p>
      )}

      <p className="mt-3 text-sm text-slate-500">
        {counts.clients} client{counts.clients === 1 ? "" : "s"} · {counts.sites} site{counts.sites === 1 ? "" : "s"} · {counts.projects} project{counts.projects === 1 ? "" : "s"}
      </p>

      {createClientFormOpen && <div className="mt-3">{renderForm()}</div>}

      {visibleClients.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
          {allClients.length === 0
            ? "No clients yet — create your first client to get started."
            : "No clients, sites, or projects match this search."}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {visibleClients.map((client) => renderClient(client))}
        </ul>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) closeConfirm();
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="hierarchy-confirm-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 id="hierarchy-confirm-title" className="text-base font-semibold text-slate-900">{confirm.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirm.body}</p>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button type="button" className={btnGhost} disabled={busy} onClick={closeConfirm} autoFocus>
                Cancel
              </button>
              <button type="button" className={btnDanger} disabled={busy} onClick={confirm.onConfirm}>
                {busy ? "Working…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
