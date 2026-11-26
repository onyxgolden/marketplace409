// @vitest-environment jsdom
// Slice 1 reconciliation: every tenant mutation updates exactly the affected
// cached row/detail in place -- never the monolithic /api/rental payload --
// and a save cannot double-submit. The fetch stub records every URL so each
// test proves the negative (no bare monolith GET after the mutation) as well
// as the positive (the row/detail shows the new value).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RentalTenantPanel, { applyTenantProfileToRow, compactTenantRow, sortTenantsByName } from "./RentalTenantPanel";
import { clearSWRCache, getCacheEntry, seedCacheEntry } from "@/hooks/swrCache";

const UNIT = { id: "u1", label: "4225 Barnhill" };
const LEASE = { id: "l1", unit_id: "u1", property_id: "p1", status: "active", start_date: "2026-01-01", end_date: "2026-12-31", monthly_rent_cents: 185000 };
const MEMBERSHIPS = [
  { lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" },
  { lease_id: "l1", tenant_id: "t2", occupancy_role: "co_tenant" },
];
const emptyHistory = { ledger: { entries: [], last3: [], unassigned: [], totals: { chargedCents: 0, paidCents: 0, refundedCents: 0 }, balanceCents: 0 }, deposits: { entries: [], heldCents: 0, requiredCents: 0 } };

function fullRow(id, displayName, email, extra = {}) {
  return { id, display_name: displayName, email, phone: "555-1000", work_phone: null,
    employer_name: null, employer_phone: null, monthly_income_cents: null,
    emergency_contact_name: null, emergency_contact_phone: null,
    application_status: null, application_submitted_at: null, screening_provider: null,
    screening_reference: null, screening_status: null, screening_completed_at: null,
    ssn_last_four: null, landlord_notes: null, status: "active", invited_at: null,
    auth_user_id: null, photo_bucket: null, photo_object_path: null, photo_url: null,
    payment_policy: null, ...extra };
}
function compactRow(id, displayName, email, extra = {}) {
  return { id, display_name: displayName, email, invited_at: null, auth_user_id: null,
    photo_bucket: null, photo_object_path: null, photo_url: null, ...extra };
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

describe("RentalTenantPanel Slice 1 reconciliation", () => {
  let container;
  let root;
  let gets;
  let posts;
  let liveList;
  let liveDetail;

  function seedAll() {
    clearSWRCache();
    liveList = {
      tenants: [compactRow("t1", "Alice Adams", "alice@example.com"), compactRow("t2", "Bob Baker", "bob@example.com"), compactRow("t3", "Carol Clark", "carol@example.com")],
      leases: [LEASE], leaseMemberships: MEMBERSHIPS.map((item) => ({ ...item })), units: [UNIT], openCharges: [],
      totalCount: 3, page: 1, pageSize: 50,
    };
    liveDetail = {
      tenant: fullRow("t1", "Alice Adams", "alice@example.com"),
      tenants: [fullRow("t1", "Alice Adams", "alice@example.com"), fullRow("t2", "Bob Baker", "bob@example.com")],
      leases: [LEASE], leaseMemberships: MEMBERSHIPS.map((item) => ({ ...item })), units: [UNIT], openCharges: [],
      lateFeeTenantOverride: null, paymentPolicy: "allow_any_amount",
    };
    // The cache holds deep copies: the stub mutates the live sources the way
    // the database would, and the panel patches the cache in place -- the two
    // must never share an object, or a stub mutation would look like a patch.
    seedCacheEntry("rental:tenants:v2", JSON.parse(JSON.stringify(liveList)));
    seedCacheEntry("rental:tenant-detail:t1", JSON.parse(JSON.stringify(liveDetail)));
  }

  // The stub simulates the server: POST handlers mutate the live sources the
  // way the database would, so a targeted surface refetch (add-co-tenant)
  // reads the new state -- exactly like production.
  function postResponse(body) {
    switch (body.operation) {
      case "save-tenant": {
        const saved = { id: "t4", displayName: body.tenant.displayName, display_name: body.tenant.displayName,
          email: body.tenant.email, phone: body.tenant.phone ?? null, status: "inactive",
          invitedAt: null, authUserId: null, activatedAt: null, createdAt: "2026-11-26T00:00:00.000Z", updatedAt: "2026-11-26T00:00:00.000Z" };
        liveList.tenants = sortTenantsByName([...liveList.tenants, compactTenantRow(saved)]);
        liveList.totalCount += 1;
        return { success: true, tenant: saved };
      }
      case "delete-unused-tenant": {
        const deleted = liveList.tenants.find((item) => item.id === body.tenantId);
        liveList.tenants = liveList.tenants.filter((item) => item.id !== body.tenantId);
        liveList.totalCount = Math.max(0, liveList.totalCount - 1);
        liveDetail.tenants = liveDetail.tenants.filter((item) => item.id !== body.tenantId);
        return { success: true, deletedTenant: { id: deleted.id, display_name: deleted.display_name, email: deleted.email } };
      }
      case "update-tenant-email": {
        const row = { id: body.tenantId, display_name: "Alice Adams", email: body.email.trim().toLowerCase(), status: "active" };
        return { success: true, tenant: row };
      }
      case "send-tenant-invite":
        return { success: true, tenantId: body.tenantId, invitedAt: "2026-11-26T12:00:00.000Z" };
      case "update-tenant-profile": {
        const name = typeof body.profile.displayName === "string" && body.profile.displayName.trim() !== ""
          ? body.profile.displayName.trim() : "Alice Adams";
        return { success: true, tenant: { id: body.tenantId, display_name: name } };
      }
      case "set-primary-tenant":
        liveList.leaseMemberships = liveList.leaseMemberships.map((item) => item.lease_id === body.leaseId
          ? { ...item, occupancy_role: item.tenant_id === body.tenantId ? "primary" : "co_tenant" } : item);
        liveDetail.leaseMemberships = liveDetail.leaseMemberships.map((item) => item.lease_id === body.leaseId
          ? { ...item, occupancy_role: item.tenant_id === body.tenantId ? "primary" : "co_tenant" } : item);
        return { success: true };
      case "add-co-tenant": {
        const membership = { lease_id: body.leaseId, tenant_id: body.tenantId, occupancy_role: "co_tenant" };
        liveList.leaseMemberships = [...liveList.leaseMemberships, membership];
        liveDetail.leaseMemberships = [...liveDetail.leaseMemberships, membership];
        const added = liveList.tenants.find((item) => item.id === body.tenantId);
        if (added) liveDetail.tenants = [...liveDetail.tenants, fullRow(added.id, added.display_name, added.email)];
        return { success: true, membership };
      }
      case "remove-co-tenant":
        liveList.leaseMemberships = liveList.leaseMemberships.filter((item) => !(item.lease_id === body.leaseId && item.tenant_id === body.tenantId));
        liveDetail.leaseMemberships = liveDetail.leaseMemberships.filter((item) => !(item.lease_id === body.leaseId && item.tenant_id === body.tenantId));
        return { success: true };
      case "save-late-fee-tenant-override": {
        const input = body.override;
        const empty = !input.exempt && input.graceDays == null && input.calculationType == null && input.maximumAmountCents == null;
        const override = empty ? null : { tenant_id: input.tenantId, exempt: input.exempt === true,
          grace_days: input.exempt ? null : (input.graceDays == null ? null : Number(input.graceDays)),
          calculation_type: input.exempt ? null : input.calculationType,
          fixed_amount_cents: input.exempt ? null : input.fixedAmountCents,
          percentage_basis_points: input.exempt ? null : input.percentageBasisPoints,
          maximum_amount_cents: input.exempt ? null : input.maximumAmountCents,
          updated_at: "2026-11-26T12:00:00.000Z" };
        liveDetail.lateFeeTenantOverride = override;
        return { success: true, override };
      }
      case "save-payment-policy-tenant-override": {
        const policy = body.override.policy === "inherit" ? null : body.override.policy;
        liveDetail.tenant = liveDetail.tenant ? { ...liveDetail.tenant, payment_policy: policy } : liveDetail.tenant;
        liveDetail.tenants = liveDetail.tenants.map((item) => item.id === body.override.tenantId ? { ...item, payment_policy: policy } : item);
        return { success: true, override: policy };
      }
      default:
        throw new Error(`unexpected POST ${body.operation}`);
    }
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
        return { ok: true, json: async () => ({ photoUrl: "https://example.test/photos/t1.png" }) };
      }
      if (options?.method === "POST") {
        const body = JSON.parse(options.body);
        posts.push(body);
        return { ok: true, json: async () => postResponse(body) };
      }
      gets.push(String(url));
      if (String(url).includes("surface=tenant-detail")) {
        const tenantId = decodeURIComponent(String(url).match(/tenantId=([^&]+)/)?.[1] || "");
        const tenant = liveDetail.tenants.find((item) => item.id === tenantId);
        if (tenant) return { ok: true, json: async () => ({ ...liveDetail, tenant }) };
        const listRow = liveList.tenants.find((item) => item.id === tenantId);
        if (!listRow) return { ok: true, json: async () => ({ tenant: null, notFound: true }) };
        return { ok: true, json: async () => ({ tenant: fullRow(listRow.id, listRow.display_name, listRow.email),
          tenants: [fullRow(listRow.id, listRow.display_name, listRow.email)], leases: [], leaseMemberships: [],
          units: [], openCharges: [], lateFeeTenantOverride: null, paymentPolicy: "allow_any_amount" }) };
      }
      if (String(url).includes("surface=tenants")) return { ok: true, json: async () => liveList };
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

  beforeEach(() => {
    seedAll();
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

  it("create inserts the new tenant sorted into the cached list without a monolith refetch", async () => {
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
    expect(cached.tenants.map((tenant) => tenant.display_name)).toEqual(["Aaron Aardvark", "Alice Adams", "Bob Baker", "Carol Clark"]);
    expect(cached.totalCount).toBe(4);
    expect(cached.tenants[0]).toEqual({ id: "t4", display_name: "Aaron Aardvark", email: "aaron@example.com", invited_at: null, auth_user_id: null, photo_bucket: null, photo_object_path: null, photo_url: null });
    expect(onNavigate).toHaveBeenCalledWith("tenants", expect.objectContaining({ recordType: "tenant", recordId: "t4", notice: "Tenant saved: Aaron Aardvark" }));
  });

  it("two rapid Save clicks post exactly once and show Saving… on the initiating button", async () => {
    await mountPanel();
    act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "+ Add a new tenant").click());
    setNativeValue(container.querySelector('input[name="displayName"]'), "Paula Welch");
    setNativeValue(container.querySelector('input[name="email"]'), "paula@example.com");
    const saveButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save tenant");
    act(() => saveButton.click());
    expect(saveButton.textContent).toBe("Saving…");
    expect(saveButton.disabled).toBe(true);
    act(() => saveButton.click());
    await flush();
    expect(posts.filter((body) => body.operation === "save-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
  });

  it("update-email patches the email in both caches without a monolith refetch", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const form = container.querySelector('input[name="portalEmail"]').form;
    setNativeValue(container.querySelector('input[name="portalEmail"]'), "alice.new@example.com");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "update-tenant-email")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Portal email updated for Alice Adams.");
    expect(getCacheEntry("rental:tenants:v2").data.tenants.find((item) => item.id === "t1").email).toBe("alice.new@example.com");
    expect(getCacheEntry("rental:tenant-detail:t1").data.tenant.email).toBe("alice.new@example.com");
  });

  it("update-email stores the server-normalized email, not the submitted casing (Q3)", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const form = container.querySelector('input[name="portalEmail"]').form;
    // The server trims and lowercases; the patch must take the canonical
    // value from the response, never the raw submitted input.
    setNativeValue(container.querySelector('input[name="portalEmail"]'), "  ALICE.New@Example.COM  ");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "update-tenant-email")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(getCacheEntry("rental:tenants:v2").data.tenants.find((item) => item.id === "t1").email).toBe("alice.new@example.com");
    expect(getCacheEntry("rental:tenant-detail:t1").data.tenant.email).toBe("alice.new@example.com");
  });

  it("update-profile applies the submitted profile to the detail row and re-sorts the list on rename", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const form = container.querySelector('input[name="tenantName"]').form;
    setNativeValue(container.querySelector('input[name="tenantName"]'), "Zoe Zimmerman");
    setNativeValue(container.querySelector('input[name="phone"]'), "555-2000");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "update-tenant-profile")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Tenant information updated for Zoe Zimmerman.");
    const detail = getCacheEntry("rental:tenant-detail:t1").data;
    expect(detail.tenant.display_name).toBe("Zoe Zimmerman");
    expect(detail.tenant.phone).toBe("555-2000");
    const list = getCacheEntry("rental:tenants:v2").data;
    expect(list.tenants.map((tenant) => tenant.display_name)).toEqual(["Bob Baker", "Carol Clark", "Zoe Zimmerman"]);
    // The compact list row takes only the rename -- never the full profile.
    expect(list.tenants.find((item) => item.id === "t1")).toEqual({ id: "t1", display_name: "Zoe Zimmerman", email: "alice@example.com", invited_at: null, auth_user_id: null, photo_bucket: null, photo_object_path: null, photo_url: null });
  });

  it("send-invite patches invited_at and status in both caches without a monolith refetch", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
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
    expect(getCacheEntry("rental:tenants:v2").data.tenants.find((item) => item.id === "t1").invited_at).toBe("2026-11-26T12:00:00.000Z");
    expect(getCacheEntry("rental:tenant-detail:t1").data.tenant.status).toBe("invited");
  });

  it("make-primary flips the roles in both caches without a monolith refetch", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const coTenantCard = container.querySelector('section[aria-label="Co-tenant"]');
    const makePrimary = [...coTenantCard.querySelectorAll("button")].find((button) => button.textContent === "Make primary tenant");
    await act(async () => makePrimary.click());
    await flush();
    expect(posts.filter((body) => body.operation === "set-primary-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    const detail = getCacheEntry("rental:tenant-detail:t1").data;
    expect(detail.leaseMemberships).toEqual([
      { lease_id: "l1", tenant_id: "t1", occupancy_role: "co_tenant" },
      { lease_id: "l1", tenant_id: "t2", occupancy_role: "primary" },
    ]);
    expect(container.querySelector('section[aria-label="Primary tenant"]').textContent).toContain("Bob Baker");
  });

  it("add-co-tenant appends the membership and refetches only the narrow detail surface", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const select = container.querySelector('select[name="coTenantId"]');
    select.value = "t3";
    const form = select.form;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "add-co-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(gets.filter((url) => url.includes("surface=tenant-detail"))).not.toHaveLength(0);
    expect(container.textContent).toContain("Co-tenant added: Carol Clark.");
    expect(container.querySelectorAll('section[aria-label="Co-tenant"]').length).toBe(2);
  });

  it("remove-co-tenant filters the membership from both caches without a monolith refetch", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const coTenantCard = container.querySelector('section[aria-label="Co-tenant"]');
    const removeButton = [...coTenantCard.querySelectorAll("button")].find((button) => button.textContent === "Remove co-tenant");
    await act(async () => removeButton.click());
    await flush();
    expect(posts.filter((body) => body.operation === "remove-co-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Co-tenant removed: Bob Baker.");
    expect(getCacheEntry("rental:tenant-detail:t1").data.leaseMemberships).toEqual([
      { lease_id: "l1", tenant_id: "t1", occupancy_role: "primary" },
    ]);
    expect(container.querySelector('section[aria-label="Co-tenant"]')).toBeNull();
  });

  it("save-late-fee-override patches the detail override without a monolith refetch", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const input = container.querySelector('input[name="overrideGraceDays"]');
    const form = input.form;
    setNativeValue(input, "5");
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "save-late-fee-tenant-override")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Override active");
    expect(getCacheEntry("rental:tenant-detail:t1").data.lateFeeTenantOverride).toEqual({
      tenant_id: "t1", exempt: false, grace_days: 5, calculation_type: null,
      fixed_amount_cents: null, percentage_basis_points: null, maximum_amount_cents: null,
      updated_at: "2026-11-26T12:00:00.000Z",
    });
  });

  it("clearing the late-fee override patches the detail override to null", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const input = container.querySelector('input[name="overrideGraceDays"]');
    setNativeValue(input, "5");
    await act(async () => { input.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    const clearButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Clear override");
    await act(async () => clearButton.click());
    await flush();
    expect(posts.filter((body) => body.operation === "save-late-fee-tenant-override")).toHaveLength(2);
    expectNoMonolithFetch();
    expect(getCacheEntry("rental:tenant-detail:t1").data.lateFeeTenantOverride).toBeNull();
    expect(container.textContent).toContain("No override");
  });

  it("save-payment-policy-override patches the tenant policy in the detail cache", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const select = container.querySelector('select[name="overridePaymentPolicy"]');
    select.value = "require_rent";
    await act(async () => { select.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
    expect(posts.filter((body) => body.operation === "save-payment-policy-tenant-override")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(container.textContent).toContain("Payment policy override saved.");
    expect(container.textContent).toContain("Override active");
    expect(getCacheEntry("rental:tenant-detail:t1").data.tenant.payment_policy).toBe("require_rent");
  });

  it("delete removes the row from the list cache and invalidates the detail without a monolith refetch", async () => {
    // t3 is unassigned, so the delete box shows on her record.
    seedCacheEntry("rental:tenant-detail:t3", {
      tenant: fullRow("t3", "Carol Clark", "carol@example.com"),
      tenants: [fullRow("t3", "Carol Clark", "carol@example.com")],
      leases: [], leaseMemberships: [], units: [], openCharges: [],
      lateFeeTenantOverride: null, paymentPolicy: "allow_any_amount",
    });
    const onNavigate = vi.fn();
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t3" }, onNavigate });
    const deleteButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Delete unused duplicate");
    act(() => deleteButton.click());
    const dialog = container.querySelector('[role="alertdialog"]');
    setNativeValue(dialog.querySelector('input[name="deleteConfirmText"]'), "DELETE");
    const confirmButton = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Delete permanently");
    await act(async () => confirmButton.click());
    await flush();
    expect(posts.filter((body) => body.operation === "delete-unused-tenant")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(getCacheEntry("rental:tenants:v2").data.tenants.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(container.textContent).toContain("Deleted unused duplicate: Carol Clark.");
    expect(onNavigate).toHaveBeenCalledWith("tenants");
  });

  it("photo upload patches photo_url in both caches without a monolith refetch", async () => {
    await mountPanel({ recordContext: { recordType: "tenant", recordId: "t1" } });
    const fileInput = container.querySelector('input[type="file"]');
    const file = new File(["fake-png"], "photo.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [file] });
    await act(async () => { fileInput.dispatchEvent(new Event("change", { bubbles: true })); });
    await flush();
    expect(posts.filter((body) => body.url === "/api/rental/photo")).toHaveLength(1);
    expectNoMonolithFetch();
    expect(getCacheEntry("rental:tenant-detail:t1").data.tenant.photo_url).toBe("https://example.test/photos/t1.png");
    expect(getCacheEntry("rental:tenants:v2").data.tenants.find((item) => item.id === "t1").photo_url).toBe("https://example.test/photos/t1.png");
    expect(container.querySelector('img[src="https://example.test/photos/t1.png"]')).not.toBeNull();
  });
});

describe("tenant row helpers (pure)", () => {
  it("compactTenantRow maps a camelCase domain tenant to the 7-column list row", () => {
    expect(compactTenantRow({ id: "t9", displayName: "Nina Nash", email: "nina@example.com", phone: "555-1", invitedAt: "2026-01-01T00:00:00.000Z", authUserId: "au-1", photoBucket: "b", photoObjectPath: "o", photoUrl: "u" })).toEqual({
      id: "t9", display_name: "Nina Nash", email: "nina@example.com", invited_at: "2026-01-01T00:00:00.000Z",
      auth_user_id: "au-1", photo_bucket: "b", photo_object_path: "o", photo_url: "u",
    });
    expect(compactTenantRow({ id: "t9", displayName: "Nina Nash", email: "nina@example.com" })).toEqual({
      id: "t9", display_name: "Nina Nash", email: "nina@example.com", invited_at: null,
      auth_user_id: null, photo_bucket: null, photo_object_path: null, photo_url: null,
    });
  });

  it("sortTenantsByName orders by display_name and leaves the input untouched", () => {
    const input = [{ id: "b", display_name: "Zed" }, { id: "a", display_name: "Amy" }];
    expect(sortTenantsByName(input).map((item) => item.id)).toEqual(["a", "b"]);
    expect(input.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("applyTenantProfileToRow trims strings, nulls blanks, and renames only on a non-empty name", () => {
    const row = fullRow("t1", "Alice Adams", "alice@example.com");
    const updated = applyTenantProfileToRow(row, {
      displayName: "  Alice A.  ", phone: " ", workPhone: "555-2", employerName: "Acme",
      employerPhone: "", monthlyIncomeCents: "250000", emergencyContactName: "", emergencyContactPhone: "",
      applicationStatus: "", applicationSubmittedAt: "", screeningProvider: "", screeningReference: "",
      screeningStatus: "", screeningCompletedAt: "", ssnLastFour: "", landlordNotes: "  ok  ",
    });
    expect(updated.display_name).toBe("Alice A.");
    expect(updated.phone).toBeNull();
    expect(updated.work_phone).toBe("555-2");
    expect(updated.employer_name).toBe("Acme");
    expect(updated.employer_phone).toBeNull();
    expect(updated.monthly_income_cents).toBe(250000);
    expect(updated.landlord_notes).toBe("ok");
    const noRename = applyTenantProfileToRow(row, { displayName: "   " });
    expect(noRename.display_name).toBe("Alice Adams");
    const nonNumericIncome = applyTenantProfileToRow(row, { monthlyIncomeCents: "abc" });
    expect(nonNumericIncome.monthly_income_cents).toBeNull();
  });
});

describe("Slice 1 guard: demand-loaded shell (brief section 4 condition 5)", () => {
  it("the shell loads heavy panels through next/dynamic, not static imports", async () => {
    const { readFileSync } = await import("node:fs");
    const shell = readFileSync("src/components/forge/rental/RentalApplicationShell.jsx", "utf8");
    expect(shell).toContain('next/dynamic');
    for (const panel of ["RentalLeasePanel", "RentalPaymentPanel", "RentalMaintenancePanel", "RentalPropertyPanel", "RentalSetupPanel", "RentalSetupWizardPanel", "RentalReportPanel", "RentalFinancialSetupPanel", "RentalDocumentPanel"]) {
      expect(shell).not.toMatch(new RegExp(`^import ${panel} from`, "m"));
    }
    expect(shell).toMatch(/^import RentalOverviewPanel from/m);
    expect(shell).toMatch(/^import RentalTenantPanel from/m);
  });
});
