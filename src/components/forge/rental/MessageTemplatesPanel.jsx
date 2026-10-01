"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TEMPLATE_FIELDS } from "@/domains/rental-messaging/messageTemplates";

// Rentec parity R6 — the message templates library
// (Settings → Program → Message templates in Rentec's IA; FORGE mounts it in
// the Communications panel). System templates show a System badge with a
// Duplicate button (they can never be edited or deleted); custom templates
// get Edit + a trash-can delete. The editor's field chips insert {{field}}
// tokens at the cursor; the full catalog lives next to the code in
// src/domains/rental-messaging/MESSAGE_TEMPLATE_FIELDS.md.

const KIND_LABEL = { email: "Email", text: "Text", mailing: "Mailing" };
const AUDIENCE_LABEL = { tenant: "Tenant", owner: "Owner" };
const emptyEditor = { id: null, name: "", kind: "text", audience: "tenant", subject: "", body: "" };

export default function MessageTemplatesPanel() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("");
  const [editor, setEditor] = useState(null);
  const bodyRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/rental/message-templates");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load message templates.");
      setTemplates(body.templates || []);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function insertField(key) {
    const element = bodyRef.current;
    if (!element) return;
    const token = `{{${key}}}`;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const next = `${element.value.slice(0, start)}${token}${element.value.slice(end)}`;
    setEditor((current) => ({ ...current, body: next }));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = { name: editor.name, kind: editor.kind, audience: editor.audience, subject: editor.subject, body: editor.body };
      const url = editor.id ? `/api/rental/message-templates/${encodeURIComponent(editor.id)}` : "/api/rental/message-templates";
      const response = await fetch(url, { method: editor.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to save the template.");
      setEditor(null); setMessage(`Template "${result.template.name}" saved.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function duplicate(id) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/message-templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duplicateFrom: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to duplicate the template.");
      setMessage(`Duplicated as "${result.template.name}" — customize it freely.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function remove(template) {
    if (!window.confirm(`Delete the custom template "${template.name}"? System templates cannot be deleted.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/rental/message-templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete the template.");
      setMessage(`Template "${template.name}" deleted.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const visible = templates.filter((template) =>
    (!kindFilter || template.kind === kindFilter) && (!audienceFilter || template.audience === audienceFilter));

  return <section aria-label="Message templates" className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h3 className="text-lg font-black text-slate-950 dark:text-white">Message templates</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          One library for email and text templates with <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">{"{{field}}"}</code> merge
          fields. System templates are read-only — duplicate one to customize it.
        </p>
      </div>
      <button type="button" disabled={busy} onClick={() => setEditor({ ...emptyEditor })}
        className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">
        New template
      </button>
    </div>

    {error ? <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
    {message ? <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{message}</p> : null}

    <div className="mt-4 flex flex-wrap gap-2">
      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Kind
        <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}
          className="ml-2 rounded-lg border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white">
          <option value="">All kinds</option>
          <option value="email">Email</option>
          <option value="text">Text</option>
        </select>
      </label>
      <label className="text-sm font-bold text-slate-700 dark:text-slate-300">Audience
        <select value={audienceFilter} onChange={(event) => setAudienceFilter(event.target.value)}
          className="ml-2 rounded-lg border border-slate-300 bg-white p-2 font-normal dark:border-slate-600 dark:bg-slate-900 dark:text-white">
          <option value="">All audiences</option>
          <option value="tenant">Tenant</option>
          <option value="owner">Owner</option>
        </select>
      </label>
    </div>

    {loading ? <p className="mt-4 text-sm text-slate-500">Loading templates…</p> : null}
    {!loading && visible.length === 0 ? <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No templates match these filters.</p> : null}
    <ul className="mt-4 space-y-2">
      {visible.map((template) => <li key={template.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div>
          <p className="font-bold text-slate-950 dark:text-white">{template.name}</p>
          <p className="mt-1 flex flex-wrap gap-1 text-xs">
            <span className={`rounded-full px-2 py-0.5 font-bold ${template.isSystem ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"}`}>{template.isSystem ? "System" : "Custom"}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{KIND_LABEL[template.kind] || template.kind}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">{AUDIENCE_LABEL[template.audience] || template.audience}</span>
          </p>
          {template.subject ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Subject: {template.subject}</p> : null}
        </div>
        <div className="flex gap-2">
          {template.isSystem ? <button type="button" disabled={busy} onClick={() => duplicate(template.id)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Duplicate</button> : null}
          {!template.isSystem ? <button type="button" disabled={busy} onClick={() => setEditor({ id: template.id, name: template.name, kind: template.kind, audience: template.audience, subject: template.subject || "", body: template.body })}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Edit</button> : null}
          {!template.isSystem ? <button type="button" disabled={busy} onClick={() => remove(template)} title={`Delete ${template.name}`}
            aria-label={`Delete ${template.name}`}
            className="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40">🗑</button> : null}
        </div>
      </li>)}
    </ul>

    {editor ? <form aria-label={editor.id ? "Edit template" : "New template"} onSubmit={save}
      className="mt-6 grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 md:grid-cols-2">
      <h4 className="text-base font-black text-slate-950 dark:text-white md:col-span-2">{editor.id ? "Edit template" : "New template"}</h4>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Name
        <input required value={editor.name} maxLength={120} onChange={(event) => setEditor({ ...editor, name: event.target.value })}
          placeholder="e.g. Rent reminder" className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-bold text-slate-900 dark:text-white">Kind
          <select value={editor.kind} onChange={(event) => setEditor({ ...editor, kind: event.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white">
            <option value="email">Email</option>
            <option value="text">Text</option>
          </select>
        </label>
        <label className="text-sm font-bold text-slate-900 dark:text-white">Audience
          <select value={editor.audience} onChange={(event) => setEditor({ ...editor, audience: event.target.value })}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white">
            <option value="tenant">Tenant</option>
            <option value="owner">Owner</option>
          </select>
        </label>
      </div>
      {editor.kind === "email" ? <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Subject
        <input required value={editor.subject} maxLength={200} onChange={(event) => setEditor({ ...editor, subject: event.target.value })}
          placeholder="e.g. Rent reminder — {{property_label}}" className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white" />
      </label> : null}
      <div className="md:col-span-2">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Insert a merge field</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TEMPLATE_FIELDS.map((field) => <button key={field.key} type="button" title={field.description}
            onClick={() => insertField(field.key)}
            className="rounded-full border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">
            {field.label}
          </button>)}
        </div>
      </div>
      <label className="text-sm font-bold text-slate-900 dark:text-white md:col-span-2">Body
        <textarea required ref={bodyRef} value={editor.body} rows={6} maxLength={8000}
          onChange={(event) => setEditor({ ...editor, body: event.target.value })}
          placeholder={"Hi {{tenant_name}}, …"}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal dark:border-slate-600 dark:bg-slate-950 dark:text-white" />
      </label>
      <div className="flex gap-2 md:col-span-2">
        <button disabled={busy} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">
          {busy ? "Saving…" : editor.id ? "Save changes" : "Create template"}
        </button>
        <button type="button" disabled={busy} onClick={() => setEditor(null)}
          className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
      </div>
    </form> : null}
  </section>;
}
