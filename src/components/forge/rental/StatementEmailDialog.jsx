"use client";
import { useEffect, useState } from "react";

// Explicit confirm dialog for owner-triggered tenant emails (Rentec parity
// R2). The send only happens when the owner presses the confirm button —
// opening the dialog never sends anything.
export default function StatementEmailDialog({ title, recipientEmail, summaryLines = [], confirmLabel, onConfirm, onClose }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function confirm() {
    setSending(true);
    setError("");
    try {
      await onConfirm();
    } catch (caught) {
      setError(caught?.message || "The email could not be sent.");
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-lg font-black text-slate-950 dark:text-white">{title}</h3>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="font-bold text-slate-500 dark:text-slate-400">To</dt>
            <dd className="font-black text-slate-900 dark:text-white">{recipientEmail || "—"}</dd>
          </div>
          {summaryLines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4">
              <dt className="font-bold text-slate-500 dark:text-slate-400">{line.label}</dt>
              <dd className="font-black text-slate-900 dark:text-white">{line.value}</dd>
            </div>
          ))}
        </dl>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={sending}
            className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={sending || !recipientEmail}
            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">
            {sending ? "Sending…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
