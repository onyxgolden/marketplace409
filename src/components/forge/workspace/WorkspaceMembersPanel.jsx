"use client";
import { useCallback, useEffect, useState } from "react";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";

const STATUS_LABELS = { invited: "Invited", active: "Active", suspended: "Suspended" };

export default function WorkspaceMembersPanel() {
  const [viewerRole, setViewerRole] = useState(null);
  const [viewerId, setViewerId] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    return fetch("/api/workspace/members")
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "Unable to load workspace members.");
        setViewerRole(payload.viewerRole);
        setViewerId(payload.viewerId);
        setMembers(payload.members || []);
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // resolveEffectiveOwnerId only matches an *active* co-owner membership, so viewerRole still reads
  // "primary_owner" for someone who has been invited but hasn't accepted yet -- their own pending row
  // shows up in `members` (via the self-select RLS policy) with memberUserId equal to their own id.
  // That, not viewerRole, is what identifies "this invitation is addressed to me."
  const ownPendingInvite = members.find((member) => member.memberUserId === viewerId && member.status === "invited");

  async function invite(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/workspace/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, role: "co_owner" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to invite that member.");
      setMessage(`Invited ${payload.member.invitedEmail} as a co-owner.`);
      setEmail("");
      await load();
    } catch (inviteError) {
      setError(inviteError.message);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/workspace/members/accept", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to accept that invitation.");
      setMessage("Invitation accepted. You now have co-owner access.");
      await load();
    } catch (acceptError) {
      setError(acceptError.message);
    } finally {
      setBusy(false);
    }
  }

  async function setSuspended(memberId, action) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/workspace/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId, action }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update that member.");
      setMessage(action === "suspend" ? "Access suspended." : "Access reactivated.");
      await load();
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Account</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Workspace members</h2>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Co-owners get full Rental Manager and Financial FORGE access to this workspace. Ownership itself, API secrets,
        and payout-bank changes always stay with the primary owner.
      </p>

      {loading ? <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading membership status…</p> : null}

      {!loading && ownPendingInvite ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
            You have a pending invitation to become a co-owner of this workspace.
          </p>
          <button type="button" disabled={busy} onClick={accept} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${goldControlClassName}`}>
            Accept invitation
          </button>
        </div>
      ) : null}

      {!loading && viewerRole === "co_owner" ? (
        <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200">
          You have co-owner access to this workspace. Only the primary owner can invite, suspend, or reactivate members.
        </p>
      ) : null}

      {!loading && viewerRole === "primary_owner" ? (
        <form onSubmit={invite} className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[220px]">
            <span className="block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Invite by email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="wife@example.com"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
            />
          </label>
          <button type="submit" disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-bold transition ${goldControlClassName}`}>
            Invite as co-owner
          </button>
        </form>
      ) : null}

      {!loading && members.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No workspace members yet.</p>
      ) : null}

      {members.map((member) => (
        <article key={member.id} className="mt-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <strong className="text-slate-950 dark:text-white">{member.invitedEmail}</strong>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {member.role.replaceAll("_", " ")} · {STATUS_LABELS[member.status] || member.status}
              </p>
            </div>
            {viewerRole === "primary_owner" && member.memberUserId !== viewerId && member.status !== "suspended" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setSuspended(member.id, "suspend")}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Suspend access
              </button>
            ) : null}
            {viewerRole === "primary_owner" && member.memberUserId !== viewerId && member.status === "suspended" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setSuspended(member.id, "reactivate")}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${goldControlClassName}`}
              >
                Reactivate access
              </button>
            ) : null}
          </div>
        </article>
      ))}

      {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700 dark:text-red-400">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-300">{message}</p> : null}
    </section>
  );
}
