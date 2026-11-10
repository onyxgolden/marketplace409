"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RENTAL_ADMIN_CAPABILITIES,
  RENTAL_ADMIN_OWNER_ONLY_KEYS,
  RENTAL_ADMIN_STARTER_ROLES,
  RENTAL_ADMIN_SURFACES,
  rentalAdminEffectiveKeys,
  rentalAdminKeyLabels,
} from "@/lib/rental/adminPermissions";

function newRequestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function staffCountText(count) {
  const n = Number(count || 0);
  return n === 1 ? "1 staff member" : `${n} staff members`;
}

function isStarterRole(role, starterRoles) {
  if (!role) return false;
  if (role.is_system) return true;
  const names = (starterRoles && starterRoles.length > 0
    ? starterRoles
    : RENTAL_ADMIN_STARTER_ROLES
  ).map((r) => r.name);
  return names.includes(role.name);
}

function diffParts(addedKeys, removedKeys) {
  const parts = [];
  const added = rentalAdminKeyLabels(addedKeys || []);
  const removed = rentalAdminKeyLabels(removedKeys || []);
  if (added.length > 0) parts.push(`added ${added.join(", ")}`);
  if (removed.length > 0) parts.push(`removed ${removed.join(", ")}`);
  return parts;
}

function auditSummary(entry, resolveEmail) {
  const detail = entry.detail || {};
  const roleName = detail.role_name || detail.display_name || detail.name || null;
  const added = rentalAdminKeyLabels(detail.added || []);
  const removed = rentalAdminKeyLabels(detail.removed || []);
  const affected = detail.affected_user_count;
  const targetEmail = entry.target_user_id ? resolveEmail(entry.target_user_id) : null;
  const who = targetEmail || "a staff member";
  switch (entry.action) {
    case "role.seeded":
      return roleName ? `Starter role set up: ${roleName}.` : "Starter roles set up.";
    case "role.created": {
      const count = Array.isArray(detail.keys) ? detail.keys.length : 0;
      return roleName
        ? `Role created: ${roleName}, with ${count} permission${count === 1 ? "" : "s"}.`
        : "Role created.";
    }
    case "role.updated": {
      const parts = [];
      if (added.length > 0) parts.push(`added ${added.join(", ")}`);
      if (removed.length > 0) parts.push(`removed ${removed.join(", ")}`);
      const change = parts.length > 0 ? parts.join("; ") : "no permissions changed";
      const affects = typeof affected === "number" ? ` Affects ${staffCountText(affected)}.` : "";
      return `Role updated${roleName ? `: ${roleName}` : ""}: ${change}.${affects}`;
    }
    case "role.retired": {
      const moved = Number(detail.reassigned_count || 0);
      return moved > 0
        ? `Role retired${roleName ? `: ${roleName}` : ""}. Moved ${staffCountText(moved)} to another role.`
        : `Role retired${roleName ? `: ${roleName}` : ""}. No staff members were using it.`;
    }
    case "role.assigned":
      return roleName
        ? `Role assigned: ${roleName} to ${who}.`
        : `A role was assigned to ${who}.`;
    case "role.revoked":
      return detail.superseded_by
        ? `Role replaced for ${who}: the previous role was removed.`
        : `Role removed from ${who}.`;
    default:
      return entry.action || "Role change.";
  }
}

