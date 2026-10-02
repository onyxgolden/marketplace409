"use client";
import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { resolveActiveFunction } from "@/components/forge/workspace/ApplicationShell";
import { useSidebarHiddenItems } from "@/components/forge/workspace/useSidebarHiddenItems";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import RentalSetupWizardPanel, { fetchSetupWizardStatus, readSetupWizardDismissal, writeSetupWizardDismissal } from "./RentalSetupWizardPanel";
import SidebarCustomizePopover from "@/components/forge/workspace/SidebarCustomizePopover";
import RentalContextualSurface from "./RentalContextualSurface";
import RentalOverviewPanel from "./RentalOverviewPanel"; import RentalSetupPanel from "./RentalSetupPanel"; import RentalTenantPanel from "./RentalTenantPanel"; import RentalLeasePanel from "./RentalLeasePanel"; import RentalPaymentsPanel from "./RentalPaymentsPanel"; import RentalInsurancePanel from "./RentalInsurancePanel"; import RentalInsuranceAddonsPanel from "./RentalInsuranceAddonsPanel"; import RentalMaintenancePanel from "./RentalMaintenancePanel"; import RentalDocumentsPanel from "./RentalDocumentsPanel"; import RentalCommunicationsPanel from "./RentalCommunicationsPanel"; import MessagesPanel from "./MessagesPanel"; import RentalReconciliationPanel from "./RentalReconciliationPanel"; import BankLedgerPage from "./BankLedgerPage"; import ChartOfAccountsPage from "./ChartOfAccountsPage"; import BatchExpenseForm from "./BatchExpenseForm"; import RentalReportsPanel from "./RentalReportsPanel"; import RentalDepositsPanel from "./RentalDepositsPanel"; import RentalInspectionsPanel from "./RentalInspectionsPanel"; import RentalLeaseLifecyclePanel from "./RentalLeaseLifecyclePanel"; import RentalLeasePreparationPanel from "./RentalLeasePreparationPanel"; import RentalAutopayPanel from "./RentalAutopayPanel"; import RentalAnimalsPanel from "./RentalAnimalsPanel"; import RentalSupportPanel from "./RentalSupportPanel"; import RentalVendorsPanel from "./RentalVendorsPanel"; import BankingToolsPanel from "./BankingToolsPanel"; import OwnerStatementsPanel from "./OwnerStatementsPanel"; import ListingsPanel from "./ListingsPanel"; import ApplicationsPanel from "./ApplicationsPanel"; import Tax1099Panel from "./Tax1099Panel";
import RentalOwnersHomePanel from "./RentalOwnersHomePanel";
import RentalReceiptsPanel from "./RentalReceiptsPanel";
import RentalMailingPanel from "./RentalMailingPanel";
import RentecMigrationPanel from "./RentecMigrationPanel";
import RentecFileInventoryPanel from "./RentecFileInventoryPanel";
import RentecPaymentImportPanel from "./RentecPaymentImportPanel";
import RentecFinancialHistoryImportPanel from "./RentecFinancialHistoryImportPanel";
import PropertyFinancialSetupPanel from "./PropertyFinancialSetupPanel";
import RentalHelpModal from "./RentalHelpModal";
import { RentalTerminologyProvider, useRentalTerminology } from "./rentalTerminologyContext";
import { termLabel as resolveTermLabel } from "@/domains/rental-terminology/rentalTerminology";
import RentalTerminologyPanel from "./RentalTerminologyPanel";
import RentalTeamPanel from "./RentalTeamPanel";
import RentalPreviewBanner from "./RentalPreviewBanner";
import RentalTodaysPrioritiesPanel from "./guided-workflow/RentalTodaysPrioritiesPanel";
import RentalFirstTenantReadinessPanel from "./guided-workflow/RentalFirstTenantReadinessPanel";
import RentalLeaseRenewalPanel from "./guided-workflow/RentalLeaseRenewalPanel";

