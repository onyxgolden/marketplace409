"use client";
import { useCallback, useEffect, useState } from "react";
import { CUSTOM_FIELD_TYPES, formatFieldValue } from "@/domains/rental-forms/customFields";

// Rentec parity R15 — the per-record custom field editor. Drops into any
// record detail view (tenant, lease, unit, property): it loads that record
// type's field definitions plus the record's stored values, renders a plain
// input per field type, and saves through /api/rental/custom-field-values.
// The `groups` prop supports stacked sections (e.g. property + unit fields
// on the unit detail): [{ entity, recordId, title }]. Renders nothing when
// the workspace has no fields for the given entities.

const inputClassName = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-white";

function FieldInput({ field, value, onChange }) {
  const type = field.fieldType;
  if (type === "yes_no") {
    return (
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={inputClassName}>
        <option value="">— Select —</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    );
  }
  if (type === "picklist") {
    return (
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={inputClassName}>
        <option value="">— Select —</option>
        {(field.picklistOptions || []).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (type === "date") {
    return <input type="date" value={value ?? ""} onChange={(event) => onChange(event.target.value)} className={inputClassName} />;
  }
  if (type === "number") {
    return <input type="text" inputMode="decimal" value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="0" className={inputClassName} />;
  }
  return <input type="text" value={value ?? ""} onChange={(event) => onChange(event.target.value)} maxLength={500} className={inputClassName} />;
}

export default function CustomFieldsEditor({ groups = [] }) {
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const groupKey = groups.map((group) => `${group.entity}:${group.recordId}`).join("|");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const loaded = [];
      for (const group of groups) {
        if (!group?.entity || !group?.recordId) continue;
        const response = await fetch(`/api/rental/custom-field-values?entity=${encodeURIComponent(group.entity)}&recordId=${encodeURIComponent(group.recordId)}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load custom fields.");
        loaded.push({ ...group, fields: body.fields || [], values: body.values || {} });
      }
      setSections(loaded);
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const fieldCount = sections.reduce((sum, section) => sum + section.fields.length, 0);
  if (!loading && !error && fieldCount === 0) return null;

  function setValue(sectionIndex, fieldId, value) {
    setSections((current) => current.map((section, index) => (
      index === sectionIndex ? { ...section, values: { ...section.values, [fieldId]: value } } : section
    )));
    setMessage("");
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      for (const section of sections) {
        const response = await fetch("/api/rental/custom-field-values", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entity: section.entity, recordId: section.recordId, values: section.values }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to save custom fields.");
      }
      setMessage("Custom fields saved.");
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const typeLabel = (key) => CUSTOM_FIELD_TYPES.find((type) => type.key === key)?.label || key;

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/60 p-5 dark:border-slate-700 dark:bg-slate-950/30" data-custom-fields-editor>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Custom fields</p>
      {loading && <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">Loading fields…</p>}
      {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p>}
      {!loading && !error && (
        <form onSubmit={save}>
          {sections.map((section, sectionIndex) => section.fields.length > 0 && (
            <div key={`${section.entity}:${section.recordId}`} className={sectionIndex > 0 ? "mt-4 border-t border-slate-200 pt-4 dark:border-slate-700" : "mt-2"}>
              {section.title && <p className="mb-2 text-sm font-black text-slate-800 dark:text-slate-200">{section.title}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <label key={field.id} className="text-sm font-bold text-slate-900 dark:text-white">
                    {field.name}{field.isRequired && <span className="ml-1 text-red-600 dark:text-red-400">*</span>}
                    <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{typeLabel(field.fieldType)}</span>
                    <FieldInput field={field} value={section.values[field.id] ?? ""} onChange={(value) => setValue(sectionIndex, field.id, value)} />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-4">
            <button disabled={busy} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">{busy ? "Saving…" : "Save custom fields"}</button>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Saved values can be used in notices as {"{{custom.field_name}}"} placeholders.</p>
          </div>
        </form>
      )}
    </div>
  );
}

// Read-only inline display of a record's custom field values, for detail
// views that should show (not edit) them.
export function CustomFieldValuesDisplay({ fields = [], values = {} }) {
  const shown = fields.filter((field) => values[field.id] !== null && values[field.id] !== undefined && values[field.id] !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      {shown.map((field) => (
        <div key={field.id}>
          <dt className="text-xs font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">{field.name}</dt>
          <dd className="mt-0.5 font-bold text-slate-800 dark:text-slate-200">{formatFieldValue(field, values[field.id])}</dd>
        </div>
      ))}
    </dl>
  );
}
