"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { NOTICE_FIELDS } from "@/domains/rental-forms/formPlaceholders";
import NoticeLogList from "./NoticeLogList";

// Rentec parity R15 — the custom forms / notice builder surface
// (Rentec's forms-in-settings). Three tabs:
//
//   Library  — the system notice catalog (pay-or-quit, late notice, lease
//              violation, move-out reminder, rent increase, notice to enter)
//              plus the workspace's own forms. System rows are read-only;
//              Duplicate makes an editable copy.
//   Builder  — name, kind, and a body editor with placeholder chips that
//              insert {{dotted.path}} tokens at the cursor; "Preview with a
//              record" renders the draft against a real tenant.
//   Generate — pick a form + a tenant, preview the populated notice, print
//              it, and log it to the tenant's record.
//
// Notice language and cure/vacate timelines vary by state and local law —
// the surface says so. E-signatures live in the marketplace layer and are
// intentionally not wired here (noted in the PR as a follow-up).

const KIND_LABEL = { notice: "Notice", form: "Form" };
const emptyEditor = { id: null, name: "", kind: "notice", body: "" };
const inputClassName = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-white";

function printRendered({ title, body, subtitle }) {
  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  const safe = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = safe(body).split(/\r?\n/).map((line) => `<p>${line || "&nbsp;"}</p>`).join("");
  win.document.write(`<!doctype html><html><head><title>${safe(title)}</title><style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;padding:0 24px;line-height:1.7;font-size:15px}p{margin:0 0 1em}.meta{color:#555;font-size:13px;border-bottom:1px solid #ccc;padding-bottom:12px;margin-bottom:24px}@media print{.noprint{display:none}}</style></head><body><div class="noprint" style="margin-bottom:16px"><button onclick="window.print()">Print</button></div><div class="meta">${safe(subtitle)}</div>${paragraphs}</body></html>`);
  win.document.close();
  win.focus();
}

