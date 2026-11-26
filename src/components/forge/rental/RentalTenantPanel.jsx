"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RentalRecordBrowser from "./RentalRecordBrowser";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions";
import RentalPhotoUpload from "./RentalPhotoUpload";
import TenantPaymentHistory from "./TenantPaymentHistory";
import CustomFieldsEditor from "./CustomFieldsEditor";
import NoticeLogList from "./NoticeLogList";
import TenantLedgerPage from "./TenantLedgerPage";
import { useCardContextMenu, CardContextMenu, CARD_REGION_ATTRIBUTE } from "./CardContextMenu";
import { goldControlClassName } from "@/components/forge/forgeMetallicTheme";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { fetchWithDedupe, getCacheEntry, invalidatePrefix, patchCacheEntry } from "@/hooks/swrCache";
import { ForgeLoadingState } from "@/components/forge/ForgeStates";
import { PAYMENT_POLICIES, paymentPolicyDescription, paymentPolicyLabel } from "@/domains/rental-payment/paymentPolicy";
import { useRentalTerminology } from "./rentalTerminologyContext";

export function propertyLabelForTenant(tenant, leases, leaseMemberships, units) {
  const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id);
  const activeLease = leases.find((lease) => leaseIds.includes(lease.id) && lease.status === "active");
  if (!activeLease) return null;
  const unit = units.find((item) => item.id === activeLease.unit_id);
  return unit?.label || activeLease.unit_id || null;
}

export function activeBalanceCentsForTenant(tenant, leases, leaseMemberships, openCharges) {
  const leaseIds = new Set(leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id));
  const activeLeaseIds = new Set(leases.filter((lease) => leaseIds.has(lease.id) && lease.status === "active").map((lease) => lease.id));
  if (activeLeaseIds.size === 0) return null;
  return openCharges
    .filter((charge) => activeLeaseIds.has(charge.lease_id))
    .reduce((sum, charge) => sum + Number(charge.amount_cents || 0) - Number(charge.paid_amount_cents || 0), 0);
}

// Tenants who can be added to a lease as co-tenants: everyone not already
// on that lease (primary included — the primary is already attached, so
// offering them again would only produce a 409).
export function availableCoTenants(tenants, leaseMemberships, leaseId) {
  if (!leaseId) return [];
  const onLease = new Set(leaseMemberships.filter((item) => item.lease_id === leaseId).map((item) => item.tenant_id));
  return tenants.filter((tenant) => !onLease.has(tenant.id));
}

// Profile-form payload, kept pure so the save path is unit-testable without
// rendering. FORGE does not collect tenant birth dates -- there is
// deliberately no dateOfBirth field here.
export function tenantProfilePayload(form) {
  const dollars = form.get("monthlyIncome");
  return { displayName: form.get("tenantName"), phone: form.get("phone"), workPhone: form.get("workPhone"),
    employerName: form.get("employerName"), employerPhone: form.get("employerPhone"),
    monthlyIncomeCents: dollars ? Math.round(Number(dollars) * 100) : null,
    emergencyContactName: form.get("emergencyContactName"), emergencyContactPhone: form.get("emergencyContactPhone"),
    applicationStatus: form.get("applicationStatus"), applicationSubmittedAt: form.get("applicationSubmittedAt"),
    screeningProvider: form.get("screeningProvider"), screeningReference: form.get("screeningReference"),
    screeningStatus: form.get("screeningStatus"), screeningCompletedAt: form.get("screeningCompletedAt"),
    ssnLastFour: form.get("ssnLastFour"), landlordNotes: form.get("landlordNotes") };
}