// Seven-section Rentec-style information architecture (Rentec-parity R8,
// 2026-10-01): Summary landing, then Properties / Tenants / Banking / Owners /
// Reports / Settings -- the grouping a Rentec user reaches for. This replaces
// the eight-section layout (owner-approved 2026-09-21) as part of the
// Rentec-parity program. Every surviving function id is byte-identical to the
// pre-R8 registry, so buildRentalSurface, stored activeFunctionId values,
// sidebar hide-prefs (key "rental-manager"), and RentalContextualSurface
// record-scoping keep working untouched. Retired group labels ("dashboard",
// "transactions") still resolve through resolveRentalSectionParam's legacy map
// below, and retired ids ("guide", "private-financing", and the RV trio)
// resolve through resolveActiveFunction's fallback to the first entry --
// "overview" -- below.
export const RENTAL_NAVIGATION = Object.freeze([
  Object.freeze({ label: "Summary", items: Object.freeze([{ id: "overview", label: "Summary" }]) }),
  Object.freeze({
    label: "Properties",
    items: Object.freeze([
      { id: "setup", label: "Properties" },
      { id: "insurance", label: "Insurance" },
      { id: "maintenance", label: "Maintenance" },
      { id: "inspections", label: "Inspections" },
      { id: "documents", label: "Documents" },
    ]),
  }),
  Object.freeze({
    label: "Tenants",
    items: Object.freeze([
      { id: "tenants", label: "Tenants" },
      { id: "leases", label: "Leases" },
      { id: "lease-lifecycle", label: "Lease Changes" },
      { id: "lease-preparation", label: "Lease Editor" },
      { id: "readiness", label: "Prepare a Tenant" },
      { id: "renewal", label: "Renew a Lease" },
      { id: "communications", label: "Communications" },
      { id: "mailing", label: "Mailing" },
      // Intentionally the combined owner inbox: this surface deliberately merges rental and
      // private-financing conversations (see MessagesPanel). It must NOT be silently relabeled
      // as tenant-only messaging while Private Financing has no messaging surface of its own.
      { id: "messages", label: "Owner Inbox" },
      { id: "animals", label: "Animals" },
    ]),
  }),
  Object.freeze({
    label: "Leasing",
    items: Object.freeze([
      { id: "listings", label: "Listings" },
      { id: "applications", label: "Applications" },
    ]),
  }),
  Object.freeze({
    label: "Banking",
    items: Object.freeze([
      { id: "charges", label: "Rent & Payments" },
      { id: "deposits", label: "Deposits" },
      { id: "checks-deposits", label: "Checks & Deposits" },
      { id: "reconciliation", label: "Reconciliation" },
      { id: "bank-ledger", label: "Bank Ledger" },
      { id: "vendors", label: "Vendors" },
      { id: "receipts", label: "Receipts" },
      { id: "chart-of-accounts", label: "Chart of Accounts" },
      { id: "batch-entry", label: "Batch Entry" },
    ]),
  }),
  Object.freeze({ label: "Owners", items: Object.freeze([{ id: "owners", label: "Owners" }]) }),
  Object.freeze({ label: "Reports", items: Object.freeze([{ id: "reports", label: "Reports" }, { id: "owner-statements", label: "Owner Statements" }]) }),
  Object.freeze({ label: "Tax", items: Object.freeze([{ id: "tax-1099", label: "1099 Filing" }]) }),

  Object.freeze({
    label: "Settings",
    items: Object.freeze([
      { id: "financial-setup", label: "Financial Setup" },
      { id: "autopay", label: "Autopay" },
      { id: "support", label: "Support" },
      { id: "rentec-migration", label: "Rentec Migration" },
      { id: "rentec-files", label: "Rentec Files" },
      { id: "rentec-payment-import", label: "Rentec Payment Import" },
      { id: "rentec-financial-history-import", label: "Rentec Financial History Import" },
      { id: "terminology", label: "Terminology" },
      { id: "team", label: "Team & Permissions" },
      // R16: the re-runnable setup guide. Listed last so the coverage-ordered
      // help content (rentalHelpContent.js) stays aligned with nav order.
      { id: "setup-guide", label: "Setup guide" },
    ]),
  }),
]);
export const RENTAL_FUNCTIONS = Object.freeze(RENTAL_NAVIGATION.flatMap((group) => group.items));

