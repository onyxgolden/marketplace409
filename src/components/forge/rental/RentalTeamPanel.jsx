"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RENTAL_PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_LABELS,
  STAFF_ROLES,
} from "@/lib/rental/permissions";

const ROLE_OPTIONS = STAFF_ROLES;

const AUDIT_LABELS = {
  "member.invited": "Invited",
  "member.role_changed": "Role changed",
  "member.permissions_changed": "Permissions changed",
  "member.suspended": "Suspended",
  "member.reactivated": "Reactivated",
  "preview.start": "Preview started",
  "preview.end": "Preview ended",
};

function auditSummary(entry) {
  const label = AUDIT_LABELS[entry.action] || entry.action;
  const detail = entry.detail || {};
  if (entry.action === "member.role_changed" && detail.from && detail.to) {
    return `${label}: ${(ROLE_LABELS[detail.from] || detail.from)} → ${(ROLE_LABELS[detail.to] || detail.to)}`;
  }
  if (entry.action === "member.invited" && detail.role) {
    return `${label} as ${ROLE_LABELS[detail.role] || detail.role}`;
  }
  if (entry.action === "preview.start" && detail.email) {
    return `${label}: previewing as ${detail.email}`;
  }
  return label;
}

const CATEGORY_ORDER = ["Money", "Operations", "Visibility", "Administration"];

function groupedCatalog(catalog) {
  const groups = [];
  for (const category of CATEGORY_ORDER) {
    const items = catalog.filter((p) => p.category === category);
    if (items.length > 0) groups.push({ category, items });
  }
  return groups;
}

