"use client";
import { useMemo, useState } from "react";
import {
  DEFAULT_TERMS,
  MAX_TERM_LENGTH,
  resolveTermMap,
  termLabel as resolveTermLabel,
  TERMINOLOGY_KEYS,
  validateTermMap,
} from "@/domains/rental-terminology/rentalTerminology";
import { useRentalTerminology } from "./rentalTerminologyContext";

// Rentec parity R25 — owner settings surface for terminology customization
// (Settings → Terminology). Renames the five core rental concepts
// workspace-wide: the shell nav and the term-aware panel headings pick the
// new words up through useRentalTerminology().
//
// Plain-English editor: singular + plural for each term, a live preview that
// re-renders from the draft as you type, Save (validated, owner/co-owner
// only — read-only members get the server 403), and Restore defaults.

const TERM_HINTS = {
  tenant: 'Who lives in the property. Rentec owners often use "resident".',
  property: 'The building you manage. Some owners prefer "unit" or "building".',
  lease: 'The rental contract. Could be "rental agreement".',
  owner: 'Who receives statements. Could be "landlord".',
  vendor: 'Who you pay for work. Could be "contractor".',
};

function draftFromTerms(terms) {
  const resolved = resolveTermMap(terms);
  const draft = {};
  for (const key of TERMINOLOGY_KEYS) {
    draft[key] = { singular: resolved[key].singular, plural: resolved[key].plural };
  }
  return draft;
}

function PreviewSentence({ children }) {
  return <p className="text-sm text-slate-700 dark:text-slate-300">{children}</p>;
}

export default function RentalTerminologyPanel() {
  const { terms, updateTerms } = useRentalTerminology();
  // The draft is derived, not synced: it follows the workspace map until the
  // owner edits (draftOverride set), then follows the edits. No effect-based
  // syncing — arriving server terms can never clobber in-progress typing.
  const [draftOverride, setDraftOverride] = useState(null);
  const draft = draftOverride ?? draftFromTerms(terms);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  // Live preview resolves from the draft — it updates as the owner types.
  const preview = useMemo(() => {
    const draftMap = resolveTermMap(draft);
    const t = (key, options) => resolveTermLabel(draftMap, key, options);
    return { t };
  }, [draft]);

  function setTerm(key, form, value) {
    setError(null);
    setDraftOverride((current) => {
      const base = current ?? draftFromTerms(terms);
      return { ...base, [key]: { ...base[key], [form]: value } };
    });
  }

  function restoreDefaults() {
    setError(null);
    setMessage(null);
    setDraftOverride(draftFromTerms(DEFAULT_TERMS));
  }

  async function save(event) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const validation = validateTermMap(draft);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/rental/terminology", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms: validation.clean }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to save terminology.");
      updateTerms(payload.terms);
      setDraftOverride(null);
      setMessage("Terminology saved. The navigation and section headings now use your terms.");
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const { t } = preview;

  return (
    <section data-rental-terminology-panel className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Settings</p>
      <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950 dark:text-white">Terminology</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
        Rename the words FORGE uses across the Rental Manager — navigation, section titles, and panel
        headings. Leave a row alone to keep the current word. Nothing else changes: records, reports,
        and portal links keep working exactly as before.
      </p>

      <form onSubmit={save} className="mt-6 grid gap-4 lg:grid-cols-2">
        {TERMINOLOGY_KEYS.map((key) => (
          <fieldset key={key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
            <legend className="px-1 text-sm font-black capitalize text-slate-900 dark:text-white">
              {DEFAULT_TERMS[key].singular} <span className="font-normal text-slate-500">({TERM_HINTS[key]})</span>
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Singular</span>
                <input
                  value={draft[key].singular}
                  onChange={(event) => setTerm(key, "singular", event.target.value)}
                  maxLength={MAX_TERM_LENGTH}
                  placeholder={DEFAULT_TERMS[key].singular}
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Plural</span>
                <input
                  value={draft[key].plural}
                  onChange={(event) => setTerm(key, "plural", event.target.value)}
                  maxLength={MAX_TERM_LENGTH}
                  placeholder={DEFAULT_TERMS[key].plural}
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-950 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>
          </fieldset>
        ))}

        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/40">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Live preview</p>
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Navigation preview">
              {["tenant", "property", "lease", "vendor"].map((key) => (
                <span key={key} className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white dark:bg-amber-400 dark:text-slate-950">
                  {t(key, { plural: true, capitalize: true })}
                </span>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              <PreviewSentence>Assign this {t("lease")} to the {t("tenant")} and email the {t("owner")} a copy.</PreviewSentence>
              <PreviewSentence>{t("tenant", { plural: true, capitalize: true })} with unpaid balances appear at the top of the rent roll.</PreviewSentence>
              <PreviewSentence>Post the {t("vendor")} bill against the {t("property")}.</PreviewSentence>
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-900 dark:bg-red-950/40 dark:text-red-200 lg:col-span-2">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200 lg:col-span-2">
            {message}
          </p>
        )}

        <div className="flex flex-wrap gap-3 lg:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-amber-400 dark:text-slate-950 dark:hover:bg-amber-300"
          >
            {saving ? "Saving…" : "Save terminology"}
          </button>
          <button
            type="button"
            onClick={restoreDefaults}
            className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Restore defaults
          </button>
        </div>
      </form>
    </section>
  );
}