// Rentec parity R25 — terminology customization. Nav item ids are stable
// (deep links, sidebar hide-prefs, ?section= params never change); only the
// displayed labels are term-aware. The static RENTAL_NAVIGATION above stays
// the source of truth for ids and default English labels; this pure function
// returns a label-localized copy. Each returned group also carries
// `defaultLabel` (the pre-terminology label) so collapse-persistence keys and
// the Dashboard exemption in isItemHidden stay stable across renames.
const GROUP_TERM_LABELS = Object.freeze({
  Properties: Object.freeze({ key: "property", plural: true }),
  Tenants: Object.freeze({ key: "tenant", plural: true }),
});
const ITEM_TERM_LABELS = Object.freeze({
  setup: Object.freeze({ key: "property", plural: true }),
  tenants: Object.freeze({ key: "tenant", plural: true }),
  leases: Object.freeze({ key: "lease", plural: true }),
  vendors: Object.freeze({ key: "vendor", plural: true }),
});
const ITEM_TERM_TEMPLATES = Object.freeze({
  "lease-lifecycle": (t) => `${t("lease", { capitalize: true })} Changes`,
  "lease-preparation": (t) => `${t("lease", { capitalize: true })} Editor`,
  readiness: (t) => `Prepare a ${t("tenant")}`,
  renewal: (t) => `Renew a ${t("lease")}`,
  // The combined owner inbox deliberately merges rental and private-financing
  // conversations — renaming "Owner" here keeps that meaning, it must never
  // become a tenant-only label.
  messages: (t) => `${t("owner", { capitalize: true })} Inbox`,
});
export function applyTerminologyToNavigation(navigation, terms) {
  const t = (key, options) => resolveTermLabel(terms, key, options);
  return navigation.map((group) => {
    const groupSpec = GROUP_TERM_LABELS[group.label];
    const items = group.items.map((item) => {
      const template = ITEM_TERM_TEMPLATES[item.id];
      if (template) return { ...item, label: template(t) };
      const spec = ITEM_TERM_LABELS[item.id];
      if (!spec) return item;
      return { ...item, label: t(spec.key, { plural: spec.plural, capitalize: true }) };
    });
    const localized = { ...group, defaultLabel: group.label, items };
    if (groupSpec) localized.label = t(groupSpec.key, { plural: groupSpec.plural, capitalize: true });
    return localized;
  });
}

// Maps a `?section=` URL value to a rental function id so external entry points (notably the
// /forge/property compatibility redirect) can deep-link a section instead of dumping the user
// on the Summary default. Accepts a function id directly ("maintenance") or a section label
// ("banking" -> the section's first item, "charges"). Retired pre-R8 group labels keep working
// through LEGACY_RENTAL_SECTION_LABELS below. Returns null when nothing matches, and
// the caller falls back to "overview" -- which resolveActiveFunction also guarantees for any
// retired id, since "overview" remains the first RENTAL_FUNCTIONS entry.
const LEGACY_RENTAL_SECTION_LABELS = Object.freeze({
  dashboard: "overview",
  transactions: "charges",
});
export function resolveRentalSectionParam(value) {
  const slug = String(value || "").trim().toLowerCase();
  if (!slug) return null;
  const byId = RENTAL_FUNCTIONS.find((item) => item.id === slug);
  if (byId) return byId.id;
  const group = RENTAL_NAVIGATION.find((entry) => entry.label.toLowerCase() === slug);
  if (group?.items[0]?.id) return group.items[0].id;
  return LEGACY_RENTAL_SECTION_LABELS[slug] ?? null;
}

// Re-exported for convenience: the pure ?recordType=/?recordId=/?propertyId=
// resolver lives in rentalRecordParam.js (no "use client") so the server page
// can import it too.
export { resolveRentalRecordContextParam, KNOWN_RECORD_TYPES } from "./rentalRecordParam";

// Every item that may be hidden via the sidebar's Customize control, grouped by the section label
// shown in that checklist -- everything except Summary, which every user needs as a landing view
// and is therefore never offered as hideable in the first place.
const SIDEBAR_KEY = "rental-manager";
export const HIDEABLE_SIDEBAR_SECTIONS = Object.freeze(
  RENTAL_NAVIGATION
    .filter((group) => group.label !== "Summary")
    .map((group) => Object.freeze({ sectionLabel: group.label, items: group.items })),
);

// Summary is never filterable, even defensively against a corrupted/stale hidden-ids value --
// every user needs a landing view regardless of what's stored server-side.
// Compares against defaultLabel so a terminology rename can't accidentally
// make Dashboard hideable.
function isItemHidden(group, itemId, hiddenItemIds) {
  return (group.defaultLabel ?? group.label) !== "Summary" && hiddenItemIds.has(itemId);
}

// Surfaces that render a dead end with no record context. Sidebar navigation
// passes none, so the shell carries the currently selected property/unit
// across for exactly these surfaces instead of landing on "select a property"
// with no way to select one.
const CONTEXT_CARRY_SURFACES = new Set(["financial-setup"]);

