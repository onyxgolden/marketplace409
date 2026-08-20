"use client";
import { useEffect, useState } from "react";

// Manual, operator-tracked lifecycle. Deliberately excludes any "approved"/"denied" value —
// the landlord's decision is made elsewhere, never inferred here from a status change.
export const SCREENING_STATUS_OPTIONS = Object.freeze([
  { value: "not_requested", label: "Not requested" },
  { value: "invitation_sent", label: "Invitation sent" },
  { value: "applicant_completing", label: "Applicant completing" },
  { value: "report_ready", label: "Report ready" },
  { value: "reviewed", label: "Reviewed" },
  { value: "decision_completed", label: "Decision completed" },
  { value: "cancelled", label: "Cancelled" },
]);
const DEFAULT_TRACKER = Object.freeze({ status: "not_requested", providerChoice: "smartmove", otherProviderName: "" });

// Screening is a pre-lease applicant activity, not a routine action for an already-onboarded
// tenant. `rental_tenants.status` is the source of truth for that distinction (see
// supabase/migrations/20260812000100_create_rental_identity.sql) — this must stay in sync with
// that CHECK constraint's value, not introduce a second, drifting definition of "applicant".
export function isTenantScreeningVisible(tenant) {
  return Boolean(tenant) && tenant.status === "applicant";
}

export function buildScreeningRedirectHref(provider) {
  return `/api/rental/screening/redirect?provider=${encodeURIComponent(provider)}`;
}

// `tenant.id` (see src/app/api/rental/route.js's `id("rental_tenant", ...)`) is always a
// server-generated UUID when created through the real save-tenant UI — never client-supplied —
// so it is safe as a global scoping key even across different landlord accounts sharing a
// browser, not just across records within one account.
export function screeningTrackerStorageKey(tenantId) {
  return `forge-rental-screening-tracker:${tenantId}`;
}

// `storage` is injectable (mirrors the `env = process.env` pattern used server-side) so this is
// testable without a DOM, and so a missing/blocked localStorage never throws.
export function loadScreeningTracker(tenantId, storage) {
  if (!storage || !tenantId) return DEFAULT_TRACKER;
  try {
    const raw = storage.getItem(screeningTrackerStorageKey(tenantId));
    if (!raw) return DEFAULT_TRACKER;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_TRACKER, ...parsed };
  } catch {
    return DEFAULT_TRACKER;
  }
}
export function saveScreeningTracker(tenantId, tracker, storage) {
  if (!storage || !tenantId) return;
  try {
    storage.setItem(screeningTrackerStorageKey(tenantId), JSON.stringify(tracker));
  } catch {
    // Best-effort only — this is a convenience tracker, never a compliance record.
  }
}

export function screeningDisclosureCopy({ affiliateActive } = {}) {
  return Object.freeze({
    privacy: "Screening is completed securely through TransUnion SmartMove. FORGE does not receive or store your Social Security number or screening report through this link.",
    commission: affiliateActive
      ? "FORGE may receive a commission when screening is purchased through this link. This does not increase the screening price."
      : null,
  });
}

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

