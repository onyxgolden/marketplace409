"use client";
import { useEffect, useState } from "react";

// Rentec parity R6 — minimal template picker for a message composer.
// Fetches tenant/text templates, renders the chosen one server-side against
// the work order's merge fields, and hands the rendered text to onInsert.
// No send path: the composer owns sending, exactly as before.
//
// Wiring (R5 WorkOrderMessages in RentalMaintenancePanel.jsx, once PR #510
// merges — ConversationThread already accepts composerAddon):
//   <ConversationThread
//     ...
//     composerAddon={({ insertText }) => (
//       <MessageTemplatePicker workOrderId={workOrderId} onInsert={insertText} />
//     )}
//   />

export default function MessageTemplatePicker({ workOrderId, audience = "tenant", kind = "text", onInsert }) {
  const [templates, setTemplates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/rental/message-templates?kind=${encodeURIComponent(kind)}&audience=${encodeURIComponent(audience)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load templates.");
        if (!cancelled) setTemplates(body.templates || []);
      } catch (reason) { if (!cancelled) setError(reason.message); }
    }
    load();
    return () => { cancelled = true; };
  }, [kind, audience]);

  async function choose(templateId) {
    if (!templateId) return;
    setBusy(true); setError(""); setWarning("");
    try {
      const response = await fetch("/api/rental/message-templates/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId, workOrderId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to render the template.");
      if (result.missingFields?.length) {
        setWarning(`Some fields had no value and were left blank: ${result.missingFields.join(", ")}.`);
      }
      onInsert(result.body);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  if (templates.length === 0 && !error) return null;
  return <div className="mb-2 flex flex-wrap items-center gap-2">
    <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Template
      <select aria-label="Insert a message template" disabled={busy} defaultValue="" onChange={(event) => { choose(event.target.value); event.target.value = ""; }}
        className="ml-2 rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white">
        <option value="">Insert a template…</option>
        {templates.map((template) => <option key={template.id} value={template.id}>
          {template.name}{template.isSystem ? "" : " (custom)"}
        </option>)}
      </select>
    </label>
    {busy ? <span className="text-xs text-slate-500">Rendering…</span> : null}
    {error ? <span role="alert" className="text-xs font-bold text-red-700">{error}</span> : null}
    {warning ? <span role="status" className="text-xs font-bold text-amber-700 dark:text-amber-400">{warning}</span> : null}
  </div>;
}