function MemberCard({ member, catalog, viewerId, onChanged, onNotify }) {
  // NO-GO fix 2026-10-01 (finding 2): team.manage is never offered as a per-person
  // override for staff — only the primary owner (implicit) and co_owner hold it.
  const toggleableCatalog = member.role === "co_owner"
    ? catalog
    : catalog.filter((p) => p.key !== "team.manage");
  const [role, setRole] = useState(member.role);
  const [overrides, setOverrides] = useState(member.permissionOverrides || {});
  const [saving, setSaving] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);

  const defaults = useMemo(
    () => new Set(ROLE_DEFAULT_PERMISSIONS[role] || []),
    [role]
  );
  const effective = useCallback(
    (key) => (key in overrides ? overrides[key] : defaults.has(key)),
    [overrides, defaults]
  );
  const dirty =
    role !== member.role ||
    JSON.stringify(overrides) !== JSON.stringify(member.permissionOverrides || {});

  async function patch(body, successMessage) {
    setSaving(true);
    try {
      const response = await fetch("/api/rental/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ memberId: member.id, ...body }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "Unable to update that member.");
      onChanged(result.member);
      onNotify(successMessage, false);
    } catch (error) {
      onNotify(error.message, true);
    } finally {
      setSaving(false);
    }
  }

  function togglePermission(key) {
    setOverrides((prev) => ({ ...prev, [key]: !effective(key) }));
  }

  const isSelf = member.memberUserId === viewerId;

  async function startPreview() {
    setSaving(true);
    try {
      const response = await fetch("/api/rental/team/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ memberId: member.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "Unable to start the preview.");
      onNotify(`Previewing as ${member.email} — read-only.`, false);
      window.dispatchEvent(new Event("forge:team-preview-change"));
      window.dispatchEvent(new Event("forge:team-permissions-change"));
    } catch (error) {
      onNotify(error.message, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article
      data-team-member={member.id}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-black text-slate-950 dark:text-slate-50">{member.email}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {member.roleLabel}
            {member.status !== "active" && (
              <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase dark:bg-slate-700">
                {member.status}
              </span>
            )}
            {isSelf && <span className="ml-2 text-xs font-bold text-slate-500">(you)</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {member.status === "active" && !isSelf && (
            <button
              type="button"
              onClick={startPreview}
              disabled={saving}
              title="Preview the app exactly as this team member experiences it (read-only)"
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              👁 View as
            </button>
          )}
          {!isSelf && member.status === "active" && (
            <button
              type="button"
              onClick={() => patch({ statusAction: "suspend" }, `${member.email} suspended.`)}
              disabled={saving}
              className="rounded-full border border-red-300 px-3 py-1.5 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            >
              Suspend
            </button>
          )}
          {!isSelf && member.status === "suspended" && (
            <button
              type="button"
              onClick={() => patch({ statusAction: "reactivate" }, `${member.email} reactivated.`)}
              disabled={saving}
              className="rounded-full border border-emerald-300 px-3 py-1.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
            >
              Reactivate
            </button>
          )}
        </div>
      </div>

      {!isSelf && member.status === "active" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              disabled={saving}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 font-bold dark:border-slate-600 dark:bg-slate-800"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setShowPermissions((v) => !v)}
              className="rounded-full border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
              aria-expanded={showPermissions}
            >
              {showPermissions ? "Hide permissions" : "Edit individual permissions"}
            </button>
          </div>
        </div>
      )}

      {showPermissions && !isSelf && member.status === "active" && (
        <div className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
            Toggles start at the role default. Changing one sets a per-person override;
            <span className="font-bold"> Custom</span> marks what you changed.
          </p>
          {groupedCatalog(toggleableCatalog).map((group) => (
            <fieldset key={group.category} className="mb-4 last:mb-0">
              <legend className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500">
                {group.category}
              </legend>
              <ul className="space-y-2">
                {group.items.map((permission) => {
                  const granted = effective(permission.key);
                  const customized = permission.key in overrides;
                  return (
                    <li key={permission.key}>
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={() => togglePermission(permission.key)}
                          disabled={saving}
                          className="mt-1 h-4 w-4 accent-sky-600"
                        />
                        <span>
                          <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                            {permission.label}
                            {customized && (
                              <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 dark:bg-sky-900 dark:text-sky-200">
                                Custom
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
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOverrides({})}
              disabled={saving || Object.keys(overrides).length === 0}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              Reset to role defaults
            </button>
          </div>
        </div>
      )}

      {dirty && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => patch({ role, permissionOverrides: overrides }, `${member.email} updated.`)}
            disabled={saving}
            className="rounded-full bg-sky-700 px-4 py-2 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => {
              setRole(member.role);
              setOverrides(member.permissionOverrides || {});
            }}
            disabled={saving}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-bold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Discard
          </button>
        </div>
      )}
    </article>
  );
}

export default function RentalTeamPanel() {
  const [members, setMembers] = useState(null);
  const [catalog, setCatalog] = useState(RENTAL_PERMISSIONS);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("property_manager");
  const [inviting, setInviting] = useState(false);
  const [viewerId, setViewerId] = useState(null);

  const notify = useCallback((message, isError) => {
    setNotice({ message, isError: Boolean(isError) });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [teamResponse, auditResponse] = await Promise.all([
        fetch("/api/rental/team", { credentials: "same-origin" }),
        fetch("/api/rental/team/audit", { credentials: "same-origin" }),
      ]);
      const teamBody = await teamResponse.json();
      if (!teamResponse.ok) throw new Error(teamBody?.error || "Unable to load the team.");
      setMembers(teamBody.members || []);
      setCatalog(teamBody.permissionCatalog?.length ? teamBody.permissionCatalog : RENTAL_PERMISSIONS);
      setViewerId(teamBody.viewerId || null);
      const auditBody = await auditResponse.json();
      if (auditResponse.ok) setAudit(auditBody.entries || []);
    } catch (error) {
      notify(error.message, true);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial team + audit fetch when the panel mounts; later refreshes are user-triggered.
    load();
  }, [load]);

  async function invite(event) {
    event.preventDefault();
    setInviting(true);
    try {
      const response = await fetch("/api/rental/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "Unable to invite that member.");
      setMembers((prev) => [result.member, ...(prev || [])]);
      setInviteEmail("");
      notify(`Invite recorded for ${result.member.email}. They accept from their own account.`, false);
    } catch (error) {
      notify(error.message, true);
    } finally {
      setInviting(false);
    }
  }

  function handleMemberChanged(updated) {
    setMembers((prev) => (prev || []).map((m) => (m.id === updated.id ? updated : m)));
    load();
  }

  return (
    <section data-rental-team-panel className="space-y-6">
      <div>
        <h2 className="text-xl font-black text-slate-950 dark:text-slate-50">Team &amp; Permissions</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          Invite team members, assign roles, and fine-tune what each person can do. The owner and
          co-owner always have full access. Everyone else starts from their role&apos;s defaults,
          which you can override person by person. Use <span className="font-bold">👁 View as</span> to
          check exactly what a team member experiences — previewing is read-only and every session
          is logged below.
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

      <form
        onSubmit={invite}
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <h3 className="text-base font-black text-slate-950 dark:text-slate-50">Invite a team member</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          They must already have a FORGE account with a confirmed email address — enter that exact email.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Email</span>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 dark:border-slate-600 dark:bg-slate-800"
            />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Role</span>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-2.5 font-bold dark:border-slate-600 dark:bg-slate-800"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="rounded-full bg-sky-700 px-5 py-2.5 text-sm font-black text-white hover:bg-sky-800 disabled:opacity-50"
            >
              {inviting ? "Inviting…" : "Invite"}
            </button>
          </div>
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading the team…</p>
      ) : (
        <div className="grid gap-4">
          {(members || []).map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              catalog={catalog}
              viewerId={viewerId}
              onChanged={handleMemberChanged}
              onNotify={notify}
            />
          ))}
          {(members || []).length === 0 && (
            <p className="text-sm text-slate-500">No team members yet — just you.</p>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-base font-black text-slate-950 dark:text-slate-50">What each role can do</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Role defaults are fixed — adjust individuals with the per-person toggles above.
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(ROLE_LABELS)
            .filter(([role]) => role !== "primary_owner")
            .map(([role, label]) => {
              const granted = new Set(ROLE_DEFAULT_PERMISSIONS[role] || []);
              return (
                <div key={role} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <p className="font-black text-slate-900 dark:text-slate-100">{label}</p>
                  {granted.size === 0 ? (
                    <p className="mt-1 text-sm text-slate-500">View only — no actions.</p>
                  ) : (
                    <ul className="mt-2 space-y-1">
                      {catalog
                        .filter((p) => granted.has(p.key))
                        .map((p) => (
                          <li key={p.key} className="text-sm text-slate-600 dark:text-slate-300">
                            ✓ {p.label}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-base font-black text-slate-950 dark:text-slate-50">Team activity log</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Every invite, role change, permission change, suspension, and preview session.
        </p>
        {audit.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No team activity yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2 text-sm last:border-0 dark:border-slate-800">
                <span className="font-bold text-slate-800 dark:text-slate-200">{auditSummary(entry)}</span>
                <span className="text-xs text-slate-500">
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