export default function RentalTenantScreeningSection({ tenant, initialConfig = null }) {
  const visible = isTenantScreeningVisible(tenant);
  // Hooks must run unconditionally on every render (Rules of Hooks) — the visibility check is
  // applied only after all of them, via the early `return null` below. Each effect additionally
  // skips its own work when not visible, so an active/former/invited tenant never triggers a
  // config fetch or a localStorage read for a feature it will never see.
  const [config, setConfig] = useState(initialConfig || { smartMove: { affiliateActive: false } });
  const [tracker, setTracker] = useState(() => (visible ? loadScreeningTracker(tenant?.id, browserStorage()) : DEFAULT_TRACKER));

  useEffect(() => {
    if (!visible) return;
    setTracker(loadScreeningTracker(tenant?.id, browserStorage()));
  }, [visible, tenant?.id]);

  useEffect(() => {
    if (!visible || initialConfig) return;
    let cancelled = false;
    fetch("/api/rental/screening/config").then(async (response) => {
      const body = await response.json();
      if (!cancelled && response.ok) setConfig(body);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [visible, initialConfig]);

  function updateTracker(patch) {
    const next = { ...tracker, ...patch };
    setTracker(next);
    saveScreeningTracker(tenant?.id, next, browserStorage());
  }

  if (!visible) return null;

  const disclosure = screeningDisclosureCopy({ affiliateActive: config?.smartMove?.affiliateActive });

  return (
    <section data-rental-tenant-screening className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">Tenant Screening</p>
      <h3 className="mt-2 text-xl font-black text-slate-950 dark:text-slate-100">Screen {tenant?.display_name || "this applicant"} for this rental</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
        Screening happens entirely on the provider&rsquo;s own secure site, with the applicant&rsquo;s consent. FORGE only launches
        it and helps you keep track of where things stand — the decision to approve or deny remains yours to make.
      </p>

      <div className="mt-5 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 p-5">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-emerald-700 dark:bg-emerald-400 px-3 py-1 text-xs font-black text-white dark:text-emerald-950">Recommended</span>
          <span className="rounded-full border border-emerald-300 dark:border-emerald-700 px-3 py-1 text-xs font-bold text-emerald-900 dark:text-emerald-200">Operated by TransUnion</span>
          <span className="rounded-full border border-emerald-300 dark:border-emerald-700 px-3 py-1 text-xs font-bold text-emerald-900 dark:text-emerald-200">Applicant-authorized</span>
          <span className="rounded-full border border-emerald-300 dark:border-emerald-700 px-3 py-1 text-xs font-bold text-emerald-900 dark:text-emerald-200">External to FORGE</span>
        </div>
        <h4 className="mt-3 text-lg font-black text-slate-950 dark:text-slate-100">TransUnion SmartMove</h4>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          Opens SmartMove in a new tab, where the applicant authorizes and completes their own credit, criminal, and eviction
          screening directly with TransUnion.
        </p>
        <a
          href={buildScreeningRedirectHref("smartmove")}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block rounded-xl bg-emerald-700 dark:bg-emerald-400 px-5 py-3 font-black text-white dark:text-emerald-950"
        >
          Start SmartMove screening ↗
        </a>
        <p className="mt-4 text-sm font-bold text-emerald-900 dark:text-emerald-200">{disclosure.privacy}</p>
        {disclosure.commission ? <p className="mt-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">{disclosure.commission}</p> : null}
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">Report availability and record coverage vary by jurisdiction — no screening provider, including SmartMove, guarantees every criminal or eviction record.</p>
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">FORGE does not perform, guarantee, or receive the results of this background check. Reviewing the report and making a decision remains entirely up to you.</p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => updateTracker({ providerChoice: "other" })}
          className="text-sm font-black text-sky-700 dark:text-sky-400 underline"
        >
          Use another screening provider
        </button>
        <span className="text-xs text-slate-500 dark:text-slate-400">No SmartMove account required — track any provider below.</span>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-bold text-slate-800 dark:text-slate-200">
          Screening status
          <select
            value={tracker.status}
            onChange={(event) => updateTracker({ status: event.target.value })}
            aria-label={`Screening status for ${tenant?.display_name || "this applicant"}`}
            className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-slate-950 dark:text-slate-100"
          >
            {SCREENING_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {tracker.providerChoice === "other" ? (
          <label className="text-sm font-bold text-slate-800 dark:text-slate-200">
            Which provider?
            <input
              type="text"
              value={tracker.otherProviderName}
              onChange={(event) => updateTracker({ otherProviderName: event.target.value })}
              placeholder="e.g. First Advantage"
              className="mt-1 w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-slate-950 dark:text-slate-100"
            />
          </label>
        ) : null}
      </div>
      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Tracked only in this browser — not yet saved to your FORGE account.</p>
    </section>
  );
}