export function tenantHouseholdForSelection(selectedTenant, tenants, leases, leaseMemberships, units) {
  if (!selectedTenant) return { lease: null, unit: null, primaryTenant: null, coTenants: [] };
  const memberships = leaseMemberships.filter((item) => item.tenant_id === selectedTenant.id);
  const lease = leases.find((item) => item.status === "active" && memberships.some((membership) => membership.lease_id === item.id))
    || leases.find((item) => memberships.some((membership) => membership.lease_id === item.id)) || null;
  if (!lease) return { lease: null, unit: null, primaryTenant: selectedTenant, coTenants: [] };
  const householdMemberships = leaseMemberships.filter((item) => item.lease_id === lease.id);
  const primaryMembership = householdMemberships.find((item) => item.occupancy_role === "primary") || householdMemberships[0];
  const primaryTenant = tenants.find((item) => item.id === primaryMembership?.tenant_id) || selectedTenant;
  const coTenants = householdMemberships.filter((item) => item.tenant_id !== primaryTenant.id)
    .map((item) => tenants.find((tenant) => tenant.id === item.tenant_id)).filter(Boolean);
  return { lease, unit: units.find((item) => item.id === lease.unit_id) || null, primaryTenant, coTenants };
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Slice 1: one busy key per mutation, so only the initiating control disables
// while its save is in flight. The panel and the profile/override forms share
// this scheme -- a card disables its own button by comparing busyKey against
// the key for its tenant and action.
export const BUSY_KEYS = {
  create: "create",
  email: (tenantId) => `email:${tenantId}`,
  invite: (tenantId) => `invite:${tenantId}`,
  profile: (tenantId) => `profile:${tenantId}`,
  primary: (tenantId) => `primary:${tenantId}`,
  addCoTenant: "add-co-tenant",
  removeCoTenant: (tenantId) => `remove-co-tenant:${tenantId}`,
  lateFee: (tenantId) => `late-fee:${tenantId}`,
  paymentPolicy: (tenantId) => `payment-policy:${tenantId}`,
  delete: (tenantId) => `delete:${tenantId}`,
};

// The tenants surface carries only these columns; a freshly created tenant
// (the save-tenant response is a camelCase domain tenant) maps to exactly
// this shape, so the new row slots into the cached list without a refetch.
export function compactTenantRow(domainTenant) {
  return { id: domainTenant.id, display_name: domainTenant.displayName, email: domainTenant.email,
    invited_at: domainTenant.invitedAt ?? null, auth_user_id: domainTenant.authUserId ?? null,
    photo_bucket: domainTenant.photoBucket ?? null, photo_object_path: domainTenant.photoObjectPath ?? null,
    photo_url: domainTenant.photoUrl ?? null };
}

export function sortTenantsByName(rows) {
  // Mirror the server order exactly (display_name, then id): a name tie
  // must resolve the same way in the browser as in the database, or a
  // locally re-sorted list can disagree with the next server page.
  return [...rows].sort((a, b) => String(a.display_name || "").localeCompare(String(b.display_name || ""))
    || String(a.id || "").localeCompare(String(b.id || "")));
}

// PR #863 fix round 1, Finding 2 — the tenants list is paged server-side
// (50 rows per page, display_name order). Page 1 keeps the Slice-1 key so
// existing disk entries stay valid; later pages get their own scope-bound
// key, and a name/email lookup gets one per query string.
export const TENANT_LIST_KEY = "rental:tenants:v2";
export const TENANT_LIST_PAGE_SIZE = 50;
export function tenantListPageKey(page) {
  return page <= 1 ? TENANT_LIST_KEY : `${TENANT_LIST_KEY}:page:${page}`;
}
// A list is single-page when the whole portfolio fits on page 1: a local
// row patch is then exactly correct, so mutations stay refetch-free. Past
// 50 tenants a create/delete/rename can move rows across the page boundary,
// so those mutations re-read the exact page from the server instead.
export function isSinglePageTenantList(list) {
  return (list?.totalCount ?? (list?.tenants || []).length) <= TENANT_LIST_PAGE_SIZE;
}

export function dedupeTenantsById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

async function fetchTenantListPage(page) {
  const response = await fetch(`/api/rental?surface=tenants&page=${page}&pageSize=${TENANT_LIST_PAGE_SIZE}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to load tenants.");
  return result;
}

async function fetchTenantLookup(query) {
  const response = await fetch(`/api/rental?surface=tenants&search=${encodeURIComponent(query)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to search tenants.");
  return result;
}

// Apply a submitted profile to a cached tenant row, mirroring the server's
// update-tenant-profile normalization exactly: strings are trimmed or nulled,
// monthly income is already whole cents (or null), and displayName renames
// only when the profile carries a non-empty name. The server rejects a
// non-numeric income with 400, so the patch path never sees one; a non-finite
// value here is nulled defensively so a poison NaN can never land in the cache.
export function applyTenantProfileToRow(row, profile) {
  const optional = (value) => typeof value === "string" ? value.trim() || null : null;
  const income = profile.monthlyIncomeCents == null || profile.monthlyIncomeCents === "" ? null : Number(profile.monthlyIncomeCents);
  const monthlyIncomeCents = Number.isSafeInteger(income) && income >= 0 ? income : null;
  const displayName = typeof profile.displayName === "string" && profile.displayName.trim() !== ""
    ? profile.displayName.trim() : undefined;
  return { ...row,
    ...(displayName !== undefined ? { display_name: displayName } : {}),
    phone: optional(profile.phone), work_phone: optional(profile.workPhone),
    employer_name: optional(profile.employerName), employer_phone: optional(profile.employerPhone),
    monthly_income_cents: monthlyIncomeCents,
    emergency_contact_name: optional(profile.emergencyContactName), emergency_contact_phone: optional(profile.emergencyContactPhone),
    application_status: optional(profile.applicationStatus), application_submitted_at: optional(profile.applicationSubmittedAt),
    screening_provider: optional(profile.screeningProvider), screening_reference: optional(profile.screeningReference),
    screening_status: optional(profile.screeningStatus), screening_completed_at: optional(profile.screeningCompletedAt),
    ssn_last_four: optional(profile.ssnLastFour), landlord_notes: optional(profile.landlordNotes) };
}

export function tenantInviteLabel(tenant) {
  // The lifecycle `status` column is stamped "invited" at creation, before any
  // email goes out — it must never be shown as the invite state. Derive the
  // label from what actually happened: portal claimed, invite email sent, or
  // nothing yet.
  if (tenant?.auth_user_id) return "Portal claimed";
  if (tenant?.invited_at) return `Invite sent ${new Date(tenant.invited_at).toLocaleDateString()}`;
  return "Invite not sent";
}

export default function RentalTenantPanel({ initialTenants = [], onNavigate: navigate, recordContext = null }) {
  // R25 terminology: panel headings resolve through the workspace term map.
  const { termLabel } = useRentalTerminology();
  const [message, setMessage] = useState("");
  const openCreateTenant = recordContext?.openCreateTenant === true;
  const recordTenantId = recordContext?.recordType === "tenant" ? recordContext.recordId : null;
  // Slice 1: the Tenants index reads the narrow tenants surface (first 50,
  // compact rows) under a versioned key, and the record page reads the narrow
  // tenant-detail surface for the selected tenant only. Neither reads the
  // monolith /api/rental. Mutations reconcile the cached rows in place
  // (see the per-mutation helpers below) and never refetch the monolith.
  // Fix round 1: the index is paged — page 1 under the Slice-1 key, later
  // pages under their own keys, appended by Load more. The list a mutation
  // patches is the accumulated loaded pages; a boundary change re-reads the
  // exact page from the server instead of patching (see refreshTenantListPage).
  const fetchRentalTenants = useCallback(async () => fetchTenantListPage(1), []);
  const { data, error: loadError, isLoading, isRefreshing, refresh: refreshList, mutate: mutateList, invalidate: invalidateList, identityEpoch } = useStaleWhileRevalidate(
    TENANT_LIST_KEY,
    fetchRentalTenants,
    { ttlMs: 60_000 },
  );
  const detailKey = recordTenantId ? `rental:tenant-detail:${recordTenantId}` : null;
  const fetchTenantDetail = useCallback(async () => {
    const response = await fetch(`/api/rental?surface=tenant-detail&tenantId=${encodeURIComponent(recordTenantId)}`);
    const result = await response.json();
    // A 404 is data, not an error: the tenant id is unknown (or belongs to
    // another workspace) and the panel falls back to the index with the
    // "wasn't found" notice. Throwing would keep stale record data on screen.
    if (response.status === 404) return { tenant: null, notFound: true };
    if (!response.ok) throw new Error(result.error || "Unable to load tenant.");
    return result;
  }, [recordTenantId]);
  const { data: detailData, error: detailError, isLoading: detailLoading, refresh: refreshDetail, mutate: mutateDetail, invalidate: invalidateDetail } = useStaleWhileRevalidate(
    detailKey,
    fetchTenantDetail,
    { ttlMs: 60_000 },
  );
  // Fix round 1 pagination state: extra pages loaded by Load more (page 1
  // lives in the hook above), how many pages are loaded, and a generation
  // counter bumped on every boundary reset so a page fetch that started
  // before the reset is discarded instead of mixed with the fresh page.
  const [extraTenantPages, setExtraTenantPages] = useState([]);
  const [tenantPageCount, setTenantPageCount] = useState(1);
  const [loadingMoreTenants, setLoadingMoreTenants] = useState(false);
  const listGeneration = useRef(0);
  // Co-tenant lookup state: a debounced server search by name/email that
  // reaches tenants sorted past the loaded pages (see the effect below).
  const [coTenantQuery, setCoTenantQuery] = useState("");
  const [coTenantSearch, setCoTenantSearch] = useState([]);
  const [coTenantSearching, setCoTenantSearching] = useState(false);
  // A failed lookup is its own state: it must never present as an
  // authoritative "No tenant matches" (fix round 2, residual 3).
  const [coTenantSearchError, setCoTenantSearchError] = useState("");
  const coTenantQueryRef = useRef("");
  const tenants = useMemo(() => data
    ? [...(data.tenants || []), ...extraTenantPages.flatMap((page) => page.tenants || [])]
    : initialTenants, [data, extraTenantPages, initialTenants]);
  const tenantTotalCount = data?.totalCount ?? tenants.length;
  const leases = data?.leases || [];
  const leaseMemberships = data?.leaseMemberships || [];
  const units = data?.units || [];
  const openCharges = data?.openCharges || [];
  // Detail-surface arrays: the record page renders ONLY from these (the list
  // rows are compact and cannot fill the profile form). The add-co-tenant
  // candidate list is the one exception — it needs the full list.
  const detailTenants = detailData?.tenants ?? [];
  const detailLeases = detailData?.leases ?? [];
  const detailMemberships = detailData?.leaseMemberships ?? [];
  const detailUnits = detailData?.units ?? [];
  const detailOpenCharges = detailData?.openCharges ?? [];
  const [showCreate, setShowCreate] = useState(openCreateTenant || initialTenants.length === 0);
  // One busy key per mutation, not one shared boolean: only the initiating
  // control disables while its save is in flight, and a second click on the
  // same control cannot double-submit.
  const [busyKey, setBusyKey] = useState(null);
  // In-app delete confirmation (replaces the native window.confirm): the dialog
  // below is part of the DOM, so it is visible and clickable in every browser —
  // including automated ones that auto-dismiss native dialogs, which previously
  // made the "Delete unused duplicate" button appear completely dead.
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const { menu: contextMenu, onContextMenu, openAt: openContextMenuAt, close: closeContextMenu } = useCardContextMenu();
  // One-time adoption of the loaded dataset (mirrors the old fetch-on-mount):
  // collapse the create form when tenants exist. Background refreshes never
  // touch the form. Record navigation (not local selection state) decides
  // whether the index or a tenant record page renders.
  const adoptedInitial = useRef(false);
  useEffect(() => {
    if (!data || adoptedInitial.current) return;
    adoptedInitial.current = true;
    setShowCreate(openCreateTenant || (data.tenants?.length || 0) === 0);
  }, [data, openCreateTenant]);
  // An identity change wipes the cache (see swrCache): the loaded extra
  // pages belong to the previous identity, so drop them too — otherwise
  // page-2 rows from user A would render under user B's page 1.
  const lastIdentityEpoch = useRef(identityEpoch);
  useEffect(() => {
    if (lastIdentityEpoch.current === identityEpoch) return;
    lastIdentityEpoch.current = identityEpoch;
    listGeneration.current += 1;
    setExtraTenantPages([]);
    setTenantPageCount(1);
    setCoTenantQuery("");
    setCoTenantSearch([]);
    setCoTenantSearchError("");
  }, [identityEpoch]);
  // Switching records resets the co-tenant search: a query typed for one
  // lease must never offer its matches on another lease's form. Adjusted
  // during render (the React docs pattern for state that tracks a prop) so
  // no effect — and no setState-in-effect — is needed.
  const [searchScopeId, setSearchScopeId] = useState(recordTenantId);
  if (searchScopeId !== recordTenantId) {
    setSearchScopeId(recordTenantId);
    setCoTenantQuery("");
    setCoTenantSearch([]);
    setCoTenantSearching(false);
    setCoTenantSearchError("");
  }
  // Debounced server lookup for the add-co-tenant picker: 2+ characters,
  // 300ms after the last keystroke, one narrow read per query string. A
  // late resolution for an older query is discarded (the ref holds the
  // latest query), so typing never shows stale candidates. A query under 2
  // characters clears its results in the input's onChange, not here.
  useEffect(() => {
    const query = coTenantQuery.trim();
    coTenantQueryRef.current = query;
    if (query.length < 2) return undefined;
    const timer = setTimeout(() => {
      fetchWithDedupe(`${TENANT_LIST_KEY}:search:${query.toLowerCase()}`, () => fetchTenantLookup(query))
        .then((payload) => { if (coTenantQueryRef.current === query) { setCoTenantSearch(payload?.tenants || []); setCoTenantSearchError(""); } })
        .catch(() => { if (coTenantQueryRef.current === query) { setCoTenantSearch([]); setCoTenantSearchError("Tenant search failed — please try again."); } })
        .finally(() => { if (coTenantQueryRef.current === query) setCoTenantSearching(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [coTenantQuery]);
  // Full-page ledger state: { tenant, initialView } where initialView is null |
  // "post-income" | "print". Rendered full-page below, replacing the card surface.
  const [ledgerTenant, setLedgerTenant] = useState(null);
  const openFullLedger = useCallback((tenant, initialView = null) => {
    closeContextMenu();
    if (tenant?.id) setLedgerTenant({ tenant, initialView });
  }, [closeContextMenu]);
  const onNavigate = useCallback((target, context) => navigate?.(target, labelRentalRecordContext(context, tenants, "display_name")), [navigate, tenants]);
  // Record navigation (Rentec parity): the Tenants screen is an efficient
  // index/list. Selecting a tenant opens the dedicated tenant record page --
  // a deep-linkable full page (browser Back works) -- never a preview sidebar.
  const goToTenantRecord = useCallback((tenant) => {
    if (!tenant?.id) return;
    onNavigate("tenants", { recordType: "tenant", recordId: tenant.id, recordLabel: tenant.display_name });
  }, [onNavigate]);
  // Rentec's triple-redundant ledger access: right-click menu, ⋮ button, and the
  // balance itself as a link — every path opens the same full-page ledger.
  // Row right-click (Brandy's workflow): View Ledger, Tenant Details, View Property,
  // Post Income, Post Charge, Print Statement. On the record page itself the
  // "Tenant Details" item is omitted (you are already there).
  const tenantMenuItems = useCallback((tenant, context, options = {}) => {
    if (!tenant) return [];
    const items = [
      { label: "View Ledger", onSelect: () => openFullLedger(tenant) },
    ];
    if (!options.inRecord) {
      items.push({ label: "Tenant Details", onSelect: () => goToTenantRecord(tenant) });
    }
    const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id);
    const lease = leases.find((item) => leaseIds.includes(item.id) && item.status === "active")
      || leases.find((item) => leaseIds.includes(item.id));
    const unit = units.find((item) => item.id === lease?.unit_id);
    if (unit) {
      items.push({ label: "View Property", onSelect: () => onNavigate("setup", { recordType: "property", recordId: unit.id, recordLabel: unit.label }) });
    }
    items.push(
      { label: "Post Income", onSelect: () => openFullLedger(tenant, "post-income") },
      { label: "Post Charge", onSelect: () => onNavigate("charges", context) },
      { label: "Print Statement", onSelect: () => openFullLedger(tenant, "print") },
    );
    return items;
  }, [openFullLedger, goToTenantRecord, onNavigate, leases, leaseMemberships, units]);
  const openTenantMenuBelow = useCallback((buttonElement, tenant, context, options = {}) => {
    const rect = buttonElement?.getBoundingClientRect?.();
    openContextMenuAt(rect ? rect.left : 120, rect ? rect.bottom + 6 : 120, tenantMenuItems(tenant, context, options));
  }, [openContextMenuAt, tenantMenuItems]);
  // Patch a cache, falling back to a targeted revalidation of that same narrow
  // surface when there is no entry to patch. Never the monolith.
  async function patchOrRefresh(mutate, refresh, updater) {
    if (!mutate(updater)) await refresh();
  }
  // Load the next tenants page and append it (server order, no re-sort: the
  // pages arrive in display_name order). A page fetch that started before a
  // boundary reset is discarded by the generation check.
  async function loadMoreTenants() {
    if (loadingMoreTenants) return;
    const nextPage = tenantPageCount + 1;
    const generation = listGeneration.current;
    setLoadingMoreTenants(true);
    try {
      const payload = await fetchWithDedupe(tenantListPageKey(nextPage), () => fetchTenantListPage(nextPage));
      if (generation !== listGeneration.current) return;
      setExtraTenantPages((prev) => prev.some((page) => page.page === nextPage)
        ? prev : [...prev, { page: nextPage, tenants: payload?.tenants || [] }]);
      setTenantPageCount(nextPage);
    } catch (error) {
      setMessage(error?.message || "Unable to load more tenants.");
    } finally {
      setLoadingMoreTenants(false);
    }
  }
  // Re-read the exact first page after a boundary change (create, delete, or
  // rename past 50 tenants): drop the extra pages, orphan any in-flight page
  // reads, and invalidate page 1 before refetching so a stale in-flight GET
  // cannot overwrite the fresh page (the Finding 1 barrier). One narrow
  // surface read, never the monolith.
  async function refreshTenantListPage() {
    listGeneration.current += 1;
    setExtraTenantPages([]);
    setTenantPageCount(1);
    invalidatePrefix(`${TENANT_LIST_KEY}:page:`);
    invalidateList();
    await refreshList();
  }
  // One authoritative loaded-pages reconciliation path (fix round 2,
  // residual 3): a row mutation patches the matching tenant in page 1 AND
  // every loaded extra page, and keeps each corresponding page cache entry
  // coherent (patched through the same Finding-1 barrier as page 1, so a
  // stale in-flight page read cannot overwrite it). Returns false when
  // page 1 has no entry to patch -- the caller falls back to a targeted
  // refresh of page 1. Extra pages cannot exist without a page-1 entry
  // (Load more only appends after page 1 loads), so a false return means
  // there is nothing loaded to reconcile.
  function patchTenantRowInLoadedPages(tenantId, patchRow) {
    const patched = mutateList((list) => ({ ...list,
      tenants: (list.tenants || []).map((item) => item.id === tenantId ? patchRow(item) : item) }));
    if (!patched) return false;
    setExtraTenantPages((prev) => prev.map((page) => ({ ...page,
      tenants: (page.tenants || []).map((item) => item.id === tenantId ? patchRow(item) : item) })));
    extraTenantPages.forEach((page) => {
      patchCacheEntry(tenantListPageKey(page.page), (data) => data ? { ...data,
        tenants: (data.tenants || []).map((item) => item.id === tenantId ? patchRow(item) : item) } : data);
    });
    return true;
  }
  // Photo upload/remove: the photo URL changes in place in both caches.
  function reconcileTenantPhoto(tenantId, photoUrl) {
    patchTenantRowInLoadedPages(tenantId, (item) => ({ ...item, photo_url: photoUrl }));
    mutateDetail((detail) => detail?.tenant ? { ...detail,
      tenant: { ...detail.tenant, photo_url: photoUrl },
      tenants: (detail.tenants || []).map((item) => item.id === tenantId ? { ...item, photo_url: photoUrl } : item) } : detail);
  }
  // Mutations reconcile the cached rows in place (row-only, never a monolith
  // refetch); selection is preserved because the cache is patched, not blanked.
  async function save(event) {
    event.preventDefault(); setBusyKey(BUSY_KEYS.create); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-tenant", tenant: { displayName: form.get("displayName"),
          email: form.get("email"), phone: form.get("phone") || null } }) });
      const result = await response.json();
      if (!response.ok) {
        if (result.existingTenant?.id) { setShowCreate(false); goToTenantRecord(result.existingTenant); }
        throw new Error(result.error || "Unable to save tenant.");
      }
      const savedId = result.tenant.id;
      formElement.reset();
      // Row-only reconciliation while the new total still fits on page 1
      // (oldTotal + 1 <= 50): the new tenant slots into the cached list
      // (sorted, count bumped) -- no refetch. At exactly 50 tenants the new
      // row belongs on page 2, so re-read the exact page instead of
      // appending locally (which would render 51+ rows and the wrong
      // first-50 subset). The detail surface loads on demand when the
      // record page opens.
      const cachedList = getCacheEntry(TENANT_LIST_KEY)?.data;
      const oldTotal = cachedList ? (cachedList.totalCount ?? (cachedList.tenants || []).length) : 0;
      if (cachedList && oldTotal + 1 <= TENANT_LIST_PAGE_SIZE) {
        if (!mutateList((list) => ({ ...list,
          tenants: sortTenantsByName([...(list.tenants || []), compactTenantRow(result.tenant)]),
          totalCount: (list.totalCount ?? (list.tenants || []).length) + 1 }))) {
          await refreshList();
        }
      } else {
        await refreshTenantListPage();
      }
      setShowCreate(false);
      // The confirmation rides with the navigation so it lands on the record
      // view itself in a success style nothing else on the page uses: the old
      // local message rendered in the same sky style as the "Working with"
      // banner above it and was easy to miss.
      const notice = `Tenant saved: ${result.tenant.displayName}`;
      // The closure's tenant list is stale post-refresh, so label explicitly.
      if (navigate) navigate("tenants", { recordType: "tenant", recordId: savedId, recordLabel: result.tenant.displayName, notice });
      else setMessage(notice);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  async function deleteUnusedTenant(tenant) {
    setBusyKey(BUSY_KEYS.delete(tenant.id)); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "delete-unused-tenant", tenantId: tenant.id, confirmation: "DELETE" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to delete the unused tenant.");
      // Row-only reconciliation while the whole portfolio fits on page 1:
      // drop the row from the cached list and tombstone the detail cache so
      // a stale record can never render for a deleted id. Past 50 tenants
      // the next tenant must be pulled in from page 2, so re-read the exact
      // first page instead of leaving a short list.
      const cachedList = getCacheEntry(TENANT_LIST_KEY)?.data;
      if (cachedList && isSinglePageTenantList(cachedList)) {
        mutateList((list) => ({ ...list,
          tenants: (list.tenants || []).filter((item) => item.id !== tenant.id),
          totalCount: Math.max(0, (list.totalCount ?? (list.tenants || []).length) - 1) }));
      } else {
        await refreshTenantListPage();
      }
      invalidateDetail();
      setMessage(`Deleted unused duplicate: ${result.deletedTenant.display_name}.`);
      // Deletion only happens from the record page; return to the index.
      if (recordTenantId && tenant.id === recordTenantId) navigate?.("tenants");
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  function cancelDeleteTarget() { setDeleteTarget(null); setDeleteConfirmText(""); }
  async function confirmDeleteTarget() {
    const target = deleteTarget;
    cancelDeleteTarget();
    if (target) await deleteUnusedTenant(target);
  }
  async function updateEmail(event, tenantId) {
    event.preventDefault(); setBusyKey(BUSY_KEYS.email(tenantId)); setMessage(""); const form = new FormData(event.currentTarget);
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "update-tenant-email", tenantId, email: form.get("portalEmail") }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to update tenant email.");
      setMessage(`Portal email updated for ${result.tenant.display_name}.`);
      // The server returns the updated row (id, display_name, email, status).
      const patchRow = (row) => row.id === tenantId ? { ...row, email: result.tenant.email, display_name: result.tenant.display_name, status: result.tenant.status } : row;
      if (!patchTenantRowInLoadedPages(tenantId, patchRow)) await refreshList();
      await patchOrRefresh(mutateDetail, refreshDetail, (detail) => detail?.tenant ? { ...detail,
        tenant: patchRow(detail.tenant), tenants: (detail.tenants || []).map(patchRow) } : detail);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  // Join-up invite: one explicit owner action per tenant. The button disables
  // the instant it is pressed (its own busy key) and the server sends
  // with a per-day idempotency key, so a double click cannot send twice.
  async function sendInviteEmail(tenant, leaseId) {
    setBusyKey(BUSY_KEYS.invite(tenant.id)); setMessage("");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "send-tenant-invite", tenantId: tenant.id, leaseId: leaseId || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to send the invite email.");
      setMessage(`Invite email sent to ${tenant.display_name} (${tenant.email}).`);
      // The server stamps invited_at and flips status to "invited" on send.
      const patchRow = (row) => row.id === tenant.id ? { ...row, invited_at: result.invitedAt, status: "invited" } : row;
      if (!patchTenantRowInLoadedPages(tenant.id, patchRow)) await refreshList();
      await patchOrRefresh(mutateDetail, refreshDetail, (detail) => detail?.tenant ? { ...detail,
        tenant: patchRow(detail.tenant), tenants: (detail.tenants || []).map(patchRow) } : detail);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  async function updateProfile(event, tenantId) {
    event.preventDefault(); setBusyKey(BUSY_KEYS.profile(tenantId)); setMessage(""); const form = new FormData(event.currentTarget);
    const profile = tenantProfilePayload(form);
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "update-tenant-profile", tenantId, profile }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to update tenant profile.");
      setMessage(`Tenant information updated for ${result.tenant.display_name}.`);
      // The server returns only {id, display_name}; the rest of the row comes
      // from the submitted profile, normalized exactly like the server. The
      // list row is compact, so it takes only the rename (plus re-sort); the
      // full profile lands in the detail cache. Past 50 tenants a rename can
      // move the row across the page boundary, so re-read the exact first
      // page instead of re-sorting a stale subset.
      const patchRow = (row) => row.id === tenantId ? applyTenantProfileToRow({ ...row, display_name: result.tenant.display_name }, profile) : row;
      const patchListRow = (row) => row.id === tenantId ? { ...row, display_name: result.tenant.display_name } : row;
      const cachedList = getCacheEntry(TENANT_LIST_KEY)?.data;
      if (cachedList && isSinglePageTenantList(cachedList)) {
        await patchOrRefresh(mutateList, refreshList, (list) => ({ ...list, tenants: sortTenantsByName((list.tenants || []).map(patchListRow)) }));
      } else {
        await refreshTenantListPage();
      }
      await patchOrRefresh(mutateDetail, refreshDetail, (detail) => detail?.tenant ? { ...detail,
        tenant: patchRow(detail.tenant), tenants: (detail.tenants || []).map(patchRow) } : detail);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  async function makePrimary(leaseId, tenantId) {
    setBusyKey(BUSY_KEYS.primary(tenantId)); setMessage("");
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "set-primary-tenant", leaseId, tenantId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to change the primary tenant.");
      setMessage("Primary tenant updated.");
      // The RPC demotes every primary on the lease and promotes the named
      // tenant; mirror that role flip in both caches.
      const flipRoles = (memberships) => (memberships || []).map((item) => item.lease_id === leaseId
        ? { ...item, occupancy_role: item.tenant_id === tenantId ? "primary" : "co_tenant" } : item);
      await patchOrRefresh(mutateList, refreshList, (list) => ({ ...list, leaseMemberships: flipRoles(list.leaseMemberships) }));
      await patchOrRefresh(mutateDetail, refreshDetail, (detail) => detail ? { ...detail, leaseMemberships: flipRoles(detail.leaseMemberships) } : detail);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  // Add a second renter to this lease as a co-tenant. The person must already
  // exist as a tenant record (Tenants → + Add a new tenant) with their own
  // email — this step only links them to the lease. After adding, their
  // email + invite card appear below like any other co-tenant.
  async function addCoTenant(event, leaseId) {
    event.preventDefault(); setBusyKey(BUSY_KEYS.addCoTenant); setMessage(""); const form = new FormData(event.currentTarget);
    const tenantId = form.get("coTenantId");
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "add-co-tenant", leaseId, tenantId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to add the co-tenant.");
      // The added tenant may have come from the server search (past page 1),
      // so look them up in the loaded rows plus the search matches.
      const added = [...tenants, ...coTenantSearch].find((item) => item.id === tenantId);
      setMessage(`Co-tenant added: ${added?.display_name || "tenant"}. Their email and invite card are below.`);
      // The membership is in the response; the new co-tenant's FULL row is in
      // no cache (the list row is compact), so the narrow detail surface
      // re-fetches -- a targeted surface revalidation, not the monolith.
      mutateList((list) => ({ ...list,
        leaseMemberships: [...(list.leaseMemberships || []), result.membership] }));
      await refreshDetail();
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  // Remove a co-tenant link. The tenant record itself is untouched — the
  // person keeps their email and portal history and can be re-added. The
  // primary tenant can never be removed this way (the server refuses it).
  async function removeCoTenant(leaseId, tenant) {
    setBusyKey(BUSY_KEYS.removeCoTenant(tenant.id)); setMessage("");
    try { const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "remove-co-tenant", leaseId, tenantId: tenant.id }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to remove the co-tenant.");
      setMessage(`Co-tenant removed: ${tenant.display_name}. Their tenant record is untouched and can be re-added.`);
      const dropMembership = (memberships) => (memberships || []).filter((item) => !(item.lease_id === leaseId && item.tenant_id === tenant.id));
      await patchOrRefresh(mutateList, refreshList, (list) => ({ ...list, leaseMemberships: dropMembership(list.leaseMemberships) }));
      await patchOrRefresh(mutateDetail, refreshDetail, (detail) => detail ? { ...detail, leaseMemberships: dropMembership(detail.leaseMemberships) } : detail);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  // Per-tenant late-fee override: exempt, or per-field overrides of the
  // portfolio default. Saving with every field blank clears the override.
  async function saveLateFeeOverride(event, tenantId, clear) {
    event.preventDefault(); setBusyKey(BUSY_KEYS.lateFee(tenantId)); setMessage("");
    let payload;
    if (clear) {
      payload = { tenantId, exempt: false };
    } else {
      const form = new FormData(event.currentTarget);
      payload = { tenantId,
        exempt: form.get("overrideExempt") === "on",
        graceDays: form.get("overrideGraceDays") || null,
        calculationType: form.get("overrideCalculationType") || null,
        fixedAmountCents: form.get("overrideFixedAmount") ? Math.round(Number(form.get("overrideFixedAmount")) * 100) : null,
        percentageBasisPoints: form.get("overridePercentage") ? Math.round(Number(form.get("overridePercentage")) * 100) : null,
        maximumAmountCents: form.get("overrideMaximumAmount") ? Math.round(Number(form.get("overrideMaximumAmount")) * 100) : null };
    }
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-late-fee-tenant-override", override: payload }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save the late-fee override.");
      setMessage(result.override ? `Late-fee override saved.` : `Late-fee override cleared — the portfolio default applies.`);
      // The server returns the saved override row (or null on clear).
      await patchOrRefresh(mutateDetail, refreshDetail, (detail) => detail ? { ...detail, lateFeeTenantOverride: result.override } : detail);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  // Per-tenant payment-policy override (R11): a single policy that beats the
  // portfolio default; saving "inherit" (blank) clears it.
  async function savePaymentPolicyOverride(event, tenantId, clear) {
    event.preventDefault(); setBusyKey(BUSY_KEYS.paymentPolicy(tenantId)); setMessage("");
    const form = new FormData(event.currentTarget);
    const policy = clear ? "inherit" : (form.get("overridePaymentPolicy") || "inherit");
    try {
      const response = await fetch("/api/rental", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "save-payment-policy-tenant-override", override: { tenantId, policy } }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Unable to save the payment policy override.");
      setMessage(result.override ? "Payment policy override saved." : "Payment policy override cleared — the portfolio default applies.");
      // The server returns the policy string (or null on clear/inherit).
      await patchOrRefresh(mutateDetail, refreshDetail, (detail) => detail?.tenant ? { ...detail,
        tenant: { ...detail.tenant, payment_policy: result.override },
        tenants: (detail.tenants || []).map((item) => item.id === tenantId ? { ...item, payment_policy: result.override } : item) } : detail);
    } catch (error) { setMessage(error.message); } finally { setBusyKey(null); }
  }
  // Full-page ledger replaces the entire panel surface — Rentec-style, no cramped card.
  if (ledgerTenant?.tenant) {
    const ledgered = ledgerTenant.tenant;
    return <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-tenant-setup>
      <TenantLedgerPage tenantId={ledgered.id} tenantName={ledgered.display_name}
        unitLabel={propertyLabelForTenant(ledgered, leases, leaseMemberships, units)}
        initialView={ledgerTenant.initialView} onClose={() => setLedgerTenant(null)}
        onOpenPropertyLedger={(propertyKey, propertyLabel) => onNavigate("setup", { recordType: "property", recordId: propertyKey, recordLabel: propertyLabel })}
        onOpenBankLedger={() => navigate?.("bank-ledger")} />
    </section>;
  }
  // Record mode: the dedicated tenant record page. The Tenants index never
  // previews records in a sidebar -- selecting a tenant navigates here via a
  // deep-linkable URL (browser Back works). Dense professional record: compact
  // headers and dividers instead of oversized preview cards.
  // The record page renders ONLY from the detail surface. While it loads, the
  // record area shows its loading state (never the index); a 404 falls
  // through to the index with the "wasn't found" notice below.
  if (recordTenantId && !detailData) {
    return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-tenant-record>
      <button type="button" onClick={() => navigate?.("tenants")} className="text-sm font-black text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">← Tenants</button>
      {message && <p role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-slate-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-slate-200">{message}</p>}
      {detailLoading && <div className="mt-4"><ForgeLoadingState label="Loading tenant…" /></div>}
      {detailError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{detailError}</p>}
    </section>;
  }
  const recordTenant = recordTenantId && detailData && !detailData.notFound ? detailData.tenant : null;
  if (recordTenant) {
    const household = tenantHouseholdForSelection(recordTenant, detailTenants, detailLeases, detailMemberships, detailUnits);
    const tenant = household.primaryTenant || recordTenant;
    // Co-tenant candidates: everyone not already on this lease, from the
    // loaded list pages plus the server search matches (which reach tenants
    // sorted past page 1). Deduped by id; the search box below extends the
    // list whenever the loaded pages hold no candidate.
    const coTenantCandidates = dedupeTenantsById([
      ...availableCoTenants(tenants, detailMemberships, household.lease?.id),
      ...availableCoTenants(coTenantSearch, detailMemberships, household.lease?.id),
    ]);
    // More tenants exist beyond the loaded pages: the "every saved tenant
    // is already on this lease" claim cannot be made from the loaded subset
    // alone — the search box is the way to reach them.
    const coTenantsBeyondLoadedPages = tenantTotalCount > tenants.length;
    // A lease the form created lands its tenant as co_tenant with no true
    // primary, which leaves the fallback primary with no Make-primary control:
    // co-tenant cards (the only other place the button renders) exclude the
    // fallback primary, so the section reads "No co-tenant is assigned" and no
    // button exists anywhere. Show the control on the Primary card only while
    // no true primary exists; with a primary the prop stays null and the
    // render is unchanged. The card tenant is a lease member by construction
    // whenever a lease exists; the membership check below is belt-and-braces.
    const householdHasNoPrimary = household.lease
      && detailMemberships.some((item) => item.lease_id === household.lease.id)
      && !detailMemberships.some((item) => item.lease_id === household.lease.id && item.occupancy_role === "primary");
    const primaryCardIsLeaseMember = household.lease
      && detailMemberships.some((item) => item.lease_id === household.lease.id && item.tenant_id === tenant.id);
    const context = { recordType: "tenant", recordId: tenant.id };
    const recordMenuItems = tenantMenuItems(tenant, context, { inRecord: true });
    const tenantLeaseIds = detailMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id);
    const tenantMovedIn = detailLeases.some((lease) => tenantLeaseIds.includes(lease.id) && lease.status === "active");
    return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-tenant-record>
      <CardContextMenu menu={contextMenu} onClose={closeContextMenu} />
      {recordContext?.notice && <p role="status" className="mb-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base font-black text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">✓ {recordContext.notice}</p>}
      {message && <p role="status" className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-slate-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-slate-200">{message}</p>}
      <div data-rental-tenant-detail {...{ [CARD_REGION_ATTRIBUTE]: "" }}
        onContextMenu={(event) => onContextMenu(event, recordMenuItems)}
        title="Right-click for tenant actions">
        <button type="button" onClick={() => navigate?.("tenants")}
          className="text-sm font-black text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">← Tenants</button>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Tenant record</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{tenant.display_name}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {propertyLabelForTenant(tenant, detailLeases, detailMemberships, detailUnits) || "No active lease"}
              {" · "}{tenantMovedIn ? "Moved In" : "Inactive"}
              {" · "}{tenantInviteLabel(tenant)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={`More actions for ${tenant.display_name}`} aria-haspopup="menu" title="More actions"
              onClick={(event) => openTenantMenuBelow(event.currentTarget, tenant, context, { inRecord: true })}
              className="rounded-xl border border-slate-300 px-3 py-2 text-lg font-black leading-none text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800">⋮</button>
            <RentalRecordActions label="Tenant actions" actions={[{label:"Rent & payments",onSelect:()=>onNavigate?.("charges",context)},{label:"Manage lease",onSelect:()=>onNavigate?.("leases",context)},{label:"Messaging",onSelect:()=>onNavigate?.("communications",context)},{label:"Inspections",onSelect:()=>onNavigate?.("inspections",context)},{label:"File library",onSelect:()=>onNavigate?.("documents",context)}]}/>
          </div>
        </div>
        <LeaseSummaryStrip lease={household.lease} unit={household.unit}/>
        {(() => { const others = detailLeases.filter((item) => item.id !== household.lease?.id && tenantLeaseIds.includes(item.id)); return others.length > 0 ? <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">This tenant is also on {others.length === 1 ? "another lease" : "other leases"} ({others.map((item) => (detailUnits.find((unit) => unit.id === item.unit_id)?.label || item.id)).join(", ")}). The co-tenants shown here belong to this lease only — <button type="button" onClick={() => onNavigate?.("leases", context)} className="font-bold underline">open Leases</button> to manage the other household.</p> : null; })()}
        <TenantRecordTabs
          key={tenant.id}
          tenantId={tenant.id}
          tenantName={tenant.display_name}
          unitLabel={propertyLabelForTenant(tenant, detailLeases, detailMemberships, detailUnits)}
          onOpenPropertyLedger={(propertyKey, propertyLabel) => onNavigate("setup", { recordType: "property", recordId: propertyKey, recordLabel: propertyLabel })}
          onOpenBankLedger={() => navigate?.("bank-ledger")}
          details={<>
        <TenantPaymentHistory key={tenant.id} tenantId={tenant.id} tenantName={tenant.display_name} onOpenFullLedger={() => openFullLedger(tenant)} />
        <TenantProfileCard title="Primary tenant" tenant={tenant} busyKey={busyKey} updateProfile={updateProfile} updateEmail={updateEmail} onPhotoUploaded={(photoUrl) => reconcileTenantPhoto(tenant.id, photoUrl)} sendInviteEmail={sendInviteEmail} leaseId={household.lease?.id} lateFeeOverride={detailData?.lateFeeTenantOverride || null} saveLateFeeOverride={saveLateFeeOverride} workspacePaymentPolicy={detailData?.paymentPolicy || "allow_any_amount"} paymentPolicyOverride={tenant.payment_policy||null} savePaymentPolicyOverride={savePaymentPolicyOverride} makePrimary={householdHasNoPrimary && primaryCardIsLeaseMember && household.lease.status !== "cancelled" ? ()=>makePrimary(household.lease.id, tenant.id) : null}/>{household.lease && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">The primary tenant cannot be removed from a lease. Change the primary tenant first.</p>}
        <CustomFieldsEditor groups={[{ entity: "tenant", recordId: tenant.id }]} />
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700" data-tenant-notice-log>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">Generated notices</p>
          <div className="mt-2"><NoticeLogList tenantId={tenant.id} tenantName={tenant.display_name} compact /></div>
        </div>
        {!detailMemberships.some((item) => item.tenant_id === tenant.id) && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30"><p className="text-sm font-bold text-red-900 dark:text-red-200">This tenant is not assigned to any lease.</p><button type="button" disabled={busyKey === BUSY_KEYS.delete(tenant.id)} onClick={() => { setDeleteTarget(tenant); setDeleteConfirmText(""); }} className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-50">Delete unused duplicate</button></div>}
        {deleteTarget && <div role="alertdialog" aria-modal="true" aria-labelledby="delete-unused-tenant-title" aria-describedby="delete-unused-tenant-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          onKeyDown={(event) => { if (event.key === "Escape") cancelDeleteTarget(); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
            <h3 id="delete-unused-tenant-title" className="text-lg font-black text-slate-950 dark:text-white">Delete unused duplicate?</h3>
            <p id="delete-unused-tenant-desc" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Permanently delete <strong>{deleteTarget.display_name}</strong> ({deleteTarget.email})? This cannot be undone.
              Only tenants with no lease, payments, or other rental history can be deleted. A tenant who has claimed the portal cannot be deleted.</p>
            <label className="mt-4 block text-sm font-bold text-slate-900 dark:text-white">Type DELETE to confirm
              <input name="deleteConfirmText" autoFocus value={deleteConfirmText}
                onChange={(event) => setDeleteConfirmText(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-950 dark:text-white" /></label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={cancelDeleteTarget} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-black text-slate-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={busyKey === BUSY_KEYS.delete(deleteTarget.id) || deleteConfirmText !== "DELETE"} onClick={confirmDeleteTarget}
                className="rounded-xl bg-red-700 px-5 py-2.5 text-sm font-black text-white transition disabled:opacity-50">Delete permanently</button>
            </div>
          </div>
        </div>}
        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700"><h3 className="text-lg font-black text-slate-950 dark:text-white">Co-tenants / spouse</h3>{household.lease?.status === "cancelled" && <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">This lease is cancelled — membership cannot be changed.</p>}<div className="mt-2 space-y-4">{household.coTenants.length ? household.coTenants.map((coTenant)=><TenantProfileCard key={coTenant.id} title="Co-tenant" tenant={coTenant} busyKey={busyKey} updateProfile={updateProfile} updateEmail={updateEmail} onPhotoUploaded={(photoUrl) => reconcileTenantPhoto(coTenant.id, photoUrl)} sendInviteEmail={sendInviteEmail} leaseId={household.lease?.id} lateFeeOverride={detailData?.lateFeeTenantOverride || null} saveLateFeeOverride={saveLateFeeOverride} workspacePaymentPolicy={detailData?.paymentPolicy || "allow_any_amount"} paymentPolicyOverride={coTenant.payment_policy||null} savePaymentPolicyOverride={savePaymentPolicyOverride} makePrimary={household.lease && household.lease.status !== "cancelled" ? ()=>makePrimary(household.lease.id,coTenant.id) : null} removeCoTenant={household.lease && household.lease.status !== "cancelled" ? ()=>removeCoTenant(household.lease.id,coTenant) : null}/>) : !household.lease ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No co-tenant is assigned — this tenant has no lease yet. Create a lease first, then add co-tenants to it.</p> : household.lease.status !== "cancelled" && coTenantCandidates.length === 0 && !coTenantsBeyondLoadedPages ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No co-tenant is assigned to this lease. Every saved tenant is already on this lease — create a new tenant record first to add one.</p> : <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No co-tenant is assigned to this lease.</p>}</div>{household.lease && household.lease.status !== "cancelled" && (coTenantCandidates.length > 0 || coTenantQuery.trim().length >= 2 || coTenantsBeyondLoadedPages) && <form onSubmit={(event)=>addCoTenant(event, household.lease.id)} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1 text-sm font-bold text-slate-900 dark:text-white">Search all tenants by name or email<input name="coTenantSearch" value={coTenantQuery} onChange={(event)=>{ const value = event.target.value; setCoTenantQuery(value); setCoTenantSearchError(""); if (value.trim().length < 2) { setCoTenantSearch([]); setCoTenantSearching(false); } else { setCoTenantSearching(true); } }} placeholder="Type at least 2 characters to search every tenant" aria-label="Search all tenants by name or email" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label><label className="min-w-[260px] flex-1 text-sm font-bold text-slate-900 dark:text-white">Add co-tenant<select name="coTenantId" required defaultValue="" aria-label="Tenant to add as co-tenant" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="" disabled>Select a saved tenant</option>{coTenantCandidates.map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.display_name} — {candidate.email}</option>)}</select></label><button disabled={busyKey === BUSY_KEYS.addCoTenant} className={`rounded-lg px-4 py-2 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>Add co-tenant</button>{coTenantSearching && <p className="w-full text-xs font-bold text-slate-500 dark:text-slate-400">Searching…</p>}{coTenantSearchError && <p className="w-full text-xs font-bold text-red-600 dark:text-red-400">{coTenantSearchError}</p>}{coTenantQuery.trim().length >= 2 && !coTenantSearching && !coTenantSearchError && coTenantSearch.length === 0 && <p className="w-full text-xs font-bold text-slate-500 dark:text-slate-400">No tenant matches “{coTenantQuery.trim()}”.</p>}</form>}</div>
        <a href="/auth?next=/forge/rental/portal" className="mt-5 inline-block text-sm font-bold text-sky-700 underline hover:text-sky-800 dark:text-sky-400 dark:hover:text-sky-300">Open tenant sign-in</a></>}
        />
      </div>
    </section>;
  }
  // Index mode: the Tenants screen is an efficient list. No Household preview
  // sidebar -- record data lives on the dedicated tenant record page.
  return <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" data-rental-tenant-setup>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700 dark:text-sky-400">{termLabel("tenant", { capitalize: true })} setup</p>
        <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950 dark:text-white">{termLabel("tenant", { plural: true, capitalize: true })}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Review saved tenants first. Creation remains separate from portal access and lease assignment.</p></div>
      {tenants.length > 0 && !showCreate && <button type="button" onClick={() => setShowCreate(true)} className={`shrink-0 rounded-xl px-5 py-3 text-sm font-black transition ${goldControlClassName}`}>+ Add a new tenant</button>}
    </div>
    <CardContextMenu menu={contextMenu} onClose={closeContextMenu} />
    {recordContext?.notice && <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-base font-black text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100">✓ {recordContext.notice}</p>}
    {message && <p role="status" className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-bold text-slate-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-slate-200">{message}</p>}
    {isLoading && <div className="mt-4"><ForgeLoadingState label="Loading tenants…" /></div>}
    {isRefreshing && tenants.length > 0 && <p className="mt-3 text-xs font-bold text-slate-400 dark:text-slate-500">Updating…</p>}
    {loadError && !data && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800 dark:bg-red-950/40 dark:text-red-300">{loadError}</p>}
    {recordTenantId && detailData?.notFound && !recordContext?.notice && <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">That tenant record wasn&apos;t found. Showing the full tenant list.</p>}
    {tenants.length > 0 && <RentalRecordBrowser title="Tenants" records={tenants} selectedId={null}
      onSelect={(id) => goToTenantRecord(tenants.find((item) => item.id === id))}
      getThumbnail={(tenant) => tenant.photo_url} listSize="wide"
      onRowContextMenu={(event, tenant) => onContextMenu(event, tenantMenuItems(tenant, { recordType: "tenant", recordId: tenant.id }))}
      columns={[
        { header: "Tenant", filterText: (tenant) => tenant.display_name, render: (tenant) => <strong className="block truncate text-sm text-slate-950 dark:text-white">{tenant.display_name}</strong> },
        { header: "Email", filterText: (tenant) => tenant.email || "", render: (tenant) => <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{tenant.email}</span> },
        { header: "Invite", width: "130px", filterText: (tenant) => tenantInviteLabel(tenant), render: (tenant) => <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{tenantInviteLabel(tenant)}</span> },
        { header: "Property", width: "200px", filterText: (tenant) => propertyLabelForTenant(tenant, leases, leaseMemberships, units) || "No active lease", render: (tenant) => { const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id); const lease = leases.find((item) => leaseIds.includes(item.id) && item.status === "active") || leases.find((item) => leaseIds.includes(item.id)); const unit = units.find((item) => item.id === lease?.unit_id); const propertyLabel = propertyLabelForTenant(tenant, leases, leaseMemberships, units);
          if (!propertyLabel) return <span className="font-bold text-red-600 dark:text-red-400">No active lease</span>;
          return unit
            ? <button type="button" onClick={(event) => { event.stopPropagation(); onNavigate("setup", { recordType: "property", recordId: unit.id, recordLabel: unit.label }); }} title={`View property ${unit.label}`} className="block truncate text-left font-bold text-sky-700 underline decoration-sky-300 underline-offset-2 hover:text-sky-900 dark:text-sky-400 dark:hover:text-sky-300">{propertyLabel}</button>
            : <span className="block truncate">{propertyLabel}</span>; } },
        { header: "Status", width: "110px", filterText: (tenant) => { const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id); return leases.some((lease) => leaseIds.includes(lease.id) && lease.status === "active") ? "Moved In" : "Inactive"; }, render: (tenant) => { const leaseIds = leaseMemberships.filter((membership) => membership.tenant_id === tenant.id).map((membership) => membership.lease_id); const movedIn = leases.some((lease) => leaseIds.includes(lease.id) && lease.status === "active"); return movedIn
          ? <span className="font-bold text-emerald-700 dark:text-emerald-400">Moved In</span>
          : <span className="font-bold text-slate-500 dark:text-slate-400">Inactive</span>; } },
        { header: "Active balance", width: "130px", align: "right", filterText: (tenant) => { const balanceCents = activeBalanceCentsForTenant(tenant, leases, leaseMemberships, openCharges); return balanceCents === null ? "" : money.format(balanceCents / 100); }, sortValue: (tenant) => activeBalanceCentsForTenant(tenant, leases, leaseMemberships, openCharges), render: (tenant) => { const balanceCents = activeBalanceCentsForTenant(tenant, leases, leaseMemberships, openCharges); return balanceCents === null
          ? <span className="text-slate-500 dark:text-slate-400">—</span>
          : <button type="button" onClick={(event) => { event.stopPropagation(); openFullLedger(tenant); }}
              title={`View the full ledger for ${tenant.display_name}`}
              aria-label={`View the full ledger for ${tenant.display_name} — balance ${money.format(balanceCents / 100)}`}
              className="underline decoration-dotted underline-offset-4 hover:opacity-80">
              <strong className={balanceCents > 0 ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}>{money.format(balanceCents / 100)}</strong>
            </button>; } },
      ]} />}
    {data && tenantTotalCount > TENANT_LIST_PAGE_SIZE && <div className="mt-4 flex flex-wrap items-center gap-3">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Showing {tenants.length} of {tenantTotalCount} tenants.</p>
      {tenants.length < tenantTotalCount && <button type="button" disabled={loadingMoreTenants} onClick={loadMoreTenants} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{loadingMoreTenants ? "Loading…" : "Load more tenants"}</button>}
    </div>}
    {showCreate && <form onSubmit={save} className="mt-6 grid max-w-4xl gap-4 md:grid-cols-2">
      <label className="text-sm font-bold text-slate-900 dark:text-white">Tenant name<input name="displayName" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Email<input name="email" type="email" required className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Phone<input name="phone" type="tel" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-900 dark:text-white" /></label>
      <div className="flex items-end gap-3"><button disabled={busyKey === BUSY_KEYS.create} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{busyKey === BUSY_KEYS.create ? "Saving…" : "Save tenant"}</button>{tenants.length > 0 && <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>}</div>
    </form>}
  </section>;
}

// Rentec-parity: the tenant record leads with the details -- the info view is
// the record home (contact, lease, deposit, activity), and the ledger is the
// second tab. Matches Rentec's tenant detail panel; the full-page ledger
// remains one click away via View Ledger. Keyed by tenant id by the caller so
// switching records always resets to the details tab.
function TenantRecordTabs({ tenantId, tenantName, unitLabel, onOpenPropertyLedger, onOpenBankLedger, details }) {
  const [recordTab, setRecordTab] = useState("details");
  const tabClass = (active) => `rounded-t-xl px-4 py-2.5 text-sm font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${
    active
      ? "bg-white text-slate-950 shadow-[inset_0_-2px_0_0_#0284c7] dark:bg-slate-900 dark:text-white"
      : "text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white"
  }`;
  return <>
    <div role="tablist" aria-label={`Record views for ${tenantName}`} className="mt-5 flex gap-1 border-b border-slate-200 dark:border-slate-700">
      <button type="button" role="tab" aria-selected={recordTab === "details"} data-record-tab="details"
        onClick={() => setRecordTab("details")} className={tabClass(recordTab === "details")}>Tenant details</button>
      <button type="button" role="tab" aria-selected={recordTab === "ledger"} data-record-tab="ledger"
        onClick={() => setRecordTab("ledger")} className={tabClass(recordTab === "ledger")}>Ledger</button>
    </div>
    {recordTab === "details" ? (
      <div role="tabpanel" aria-label="Tenant details" className="mt-4">{details}</div>
    ) : (
      <div role="tabpanel" aria-label="Tenant ledger" className="mt-4">
        <TenantLedgerPage tenantId={tenantId} tenantName={tenantName} unitLabel={unitLabel}
          closeLabel="Tenant details" onClose={() => setRecordTab("details")}
          onOpenPropertyLedger={onOpenPropertyLedger} onOpenBankLedger={onOpenBankLedger} />
      </div>
    )}
  </>;
}

// Dense lease strip: a bordered definition row, not an oversized preview card.
function LeaseSummaryStrip({lease,unit}) {
  const items = [
    ["Property", unit?.label || lease?.property_id],
    ["Lease status", lease?.status],
    ["Lease dates", lease ? `${lease.start_date} to ${lease.end_date || "Open-ended"}` : null],
    ["Monthly rent", lease ? money.format(Number(lease.monthly_rent_cents || 0) / 100) : null],
  ].filter(([, value]) => value);
  if (!items.length) return null;
  return <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 border-y border-slate-200 py-3 dark:border-slate-700">
    {items.map(([label, value]) => <div key={label} className="flex items-baseline gap-2">
      <dt className="text-xs font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-bold text-slate-950 dark:text-white">{value}</dd>
    </div>)}
  </dl>;
}
function Field({label,name,defaultValue="",type="text",step}) { return <label className="text-sm font-bold text-slate-900 dark:text-white">{label}<input name={name} type={type} step={step} defaultValue={defaultValue??""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label> }
function TenantProfileCard({title,tenant,busyKey,updateProfile,updateEmail,onPhotoUploaded,makePrimary,removeCoTenant,sendInviteEmail,leaseId,lateFeeOverride,saveLateFeeOverride,workspacePaymentPolicy,paymentPolicyOverride,savePaymentPolicyOverride}) {
  // Join-up invite confirmation (mirrors the borrower-invite pattern: checkbox
  // plus a typed phrase). The button fires a real email, so a single click
  // must never send it.
  const [showInviteConfirm, setShowInviteConfirm] = useState(false);
  const [inviteAck, setInviteAck] = useState(false);
  const [inviteConfirmText, setInviteConfirmText] = useState("");
  function openInviteConfirm() { setShowInviteConfirm(true); setInviteAck(false); setInviteConfirmText(""); }
  // Dense record section: a headed section with a top divider, not a floating card.
  return <section aria-label={title} className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">{title}</p><h4 className="mt-1 text-lg font-black text-slate-950 dark:text-white">{tenant.display_name}</h4></div>{makePrimary&&<button type="button" disabled={busyKey === BUSY_KEYS.primary(tenant.id)} onClick={makePrimary} className="rounded-lg border border-sky-500 px-3 py-2 text-sm font-bold text-sky-800 dark:text-sky-300">Make primary tenant</button>}{removeCoTenant&&<button type="button" disabled={busyKey === BUSY_KEYS.removeCoTenant(tenant.id)} onClick={removeCoTenant} className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-800 dark:text-red-300">Remove co-tenant</button>}</div>
  <div className="mt-4"><RentalPhotoUpload entityType="tenant" entityId={tenant.id} photoUrl={tenant.photo_url} onUploaded={(photoUrl) => onPhotoUploaded(photoUrl)}/></div>
  {!tenant.auth_user_id ? <form key={`email-${tenant.id}`} onSubmit={(event)=>updateEmail(event,tenant.id)} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1 text-sm font-bold text-slate-900 dark:text-white">Contact / portal email<input name="portalEmail" type="email" required defaultValue={tenant.email} aria-label={`Portal email for ${tenant.display_name}`} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label><button disabled={busyKey === BUSY_KEYS.email(tenant.id)} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white dark:bg-amber-400 dark:text-slate-950">Update email</button></form>
  : <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">This tenant has claimed the portal, so this email is tied to their portal sign-in and cannot be changed from the landlord side.</p>}
  {!tenant.auth_user_id && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30">
    <button type="button" disabled={busyKey === BUSY_KEYS.invite(tenant.id)} onClick={openInviteConfirm} className={`rounded-xl px-5 py-3 text-sm font-black transition disabled:opacity-50 ${goldControlClassName}`}>{busyKey === BUSY_KEYS.invite(tenant.id)?"Sending…":tenant.invited_at?"Resend invite email":"Send invite email"}</button>
    <p className="text-xs font-bold text-slate-600 dark:text-slate-400">{tenant.invited_at?`Invite sent ${new Date(tenant.invited_at).toLocaleDateString()}. The tenant signs in with the email above.`:"Emails the tenant a join-up invite with the portal link."}</p>
  </div>}
  {showInviteConfirm && <div role="alertdialog" aria-modal="true" aria-labelledby="send-invite-title" aria-describedby="send-invite-desc"
    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
    onKeyDown={(event) => { if (event.key === "Escape") setShowInviteConfirm(false); }}>
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900">
      <h3 id="send-invite-title" className="text-lg font-black text-slate-950 dark:text-white">Send invite email?</h3>
      <p id="send-invite-desc" className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        This sends a real email to <strong>{tenant.display_name}</strong> ({tenant.email}) with the tenant portal
        join-up link{tenant.invited_at ? " — resending the invite" : ""}. Only send when the tenant is ready to sign up.</p>
      <label className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <input type="checkbox" checked={inviteAck} onChange={(event) => setInviteAck(event.target.checked)} />
        I verified this recipient email is correct.</label>
      <label className="mt-3 block text-sm font-bold text-slate-900 dark:text-white">Type INVITE to confirm
        <input name="inviteConfirmText" autoFocus value={inviteConfirmText}
          onChange={(event) => setInviteConfirmText(event.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 dark:border-slate-600 dark:bg-slate-950 dark:text-white" /></label>
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={() => setShowInviteConfirm(false)} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-black text-slate-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
        <button type="button" disabled={busyKey === BUSY_KEYS.invite(tenant.id) || !inviteAck || inviteConfirmText !== "INVITE"}
          onClick={async () => { setShowInviteConfirm(false); await sendInviteEmail(tenant, leaseId); }}
          className="rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-black text-white transition disabled:opacity-50">Send invite</button>
      </div>
    </div>
  </div>}
  <form key={`profile-${tenant.id}`} onSubmit={(event)=>updateProfile(event,tenant.id)} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Field label="Tenant name" name="tenantName" defaultValue={tenant.display_name}/><Field label="Mobile phone" name="phone" type="tel" defaultValue={tenant.phone}/><Field label="Work phone" name="workPhone" type="tel" defaultValue={tenant.work_phone}/>
    <Field label="Employer" name="employerName" defaultValue={tenant.employer_name}/><Field label="Employer phone" name="employerPhone" type="tel" defaultValue={tenant.employer_phone}/><Field label="Monthly income" name="monthlyIncome" type="number" step="0.01" defaultValue={tenant.monthly_income_cents==null?"":Number(tenant.monthly_income_cents)/100}/>
    <Field label="Emergency contact" name="emergencyContactName" defaultValue={tenant.emergency_contact_name}/><Field label="Emergency contact phone" name="emergencyContactPhone" type="tel" defaultValue={tenant.emergency_contact_phone}/><Field label="SSN last four only" name="ssnLastFour" defaultValue={tenant.ssn_last_four}/>
    <label className="text-sm font-bold text-slate-900 dark:text-white">Application status<select name="applicationStatus" defaultValue={tenant.application_status||""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Not recorded</option><option value="not_started">Not started</option><option value="received">Received</option><option value="screening">Screening</option><option value="approved">Approved</option><option value="denied">Denied</option><option value="withdrawn">Withdrawn</option></select></label>
    <Field label="Application submitted" name="applicationSubmittedAt" type="datetime-local" defaultValue={tenant.application_submitted_at?.slice(0,16)}/><Field label="Screening provider" name="screeningProvider" defaultValue={tenant.screening_provider}/><Field label="Screening reference" name="screeningReference" defaultValue={tenant.screening_reference}/>
    <label className="text-sm font-bold text-slate-900 dark:text-white">Screening status<select name="screeningStatus" defaultValue={tenant.screening_status||""} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"><option value="">Not recorded</option><option value="not_started">Not started</option><option value="pending">Pending</option><option value="complete">Complete</option><option value="review_required">Review required</option></select></label><Field label="Screening completed" name="screeningCompletedAt" type="datetime-local" defaultValue={tenant.screening_completed_at?.slice(0,16)}/>
    <label className="text-sm font-bold text-slate-900 dark:text-white sm:col-span-2 lg:col-span-3">Private landlord notes<textarea name="landlordNotes" defaultValue={tenant.landlord_notes||""} rows="3" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white"/></label>
    <div className="sm:col-span-2 lg:col-span-3"><p className="mb-3 text-xs font-bold text-amber-800 dark:text-amber-300">Never enter a full Social Security number. Full screening credentials stay with the screening provider.</p><button disabled={busyKey === BUSY_KEYS.profile(tenant.id)} className={`rounded-xl px-5 py-3 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>Save tenant information</button></div>
  </form>
  <LateFeeOverrideForm tenant={tenant} override={lateFeeOverride} busyKey={busyKey} onSave={saveLateFeeOverride}/>
  <PaymentPolicyOverrideForm tenant={tenant} override={paymentPolicyOverride} workspacePolicy={workspacePaymentPolicy} busyKey={busyKey} onSave={savePaymentPolicyOverride}/>
</section> }

// Per-tenant automatic late-fee override. Blank fields fall back to the
// portfolio default; exempt skips the tenant entirely.
function LateFeeOverrideForm({tenant,override,busyKey,onSave}) {
  const inputClassName="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  const formKey=`latefee-override-${tenant.id}-${override?.updated_at||"none"}`;
  return <form key={formKey} onSubmit={(event)=>onSave(event,tenant.id,false)} className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
    <p className="text-xs font-black uppercase tracking-wide text-red-700 dark:text-red-400">Late-fee override</p>
    <h4 className="mt-1 text-base font-black text-slate-950 dark:text-white">Automatic late fees for {tenant.display_name}</h4>
    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Blank fields fall back to the portfolio default. Exempt skips this tenant entirely.</p>
    {override
      ? <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-bold text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">Override active{override.exempt?" — exempt from automatic late fees":" — custom terms apply"}.</p>
      : <p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">No override — the portfolio default applies.</p>}
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><input name="overrideExempt" type="checkbox" defaultChecked={override?.exempt===true}/> Exempt from automatic late fees</label>
      <Field label="Grace days (override)" name="overrideGraceDays" type="number" defaultValue={override?.grace_days??""} min={0} max={31} className={inputClassName}/>
      <label className="text-sm font-bold text-slate-900 dark:text-white">Calculation (override)<select name="overrideCalculationType" defaultValue={override?.calculation_type||""} className={inputClassName}><option value="">Portfolio default</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage of unpaid balance</option></select></label>
      <Field label="Fixed amount $ (override)" name="overrideFixedAmount" type="number" step="0.01" min="0.01" defaultValue={override?.fixed_amount_cents!=null?Number(override.fixed_amount_cents)/100:""} className={inputClassName}/>
      <Field label="Percentage % (override)" name="overridePercentage" type="number" step="0.01" min="0.01" defaultValue={override?.percentage_basis_points!=null?Number(override.percentage_basis_points)/100:""} className={inputClassName}/>
      <Field label="Maximum $ (override)" name="overrideMaximumAmount" type="number" step="0.01" min="0.01" defaultValue={override?.maximum_amount_cents!=null?Number(override.maximum_amount_cents)/100:""} className={inputClassName}/>
    </div>
    <div className="mt-4 flex flex-wrap gap-3">
      <button disabled={busyKey === BUSY_KEYS.lateFee(tenant.id)} className={`rounded-xl px-5 py-3 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>Save override</button>
      {override?<button type="button" disabled={busyKey === BUSY_KEYS.lateFee(tenant.id)} onClick={(event)=>onSave(event,tenant.id,true)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Clear override</button>:null}
    </div>
  </form>;
}

// Per-tenant payment-policy override (R11). Shows the effective policy -- the
// tenant's override when set, otherwise the inherited portfolio default -- and
// lets the owner pick one of the three modes or inherit again.
function PaymentPolicyOverrideForm({tenant,override,workspacePolicy,busyKey,onSave}) {
  const inputClassName="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-900 dark:text-white";
  const formKey=`payment-policy-override-${tenant.id}-${override||"inherit"}`;
  const effective=override||workspacePolicy||"allow_any_amount";
  return <form key={formKey} onSubmit={(event)=>onSave(event,tenant.id,false)} aria-label="Payment policy override" className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-700">
    <p className="text-xs font-black uppercase tracking-wide text-sky-700 dark:text-sky-400">Payment policy override</p>
    <h4 className="mt-1 text-base font-black text-slate-950 dark:text-white">Payment rules for {tenant.display_name}</h4>
    {override
      ? <p className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm font-bold text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">Override active — this tenant follows <strong>{paymentPolicyLabel(override)}</strong> instead of the portfolio default.</p>
      : <p className="mt-3 text-sm font-bold text-slate-500 dark:text-slate-400">No override — inherits the portfolio default: <strong>{paymentPolicyLabel(workspacePolicy)}</strong>.</p>}
    <label className="mt-4 block text-sm font-bold text-slate-900 dark:text-white">Policy for this tenant
      <select name="overridePaymentPolicy" defaultValue={override||"inherit"} className={inputClassName}>
        <option value="inherit">Inherit portfolio default ({paymentPolicyLabel(workspacePolicy)})</option>
        {PAYMENT_POLICIES.map((policy)=><option key={policy} value={policy}>{paymentPolicyLabel(policy)} — {paymentPolicyDescription(policy)}</option>)}
      </select>
    </label>
    <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">Effective policy: {paymentPolicyLabel(effective)}. {paymentPolicyDescription(effective)}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button disabled={busyKey === BUSY_KEYS.paymentPolicy(tenant.id)} className={`rounded-xl px-5 py-3 text-sm font-black disabled:opacity-50 ${goldControlClassName}`}>Save override</button>
      {override?<button type="button" disabled={busyKey === BUSY_KEYS.paymentPolicy(tenant.id)} onClick={(event)=>onSave(event,tenant.id,true)} className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">Clear override</button>:null}
    </div>
  </form>;
}
