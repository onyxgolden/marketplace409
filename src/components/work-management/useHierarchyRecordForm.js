// The ONE create/edit state machine for a hierarchy (client/site/project)
// record form -- PlannerHierarchyManager (Admin's full CRUD) and
// PlannerAddHierarchyButtons (the create-only controls on /forge/work) both
// call this hook for their save/open/close/draft/busy/error/stale-version
// behavior, instead of each independently implementing "the create flow."
// ChatGPT review of PR #848 (2026-11-21, NEEDS CHANGES, P1): shared field
// markup and body-building helpers are not the same as shared creation --
// the actual save/notice/stale-reconcile logic was duplicated. This hook is
// the fix: there is exactly one saveForm, used by both callers.
"use client";

import { useState } from "react";
import { withWorkspaceQuery } from "./workspaceQuery.js";
import { buildCreateBody, emptyDraft, newRequestId, validateDraft } from "./hierarchyFormShared.js";

export async function callJson(path, { method = "GET", body } = {}) {
  const response = await fetch(withWorkspaceQuery(path), {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

export function findRecordIn(loaded, entity, id) {
  for (const client of loaded?.clients ?? []) {
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

function blank(value) {
  return value === null || value === undefined ? "" : String(value);
}

function sameText(a, b) {
  return blank(a).trim() === blank(b).trim();
}

export function draftFromRecord(entity, record) {
  if (entity === "client") {
    return { name: blank(record.name), externalReference: blank(record.externalReference), notes: blank(record.notes), status: record.status };
  }
  if (entity === "site") {
    return {
      parentId: blank(record.clientId), name: blank(record.name), siteType: blank(record.siteType),
      addressLine1: blank(record.addressLine1), addressLine2: blank(record.addressLine2), city: blank(record.city),
      region: blank(record.region), postalCode: blank(record.postalCode), countryCode: blank(record.countryCode),
      status: record.status,
    };
  }
  return {
    parentId: blank(record.siteId), name: blank(record.name), projectCode: blank(record.projectCode),
    description: blank(record.description), projectType: blank(record.projectType),
    plannedStart: blank(record.plannedStart), plannedFinish: blank(record.plannedFinish), status: record.status,
  };
}

/** True when the draft matches the record on every field -- a save with no
 *  changes writes nothing and confirms truthfully instead. */
export function draftIsUnchanged(entity, draft, record) {
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

/**
 * reload(silent): async () => freshLoadedInventory|null -- re-fetches the
 *   caller's own inventory so a stale-version (409) reconcile and a
 *   post-save version bump both read fresh data. Required for edit; a
 *   create-only caller may pass one that just re-fetches its own list, or
 *   skip reload for create by never calling openEditForm.
 * onSaved(mode, entity, savedRecord): optional, fired after a successful
 *   create or edit, for the caller to react further (navigate, set a
 *   section-level notice that survives this hook's own form state resets).
 */
export function useHierarchyRecordForm({ reload, onSaved } = {}) {
  const [openForm, setOpenForm] = useState(null);
  const [formError, setFormError] = useState("");
  const [formNotice, setFormNotice] = useState("");
  const [staleInfo, setStaleInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  function openCreateForm(entity, parentId, options) {
    setFormError("");
    setFormNotice("");
    setStaleInfo(null);
    setOpenForm({ mode: "create", entity, id: null, version: null, parentId: parentId || "", isTest: options?.isTest === true, draft: emptyDraft(entity, parentId), record: null });
  }

  function openEditForm(entity, record) {
    if (!record) return;
    setFormError("");
    setFormNotice("");
    setStaleInfo(null);
    setOpenForm({
      mode: "edit",
      entity,
      id: record.id,
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
        const body = buildCreateBody(entity, draft, { isTest: openForm.isTest === true, requestId });
        result = await callJson("/api/forge/hierarchy", { method: "POST", body });
      } else {
        const body =
          entity === "client"
            ? { entity, id, name: draft.name, externalReference: draft.externalReference, notes: draft.notes, status: draft.status, expectedVersion: openForm.version, requestId }
            : entity === "site"
              ? {
                  entity, id, clientId: draft.parentId, name: draft.name, siteType: draft.siteType,
                  addressLine1: draft.addressLine1, addressLine2: draft.addressLine2, city: draft.city,
                  region: draft.region, postalCode: draft.postalCode, countryCode: draft.countryCode,
                  status: draft.status, expectedVersion: openForm.version, requestId,
                }
              : {
                  entity, id, siteId: draft.parentId, name: draft.name, projectCode: draft.projectCode,
                  description: draft.description, projectType: draft.projectType, plannedStart: draft.plannedStart,
                  plannedFinish: draft.plannedFinish, status: draft.status, expectedVersion: openForm.version, requestId,
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
        const reloaded = reload ? await reload(true) : null;
        const fresh = reloaded ? findRecordIn(reloaded, entity, id) : null;
        if (fresh) {
          setOpenForm((form) => (form ? { ...form, version: fresh.version, record: fresh } : form));
          setStaleInfo({ name: fresh.name, version: fresh.version, status: fresh.status });
        }
        setFormError(
          `This record was changed by someone else${fresh ? ` (now version ${fresh.version}, ${fresh.status})` : ""}. Your changes are kept below — review them and save again.`,
        );
        return;
      }
      setFormError(data.error || "Request failed.");
      return;
    }
    const saved = data.client || data.site || data.project || null;
    const savedName = saved?.name || displayName;
    const reloaded = reload ? await reload(true) : null;
    if (mode === "create") {
      setOpenForm((form) => (form ? { ...form, draft: emptyDraft(entity, form.parentId) } : form));
    } else if (saved && reloaded) {
      const fresh = findRecordIn(reloaded, entity, id);
      if (fresh) {
        setOpenForm((form) => (form ? { ...form, version: fresh.version, record: fresh, draft: draftFromRecord(entity, fresh) } : form));
      }
    }
    setFormNotice(`${savedName} saved.`);
    onSaved?.(mode, entity, saved, openForm.parentId);
  }

  return { openForm, formError, formNotice, staleInfo, busy, openCreateForm, openEditForm, closeForm, updateDraft, saveForm, setFormNotice };
}