function PermissionGrid({ catalog, ownerOnlyKeys, checkedKeys, onToggle, disabled, idPrefix }) {
  const checked = useMemo(() => new Set(checkedKeys || []), [checkedKeys]);
  const ownerOnly = useMemo(() => new Set(ownerOnlyKeys || []), [ownerOnlyKeys]);
  const groups = useMemo(() => {
    const ordered = [];
    for (const surface of RENTAL_ADMIN_SURFACES) {
      const items = (catalog || []).filter((c) => c.surface === surface);
      if (items.length > 0) ordered.push({ surface, items });
    }
    const known = new Set(RENTAL_ADMIN_SURFACES);
    const rest = (catalog || []).filter((c) => !known.has(c.surface));
    if (rest.length > 0) ordered.push({ surface: "Other", items: rest });
    return ordered;
  }, [catalog]);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <fieldset key={group.surface}>
          <legend className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">
            {group.surface}
          </legend>
          <ul className="space-y-2">
            {group.items.map((permission) => {
              const isOwnerOnly = ownerOnly.has(permission.key);
              const granted = !isOwnerOnly && checked.has(permission.key);
              return (
                <li key={permission.key}>
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      id={`${idPrefix}-${permission.key}`}
                      checked={granted}
                      disabled={disabled || isOwnerOnly}
                      onChange={() => onToggle(permission.key)}
                      className="mt-1 h-4 w-4 accent-sky-600"
                    />
                    <span>
                      <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                        {permission.label}
                        {isOwnerOnly && (
                          <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                            Owner or co-owner only
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {permission.description}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

export default function RentalPermissionsPanel() {
  const [roles, setRoles] = useState(null);
  const [catalog, setCatalog] = useState(RENTAL_ADMIN_CAPABILITIES);
  const [starterRoles, setStarterRoles] = useState(RENTAL_ADMIN_STARTER_ROLES);
  const [ownerOnlyKeys, setOwnerOnlyKeys] = useState(RENTAL_ADMIN_OWNER_ONLY_KEYS);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);

  const [search, setSearch] = useState("");
  const [foundUser, setFoundUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [assignRoleId, setAssignRoleId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  const [editingRoleId, setEditingRoleId] = useState(null);
  const [draftKeys, setDraftKeys] = useState([]);
  const [baseKeys, setBaseKeys] = useState([]);
  const [staleNote, setStaleNote] = useState(null);
  const [savingRole, setSavingRole] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createDisplayName, setCreateDisplayName] = useState("");
  const [createKeys, setCreateKeys] = useState([]);
  const [confirmingCreate, setConfirmingCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const [retiringRoleId, setRetiringRoleId] = useState(null);
  const [reassignRoleId, setReassignRoleId] = useState("");
  const [retiring, setRetiring] = useState(false);
  const [settingUp, setSettingUp] = useState(false);

  const notify = useCallback((message, isError) => {
    setNotice({ message, isError: Boolean(isError) });
  }, []);

  const knownEmails = useMemo(() => {
    const map = new Map();
    if (foundUser?.user_id && foundUser?.email) map.set(foundUser.user_id, foundUser.email);
    return map;
  }, [foundUser]);

  const resolveEmail = useCallback(
    (userId) => knownEmails.get(userId) || null,
    [knownEmails]
  );

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  const loadRoles = useCallback(async () => {
    const response = await fetch("/api/rental/admin/roles", { credentials: "same-origin" });
    const body = await readJson(response);
    if (!response.ok) throw new Error(body?.error || "Unable to load roles.");
    setRoles(body.roles || []);
    if (Array.isArray(body.catalog) && body.catalog.length > 0) setCatalog(body.catalog);
    if (Array.isArray(body.starterRoles) && body.starterRoles.length > 0) {
      setStarterRoles(body.starterRoles);
    }
    if (Array.isArray(body.ownerOnlyKeys)) setOwnerOnlyKeys(body.ownerOnlyKeys);
    return body.roles || [];
  }, []);

  const loadAudit = useCallback(async () => {
    const response = await fetch("/api/rental/admin/audit?limit=100", {
      credentials: "same-origin",
    });
    const body = await readJson(response);
    if (response.ok) setAudit(body.entries || []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await loadRoles();
      await loadAudit();
    } catch (error) {
      notify(error.message, true);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [loadRoles, loadAudit, notify]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial roles + audit fetch when the panel mounts; later refreshes are user-triggered.
    load();
  }, [load]);

  const activeRoles = useMemo(
    () => (roles || []).filter((r) => !r.retired_at),
    [roles]
  );

  const editingRole = useMemo(
    () => (roles || []).find((r) => r.id === editingRoleId) || null,
    [roles, editingRoleId]
  );

  function openEditor(role) {
    const caps = rentalAdminEffectiveKeys(role.capabilities || []);
    setEditingRoleId(role.id);
    setDraftKeys(caps);
    setBaseKeys(caps);
    setStaleNote(null);
  }

  function closeEditor() {
    setEditingRoleId(null);
    setDraftKeys([]);
    setBaseKeys([]);
    setStaleNote(null);
  }

  function toggleDraftKey(key) {
    if (ownerOnlyKeys.includes(key)) return;
    setDraftKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function toggleCreateKey(key) {
    if (ownerOnlyKeys.includes(key)) return;
    setCreateKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const editDiff = useMemo(() => {
    const base = new Set(baseKeys);
    const draft = new Set(draftKeys);
    return {
      added: draftKeys.filter((k) => !base.has(k)),
      removed: baseKeys.filter((k) => !draft.has(k)),
    };
  }, [draftKeys, baseKeys]);

  const editDirty = editDiff.added.length > 0 || editDiff.removed.length > 0;

  async function saveRoleEdit() {
    if (!editingRole) return;
    setSavingRole(true);
    try {
      const response = await fetch("/api/rental/admin/roles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          roleId: editingRole.id,
          addKeys: editDiff.added,
          removeKeys: editDiff.removed,
          expectedVersion: editingRole.version,
          requestId: newRequestId(),
        }),
      });
      const result = await readJson(response);
      if (response.status === 409 || result?.code === "stale_version") {
        const freshRoles = Array.isArray(result?.roles) ? result.roles : null;
        if (freshRoles) {
          setRoles(freshRoles);
          const fresh = freshRoles.find((r) => r.id === editingRole.id);
          if (fresh) {
            const freshCaps = rentalAdminEffectiveKeys(fresh.capabilities || []);
            const freshSet = new Set(freshCaps);
            const baseSet = new Set(baseKeys);
            const someoneAdded = freshCaps.filter((k) => !baseSet.has(k));
            const someoneRemoved = baseKeys.filter((k) => !freshSet.has(k));
            setBaseKeys(freshCaps);
            setDraftKeys(freshCaps);
            setStaleNote({ added: someoneAdded, removed: someoneRemoved });
          }
        }
        notify(
          "This role was changed by someone else — here is the current version. Check the fresh permissions below, then save again if you still want your change.",
          true
        );
        return;
      }
      if (!response.ok) throw new Error(result?.error || "Unable to save that role.");
      const freshRoles = await loadRoles();
      await loadAudit();
      const updated = freshRoles.find((r) => r.id === editingRole.id);
      if (updated) {
        const caps = rentalAdminEffectiveKeys(updated.capabilities || []);
        setBaseKeys(caps);
        setDraftKeys(caps);
      }
      closeEditor();
      notify(result?.message || `Saved the ${editingRole.display_name} role.`, false);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setSavingRole(false);
    }
  }

  async function setupStarterRoles() {
    setSettingUp(true);
    try {
      const response = await fetch("/api/rental/admin/roles/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ requestId: newRequestId() }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error || "Unable to set up the starter roles.");
      if (Array.isArray(result.roles)) setRoles(result.roles);
      await loadAudit();
      notify(result?.message || "Set up the four starter roles.", false);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setSettingUp(false);
    }
  }

  async function lookupUser(searchText) {
    const response = await fetch("/api/rental/admin/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ search: searchText }),
    });
    const result = await readJson(response);
    if (!response.ok) throw new Error(result?.error || "Unable to look that user up.");
    return result.user || null;
  }

  async function searchUser(event) {
    if (event) event.preventDefault();
    const term = search.trim();
    if (!term) {
      notify("Enter an exact user ID or verified email address.", true);
      return;
    }
    setSearching(true);
    try {
      const user = await lookupUser(term);
      if (!user) {
        setFoundUser(null);
        notify("No account was found for that exact user ID or verified email.", true);
        return;
      }
      setFoundUser(user);
      setConfirmingRevoke(false);
      const currentId = user.current_role?.id || "";
      setAssignRoleId(currentId || (activeRoles[0]?.id ?? ""));
      setNotice(null);
    } catch (error) {
      setFoundUser(null);
      notify(error.message, true);
    } finally {
      setSearching(false);
    }
  }

  async function assignRole() {
    if (!foundUser || !assignRoleId) return;
    setAssigning(true);
    try {
      const response = await fetch("/api/rental/admin/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          userId: foundUser.user_id,
          roleId: assignRoleId,
          requestId: newRequestId(),
        }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error || "Unable to assign that role.");
      const refreshed = await lookupUser(search.trim());
      if (refreshed) {
        setFoundUser(refreshed);
        setAssignRoleId(refreshed.current_role?.id || assignRoleId);
      }
      await loadRoles();
      await loadAudit();
      notify(result?.message || "Role assigned.", false);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setAssigning(false);
    }
  }

  async function revokeRole() {
    if (!foundUser) return;
    setAssigning(true);
    try {
      const response = await fetch("/api/rental/admin/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId: foundUser.user_id, requestId: newRequestId() }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error || "Unable to remove that role.");
      const refreshed = await lookupUser(search.trim());
      if (refreshed) {
        setFoundUser(refreshed);
        setAssignRoleId(refreshed.current_role?.id || (activeRoles[0]?.id ?? ""));
      }
      setConfirmingRevoke(false);
      await loadRoles();
      await loadAudit();
      notify(result?.message || "Role removed.", false);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setAssigning(false);
    }
  }

  async function createRole() {
    setCreating(true);
    try {
      const response = await fetch("/api/rental/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          name: createName.trim(),
          displayName: createDisplayName.trim(),
          keys: createKeys.filter((k) => !ownerOnlyKeys.includes(k)),
          requestId: newRequestId(),
        }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error || "Unable to create that role.");
      await loadRoles();
      await loadAudit();
      setCreateName("");
      setCreateDisplayName("");
      setCreateKeys([]);
      setConfirmingCreate(false);
      notify(result?.message || `Created the ${createDisplayName.trim()} role.`, false);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setCreating(false);
    }
  }

  async function retireRole() {
    const role = (roles || []).find((r) => r.id === retiringRoleId);
    if (!role) return;
    if (Number(role.active_assignee_count || 0) > 0 && !reassignRoleId) {
      notify("Choose a role to move the staff members to before retiring this role.", true);
      return;
    }
    setRetiring(true);
    try {
      const response = await fetch("/api/rental/admin/roles/retire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          roleId: role.id,
          reassignRoleId: reassignRoleId || undefined,
          requestId: newRequestId(),
        }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error || "Unable to retire that role.");
      await loadRoles();
      await loadAudit();
      setRetiringRoleId(null);
      setReassignRoleId("");
      if (editingRoleId === role.id) closeEditor();
      notify(result?.message || `Retired the ${role.display_name} role.`, false);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setRetiring(false);
    }
  }

  const foundEffectiveLabels = foundUser
    ? rentalAdminKeyLabels(rentalAdminEffectiveKeys(foundUser.effective_keys || []))
    : [];

  return (
    <section data-rental-permissions-panel className="space-y-6">
      <div>
        <h2 className="text-xl font-black text-slate-950 dark:text-slate-50">
          Rental roles &amp; permissions
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Give staff members a role, and the role decides what they can do in the Rental Manager.
          The owner and co-owner always have full access. Finance actions — turning on billing,
          refunds, and credits — stay owner or co-owner only and can never be put on a role.
        </p>
      </div>

      {notice && (
        <div
          role={notice.isError ? "alert" : "status"}
          className={`rounded-xl border px-4 py-3 text-sm font-bold ${
            notice.isError
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
              : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          }`}
        >
          {notice.message}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading roles…</p>
      ) : (
        <>
          {(roles || []).length === 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-base font-black text-slate-950 dark:text-slate-50">
                No roles yet
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Set up the four starter roles — Rental Admin, Manager, Bookkeeper, and Read-only —
                to get started. Nothing is created until you choose to set them up.
              </p>
              <button
                type="button"
                onClick={setupStarterRoles}
                disabled={settingUp}
                className="mt-3 rounded-full bg-sky-700 px-5 py-2.5 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
              >
                {settingUp ? "Setting up…" : "Set up starter roles"}
              </button>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-base font-black text-slate-950 dark:text-slate-50">Find a user</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Search by their exact user ID or verified email address. There is no list of all
              users here — enter the exact value.
            </p>
            <form onSubmit={searchUser} className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <label className="block">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  User ID or verified email
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="user id or name@example.com"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={searching || !search.trim()}
                  className="rounded-full bg-sky-700 px-5 py-2.5 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
                >
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
            </form>

            {foundUser && (
              <article
                data-found-user={foundUser.user_id}
                className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700"
              >
                <h4 className="text-base font-black text-slate-950 dark:text-slate-50">
                  {foundUser.email}
                </h4>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Team role: {foundUser.r17_role || "none"}
                  {foundUser.r17_status ? ` (${foundUser.r17_status})` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Current role:{" "}
                  {foundUser.current_role ? (
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {foundUser.current_role.display_name}
                    </span>
                  ) : (
                    "No role assigned"
                  )}
                </p>
                <div className="mt-3">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    What they can do
                  </p>
                  {foundEffectiveLabels.length === 0 ? (
                    <p className="mt-1 text-sm text-slate-500">No permissions.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {foundEffectiveLabels.map((label) => (
                        <li key={label} className="text-sm text-slate-600 dark:text-slate-300">
                          ✓ {label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                  <label className="block">
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      Assign role
                    </span>
                    <select
                      value={assignRoleId}
                      onChange={(event) => setAssignRoleId(event.target.value)}
                      disabled={assigning}
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 font-bold dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="">Choose a role…</option>
                      {activeRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={assignRole}
                      disabled={assigning || !assignRoleId}
                      className="rounded-full bg-sky-700 px-5 py-2.5 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
                    >
                      {assigning ? "Assigning…" : "Assign role"}
                    </button>
                    {foundUser.current_role &&
                      (confirmingRevoke ? (
                        <>
                          <button
                            type="button"
                            onClick={revokeRole}
                            disabled={assigning}
                            className="rounded-full border border-red-300 bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            Remove this role?
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingRevoke(false)}
                            disabled={assigning}
                            className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                          >
                            Keep role
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingRevoke(true)}
                          disabled={assigning}
                          className="rounded-full border border-red-300 px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                        >
                          Remove role
                        </button>
                      ))}
                  </div>
                </div>
              </article>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-base font-black text-slate-950 dark:text-slate-50">Roles</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Pick a role to see and change what it can do. Changing a role changes access for
              everyone who holds it.
            </p>
            {(roles || []).length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                No roles yet — set up the starter roles above, or create one below.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {(roles || []).map((role) => {
                  const starter = isStarterRole(role, starterRoles);
                  const isRetiringThis = retiringRoleId === role.id;
                  return (
                    <li
                      key={role.id}
                      data-role-id={role.id}
                      className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-black text-slate-900 dark:text-slate-100">
                            {role.display_name}
                            {role.retired_at && (
                              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase dark:bg-slate-700">
                                Retired
                              </span>
                            )}
                            {starter && (
                              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase dark:bg-slate-700">
                                Starter
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {staffCountText(role.active_assignee_count)} · Version {role.version}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!role.retired_at && (
                            <button
                              type="button"
                              onClick={() => openEditor(role)}
                              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                            >
                              Edit {role.display_name}
                            </button>
                          )}
                          {!role.retired_at && !starter &&
                            (isRetiringThis ? (
                              <>
                                <button
                                  type="button"
                                  onClick={retireRole}
                                  disabled={
                                    retiring ||
                                    (Number(role.active_assignee_count || 0) > 0 && !reassignRoleId)
                                  }
                                  className="rounded-full border border-red-300 bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
                                >
                                  Retire this role?
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRetiringRoleId(null);
                                    setReassignRoleId("");
                                  }}
                                  disabled={retiring}
                                  className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                                >
                                  Keep role
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setRetiringRoleId(role.id);
                                  setReassignRoleId("");
                                }}
                                className="rounded-full border border-red-300 px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                              >
                                Retire {role.display_name}
                              </button>
                            ))}
                        </div>
                      </div>
                      {isRetiringThis && Number(role.active_assignee_count || 0) > 0 && (
                        <div className="mt-3">
                          <label className="block">
                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                              Move staff members to
                            </span>
                            <select
                              value={reassignRoleId}
                              onChange={(event) => setReassignRoleId(event.target.value)}
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 font-bold dark:border-slate-600 dark:bg-slate-800"
                            >
                              <option value="">Choose a role…</option>
                              {activeRoles
                                .filter((r) => r.id !== role.id)
                                .map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.display_name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                            {staffCountText(role.active_assignee_count)} currently hold this role.
                            They must be moved before it can be retired.
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {editingRole && (
              <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <h4 className="text-base font-black text-slate-950 dark:text-slate-50">
                  Edit role: {editingRole.display_name}
                </h4>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Version {editingRole.version} · {staffCountText(editingRole.active_assignee_count)}
                </p>
                {staleNote && (
                  <div
                    role="status"
                    className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                  >
                    <p>
                      This role was changed by someone else — here is the current version.
                    </p>
                    {(() => {
                      const parts = diffParts(staleNote.added, staleNote.removed);
                      return parts.length > 0 ? (
                        <p className="mt-1">
                          What changed since you started editing: {parts.join("; ")}.
                        </p>
                      ) : (
                        <p className="mt-1">Nothing about the permissions changed.</p>
                      );
                    })()}
                  </div>
                )}
                <div className="mt-4">
                  <PermissionGrid
                    catalog={catalog}
                    ownerOnlyKeys={ownerOnlyKeys}
                    checkedKeys={draftKeys}
                    onToggle={toggleDraftKey}
                    disabled={savingRole}
                    idPrefix={`edit-${editingRole.id}`}
                  />
                </div>
                {editDirty && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Changes to save:
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      {diffParts(editDiff.added, editDiff.removed).join("; ") || "No changes."}
                    </p>
                    <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100">
                      This changes access for {staffCountText(editingRole.active_assignee_count)}.
                    </p>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveRoleEdit}
                    disabled={savingRole || !editDirty}
                    className="rounded-full bg-sky-700 px-4 py-2 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
                  >
                    {savingRole ? "Saving…" : "Save role changes"}
                  </button>
                  <button
                    type="button"
                    onClick={closeEditor}
                    disabled={savingRole}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Close without saving
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-base font-black text-slate-950 dark:text-slate-50">
              Create a new role
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Start with no permissions and tick only what the role needs. Owner-only finance
              permissions can never be added to a role.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!createName.trim() || !createDisplayName.trim()) {
                  notify("Give the role a name and a display name.", true);
                  return;
                }
                setConfirmingCreate(true);
              }}
              className="mt-3 grid gap-3 md:grid-cols-2"
            >
              <label className="block">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Role name
                </span>
                <input
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="e.g. leasing_agent"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <label className="block">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Display name
                </span>
                <input
                  type="text"
                  value={createDisplayName}
                  onChange={(event) => setCreateDisplayName(event.target.value)}
                  placeholder="e.g. Leasing Agent"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-600 dark:bg-slate-800"
                />
              </label>
              <div className="md:col-span-2">
                <PermissionGrid
                  catalog={catalog}
                  ownerOnlyKeys={ownerOnlyKeys}
                  checkedKeys={createKeys}
                  onToggle={toggleCreateKey}
                  disabled={creating}
                  idPrefix="create"
                />
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button
                  type="submit"
                  disabled={creating || !createName.trim() || !createDisplayName.trim()}
                  className="rounded-full bg-sky-700 px-5 py-2.5 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
                >
                  Create role
                </button>
              </div>
            </form>
            {confirmingCreate && (
              <div
                role="status"
                className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800"
              >
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Create the {createDisplayName.trim()} role
                  {createKeys.length > 0
                    ? ` with ${rentalAdminKeyLabels(createKeys).join(", ")}?`
                    : " with no permissions?"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={createRole}
                    disabled={creating}
                    className="rounded-full bg-sky-700 px-4 py-2 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
                  >
                    {creating ? "Creating…" : "Yes, create role"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingCreate(false)}
                    disabled={creating}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Back to editing
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <h3 className="text-base font-black text-slate-950 dark:text-slate-50">
              Role change log
            </h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Every role created, changed, assigned, removed, and retired — newest first.
            </p>
            {audit.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">No role changes yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {audit.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0 dark:border-slate-800"
                  >
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {auditSummary(entry, resolveEmail)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {entry.created_at || entry.createdAt
                        ? new Date(entry.created_at || entry.createdAt).toLocaleString()
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
