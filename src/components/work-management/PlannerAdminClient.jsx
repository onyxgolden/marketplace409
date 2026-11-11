"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PLANNER_CAPABILITIES, starterRoleLabel } from "@/lib/planner/permissions";
import { withWorkspaceQuery } from "./workspaceQuery.js";

// Work Package Planner admin page (slice 1). Every write here goes through
// the same RPCs the migration test proves — this component only decides
// what to show and what to send; the server re-checks everything (the hard
// rule: no drawing-edit capability exists anywhere in PLANNER_CAPABILITIES,
// and nothing in this file can grant one).

const btn = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const btnPrimary = `${btn} bg-slate-900 text-white hover:bg-slate-700`;
const btnGhost = `${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`;
const btnDanger = `${btn} bg-red-600 text-white hover:bg-red-500`;
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

const CATEGORY_ORDER = [
  "Packages", "Drawings", "Steps", "Crafts", "Manpower", "Baselines",
  "Progress", "Permits", "Reports", "Administration",
];

function groupedCapabilities() {
  const groups = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  for (const cap of PLANNER_CAPABILITIES) {
    if (!groups.has(cap.category)) groups.set(cap.category, []);
    groups.get(cap.category).push(cap);
  }
  return [...groups.entries()].filter(([, caps]) => caps.length > 0);
}