export default function NoticeFormsPanel() {
  const [tab, setTab] = useState("library");
  const [forms, setForms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState(null);
  const [customChips, setCustomChips] = useState([]);
  const bodyRef = useRef(null);

  // Generate tab state
  const [tenants, setTenants] = useState([]);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [logKey, setLogKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/rental/custom-forms");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to load forms.");
      setForms(body.forms || []);
      const fieldResponse = await fetch("/api/rental/custom-fields");
      const fieldBody = await fieldResponse.json();
      if (fieldResponse.ok) {
        setCustomChips((fieldBody.fields || []).map((field) => ({
          key: `custom.${field.fieldKey}`,
          label: `${field.name} (${field.entity})`,
        })));
      }
    } catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadTenants = useCallback(async () => {
    try {
      const response = await fetch("/api/rental");
      const body = await response.json();
      if (response.ok) setTenants(body.tenants || []);
    } catch { /* tenant picker is optional decoration; generate stays usable */ }
  }, []);
  useEffect(() => { if (tab === "generate" || tab === "builder") loadTenants(); }, [tab, loadTenants]);

  function insertPlaceholder(path) {
    const element = bodyRef.current;
    if (!element) return;
    const token = `{{${path}}}`;
    const start = element.selectionStart ?? element.value.length;
    const end = element.selectionEnd ?? element.value.length;
    const next = `${element.value.slice(0, start)}${token}${element.value.slice(end)}`;
    setEditor((current) => ({ ...current, body: next }));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function saveForm(event) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = { name: editor.name, kind: editor.kind, body: editor.body };
      const url = editor.id ? `/api/rental/custom-forms/${encodeURIComponent(editor.id)}` : "/api/rental/custom-forms";
      const response = await fetch(url, { method: editor.id ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to save the form.");
      setMessage(`"${body.form.name}" was saved.`);
      setEditor(null);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function duplicateForm(form) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/custom-forms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duplicateFrom: form.id }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to duplicate the form.");
      setMessage(`"${body.form.name}" was created — edit it in the Builder.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function removeForm(form) {
    if (!window.confirm(`Delete the "${form.name}" form? Generated notices already logged against tenants are kept.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/rental/custom-forms/${encodeURIComponent(form.id)}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to delete the form.");
      setMessage(`"${form.name}" was deleted.`);
      await load();
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  async function renderPreview({ formId = selectedFormId, body = null, tenantId = selectedTenantId }) {
    if ((!formId && !body) || !tenantId) {
      setError("Pick a form and a tenant to preview.");
      return null;
    }
    setPreviewing(true); setError("");
    try {
      const payload = tenantId ? { tenantId } : {};
      if (formId) payload.formId = formId;
      else payload.body = body;
      const response = await fetch("/api/rental/custom-forms/render", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const rendered = await response.json();
      if (!response.ok) throw new Error(rendered.error || "Unable to render the preview.");
      const result = { ...rendered, formName: formId ? forms.find((form) => form.id === formId)?.name || "Notice" : (editor?.name || "Draft"), tenantName: tenants.find((tenant) => tenant.id === tenantId)?.display_name || "" };
      setPreview(result);
      return result;
    } catch (reason) { setError(reason.message); return null; }
    finally { setPreviewing(false); }
  }

  async function logGenerated() {
    if (!preview) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/rental/notices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          formId: selectedFormId || null,
          formName: preview.formName,
          renderedBody: preview.text,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Unable to log the notice.");
      setMessage(`Logged to ${preview.tenantName || "the tenant"}'s record.`);
      setLogKey((key) => key + 1);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }

  const systemForms = forms.filter((form) => form.isSystem);
  const customForms = forms.filter((form) => !form.isSystem);
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId);
  const allChips = [...NOTICE_FIELDS.map((field) => ({ key: field.key, label: field.label })), ...customChips];

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-notice-forms>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Notices &amp; forms</p>
          <h3 className="mt-1 text-xl font-black text-slate-950 dark:text-white">Custom forms &amp; notice builder</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Build notices from templates with auto-filled details — tenant, property, lease, balances, and your custom
            fields. Templates are starting points: confirm notice language and timelines against your state and local laws.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Notices and forms">
        {[["library", "Library"], ["builder", "Builder"], ["generate", "Generate & log"]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setError(""); setMessage(""); }}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${tab === key ? "bg-sky-700 text-white dark:bg-sky-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</p>}

      {tab === "library" && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Standard notices</h4>
            <button type="button" onClick={() => { setEditor({ ...emptyEditor }); setTab("builder"); }} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white dark:bg-amber-400 dark:text-slate-950">+ New form</button>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ships with the standard notice family — pay-or-quit, late rent, lease violation, move-out reminder, rent increase, and notice to enter — read-only; duplicate any to customize it.</p>
          {loading && <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">Loading forms…</p>}
              <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                {systemForms.map((form) => (
                  <li key={form.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div><p className="font-black text-slate-950 dark:text-white">{form.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{KIND_LABEL[form.kind] || form.kind}</p></div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Standard</span>
                      <button type="button" disabled={busy} onClick={() => duplicateForm(form)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">Duplicate &amp; edit</button>
                      <button type="button" onClick={() => { setSelectedFormId(form.id); setTab("generate"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:text-slate-300">Use</button>
                    </div>
                  </li>
                ))}
              </ul>
              <h4 className="mt-6 text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Your forms</h4>
              {customForms.length === 0 && <p className="mt-2 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No custom forms yet — duplicate a standard notice or build one from scratch.</p>}
              {customForms.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                  {customForms.map((form) => (
                    <li key={form.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div><p className="font-black text-slate-950 dark:text-white">{form.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{KIND_LABEL[form.kind] || form.kind}</p></div>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => { setEditor({ id: form.id, name: form.name, kind: form.kind, body: form.body }); setTab("builder"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:text-slate-300">Edit</button>
                        <button type="button" onClick={() => { setSelectedFormId(form.id); setTab("generate"); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:text-slate-300">Use</button>
                        <button type="button" disabled={busy} onClick={() => removeForm(form)} className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-black text-red-700 disabled:opacity-50 dark:border-red-900 dark:text-red-300">Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}

      {tab === "builder" && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{editor?.id ? "Edit form" : "New form"}</h4>
            {!editor && <button type="button" onClick={() => setEditor({ ...emptyEditor })} className="rounded-lg bg-slate-950 px-3 py-1.5 text-xs font-black text-white dark:bg-amber-400 dark:text-slate-950">+ Start a form</button>}
          </div>
          {!editor && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Start a form to write its body, or edit one from the Library.</p>}
          {editor && (
            <form onSubmit={saveForm} className="mt-2 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-bold text-slate-900 dark:text-white">Form name<input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} required maxLength={120} placeholder="e.g. Garage parking rules" className={inputClassName} /></label>
                <label className="text-sm font-bold text-slate-900 dark:text-white">Kind
                  <select value={editor.kind} onChange={(event) => setEditor({ ...editor, kind: event.target.value })} className={inputClassName}>
                    <option value="notice">Notice</option>
                    <option value="form">Form</option>
                  </select>
                </label>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-white">Body <span className="font-normal text-slate-500 dark:text-slate-400">— click a field to insert it</span></p>
                <div className="mt-2 flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                  {allChips.map((chip) => (
                    <button key={chip.key} type="button" onClick={() => insertPlaceholder(chip.key)} title={chip.key} className="rounded-full border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60">
                      {chip.label}
                    </button>
                  ))}
                </div>
                <textarea ref={bodyRef} value={editor.body} onChange={(event) => setEditor({ ...editor, body: event.target.value })} required rows={12} className={`${inputClassName} font-mono`} placeholder={"Dear {{tenant.name}},\n\n…"} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={busy} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">{busy ? "Saving…" : "Save form"}</button>
                <button type="button" disabled={busy} onClick={() => setEditor(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-600 dark:text-slate-300">Cancel</button>
              </div>
              <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className="text-sm font-black text-slate-900 dark:text-white">Preview with a real record</p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-sm font-bold text-slate-900 dark:text-white">Tenant
                    <select value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)} className={inputClassName}>
                      <option value="">— Select a tenant —</option>
                      {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.display_name}</option>)}
                    </select>
                  </label>
                  <button type="button" disabled={previewing} onClick={() => renderPreview({ formId: null, body: editor.body })} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300">{previewing ? "Rendering…" : "Preview"}</button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === "generate" && (
        <div className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold text-slate-900 dark:text-white">Form
              <select value={selectedFormId} onChange={(event) => { setSelectedFormId(event.target.value); setPreview(null); }} className={inputClassName}>
                <option value="">— Select a form —</option>
                <optgroup label="Standard notices">
                  {systemForms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
                </optgroup>
                {customForms.length > 0 && (
                  <optgroup label="Your forms">
                    {customForms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            <label className="text-sm font-bold text-slate-900 dark:text-white">Tenant
              <select value={selectedTenantId} onChange={(event) => { setSelectedTenantId(event.target.value); setPreview(null); }} className={inputClassName}>
                <option value="">— Select a tenant —</option>
                {tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.display_name}</option>)}
              </select>
            </label>
          </div>
          <button type="button" disabled={previewing} onClick={() => renderPreview({})} className="mt-3 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300">
            {previewing ? "Rendering…" : "Generate preview"}
          </button>

          {preview && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-black text-slate-950 dark:text-white">{preview.formName}{preview.tenantName ? ` — ${preview.tenantName}` : ""}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => printRendered({ title: preview.formName, body: preview.text, subtitle: `${preview.formName}${preview.tenantName ? ` — ${preview.tenantName}` : ""} · Generated ${new Date().toLocaleDateString()}` })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:text-slate-300">Print</button>
                  <button type="button" disabled={busy} onClick={logGenerated} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-black text-white disabled:opacity-50">Log to tenant record</button>
                </div>
              </div>
              {preview.unknown?.length > 0 && (
                <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  Unknown placeholders (printed as blanks): {preview.unknown.join(", ")} — fix the spelling or remove them.
                </p>
              )}
              {preview.missing?.length > 0 && (
                <p className="mt-3 rounded-xl bg-sky-50 p-3 text-sm font-bold text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                  Empty for this record: {preview.missing.join(", ")} — they render blank so you can fill them in by hand.
                </p>
              )}
              <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 font-serif text-sm leading-relaxed text-slate-900 dark:bg-slate-900 dark:text-slate-100">{preview.text}</pre>
            </div>
          )}

          <h4 className="mt-6 text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">Generated notices log</h4>
          <NoticeLogList key={logKey} />
        </div>
      )}
    </div>
  );
}
