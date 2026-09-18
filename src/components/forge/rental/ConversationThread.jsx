"use client";
import { useState } from "react";

const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const CATEGORY_LABEL = { issue: "Issue", suggestion: "Suggestion" };

// Shared, presentation-only thread UI for all four surfaces (rental owner/tenant, private
// financing owner/borrower) -- each surface's own component owns the fetch/send wiring and passes
// plain data in, exactly like TenantPaymentForm is shared across the rental and private-financing
// payment flows.
export default function ConversationThread({ messages, selfSenderType, onSend, busy = false, error = "", allowCategory = false, placeholder = "Type a message…" }) {
  const [category, setCategory] = useState("");
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get("body")?.toString().trim();
    if (!body) return;
    await onSend(body, category || null);
    form.reset(); setCategory("");
  }
  return <div className="flex flex-col gap-4">
    <div className="max-h-96 space-y-3 overflow-y-auto rounded-xl border bg-slate-50 p-4">
      {messages.length === 0 ? <p className="text-sm text-slate-500">No messages yet.</p> : messages.map((message) => {
        const isSelf = message.senderType === selfSenderType;
        return <div key={message.id} className={`flex ${isSelf ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${isSelf ? "bg-slate-950 text-white" : "border bg-white text-slate-950"}`}>
            {message.category ? <p className={`text-xs font-bold uppercase tracking-wide ${isSelf ? "text-amber-300" : "text-amber-700"}`}>{CATEGORY_LABEL[message.category]}</p> : null}
            <p className="whitespace-pre-wrap text-sm">{message.body}</p>
            <p className={`mt-1 text-xs ${isSelf ? "text-slate-300" : "text-slate-500"}`}>{dateTime.format(new Date(message.createdAt))}</p>
          </div>
        </div>;
      })}
    </div>
    <form onSubmit={submit} className="space-y-2">
      <textarea name="body" required placeholder={placeholder} rows={3}
        className="w-full rounded-xl border p-3 text-sm text-slate-950" />
      {allowCategory ? <div className="flex gap-2">
        {["issue", "suggestion"].map((value) => <button key={value} type="button" onClick={() => setCategory((current) => current === value ? "" : value)}
          className={`rounded-full border px-3 py-1 text-xs font-bold ${category === value ? "bg-slate-950 text-white" : "text-slate-600"}`}>
          {CATEGORY_LABEL[value]}
        </button>)}
      </div> : null}
      {error ? <p role="alert" className="text-sm font-bold text-red-700">{error}</p> : null}
      <button disabled={busy} className="rounded-xl bg-amber-500 px-5 py-2 font-black text-slate-950 disabled:opacity-50">
        {busy ? "Sending…" : "Send"}
      </button>
    </form>
  </div>;
}
