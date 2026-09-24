"use client";
import { useState } from "react";
import ConversationThread from "./ConversationThread";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function threadPath(entry) {
  return entry.type === "rental" ? `/api/rental/conversations/${entry.id}/messages` : `/api/private-financing/conversations/${entry.id}/messages`;
}

// Fetches the merged owner inbox: rental conversations + private-financing
// conversations, sorted by most recent activity.
async function fetchOwnerInbox() {
  const [rental, pf] = await Promise.all([
    fetch("/api/rental").then(async (response) => ({ response, payload: await response.json() })),
    fetch("/api/private-financing/conversations").then(async (response) => ({ response, payload: await response.json() })),
  ]);
  if (!rental.response.ok) throw new Error(rental.payload.error);
  if (!pf.response.ok) throw new Error(pf.payload.error);
  const tenantsById = new Map((rental.payload.tenants || []).map((tenant) => [tenant.id, tenant.display_name]));
  const rentalEntries = (rental.payload.conversations || []).map((row) => ({
    type: "rental", id: row.tenantId, name: tenantsById.get(row.tenantId) || row.tenantId,
    lastMessageAt: row.lastMessageAt, lastMessageBody: row.lastMessageBody, lastMessageSenderType: row.lastMessageSenderType, unread: row.unread,
  }));
  const pfEntries = (pf.payload.conversations || []).map((row) => ({
    type: "private-financing", id: row.borrowerId, name: row.borrowerName,
    lastMessageAt: row.lastMessageAt, lastMessageBody: row.lastMessageBody, lastMessageSenderType: row.lastMessageSenderType, unread: row.unread,
  }));
  return [...rentalEntries, ...pfEntries].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

// A single owner inbox across both messaging domains -- a landlord and a private-financing lender
// are frequently the same person managing both from one workspace, and checking two separate
// message lists defeats the point. Each entry still resolves through its own domain-scoped API
// (rental_conversations vs private_financing_conversations); this panel only merges the summaries.
export default function MessagesPanel() {
  // Owner inbox: stale-while-revalidate under one global key. The cached list
  // renders instantly on return visits and refreshes in the background.
  const { data, error: loadError, isLoading, isRefreshing, refresh } = useStaleWhileRevalidate(
    "rental:owner-inbox",
    fetchOwnerInbox,
    { ttlMs: 60_000 },
  );
  const entries = data ?? null;
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState("");

  async function openThread(entry) {
    setSelected(entry); setThread(null); setSendError("");
    const response = await fetch(threadPath(entry));
    const payload = await response.json();
    if (response.ok) setThread(payload.messages);
    refresh();
  }

  async function send(body) {
    setBusy(true); setSendError("");
    try {
      const response = await fetch(threadPath(selected), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      await openThread(selected);
    } catch (reason) { setSendError(reason.message); } finally { setBusy(false); }
  }

  if (!entries && isLoading) return <ForgeLoadingState label="Loading messages…" />;
  if (!entries && loadError) return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><p role="alert" className="text-sm font-bold text-red-700">{loadError}</p></section>;

  return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
    <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700">Owner inbox</p>
    <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Tenant and borrower conversations</h2>
    <p className="mt-2 text-sm text-slate-500">One list across both messaging domains: rental tenants and private-financing borrowers. Each thread still resolves through its own domain-scoped API.</p>
    {entries && loadError ? <p role="status" className="mt-3 text-xs font-bold text-slate-400">Could not refresh — showing the last saved inbox.</p> : null}
    {entries && isRefreshing ? <p className="mt-3 text-xs font-bold text-slate-400">Updating…</p> : null}
    <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <ol className="divide-y rounded-xl border">
        {entries.length === 0 ? <li className="p-4 text-sm text-slate-500">No conversations yet.</li> : entries.map((entry) => (
          <li key={`${entry.type}:${entry.id}`}>
            <button onClick={() => openThread(entry)}
              className={`block w-full p-4 text-left ${selected?.id === entry.id && selected?.type === entry.type ? "bg-slate-100" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-950">{entry.name}</span>
                {entry.unread ? <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="Unread" /> : null}
              </div>
              <p className="text-xs uppercase tracking-wide text-slate-400">{entry.type === "rental" ? "Rental" : "Financing"}</p>
              <p className="mt-1 truncate text-sm text-slate-600">{entry.lastMessageBody}</p>
              <p className="text-xs text-slate-400">{dateTime.format(new Date(entry.lastMessageAt))}</p>
            </button>
          </li>
        ))}
      </ol>
      <div>
        {!selected ? <p className="text-sm text-slate-500">Select a conversation to view it.</p> : !thread ? <p className="text-sm text-slate-500">Loading conversation…</p> :
          <ConversationThread messages={thread} selfSenderType="owner" onSend={send} busy={busy} error={sendError} />}
      </div>
    </div>
  </section>;
}
