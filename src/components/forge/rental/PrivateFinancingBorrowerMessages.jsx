"use client";
import { useEffect, useState } from "react";
import ConversationThread from "./ConversationThread";

// Messaging is a borrower<->owner relationship, not per-loan -- one conversation covers every
// financing account this borrower has with a given owner. Rendered once per conversation entry
// (virtually always exactly one; more than one only for a borrower with separate relationships
// under different owners), each carrying its own ownerId so send/mark-read resolve unambiguously.
export default function PrivateFinancingBorrowerMessages({ conversations, onChanged }) {
  if (!conversations || conversations.length === 0) return null;
  return <section className="mt-6 rounded-2xl border bg-white p-6 shadow-sm">
    <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Messages</p>
    <h2 className="mt-2 text-xl font-black">Message your lender</h2>
    <p className="mt-1 text-sm text-slate-600">Reach out any time you run into an issue, or share a suggestion.</p>
    <div className="mt-4 space-y-6">
      {conversations.map((conversation) => <ConversationPanel key={conversation.ownerId} conversation={conversation} onChanged={onChanged} />)}
    </div>
  </section>;
}

function ConversationPanel({ conversation, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!conversation.hasUnread) return;
    let cancelled = false;
    fetch("/api/private-financing/portal", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "mark-conversation-read", ownerId: conversation.ownerId }) })
      .then(() => { if (!cancelled) onChanged(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(body, category) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/private-financing/portal", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "send-message", body, category, ownerId: conversation.ownerId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      await onChanged();
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }

  return <ConversationThread messages={conversation.messages} selfSenderType="borrower" onSend={send} busy={busy} error={error} allowCategory />;
}
