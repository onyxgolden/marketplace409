"use client";
import { useEffect, useState } from "react";
import ConversationThread from "./ConversationThread";

export default function TenantMessagesPanel({ conversation, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Opening this panel IS the read action -- mirrors the owner's inbox (opening a thread marks it
  // read), so this fires once whenever the tenant actually views their messages, not on every
  // portal load regardless of whether they ever scroll to this panel.
  useEffect(() => {
    if (!conversation.hasUnread) return;
    let cancelled = false;
    fetch("/api/rental/portal", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "mark-conversation-read" }) })
      .then(() => { if (!cancelled) onChanged(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(body, category) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/rental/portal", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "send-message", body, category }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      await onChanged();
    } catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }

  return <section className="rounded-2xl border bg-white p-6 shadow-sm">
    <p className="text-sm font-bold uppercase tracking-widest text-amber-700">Messages</p>
    <h2 className="mt-2 text-xl font-black">Message your landlord</h2>
    <p className="mt-1 text-sm text-slate-600">Reach out any time you run into an issue, or share a suggestion.</p>
    <div className="mt-4">
      <ConversationThread messages={conversation.messages} selfSenderType="tenant" onSend={send} busy={busy} error={error} allowCategory />
    </div>
  </section>;
}
