// @vitest-environment jsdom
// PR #863 fix round 1 — Finding 2: the first-50 tenant list needs real
// continuation. 75 tenants prove the page boundary: page 1 must stay 50 rows
// with an exact total count, Load more must append page 2 with no duplicate
// or missing ids, co-tenant selection must reach tenants past page 1, and
// create/delete/rename across the boundary must re-read the exact page
// (never render 51+ rows or a short/stale list).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel, { sortTenantsByName } from "./RentalTenantPanel";
import { clearSWRCache, getCacheEntry, seedCacheEntry } from "@/hooks/swrCache";

const UNIT = { id: "u1", label: "4225 Barnhill" };
const LEASE = { id: "l1", unit_id: "u1", property_id: "p1", status: "active", start_date: "2026-01-01", end_date: "2026-12-31", monthly_rent_cents: 185000 };
const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };

function tenantId(number) {
  return `t${String(number).padStart(2, "0")}`;
}
function tenantName(number) {
  return `Tenant ${String(number).padStart(2, "0")}`;
}
function compactRow(number) {
  return { id: tenantId(number), display_name: tenantName(number), email: `tenant${number}@example.com`,
    invited_at: null, auth_user_id: null, photo_bucket: null, photo_object_path: null, photo_url: null };
}
function fullRow(number) {
  return { ...compactRow(number), phone: "555-1000", work_phone: null, employer_name: null,
    employer_phone: null, monthly_income_cents: null, emergency_contact_name: null,
    emergency_contact_phone: null, application_status: null, application_submitted_at: null,
    screening_provider: null, screening_reference: null, screening_status: null,
    screening_completed_at: null, ssn_last_four: null, landlord_notes: null, status: "active",
    payment_policy: null };
}