export function buildRentalSurface(id, { onNavigate, recordContext = null, viewFilter = null } = {}) {
  if(recordContext&&["charges","maintenance","inspections","documents","communications"].includes(id))return <RentalContextualSurface surfaceId={id} recordContext={recordContext}/>;
  const surfaces = { guide: <RentalTodaysPrioritiesPanel onNavigate={onNavigate} />, readiness: <RentalFirstTenantReadinessPanel onNavigate={onNavigate} />, renewal: <RentalLeaseRenewalPanel onNavigate={onNavigate} />, mailing: <RentalMailingPanel />, owners: <RentalOwnersHomePanel onNavigate={onNavigate} />, "owner-statements": <OwnerStatementsPanel onNavigate={onNavigate} />, setup: <RentalSetupPanel onNavigate={onNavigate} initialViewFilter={viewFilter} recordContext={recordContext} />, tenants: <RentalTenantPanel onNavigate={onNavigate} recordContext={recordContext} />, leases: <RentalLeasePanel recordContext={recordContext} initialViewFilter={viewFilter} />, "rentec-migration": <RentecMigrationPanel />, "rentec-files": <RentecFileInventoryPanel />, charges: <RentalPaymentsPanel recordContext={recordContext} initialViewFilter={viewFilter} />, insurance: <><RentalInsurancePanel /><div className="mt-6"><RentalInsuranceAddonsPanel /></div></>, maintenance: <RentalMaintenancePanel recordContext={recordContext} initialViewFilter={viewFilter} />, documents: <RentalDocumentsPanel recordContext={recordContext} />, communications: <RentalCommunicationsPanel recordContext={recordContext} />, messages: <MessagesPanel />, reconciliation: <RentalReconciliationPanel />, "bank-ledger": <BankLedgerPage onNavigate={onNavigate} />, vendors: <RentalVendorsPanel />, receipts: <RentalReceiptsPanel />, "chart-of-accounts": <ChartOfAccountsPage onNavigate={onNavigate} />, "batch-entry": <BatchExpenseForm />, "rentec-payment-import": <RentecPaymentImportPanel onNavigate={onNavigate} />, "rentec-financial-history-import": <RentecFinancialHistoryImportPanel />, reports: <RentalReportsPanel />, "tax-1099": <Tax1099Panel />, "financial-setup": <PropertyFinancialSetupPanel recordContext={recordContext} onNavigate={onNavigate} />, deposits: <RentalDepositsPanel />, "checks-deposits": <BankingToolsPanel />, inspections: <RentalInspectionsPanel recordContext={recordContext} />, "lease-lifecycle": <RentalLeaseLifecyclePanel />, "lease-preparation": <RentalLeasePreparationPanel />, autopay: <RentalAutopayPanel />, animals: <RentalAnimalsPanel />, support: <RentalSupportPanel />, terminology: <RentalTerminologyPanel />, team: <RentalTeamPanel />, "setup-guide": <RentalSetupWizardPanel mode="guide" onNavigate={onNavigate} onExit={() => onNavigate?.("overview")} />, listings: <ListingsPanel />, applications: <ApplicationsPanel /> };

  return surfaces[id] || <RentalOverviewPanel onNavigate={onNavigate} />;
}

