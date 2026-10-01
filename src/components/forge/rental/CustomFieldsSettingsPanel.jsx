"use client";
import { useCallback, useEffect, useState } from "react";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from "@/domains/rental-forms/customFields";

// Rentec parity R15 — the custom-field definitions settings panel
// (Rentec's forms-in-settings). Owner/co-owner only for writes (the API
// 403s read-only members; the panel surfaces that error). Entity tabs pick
// which record type the fields belong to: tenants, leases, properties, or
// units. Fields defined here appear on the matching record's editor and are
// available as {{custom.<field_key>}} placeholders in the notice builder.

const emptyEditor = { id: null, name: "", fieldType: "text", isRequired: false, picklistOptions: ["", ""] };
const inputClassName = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-white";

export default function CustomFieldsSettingsPanel() {
  const [entity, setEntity] = useState("tenant");
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/rental/custom-fields");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load custom fields.");
      setFields(body.fields || []);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = fields.filter((field) => field.entity === entity);
  const entityMeta = CUSTOM_FIELD_ENTITIES.find((entry) => entry.key === entity);

  function setOption(index, value) {
    setEditor((current) => {
      const next = [...(current.picklistOptions || [])];
      next[index] = value;
      return { ...current, picklistOptions: next };
    });
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = {
        entity,
        name: editor.name,
        fieldType: editor.fieldType,
        isRequired: editor.isRequired,
        picklistOptions: editor.fieldType === "picklist" ? editor.picklistOptions : undefined,
      };
      const url = editor.id ? `/api/rental/custom-fields/${encodeURIComponent(editor.id)}` : "/api/rental/custom-fields";
      const response = await fetch(url, { method: editor.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save the field.");
      setMessage(`"${body.field.name}" was saved.`);
      setEditor(null);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function remove(field) {
    if (!window.confirm(`Delete the "${field.name}" field? Saved values on every record will be removed too.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/rental/custom-fields/${encodeURIComponent(field.id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete the field.");
      setMessage(`"${field.name}" was deleted.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const typeLabel = (key) => CUSTOM_FIELD_TYPES.find((type) => type.key === key)?.label || key;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-custom-fields-settings>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Settings</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Custom fields</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Add your own fields to tenant, lease, property, or unit records — they show up on the record and can be
            dropped into notices as <code>{"{{custom.field_name}}"}</code> placeholders.
          </p>
        </div>
        <button type="button" onClick={() => setEditor({ ...emptyEditor })} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300" disabled={busy}>
          + Add a field
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Record type">
        {CUSTOM_FIELD_ENTITIES.map((entry) => (
          <button key={entry.key} type="button" role="tab" aria-selected={entity === entry.key}
            onClick={() => { setEntity(entry.key); setEditor(null); }}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${entity === entry.key ? "bg-sky-700 text-white dark:bg-sky-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}>
            {entry.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{entityMeta?.hint}</p>

      {loading && <p className="mt-4 text-sm font-bold text-slate-500 dark:text-slate-400">Loading fields…</p>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p>}

      {!loading && visible.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No custom fields on {entityMeta?.label.toLowerCase()} yet. Add one to start collecting extra details on each record.
        </p>
      )}

      {visible.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
          {visible.map((field) => (
            <li key={field.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-black text-slate-950 dark:text-white">{field.name}
                  {field.isRequired && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">Required</span>}
                </p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {typeLabel(field.fieldType)}
                  {field.fieldType === "picklist" && field.picklistOptions ? ` — ${field.picklistOptions.join(", ")}` : ""}
                  {" · "}<code>{"{{custom."}{field.fieldKey}{"}}"}</code>
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => setEditor({ id: field.id, name: field.name, fieldType: field.fieldType, isRequired: field.isRequired, picklistOptions: field.picklistOptions && field.picklistOptions.length ? field.picklistOptions : ["", ""] })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">Edit</button>
                <button type="button" disabled={busy} onClick={() => remove(field)} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-black text-red-700 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor && (
        <form onSubmit={save} className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
          <p className="text-sm font-black text-slate-950 dark:text-white sm:col-span-2">{editor.id ? "Edit field" : `Add a field to ${entityMeta?.label.toLowerCase()}`}</p>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Field name<input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} required maxLength={80} placeholder="e.g. Gate code" className={inputClassName} /></label>
          <label className="text-sm font-bold text-slate-900 dark:text-white">Type
            <select value={editor.fieldType} onChange={(event) => setEditor({ ...editor, fieldType: event.target.value })} className={inputClassName}>
              {CUSTOM_FIELD_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label} — {type.hint}</option>)}
            </select>
          </label>
          {editor.fieldType === "picklist" && (
            <div className="sm:col-span-2">
              <p className="text-sm font-bold text-slate-900 dark:text-white">Choices (at least two)</p>
              {editor.picklistOptions.map((option, index) => (
                <div key={index} className="mt-1 flex gap-2">
                  <input value={option} onChange={(event) => setOption(index, event.target.value)} placeholder={`Choice ${index + 1}`} maxLength={60} className={inputClassName} />
                  {editor.picklistOptions.length > 2 && <button type="button" onClick={() => setEditor({ ...editor, picklistOptions: editor.picklistOptions.filter((_, i) => i !== index) })} className="rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-600 dark:border-slate-600 dark:text-slate-300">Remove</button>}
                </div>
              ))}
              <button type="button" onClick={() => setEditor({ ...editor, picklistOptions: [...editor.picklistOptions, ""] })} className="mt-2 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:text-slate-300">+ Add a choice</button>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white sm:col-span-2">
            <input type="checkbox" checked={editor.isRequired} onChange={(event) => setEditor({ ...editor, isRequired: event.target.checked })} className="h-4 w-4" />
            Required — every record must fill this in
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button disabled={busy} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">{busy ? "Saving…" : "Save field"}</button>
            <button type="button" disabled={busy} onClick={() => setEditor(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