function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function flush(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

describe("RentalTenantPanel Finding 2 pagination (75 tenants)", () => {
  let container;
  let root;
  let gets;
  let posts;
  let liveTenants;
  let liveMemberships;
  let failEmailUpdate;
  let failCoTenantSearch;

  function pageOnePayload() {
    const sorted = sortTenantsByName(liveTenants);
    return { tenants: sorted.slice(0, 50), leases: [LEASE], leaseMemberships: liveMemberships.map((item) => ({ ...item })),
      units: [UNIT], openCharges: [], totalCount: liveTenants.length, page: 1, pageSize: 50 };
  }

  function detailPayload(tenantIdValue) {
    const tenant = liveTenants.find((item) => item.id === tenantIdValue);
    if (!tenant) return { tenant: null, notFound: true };
    const memberships = liveMemberships.filter((item) => item.tenant_id === tenantIdValue);
    const leaseIds = [...new Set(memberships.map((item) => item.lease_id))];
    const householdMemberships = liveMemberships.filter((item) => leaseIds.includes(item.lease_id));
    const householdIds = [...new Set([...householdMemberships.map((item) => item.tenant_id), tenantIdValue])];
    return { tenant: fullRow(Number(tenantIdValue.slice(1))),
      tenants: householdIds.map((id) => fullRow(Number(id.slice(1)))),
      leases: leaseIds.length ? [LEASE] : [], leaseMemberships: householdMemberships,
      units: [UNIT], openCharges: [], lateFeeTenantOverride: null, paymentPolicy: "allow_any_amount" };
  }

  function postResponse(body) {
    switch (body.operation) {
      case "save-tenant": {
        const nextNumber = 100 + liveTenants.length;
        const saved = { id: `t${nextNumber}`, displayName: body.tenant.displayName, display_name: body.tenant.displayName,
          email: body.tenant.email, phone: body.tenant.phone ?? null, status: "inactive",
          invitedAt: null, authUserId: null, activatedAt: null, createdAt: "2026-11-26T00:00:00.000Z", updatedAt: "2026-11-26T00:00:00.000Z" };
        liveTenants = sortTenantsByName([...liveTenants, { id: saved.id, display_name: saved.displayName,
          email: saved.email, invited_at: null, auth_user_id: null, photo_bucket: null,
          photo_object_path: null, photo_url: null }]);
        return { success: true, tenant: saved };
      }
      case "delete-unused-tenant": {
        const deleted = liveTenants.find((item) => item.id === body.tenantId);
        liveTenants = liveTenants.filter((item) => item.id !== body.tenantId);
        liveMemberships = liveMemberships.filter((item) => item.tenant_id !== body.tenantId);
        return { success: true, deletedTenant: { id: deleted.id, display_name: deleted.display_name, email: deleted.email } };
      }
      case "update-tenant-email": {
        if (failEmailUpdate) return { __fail: true, error: "Unable to update tenant email." };
        const row = liveTenants.find((item) => item.id === body.tenantId);
        if (row) row.email = String(body.email).trim().toLowerCase();
        return { success: true, tenant: { id: body.tenantId, display_name: row?.display_name, email: row?.email, status: "active" } };
      }
      case "send-tenant-invite": {
        const row = liveTenants.find((item) => item.id === body.tenantId);
        if (row) row.invited_at = "2026-11-26T12:00:00.000Z";
        return { success: true, tenantId: body.tenantId, invitedAt: "2026-11-26T12:00:00.000Z" };
      }
      case "update-tenant-profile": {
        const name = typeof body.profile.displayName === "string" && body.profile.displayName.trim() !== ""
          ? body.profile.displayName.trim() : null;
        const row = liveTenants.find((item) => item.id === body.tenantId);
        if (row && name) row.display_name = name;
        liveTenants = sortTenantsByName(liveTenants);
        return { success: true, tenant: { id: body.tenantId, display_name: name || row?.display_name } };
      }
      case "add-co-tenant": {
        const membership = { lease_id: body.leaseId, tenant_id: body.tenantId, occupancy_role: "co_tenant" };
        liveMemberships = [...liveMemberships, membership];
        return { success: true, membership };
      }
      default:
        throw new Error(`unexpected POST ${body.operation}`);
    }
  }

  // A real server returns JSON: every GET hands the client fresh objects.
  // The stub must do the same, or a server-side mutation of liveTenants
  // would leak into already-cached pages through shared references and make
  // a missing reconciliation look like it worked.
  function freshCopy(payload) {
    return JSON.parse(JSON.stringify(payload));
  }

  function stubFetch() {
    gets = [];
    posts = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      if (String(url).includes("tenant-ledger")) return { ok: true, json: async () => emptyHistory };
      if (String(url).includes("custom-field-values")) return { ok: true, json: async () => ({ fields: [], values: {} }) };
      if (String(url).includes("/api/rental/notices")) return { ok: true, json: async () => ({ notices: [] }) };
      if (String(url).includes("/api/rental/photo")) {
        posts.push({ url: String(url), method: options?.method || "POST" });
        return { ok: true, json: async () => ({ photoUrl: "https://example.test/photos/t71.png" }) };
      }
      if (options?.method === "POST") {
        const body = JSON.parse(options.body);
        posts.push(body);
        const result = postResponse(body);
        if (result.__fail) return { ok: false, json: async () => ({ error: result.error }) };
        return { ok: true, json: async () => result };
      }
      gets.push(String(url));
      const parsed = new URL(String(url), "http://localhost");
      if (String(url).includes("surface=tenant-detail")) {
        const tenantIdValue = parsed.searchParams.get("tenantId") || "";
        return { ok: true, json: async () => freshCopy(detailPayload(tenantIdValue)) };
      }
      if (String(url).includes("surface=tenants")) {
        const search = (parsed.searchParams.get("search") || "").trim().toLowerCase();
        if (search && failCoTenantSearch) return { ok: false, json: async () => ({ error: "Search unavailable." }) };
        const page = Math.max(1, Number(parsed.searchParams.get("page") || 1));
        const pageSize = Math.min(50, Math.max(1, Number(parsed.searchParams.get("pageSize") || 50)));
        let rows = sortTenantsByName(liveTenants);
        if (search) {
          const matches = rows.filter((item) => item.display_name.toLowerCase().includes(search)
            || String(item.email || "").toLowerCase().includes(search));
          rows = matches.slice(0, 20);
          return { ok: true, json: async () => freshCopy({ tenants: rows, leases: [], leaseMemberships: [],
            units: [], openCharges: [], totalCount: matches.length, page: 1, pageSize: 20, search }) };
        }
        const totalCount = rows.length;
        const sliced = rows.slice((page - 1) * pageSize, page * pageSize);
        return { ok: true, json: async () => freshCopy({ tenants: sliced, leases: [LEASE],
          leaseMemberships: liveMemberships.map((item) => ({ ...item })), units: [UNIT], openCharges: [],
          totalCount, page, pageSize }) };
      }
      throw new Error(`unexpected GET ${url}`);
    }));
  }

  function expectNoMonolithFetch() {
    const monolith = gets.filter((url) => url === "/api/rental" || (url.startsWith("/api/rental?") && !url.includes("surface=tenants") && !url.includes("surface=tenant-detail")));
    expect(monolith).toEqual([]);
  }

  async function mountPanel({ recordContext = null, onNavigate = null } = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<RentalTenantPanel recordContext={recordContext} onNavigate={onNavigate} />));
    await flush();
    return container;
  }
  // Re-render into the same root so component state (loaded extra pages)
  // survives the navigation, exactly as the still-mounted index keeps them
  // while the record view is open.
  async function rerenderPanel({ recordContext = null, onNavigate = null } = {}) {
    await act(async () => root.render(<RentalTenantPanel recordContext={recordContext} onNavigate={onNavigate} />));
    await flush();
    return container;
  }
  async function openPageTwoRecord(tenantIdValue, onNavigate) {
    const loadMore = [...container.querySelectorAll("button")].find((button) => button.textContent === "Load more tenants");
    await act(async () => loadMore.click());
    await flush();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(75);
    await rerenderPanel({ recordContext: { recordType: "tenant", recordId: tenantIdValue }, onNavigate });
  }
  function indexRowFor(displayName) {
    return [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent.includes(displayName));
  }

  beforeEach(() => {
    clearSWRCache();
    failEmailUpdate = false;
    failCoTenantSearch = false;
    liveTenants = Array.from({ length: 75 }, (_, i) => compactRow(i + 1));
    liveMemberships = [
      { lease_id: "l1", tenant_id: "t01", occupancy_role: "primary" },
      { lease_id: "l1", tenant_id: "t02", occupancy_role: "co_tenant" },
    ];
    seedCacheEntry("rental:tenants:v2", JSON.parse(JSON.stringify(pageOnePayload())));
    stubFetch();
  });
  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.unstubAllGlobals();
    clearSWRCache();
  });

  it("page 1 renders 50 rows with an exact count and a Load more control", async () => {
    await mountPanel();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 75 tenants.");
    const loadMore = [...container.querySelectorAll("button")].find((button) => button.textContent === "Load more tenants");
    expect(loadMore).not.toBeUndefined();
    expectNoMonolithFetch();
  });

  it("Load more appends page 2 with no duplicate or missing ids", async () => {
    await mountPanel();
    const loadMore = [...container.querySelectorAll("button")].find((button) => button.textContent === "Load more tenants");
    await act(async () => loadMore.click());
    await flush();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(75);
    expect(container.textContent).toContain("Showing 75 of 75 tenants.");
    expect([...container.querySelectorAll("button")].find((button) => button.textContent === "Load more tenants")).toBeUndefined();
    const pageOne = getCacheEntry("rental:tenants:v2").data.tenants.map((item) => item.id);
    const pageTwo = getCacheEntry("rental:tenants:v2:page:2").data.tenants.map((item) => item.id);
    expect(pageOne).toHaveLength(50);
    expect(pageTwo).toHaveLength(25);
    const all = [...pageOne, ...pageTwo];
    expect(new Set(all).size).toBe(75);
    expect(new Set(all)).toEqual(new Set(liveTenants.map((item) => item.id)));
    expect(gets.filter((url) => url.includes("surface=tenants") && url.includes("page=2"))).toHaveLength(1);
    expectNoMonolithFetch();
  });

  it("co-tenant search finds an off-first-page tenant and adds them to the lease", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t01" } });
    // Tenant 71 is on page 2: it is not among the loaded candidates.
    const select = container.querySelector('select[name="coTenantId"]');
    expect([...select.options].map((option) => option.value)).not.toContain("t71");
    const search = container.querySelector('input[name="coTenantSearch"]');
    setNativeValue(search, "Tenant 71");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await flush();
    expect([...select.options].map((option) => option.value)).toContain("t71");
    select.value = "t71";
    await act(async () => { select.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "add-co-tenant")).toHaveLength(1);
    expect(posts.find((body) => body.operation === "add-co-tenant").tenantId).toBe("t71");
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Co-tenant added: Tenant 71.");
    expect(container.querySelectorAll('section[aria-label="Co-tenant"]')).toHaveLength(2);
  });

  it("create onto page 1 keeps 50 rows and the exact count; create past the boundary leaves page 1 intact", async () => {
    const onNavigate = vi.fn();
    await mountPanel({ onNavigate });
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "+ Add a new tenant").click());
    const form = container.querySelector('input[name="displayName"]').form;
    setNativeValue(container.querySelector('input[name="displayName"]'), "Aaron Aardvark");
    setNativeValue(container.querySelector('input[name="email"]'), "aaron@example.com");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "save-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    const cached = getCacheEntry("rental:tenants:v2").data;
    expect(cached.tenants).toHaveLength(50);
    expect(cached.totalCount).toBe(76);
    expect(cached.tenants[0].display_name).toBe("Aaron Aardvark");
    expect(cached.tenants[49].display_name).toBe("Tenant 49");
    expect(cached.tenants.map((item) => item.display_name)).not.toContain("Tenant 50");

    // A second create sorting past the boundary must not disturb page 1.
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "+ Add a new tenant").click());
    const form2 = container.querySelector('input[name="displayName"]').form;
    setNativeValue(container.querySelector('input[name="displayName"]'), "Zoe Zebra");
    setNativeValue(container.querySelector('input[name="email"]'), "zoe@example.com");
    await act(async () => { form2.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const cached2 = getCacheEntry("rental:tenants:v2").data;
    expect(cached2.tenants).toHaveLength(50);
    expect(cached2.totalCount).toBe(77);
    expect(cached2.tenants[0].display_name).toBe("Aaron Aardvark");
    expect(cached2.tenants[49].display_name).toBe("Tenant 49");
  });

  it("delete from page 1 pulls the next tenant in and keeps 50 rows", async () => {
    // Tenant 25 is unassigned, so the delete box shows on her record.
    const onNavigate = vi.fn();
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t25" }, onNavigate });
    const deleteButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete unused duplicate");
    act(() => deleteButton.click());
    const dialog = container.querySelector('[role="alertdialog"]');
    setNativeValue(dialog.querySelector('input[name="deleteConfirmText"]'), "DELETE");
    const confirmButton = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Delete permanently");
    await act(async () => confirmButton.click());
    await flush();
    expect(posts.filter((body) => body.operation === "delete-unused-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    const cached = getCacheEntry("rental:tenants:v2").data;
    expect(cached.tenants).toHaveLength(50);
    expect(cached.totalCount).toBe(74);
    expect(cached.tenants.map((item) => item.id)).not.toContain("t25");
    expect(cached.tenants.map((item) => item.display_name)).toContain("Tenant 51");
    expect(container.textContent).toContain("Deleted unused duplicate: Tenant 25.");
    expect(onNavigate).toHaveBeenCalledWith("tenants");
  });

  it("rename across the boundary re-reads the exact first page", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t01" } });
    const form = container.querySelector('input[name="tenantName"]').form;
    setNativeValue(container.querySelector('input[name="tenantName"]'), "Zoe Zimmerman");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "update-tenant-profile")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Tenant information updated for Zoe Zimmerman.");
    // The renamed tenant now sorts past the boundary: page 1 is the exact
    // first 50 again, with Tenant 51 pulled in.
    const cached = getCacheEntry("rental:tenants:v2").data;
    expect(cached.tenants).toHaveLength(50);
    expect(cached.totalCount).toBe(75);
    expect(cached.tenants.map((item) => item.display_name)).toContain("Tenant 51");
    expect(cached.tenants.map((item) => item.display_name)).not.toContain("Zoe Zimmerman");
    // The detail cache still carries the renamed full profile.
    expect(getCacheEntry("rental:tenant-detail:t01").data.tenant.display_name).toBe("Zoe Zimmerman");
  });

  it("a failed email write never patches either cache", async () => {
    failEmailUpdate = true;
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t01" } });
    const form = container.querySelector('input[name="portalEmail"]').form;
    setNativeValue(container.querySelector('input[name="portalEmail"]'), "alice.new@example.com");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "update-tenant-email")).toHaveLength(1);
    expect(container.textContent).toContain("Unable to update tenant email.");
    expect(getCacheEntry("rental:tenants:v2").data.tenants.find((item) => item.id === "t01").email).toBe("tenant1@example.com");
    expect(getCacheEntry("rental:tenant-detail:t01").data.tenant.email).toBe("tenant1@example.com");
  });

  it("create at exactly 50 tenants re-reads page 1 instead of appending a 51st row", async () => {
    // PR #863 fix round 2, residual P1: with exactly 50 tenants the new row
    // belongs on page 2. A local append would render an impossible 51-row
    // first page ("Showing 51 of 51" with no Load more button).
    liveTenants = Array.from({ length: 50 }, (_, i) => compactRow(i + 1));
    clearSWRCache();
    seedCacheEntry("rental:tenants:v2", JSON.parse(JSON.stringify(pageOnePayload())));
    const onNavigate = vi.fn();
    await mountPanel({ onNavigate });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(50);
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "+ Add a new tenant").click());
    const form = container.querySelector('input[name="displayName"]').form;
    setNativeValue(container.querySelector('input[name="displayName"]'), "Aaron Aardvark");
    setNativeValue(container.querySelector('input[name="email"]'), "aaron@example.com");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "save-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    // The create re-read the authoritative first page instead of patching.
    expect(gets.filter((url) => url.includes("surface=tenants") && url.includes("page=1"))).toHaveLength(1);
    const cached = getCacheEntry("rental:tenants:v2").data;
    expect(cached.tenants).toHaveLength(50);
    expect(cached.totalCount).toBe(51);
    expect(cached.tenants[0].display_name).toBe("Aaron Aardvark");
    expect(cached.tenants[49].display_name).toBe("Tenant 49");
    expect(cached.tenants.map((item) => item.display_name)).not.toContain("Tenant 50");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 51 tenants.");
    // Load more reveals the one remaining tenant on page 2.
    const loadMore = [...container.querySelectorAll("button")].find((button) => button.textContent === "Load more tenants");
    await act(async () => loadMore.click());
    await flush();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(51);
    expect(container.textContent).toContain("Showing 51 of 51 tenants.");
    expect(getCacheEntry("rental:tenants:v2:page:2").data.tenants.map((item) => item.display_name)).toEqual(["Tenant 50"]);
  });

  it("create at 49 tenants stays refetch-free and fills page 1 exactly", async () => {
    // Zero-refetch fast path: the 50th row completes page 1, so a local
    // patch is exact and no authoritative re-read is owed.
    liveTenants = Array.from({ length: 49 }, (_, i) => compactRow(i + 1));
    clearSWRCache();
    seedCacheEntry("rental:tenants:v2", JSON.parse(JSON.stringify(pageOnePayload())));
    const onNavigate = vi.fn();
    await mountPanel({ onNavigate });
    expect(container.querySelectorAll("tbody tr")).toHaveLength(49);
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "+ Add a new tenant").click());
    const form = container.querySelector('input[name="displayName"]').form;
    setNativeValue(container.querySelector('input[name="displayName"]'), "Aaron Aardvark");
    setNativeValue(container.querySelector('input[name="email"]'), "aaron@example.com");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "save-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(gets.filter((url) => url.includes("surface=tenants"))).toHaveLength(0);
    const cached = getCacheEntry("rental:tenants:v2").data;
    expect(cached.tenants).toHaveLength(50);
    expect(cached.totalCount).toBe(50);
    expect(cached.tenants[0].display_name).toBe("Aaron Aardvark");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(50);
    expect(container.textContent).not.toContain("Load more tenants");
  });

  it("email update on a page-2 tenant reconciles the loaded page-2 row", async () => {
    // PR #863 fix round 2, residual 3: a tenant opened from page 2 is
    // updated in the record view; the still-mounted index must show the
    // confirmed value, not the stale page-2 row.
    const onNavigate = vi.fn();
    await mountPanel({ onNavigate });
    await openPageTwoRecord("t71", onNavigate);
    const form = container.querySelector('input[name="portalEmail"]').form;
    setNativeValue(container.querySelector('input[name="portalEmail"]'), "T71.Updated@Example.COM");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "update-tenant-email")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Portal email updated for Tenant 71.");
    await rerenderPanel({ recordContext: null, onNavigate });
    const row = indexRowFor("Tenant 71");
    expect(row).not.toBeUndefined();
    expect(row.textContent).toContain("t71.updated@example.com");
    expect(row.textContent).not.toContain("tenant71@example.com");
    expect(getCacheEntry("rental:tenants:v2:page:2").data.tenants.find((item) => item.id === "t71").email).toBe("t71.updated@example.com");
    expect(getCacheEntry("rental:tenant-detail:t71").data.tenant.email).toBe("t71.updated@example.com");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(75);
  });

  it("invite on a page-2 tenant reconciles the loaded page-2 row", async () => {
    const onNavigate = vi.fn();
    await mountPanel({ onNavigate });
    await openPageTwoRecord("t71", onNavigate);
    const inviteButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Send invite email");
    act(() => inviteButton.click());
    const dialog = container.querySelector('[role="alertdialog"]');
    act(() => dialog.querySelector('input[type="checkbox"]').click());
    setNativeValue(dialog.querySelector('input[name="inviteConfirmText"]'), "INVITE");
    const sendButton = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Send invite");
    await act(async () => sendButton.click());
    await flush();
    expect(posts.filter((body) => body.operation === "send-tenant-invite")).toHaveLength(1);
    expectNoMonolithFetch();
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Resend invite email")).toBe(true);
    await rerenderPanel({ recordContext: null, onNavigate });
    const row = indexRowFor("Tenant 71");
    expect(row.textContent).toContain("Invite sent");
    expect(row.textContent).not.toContain("Invite not sent");
    expect(getCacheEntry("rental:tenants:v2:page:2").data.tenants.find((item) => item.id === "t71").invited_at).toBe("2026-11-26T12:00:00.000Z");
  });

  it("photo upload on a page-2 tenant reconciles the loaded page-2 row", async () => {
    const onNavigate = vi.fn();
    await mountPanel({ onNavigate });
    await openPageTwoRecord("t71", onNavigate);
    const fileInput = container.querySelector('input[type="file"]');
    const file = new File(["fake-png"], "photo.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(posts.filter((body) => body.url === "/api/rental/photo")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(getCacheEntry("rental:tenant-detail:t71").data.tenant.photo_url).toBe("https://example.test/photos/t71.png");
    await rerenderPanel({ recordContext: null, onNavigate });
    const row = indexRowFor("Tenant 71");
    expect(row.querySelector('img[src="https://example.test/photos/t71.png"]')).not.toBeNull();
    expect(getCacheEntry("rental:tenants:v2:page:2").data.tenants.find((item) => item.id === "t71").photo_url).toBe("https://example.test/photos/t71.png");
  });

  it("a failed co-tenant search reports the failure instead of 'No tenant matches'", async () => {
    // PR #863 fix round 2: a failed lookup must not present as an
    // authoritative zero-match result.
    failCoTenantSearch = true;
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t01" } });
    const search = container.querySelector('input[name="coTenantSearch"]');
    setNativeValue(search, "Tenant 71");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await flush();
    expect(container.textContent).toContain("Tenant search failed");
    expect(container.textContent).not.toContain("No tenant matches");
    // A retry after the failure recovers and offers the match.
    failCoTenantSearch = false;
    setNativeValue(search, "Tenant 72");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    await flush();
    expect(container.textContent).not.toContain("Tenant search failed");
    const select = container.querySelector('select[name="coTenantId"]');
    expect([...select.options].map((option) => option.value)).toContain("t72");
  });
});