function RentalApplicationShellView({ activeFunctionId, activeRecordContext = null, activeViewFilter = null, onFunctionChange }) {
  const activeId = resolveActiveFunction(RENTAL_FUNCTIONS, activeFunctionId);
  const [showHelp, setShowHelp] = useState(false);
  const sidebarPrefs = useSidebarHiddenItems(SIDEBAR_KEY);
  // R16 first-run wizard: on an unsetup workspace (no active properties) the
  // landing view shows the guided setup tour instead of an empty dashboard.
  // The wizard never traps the user — "Skip the tour" dismisses it (persisted
  // in localStorage, not the database) and Settings → Setup guide re-runs it.
  const [wizardDismissed, setWizardDismissed] = useState(() => readSetupWizardDismissal());
  const { data: wizardStatus } = useStaleWhileRevalidate(
    activeId === "overview" && !wizardDismissed ? "rental:setup-wizard-status" : null,
    fetchSetupWizardStatus,
    { ttlMs: 60_000 },
  );
  const showFirstRunWizard = activeId === "overview" && !wizardDismissed && wizardStatus?.unsetup === true;
  function handleWizardExit() {
    writeSetupWizardDismissal();
    setWizardDismissed(true);
  }
  // R17: the Team & Permissions surface is only offered to team.manage holders. The API layer
  // re-checks server-side, so this is navigation convenience, not a security boundary.
  const [canManageTeam, setCanManageTeam] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function loadTeamAccess() {
      try {
        const response = await fetch("/api/rental/team/permissions", { credentials: "same-origin" });
        const body = await response.json();
        if (!cancelled) {
          setCanManageTeam(Array.isArray(body?.permissions) && body.permissions.includes("team.manage"));
        }
      } catch {
        if (!cancelled) setCanManageTeam(false);
      }
    }
    loadTeamAccess();
    const refresh = () => loadTeamAccess();
    window.addEventListener("forge:team-permissions-change", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("forge:team-permissions-change", refresh);
    };
  }, []);
  // R25 terminology: the whole shell (nav rail, mobile select, customize
  // checklist, record-context banner) renders through the workspace term map.
  const { terms, termLabel } = useRentalTerminology();
  const sourceNavigation = canManageTeam === false
    ? RENTAL_NAVIGATION.map((group) => ({ ...group, items: group.items.filter((item) => item.id !== "team") }))
    : RENTAL_NAVIGATION;
  const navigation = useMemo(() => applyTerminologyToNavigation(sourceNavigation, terms), [sourceNavigation, terms]);
  const hideableSections = useMemo(
    () => navigation
      .filter((group) => (group.defaultLabel ?? group.label) !== "Dashboard")
      .map((group) => Object.freeze({ sectionLabel: group.label, items: group.items })),
    [navigation],
  );
  activeRecordContext = activeRecordContext ? { ...activeRecordContext, recordLabel: activeRecordContext.recordLabel || (activeRecordContext.recordType === "tenant" ? "selected tenant" : activeRecordContext.propertyId || "selected property") } : null;
  // Sidebar / mobile-select navigation passes no record context. Surfaces that
  // are useless without one would land on a dead end, so carry the currently
  // selected property/unit across for exactly those surfaces. Every other
  // surface keeps the existing clear-on-navigate behavior; explicit contexts
  // (e.g. the Property actions menu) always pass through untouched.
  function handleFunctionChange(functionId, recordContext = null, viewFilter = null) {
    const carried = recordContext ?? (CONTEXT_CARRY_SURFACES.has(functionId) && activeRecordContext?.propertyId ? activeRecordContext : null);
    onFunctionChange?.(functionId, carried, viewFilter);
  }
  return <section data-rental-application-shell data-active-function={activeId} className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-950">
    <RentalPreviewBanner />
    <header className="border-b border-slate-200/70 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-4 text-slate-950 dark:text-slate-100 lg:px-8">
      <div className="mx-auto flex max-w-[1800px] items-center justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">FORGE Application</p>
          <h1 className="text-2xl font-black tracking-tight">Rental Manager</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          title="Rental Manager workflows and button guide"
          aria-haspopup="dialog"
          className="flex shrink-0 items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm font-black hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 text-xs text-white dark:bg-amber-400 dark:text-slate-950">?</span>
          <span>Help</span>
        </button>
      </div>
    </header>
    <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-5 p-4 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-6 lg:p-8">
      <label className="lg:hidden"><span className="sr-only">Rental function</span><select value={activeId} onChange={(event) => handleFunctionChange?.(event.target.value)} className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-3 font-bold text-slate-950 dark:text-slate-100">{navigation.map((group) => ({ key: group.defaultLabel ?? group.label, label: group.label, items: group.items.filter((item) => !isItemHidden(group, item.id, sidebarPrefs.hiddenItemIds)) })).filter((entry) => entry.items.length > 0).map((entry) => <optgroup key={entry.key} label={entry.label}>{entry.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
      <RentalNavSidebar activeId={activeId} onFunctionChange={handleFunctionChange} sidebarPrefs={sidebarPrefs} navigation={navigation} hideableSections={hideableSections} />
      <main data-active-function-surface={activeId} data-record-context={activeRecordContext?.recordId || undefined} className="min-w-0">{showFirstRunWizard?<RentalSetupWizardPanel mode="first-run" onNavigate={handleFunctionChange} onExit={handleWizardExit}/>:<>{activeRecordContext?<div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950 px-4 py-3" role="status"><p className="text-sm font-bold text-sky-950 dark:text-sky-100">Working with {activeRecordContext.recordType === "tenant" ? termLabel("tenant") : termLabel("property")}: {activeRecordContext.recordLabel}</p><button type="button" onClick={()=>onFunctionChange?.(activeRecordContext.recordType === "tenant" ? "tenants" : "setup")} className="text-sm font-black text-sky-800 dark:text-sky-300 underline">Back to record</button></div>:null}{buildRentalSurface(activeId, { onNavigate: handleFunctionChange, recordContext: activeRecordContext, viewFilter: activeViewFilter })}</>}</main>
    </div>
    {showHelp && <RentalHelpModal activeFunctionId={activeId} onClose={() => setShowHelp(false)} />}
  </section>;
}

// The terminology provider wraps the whole shell so the nav rail, the
// record-context banner, and every term-aware panel share one workspace map.
export default function RentalApplicationShell(props) {
  return <RentalTerminologyProvider><RentalApplicationShellView {...props} /></RentalTerminologyProvider>;
}

const NAV_COLLAPSE_STORAGE_KEY = "forge-rental-nav-sidebar-collapsed";
// Nav starts quiet: every group collapses by default except the one holding the active
// destination. This only affects initial visual weight -- every destination in
// RENTAL_NAVIGATION stays reachable via its group header, and an explicit user toggle is
// persisted and always wins over this default on the next load. Stale collapse keys from
// retired groups are harmless: unknown keys simply never match a group.
function defaultCollapsedGroups(activeId) {
  return RENTAL_NAVIGATION.filter((group) => !group.items.some((item) => item.id === activeId)).map((group) => group.label);
}
function loadStoredCollapsedNavGroups() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NAV_COLLAPSE_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function NavFunctionButton({ item, activeId, onFunctionChange }) {
  return (
    <button
      type="button"
      aria-current={activeId === item.id ? "page" : undefined}
      onClick={() => onFunctionChange?.(item.id)}
      className={`w-full rounded-lg px-3 py-1.5 text-left text-sm font-bold transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
        activeId === item.id
          ? "bg-slate-950 text-white dark:bg-amber-400 dark:text-slate-950"
          : "text-slate-600 hover:bg-slate-200/60 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
      }`}
    >
      {item.label}
    </button>
  );
}
function NavGroupToggle({ label, open, onToggle, className }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={className}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="text-[10px] text-slate-400">{open ? "▾" : "▸"}</span>
    </button>
  );
}
function visibleItems(group, items, hiddenItemIds) {
  return items.filter((item) => !isItemHidden(group, item.id, hiddenItemIds));
}