function roleDisplayName(role) {
  if (role.is_builtin && role.role_key === "owner") return "Owner";
  return role.name || starterRoleLabel(role.role_key) || role.role_key;
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

export default function PlannerAdminClient() {
  const [snapshot, setSnapshot] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [staleWarning, setStaleWarning] = useState("");

  const [searchQuery, setSearchQuery] = useState({ userId: "", email: "" });
  const [searchResults, setSearchResults] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);

  const [assignTarget, setAssignTarget] = useState(null); // staff row being assigned
  const [assignRoleId, setAssignRoleId] = useState("");

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditError, setAuditError] = useState("");
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLoading, setAuditLoading] = useState(false);
  const AUDIT_PAGE_SIZE = 25;

  // One generic confirm modal reused for every mutating action (capability
  // toggle, assign, revoke, provision) — plain-English, names the person
  // and role, never submits until explicitly confirmed.
  const [confirm, setConfirm] = useState(null); // { title, body, onConfirm }
  const confirmTriggerRef = useRef(null);

  async function loadSnapshot() {
    setLoading(true);
    setLoadError("");
    const { response, data } = await callJson("/api/work-packages/admin/roles");
    setLoading(false);
    if (!response.ok) {
      setLoadError(data.error || "Unable to load roles.");
      return;
    }
    setSnapshot(data.snapshot);
  }

  async function loadAudit(offset = 0) {
    setAuditLoading(true);
    setAuditError("");
    const { response, data } = await callJson(
      `/api/work-packages/admin/audit?limit=${AUDIT_PAGE_SIZE}&offset=${offset}`,
    );
    setAuditLoading(false);
    if (!response.ok) {
      setAuditError(data.error || "Unable to load the audit log.");
      return;
    }
    setAuditEntries(data.entries || []);
    setAuditOffset(offset);
  }

  // Opened on demand only — the audit timeline is a secondary, research-only
  // panel. It never fetches until a reviewer actually asks to see it (Jason,
  // 2026-11-10: never render it open by default, never assume it's wanted).
  function openAuditTimeline() {
    setAuditOpen(true);
    loadAudit(0);
  }

  function closeAuditTimeline() {
    setAuditOpen(false);
  }

  // Mount-time load: inline fetch chain with a cancellation guard (this
  // directory's established pattern for effect-triggered loads — see
  // WorkPackageDetailClient's property-options effect) rather than calling
  // the reusable loadSnapshot helper directly from the effect body, since it
  // sets state synchronously as its first statement. The audit timeline is
  // not fetched here — it only loads once a reviewer opens it.
  useEffect(() => {
    let cancelled = false;
    callJson("/api/work-packages/admin/roles").then(({ response, data }) => {
      if (cancelled) return;
      setLoading(false);
      if (!response.ok) {
        setLoadError(data.error || "Unable to load roles.");
        return;
      }
      setSnapshot(data.snapshot);
    });
    return () => { cancelled = true; };
  }, []);

  const capabilitiesByRole = useMemo(() => {
    const map = new Map();
    for (const row of snapshot?.capabilities || []) {
      if (!map.has(row.role_id)) map.set(row.role_id, new Set());
      map.get(row.role_id).add(row.capability_key);
    }
    return map;
  }, [snapshot]);

  const assignmentsByRole = useMemo(() => {
    const map = new Map();
    for (const a of snapshot?.assignments || []) {
      if (!map.has(a.role_id)) map.set(a.role_id, []);
      map.get(a.role_id).push(a);
    }
    return map;
  }, [snapshot]);

  function closeConfirm() {
    setConfirm(null);
  }

  // Escape closes the confirm dialog (never mid-request); focus returns to
  // whatever triggered it, matching this directory's existing delete-dialog
  // convention (WorkPackageDetailClient).
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

  // Escape closes the audit screen too, matching the confirm dialog's
  // existing convention in this component.
  useEffect(() => {
    if (!auditOpen) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") closeAuditTimeline();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [auditOpen]);

  function askConfirm({ title, body, onConfirm }, triggerEl) {
    confirmTriggerRef.current = triggerEl || null;
    setConfirm({ title, body, onConfirm });
  }

  async function runMutation(fn) {
    setBusy(true);
    setNotice("");
    setStaleWarning("");
    try {
      const { response, data } = await fn();
      setBusy(false);
      if (!response.ok) {
        if (response.status === 409) {
          setStaleWarning(data.error || "This was changed by someone else. Reloading current state.");
          await loadSnapshot();
        } else {
          setNotice(data.error || "Request failed.");
        }
        return false;
      }
      return true;
    } catch {
      setBusy(false);
      setNotice("Request failed.");
      return false;
    }
  }

  async function provisionStarterRoles(triggerEl) {
    askConfirm(
      {
        title: "Create the starter roles",
        body: "This creates the five starter roles (Planner Admin, Planner, Scheduler, Reviewer, Read-only) for this workspace. Existing roles are never changed.",
        onConfirm: async () => {
          const ok = await runMutation(() => callJson("/api/work-packages/admin/roles/provision", { method: "POST", body: {} }));
          closeConfirm();
          if (ok) {
            setNotice("Starter roles created.");
            await loadSnapshot();
            await loadAudit(0);
          }
        },
      },
      triggerEl,
    );
  }

  function toggleCapability(role, capKey, nextGrant, triggerEl) {
    const capLabel = PLANNER_CAPABILITIES.find((c) => c.key === capKey)?.label || capKey;
    askConfirm(
      {
        title: nextGrant ? "Grant a permission" : "Remove a permission",
        body: `${nextGrant ? "Grant" : "Remove"} "${capLabel}" ${nextGrant ? "to" : "from"} the ${roleDisplayName(role)} role? This takes effect immediately for every user currently assigned this role.`,
        onConfirm: async () => {
          const ok = await runMutation(() =>
            callJson(`/api/work-packages/admin/roles/${role.id}/capabilities`, {
              method: "PATCH",
              body: { capabilityKey: capKey, grant: nextGrant, expectedVersion: role.version },
            }),
          );
          closeConfirm();
          if (ok) {
            setNotice(`"${capLabel}" ${nextGrant ? "granted to" : "removed from"} ${roleDisplayName(role)}.`);
            await loadSnapshot();
            await loadAudit(0);
          }
        },
      },
      triggerEl,
    );
  }

  async function runSearch(event) {
    event.preventDefault();
    setSearchBusy(true);
    setSearchError("");
    setSearchResults(null);
    const { response, data } = await callJson(
      `/api/work-packages/admin/staff/search?${searchQuery.userId ? `userId=${encodeURIComponent(searchQuery.userId)}` : `email=${encodeURIComponent(searchQuery.email)}`}`,
    );
    setSearchBusy(false);
    if (!response.ok) {
      setSearchError(data.error || "Search failed.");
      return;
    }
    setSearchResults(data.results || []);
  }

  function openAssignFlow(staffRow) {
    setAssignTarget(staffRow);
    setAssignRoleId("");
  }

  function confirmAssign(triggerEl) {
    const role = snapshot?.roles.find((r) => r.id === assignRoleId);
    if (!assignTarget || !role) return;
    askConfirm(
      {
        title: "Assign role",
        body: `Assign ${assignTarget.email || assignTarget.user_id} the ${roleDisplayName(role)} role? Any existing role they hold in this workspace is replaced.`,
        onConfirm: async () => {
          const ok = await runMutation(() =>
            callJson("/api/work-packages/admin/assignments", {
              method: "POST",
              body: { assigneeUserId: assignTarget.user_id, roleId: assignRoleId },
            }),
          );
          closeConfirm();
          if (ok) {
            setNotice(`${assignTarget.email || assignTarget.user_id} assigned to ${roleDisplayName(role)}.`);
            setAssignTarget(null);
            setAssignRoleId("");
            setSearchResults(null);
            await loadSnapshot();
            await loadAudit(0);
          }
        },
      },
      triggerEl,
    );
  }

  function confirmRevoke(assignment, triggerEl) {
    askConfirm(
      {
        title: "Revoke role assignment",
        body: `Revoke this role assignment for user ${assignment.assignee_user_id}? They will have no Planner role until reassigned.`,
        onConfirm: async () => {
          const ok = await runMutation(() =>
            callJson(`/api/work-packages/admin/assignments/${assignment.id}`, {
              method: "DELETE",
              body: { expectedVersion: assignment.version },
            }),
          );
          closeConfirm();
          if (ok) {
            setNotice(`Revoked role assignment for ${assignment.assignee_user_id}.`);
            await loadSnapshot();
            await loadAudit(0);
          }
        },
      },
      triggerEl,
    );
  }

  if (loading) return <p className="mt-6 text-sm text-slate-500">Loading roles…</p>;
  if (loadError) {
    return (
      <div className="mt-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">
        {loadError}
        {loadError.includes("not available yet") && (
          <p className="mt-1 text-xs text-red-600">
            The admin permissions migration has not been applied to this environment yet.
          </p>
        )}
      </div>
    );
  }

  const roles = snapshot?.roles || [];
  const groups = groupedCapabilities();

  return (
    <div className="mt-6 space-y-8">
      {notice && (
        <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{notice}</p>
      )}
      {staleWarning && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{staleWarning}</p>
      )}

      <div className="flex justify-end">
        <button type="button" className={btnGhost} onClick={openAuditTimeline}>
          View audit timeline
        </button>
      </div>

      {roles.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p className="text-slate-600">No roles exist yet for this workspace.</p>
          <button
            type="button"
            className={`${btnPrimary} mt-3`}
            disabled={busy}
            onClick={(event) => provisionStarterRoles(event.currentTarget)}
          >
            Create starter roles
          </button>
        </section>
      ) : (
        <section aria-labelledby="planner-admin-roles-heading">
          <h2 id="planner-admin-roles-heading" className="text-lg font-semibold">Roles &amp; permissions</h2>
          <p className="mt-1 text-sm text-slate-500">
            A role change takes effect for every assignee on their next request. The Owner role and
            drawing edits can never be granted — see the Administration group below for role editing
            itself.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 bg-white px-3 py-2 text-left font-medium text-slate-600">Permission</th>
                  {roles.map((role) => (
                    <th key={role.id} scope="col" className="px-3 py-2 text-left font-medium text-slate-600">
                      {roleDisplayName(role)}
                      {role.is_builtin && <span className="ml-1 text-xs text-slate-400">(built-in)</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map(([category, caps]) => (
                  <>
                    <tr key={`${category}-header`}>
                      <th scope="rowgroup" colSpan={roles.length + 1} className="bg-slate-50 px-3 py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {category}
                      </th>
                    </tr>
                    {caps.map((cap) => (
                      <tr key={cap.key} className="border-t border-slate-100">
                        <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-normal text-slate-700">
                          {cap.label}
                        </th>
                        {roles.map((role) => {
                          const granted = capabilitiesByRole.get(role.id)?.has(cap.key) ?? false;
                          // D3: is_builtin marks the 5 starter roles (seeded
                          // true by forge_planner_roles_provision_starter_set)
                          // -- it is NOT a proxy for "immutable." The backend
                          // (capability_set RPC) only refuses role_key ===
                          // "owner", which never has a row in practice (owner
                          // authority is structural, not role-data-dependent
                          // -- see PR #767). The old `!role.is_builtin` check
                          // disabled editing every real role in the system.
                          const editable = role.role_key !== "owner";
                          return (
                            <td key={role.id} className="px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={granted}
                                disabled={busy || !editable}
                                aria-label={`${cap.label} — ${roleDisplayName(role)}`}
                                onChange={(event) => toggleCapability(role, cap.key, !granted, event.currentTarget)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {roles.length > 0 && (
        <section aria-labelledby="planner-admin-assignments-heading">
          <h2 id="planner-admin-assignments-heading" className="text-lg font-semibold">Role assignments</h2>

          <form onSubmit={runSearch} className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="planner-admin-search-id" className="block text-xs font-medium text-slate-600 mb-1">User ID</label>
              <input
                id="planner-admin-search-id"
                className={input}
                value={searchQuery.userId}
                onChange={(event) => setSearchQuery({ userId: event.target.value, email: "" })}
                placeholder="exact user id"
              />
            </div>
            <span className="pb-2 text-xs text-slate-400">or</span>
            <div>
              <label htmlFor="planner-admin-search-email" className="block text-xs font-medium text-slate-600 mb-1">Verified email</label>
              <input
                id="planner-admin-search-email"
                className={input}
                value={searchQuery.email}
                onChange={(event) => setSearchQuery({ userId: "", email: event.target.value })}
                placeholder="exact email"
              />
            </div>
            <button type="submit" className={btnGhost} disabled={searchBusy || (!searchQuery.userId && !searchQuery.email)}>
              {searchBusy ? "Searching…" : "Search"}
            </button>
          </form>
          {searchError && <p role="alert" className="mt-2 text-sm text-red-700">{searchError}</p>}
          {searchResults && searchResults.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">No match found.</p>
          )}
          {searchResults && searchResults.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {searchResults.map((staff) => (
                <li key={staff.user_id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-slate-700">{staff.email || staff.user_id}</span>
                  <button type="button" className={btnGhost} onClick={() => openAssignFlow(staff)}>
                    Assign a role…
                  </button>
                </li>
              ))}
            </ul>
          )}

          {assignTarget && (
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-700">
                Assigning <span className="font-medium">{assignTarget.email || assignTarget.user_id}</span>:
              </p>
              <select
                className={input}
                style={{ width: "auto" }}
                value={assignRoleId}
                onChange={(event) => setAssignRoleId(event.target.value)}
                aria-label="Role to assign"
              >
                <option value="">Choose a role…</option>
                {/* D3: assignable roles are every real role (the 5 starter
                    roles AND any custom roles) -- excluding only a literal
                    "owner" row, which never exists in practice. The old
                    `!r.is_builtin` filter excluded every starter role,
                    leaving nothing to assign. */}
                {roles.filter((r) => r.role_key !== "owner").map((role) => (
                  <option key={role.id} value={role.id}>{roleDisplayName(role)}</option>
                ))}
              </select>
              <button
                type="button"
                className={btnPrimary}
                disabled={!assignRoleId || busy}
                onClick={(event) => confirmAssign(event.currentTarget)}
              >
                Assign
              </button>
              <button type="button" className={btnGhost} onClick={() => setAssignTarget(null)}>Cancel</button>
            </div>
          )}

          <h3 className="mt-6 text-sm font-semibold text-slate-700">Currently assigned</h3>
          {roles.filter((r) => r.role_key !== "owner").every((r) => !(assignmentsByRole.get(r.id) || []).length) ? (
            <p className="mt-1 text-sm text-slate-500">No one has been assigned a role yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {roles.filter((r) => r.role_key !== "owner").flatMap((role) =>
                (assignmentsByRole.get(role.id) || []).map((a) => (
                  <li key={a.id} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm text-slate-700">
                      {a.assignee_user_id} — <span className="font-medium">{roleDisplayName(role)}</span>
                    </span>
                    <button type="button" className={btnDanger} disabled={busy} onClick={(event) => confirmRevoke(a, event.currentTarget)}>
                      Revoke
                    </button>
                  </li>
                )),
              )}
            </ul>
          )}
        </section>
      )}

      {auditOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="planner-admin-audit-heading"
          className="fixed inset-0 z-40 overflow-y-auto bg-white"
        >
          <div className="mx-auto max-w-3xl px-4 py-6">
            <div className="flex items-center justify-between">
              <h2 id="planner-admin-audit-heading" className="text-lg font-semibold">Audit timeline</h2>
              <button type="button" className={btnGhost} onClick={closeAuditTimeline}>
                Back to admin
              </button>
            </div>
            {auditLoading && <p className="mt-4 text-sm text-slate-500">Loading…</p>}
            {auditError && <p role="alert" className="mt-4 text-sm text-red-700">{auditError}</p>}
            {!auditLoading && !auditError && auditEntries.length === 0 && (
              <p className="mt-4 text-sm text-slate-500">No role or permission changes recorded yet.</p>
            )}
            {!auditLoading && auditEntries.length > 0 && (
              <>
                <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {auditEntries.map((entry) => (
                    <li key={entry.id} className="px-3 py-2 text-sm text-slate-700">
                      <span className="text-xs font-mono text-slate-400">{new Date(entry.recorded_at).toLocaleString()}</span>{" "}
                      — <span className="font-medium">{entry.action.replace(/_/g, " ")}</span> by {entry.actor_id}
                      {entry.target_user_id ? ` on ${entry.target_user_id}` : ""}
                      {entry.reason ? <span className="text-slate-500"> — &ldquo;{entry.reason}&rdquo;</span> : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <button type="button" className={btnGhost} disabled={auditOffset === 0} onClick={() => loadAudit(Math.max(0, auditOffset - AUDIT_PAGE_SIZE))}>
                    Newer
                  </button>
                  <button type="button" className={btnGhost} disabled={auditEntries.length < AUDIT_PAGE_SIZE} onClick={() => loadAudit(auditOffset + AUDIT_PAGE_SIZE)}>
                    Older
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) closeConfirm();
          }}
        >
          <div role="dialog" aria-modal="true" aria-labelledby="planner-admin-confirm-title" className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 id="planner-admin-confirm-title" className="text-base font-semibold text-slate-900">{confirm.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirm.body}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={btnGhost} disabled={busy} onClick={closeConfirm} autoFocus>
                Cancel
              </button>
              <button type="button" className={btnPrimary} disabled={busy} onClick={confirm.onConfirm}>
                {busy ? "Working…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