function RentalNavSidebar({ activeId, onFunctionChange, sidebarPrefs, navigation, hideableSections }) {
  const [collapsed, setCollapsed] = useState(() => loadStoredCollapsedNavGroups() ?? defaultCollapsedGroups(activeId));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const { hiddenItemIds } = sidebarPrefs;
  // Collapse keys are the pre-terminology group labels (defaultLabel) so a
  // rename can't orphan the user's stored collapse preferences.
  const groupKey = (group) => group.defaultLabel ?? group.label;
  const toggleKey = (key) => {
    setCollapsed((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
      window.localStorage.setItem(NAV_COLLAPSE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };
  return (
    <aside className="hidden self-start lg:block">
      <div className="relative mb-2">
        <button
          type="button"
          onClick={() => setCustomizeOpen((current) => !current)}
          aria-haspopup="dialog"
          aria-expanded={customizeOpen}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.1em] text-slate-500 hover:border-slate-300 hover:text-slate-950 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-white"
        >
          <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
          <span>Customize</span>
        </button>
        {customizeOpen && <SidebarCustomizePopover sections={hideableSections} sidebarPrefs={sidebarPrefs} onClose={() => setCustomizeOpen(false)} />}
      </div>
      <nav aria-label="Rental Manager functions" className="space-y-3">
        {navigation.map((group) => {
          const items = visibleItems(group, group.items, hiddenItemIds);
          if (group.items.length > 0 && items.length === 0) return null;
          const containsActive = items.some((item) => item.id === activeId);
          const open = !collapsed.includes(groupKey(group)) || containsActive;
          return (
            <div key={groupKey(group)}>
              <NavGroupToggle
                label={group.label}
                open={open}
                onToggle={() => toggleKey(groupKey(group))}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500 hover:text-slate-950 dark:text-slate-500 dark:hover:text-white"
              />
              {open && (
                <div className="mt-0.5 space-y-0.5">
                  {items.map((item) => (
                    <NavFunctionButton key={item.id} item={item} activeId={activeId} onFunctionChange={onFunctionChange} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
