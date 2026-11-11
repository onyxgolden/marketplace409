// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));

import WorkPackageDetailClient from "./WorkPackageDetailClient";

const BASE_PKG = {
  id: "forge_wp_1",
  code: "WP-0001",
  title: "Turnover",
  status: "draft",
  description: null,
  package_type: "other",
  priority: "normal",
  project_id: null,
  property_id: null,
  planned_start: null,
  planned_finish: null,
  actual_start: null,
  actual_finish: null,
  percent_complete: 0,
  progress_basis: "pct_estimate",
  planned_qty: null,
  planned_unit: null,
  planned_manhours: null,
  earned_qty: null,
  earned_manhours: null,
  actual_manhours: null,
  responsible_party: null,
  scope_baseline_id: null,
  designated_verifier: null,
  blocked_reason: null,
  version: 1,
};

const OPTIONS = [{ slug: "1900-w-decker", label: "1900 W. Decker" }];

function stubFetch({ properties = OPTIONS, failOptions = false, failPatch = false, patchImpl = null, deleteImpl = null, getEligibility = undefined, freezeImpl = null } = {}) {
  const patches = [];
  const deletes = [];
  const freezeRequests = [];
  // D1: a real backend's GET reflects whatever the scope POST actually
  // committed. A GET stub that always returns [] regardless of prior
  // writes would make the awaited-refresh fix look broken for a reason
  // that's an artifact of the stub, not the component.
  const committedBaselines = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (url === `/api/work-packages/${BASE_PKG.id}/scope` && options.method === "POST") {
      const body = JSON.parse(options.body);
      freezeRequests.push(body);
      if (freezeImpl) return freezeImpl(body);
      const baseline = { id: "forge_wsb_1", version: committedBaselines.length + 1, package_id: BASE_PKG.id, membership: body.membership, membership_hash: "fnv1a:test" };
      committedBaselines.push(baseline);
      return { ok: true, json: async () => ({ success: true, baseline }) };
    }
    if (url === "/api/work-packages/property-options") {
      if (failOptions) return { ok: false, json: async () => ({ error: "Unable to complete the request." }) };
      return { ok: true, json: async () => ({ properties }) };
    }
    if (url === `/api/work-packages/${BASE_PKG.id}` && options.method === "PATCH") {
      patches.push(JSON.parse(options.body));
      if (patchImpl) return patchImpl();
      if (failPatch) return { ok: false, json: async () => ({ error: "Package changed while editing; refresh and retry." }) };
      return { ok: true, json: async () => ({ package: { ...BASE_PKG, ...patches[patches.length - 1], property_id: patches[patches.length - 1].property_id ?? null } }) };
    }
    if (url === `/api/work-packages/${BASE_PKG.id}` && options.method === "DELETE") {
      deletes.push(JSON.parse(options.body));
      if (deleteImpl) return deleteImpl();
      return { ok: true, json: async () => ({ success: true, deletion: { package_id: BASE_PKG.id, code: BASE_PKG.code } }) };
    }
    if (url === `/api/work-packages/${BASE_PKG.id}` && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => ({ package: BASE_PKG, transitions: [], attestations: [], baselines: committedBaselines, scopeChanges: [], observations: [], ...(getEligibility !== undefined ? { deletionEligibility: getEligibility } : {}) }) };
    }
    if (typeof url === "string" && url.startsWith("/api/work-links")) {
      return { ok: true, json: async () => ({ links: [], documents: [] }) };
    }
    if (typeof url === "string" && url.startsWith("/api/work-documents")) {
      return { ok: true, json: async () => ({ documents: [] }) };
    }
    if (typeof url === "string" && url.startsWith("/api/forge/designer")) {
      return { ok: true, json: async () => ({ projects: [] }) };
    }
    if (url === `/api/work-packages/${BASE_PKG.id}/drawings/readiness`) {
      return {
        ok: true,
        json: async () => ({
          packageId: BASE_PKG.id, packageStatus: BASE_PKG.status, drawings: [],
          counts: { drawingsTotal: 0, ifcReleased: 0, pendingReview: 0, returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0 },
        }),
      };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return { patches, deletes, freezeRequests };
}

// D9: the unsaved-changes guard attaches a document-level click listener
// in a useEffect cleanup — unlike this file's other effects, that outlives
// a bare `document.body.innerHTML = ""` (clears nodes, not React's own
// commit/cleanup lifecycle) and keeps firing in later tests unless the
// root is actually unmounted first.
const activeRoots = [];

function renderDetail(pkg = BASE_PKG, { deletionEligibility, initialTab, workspaceParam, transitions = [] } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoots.push(root);
  act(() => {
    root.render(
      <WorkPackageDetailClient
        initialTab={initialTab}
        workspaceParam={workspaceParam}
        initial={{
          package: pkg,
          transitions,
          attestations: [],
          baselines: [],
          currentBaseline: null,
          scopeChanges: [],
          observations: [],
          ...(deletionEligibility !== undefined ? { deletionEligibility } : {}),
        }}
        initialLinks={[]}
      />,
    );
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function propertyField(container) {
  const terms = [...container.querySelectorAll("dt")];
  const term = terms.find((dt) => dt.textContent === "Property");
  return term?.nextElementSibling || null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  while (activeRoots.length > 0) {
    act(() => { activeRoots.pop().unmount(); });
  }
  document.body.innerHTML = "";
  // D10's fix writes real window.location via the native History API —
  // reset it so one test's tab/workspace query string never leaks into
  // the next (jsdom's window/location persist across tests in a file).
  window.history.replaceState(null, "", "/");
});

describe("WorkPackageDetailClient property display (Slice 2)", () => {
  it("shows 'No property assigned' when unassigned", () => {
    stubFetch();
    const { container } = renderDetail();
    expect(propertyField(container).textContent).toBe("No property assigned");
  });

  it("shows the linked property label with a link back to the property page", async () => {
    stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, property_id: "1900-w-decker" });
    await settle();
    const field = propertyField(container);
    expect(field.textContent).toBe("1900 W. Decker");
    const link = field.querySelector("a");
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("recordId=1900-w-decker");
    expect(link.getAttribute("href")).toContain("propertyId=1900-w-decker");
  });

  it("keeps the edit picker faithful to the current assignment", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, property_id: "1900-w-decker" });
    await settle();
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });
    const select = container.querySelector("#edit_property_id");
    expect(select.value).toBe("1900-w-decker");
    // Clearing the picker and saving PATCHes property_id: null.
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "");
    act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();
    expect(patches).toHaveLength(1);
    expect(patches[0].property_id).toBeNull();
  });
});

describe("WorkPackageDetailClient Project field (D3)", () => {
  function projectField(container) {
    const terms = [...container.querySelectorAll("dt")];
    const term = terms.find((dt) => dt.textContent === "Project");
    return term?.nextElementSibling || null;
  }

  function openEdit(container) {
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });
  }

  function setProjectInput(container, value) {
    const input = container.querySelector("#edit_project_id");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  }

  async function saveEdit(container) {
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();
  }

  it("displays the saved Project in the read-only fields", () => {
    stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, project_id: "Kent Ave turnover 2026" });
    expect(projectField(container).textContent).toBe("Kent Ave turnover 2026");
  });

  it("shows an em dash when no Project is set", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    expect(projectField(container).textContent).toBe("—");
  });

  it("initializes the edit input from the saved Project and PATCHes updates", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, project_id: "Old project" });
    await settle();
    openEdit(container);
    const input = container.querySelector("#edit_project_id");
    expect(input).not.toBeNull();
    expect(input.value).toBe("Old project");
    const labelEl = container.querySelector('label[for="edit_project_id"]');
    expect(labelEl.textContent).toMatch(/Project \(optional\)/);
    setProjectInput(container, "New project");
    await saveEdit(container);
    expect(patches).toHaveLength(1);
    expect(patches[0].project_id).toBe("New project");
  });

  it("clears Project to null when the edit input is blanked", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, project_id: "Old project" });
    await settle();
    openEdit(container);
    setProjectInput(container, "   ");
    await saveEdit(container);
    expect(patches).toHaveLength(1);
    expect(patches[0].project_id).toBeNull();
  });

  it("cancel discards unsaved Project text; reopening shows the saved value", async () => {
    stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, project_id: "Saved project" });
    await settle();
    openEdit(container);
    setProjectInput(container, "Unsaved draft");
    const cancelButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    act(() => { cancelButton.click(); });
    expect(projectField(container).textContent).toBe("Saved project");
    openEdit(container);
    expect(container.querySelector("#edit_project_id").value).toBe("Saved project");
  });

  it("keeps Project independent of the property picker on save", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, project_id: "Decker refresh", property_id: "1900-w-decker" });
    await settle();
    openEdit(container);
    await saveEdit(container);
    expect(patches).toHaveLength(1);
    expect(patches[0].project_id).toBe("Decker refresh");
    expect(patches[0].property_id).toBe("1900-w-decker");
  });
});

describe("WorkPackageDetailClient edit dates + stale errors (D6)", () => {
  function openEdit(container) {
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });
  }

  it("serializes the empty planned finish of a dateless package as null, never ''", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail(BASE_PKG); // planned_finish: null
    await settle();
    openEdit(container);
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();
    expect(patches).toHaveLength(1);
    expect(patches[0].planned_finish).toBeNull();
  });

  it("preserves an actual planned finish date verbatim on save", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, planned_start: "2026-11-01", planned_finish: "2026-11-10" });
    await settle();
    openEdit(container);
    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput.value).toBe("2026-11-10");
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();
    expect(patches).toHaveLength(1);
    expect(patches[0].planned_finish).toBe("2026-11-10");
  });

  it("a failed save keeps its error until Cancel, which also discards unsaved changes", async () => {
    stubFetch({ failPatch: true });
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    const titleInput = container.querySelector("form input:not([type='date'])");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
      .set.call(titleInput, "Changed title");
    act(() => { titleInput.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(titleInput.value).toBe("Changed title");
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();
    // The fresh server error is visible and the form stays open.
    expect(container.textContent).toContain("Package changed while editing; refresh and retry.");
    expect(container.querySelector("form")).not.toBeNull();
    const cancelButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    act(() => { cancelButton.click(); });
    expect(container.textContent).not.toContain("Package changed while editing; refresh and retry.");
    // Reopening starts from the persisted package — the failed edit is gone.
    openEdit(container);
    const reopenedTitle = container.querySelector("form input:not([type='date'])");
    expect(reopenedTitle.value).toBe("Turnover");
  });

  it("disables Save and Cancel while a save is in flight", async () => {
    let releasePatch;
    const gate = new Promise((resolve) => { releasePatch = resolve; });
    stubFetch({ patchImpl: () => gate.then(() => ({ ok: true, json: async () => ({ package: BASE_PKG }) })) });
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    const cancelButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    act(() => { saveButton.click(); });
    expect(saveButton.disabled).toBe(true);
    expect(cancelButton.disabled).toBe(true);
    await act(async () => { releasePatch(); });
    await settle();
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Edit")).toBeTruthy();
  });
});

describe("WorkPackageDetailClient delete danger zone (D7)", () => {
  const ELIGIBLE = {
    isOwner: true, canDelete: true, status: "draft", packageVersion: 1, blockers: [],
  };
  const BLOCKED = {
    isOwner: true, canDelete: false, status: "draft", packageVersion: 1,
    blockers: [
      { type: "budget_revisions", count: 1, label: "Budget history", action: "Budget revisions are a permanent audit record and can't be removed." },
      { type: "links", count: 2, label: "Linked records", action: "Unlink them in the Links section below, then try again." },
    ],
  };

  function renderDangerZone(pkg, opts = {}) {
    return renderDetail(pkg, { ...opts, initialTab: "activity" });
  }

  function dangerZone(container) {
    return container.querySelector('section[aria-label="Danger zone"]');
  }
  function deleteTrigger(container) {
    return dangerZone(container)?.querySelector("button");
  }
  function dialogEl(container) {
    return container.querySelector('[role="dialog"]');
  }
  function codeInput(container) {
    return container.querySelector("#delete_confirm_code");
  }
  function typeCode(container, value) {
    const input = codeInput(container);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  function dialogButton(container, text) {
    return [...dialogEl(container).querySelectorAll("button")].find((b) => b.textContent === text);
  }

  it("renders no delete affordance without server eligibility", () => {
    stubFetch();
    const { container } = renderDangerZone(BASE_PKG);
    expect(dangerZone(container)).toBeNull();
    expect(container.textContent).not.toContain("Danger zone");
  });

  it("renders no delete affordance for non-owners", () => {
    stubFetch();
    const { container } = renderDangerZone(BASE_PKG, {
      deletionEligibility: { ...ELIGIBLE, isOwner: false },
    });
    expect(dangerZone(container)).toBeNull();
  });

  it("shows exact blocker categories, counts, and next steps when blocked", () => {
    stubFetch();
    const { container } = renderDangerZone(BASE_PKG, { deletionEligibility: BLOCKED });
    const zone = dangerZone(container);
    expect(zone).not.toBeNull();
    expect(zone.textContent).toContain("Budget history (1)");
    expect(zone.textContent).toContain("can't be removed");
    expect(zone.textContent).toContain("Linked records (2)");
    expect(zone.textContent).toContain("Unlink them in the Links section");
    // No delete button is offered, and no archive feature is invented.
    expect(deleteTrigger(container)).toBeNull();
    expect(zone.textContent.toLowerCase()).not.toContain("archive");
  });

  it("tells owners of non-draft packages to cancel instead of deleting", () => {
    stubFetch();
    const { container } = renderDangerZone({ ...BASE_PKG, status: "in_progress" }, {
      deletionEligibility: {
        isOwner: true, canDelete: false, status: "in_progress", packageVersion: 2, blockers: [],
      },
    });
    const zone = dangerZone(container);
    expect(zone.textContent).toContain("Only draft packages can be deleted");
    expect(zone.textContent).toContain("in progress");
    expect(zone.textContent).toContain("cancel it instead");
    expect(deleteTrigger(container)).toBeNull();
  });

  it("requires typing the exact code before Delete enables; Cancel closes", async () => {
    stubFetch();
    const { container } = renderDangerZone(BASE_PKG, { deletionEligibility: ELIGIBLE });
    act(() => { deleteTrigger(container).click(); });
    const dialog = dialogEl(container);
    expect(dialog).not.toBeNull();
    expect(dialog.textContent).toContain("WP-0001");
    expect(dialog.textContent).toContain("Turnover");
    expect(dialog.textContent).toContain("audit record");
    expect(dialog.textContent).toContain("can't be undone");
    // Cancel is the focused default.
    expect(document.activeElement).toBe(dialogButton(container, "Cancel"));
    // Wrong / partial codes never enable Delete.
    expect(dialogButton(container, "Delete").disabled).toBe(true);
    typeCode(container, "WP-000");
    expect(dialogButton(container, "Delete").disabled).toBe(true);
    typeCode(container, "wp-0001");
    expect(dialogButton(container, "Delete").disabled).toBe(true);
    typeCode(container, "WP-0001");
    expect(dialogButton(container, "Delete").disabled).toBe(false);
    act(() => { dialogButton(container, "Cancel").click(); });
    expect(dialogEl(container)).toBeNull();
  });

  it("Escape closes the dialog and focus returns to the Delete button", () => {
    stubFetch();
    const { container } = renderDangerZone(BASE_PKG, { deletionEligibility: ELIGIBLE });
    act(() => { deleteTrigger(container).click(); });
    expect(dialogEl(container)).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialogEl(container)).toBeNull();
    expect(document.activeElement).toBe(deleteTrigger(container));
    // Reopening starts with an empty confirmation.
    act(() => { deleteTrigger(container).click(); });
    expect(codeInput(container).value).toBe("");
    expect(dialogButton(container, "Delete").disabled).toBe(true);
  });

  it("deletes once (busy state blocks double-clicks) and redirects after server confirmation", async () => {
    let releaseDelete;
    const gate = new Promise((resolve) => { releaseDelete = resolve; });
    const { deletes } = stubFetch({
      deleteImpl: () => gate.then(() => ({
        ok: true,
        json: async () => ({ success: true, deletion: { package_id: BASE_PKG.id, code: BASE_PKG.code } }),
      })),
    });
    const { container } = renderDangerZone(BASE_PKG, { deletionEligibility: ELIGIBLE });
    act(() => { deleteTrigger(container).click(); });
    typeCode(container, "WP-0001");
    const deleteButton = dialogButton(container, "Delete");
    act(() => { deleteButton.click(); });
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.textContent).toBe("Deleting…");
    expect(dialogButton(container, "Cancel").disabled).toBe(true);
    // A second click and Escape are both inert while the delete is in flight.
    act(() => { deleteButton.click(); });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(dialogEl(container)).not.toBeNull();
    await act(async () => { releaseDelete(); });
    await settle();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toEqual({ confirmCode: "WP-0001", expectedVersion: 1 });
    expect(routerMocks.push).toHaveBeenCalledWith("/forge/work");
  });

  it("keeps the dialog open on a 500 and never claims success", async () => {
    stubFetch({
      deleteImpl: async () => ({
        ok: false, status: 500,
        json: async () => ({ error: "Unable to complete the request." }),
      }),
    });
    const { container } = renderDangerZone(BASE_PKG, { deletionEligibility: ELIGIBLE });
    act(() => { deleteTrigger(container).click(); });
    typeCode(container, "WP-0001");
    await act(async () => { dialogButton(container, "Delete").click(); });
    await settle();
    expect(dialogEl(container)).not.toBeNull();
    expect(dialogEl(container).textContent).toContain("Unable to complete the request.");
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when the network fails", async () => {
    stubFetch({ deleteImpl: async () => { throw new Error("offline"); } });
    const { container } = renderDangerZone(BASE_PKG, { deletionEligibility: ELIGIBLE });
    act(() => { deleteTrigger(container).click(); });
    typeCode(container, "WP-0001");
    await act(async () => { dialogButton(container, "Delete").click(); });
    await settle();
    expect(dialogEl(container)).not.toBeNull();
    expect(dialogEl(container).textContent).toContain("package was not deleted");
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it("on 409 closes the dialog, refreshes eligibility, and keeps the package visible", async () => {
    stubFetch({
      deleteImpl: async () => ({
        ok: false, status: 409,
        json: async () => ({
          error: "This package has records that must be kept, so it can't be deleted.",
          blockers: BLOCKED.blockers,
        }),
      }),
      getEligibility: BLOCKED,
    });
    const { container } = renderDangerZone(BASE_PKG, { deletionEligibility: ELIGIBLE });
    act(() => { deleteTrigger(container).click(); });
    typeCode(container, "WP-0001");
    await act(async () => { dialogButton(container, "Delete").click(); });
    await settle();
    expect(dialogEl(container)).toBeNull();
    expect(routerMocks.push).not.toHaveBeenCalled();
    // The refreshed danger zone explains the fresh blockers, error visible,
    // and the detail client itself is still mounted on the Activity tab.
    const zone = dangerZone(container);
    expect(zone.textContent).toContain("Budget history (1)");
    expect(container.querySelector('[role="alert"]').textContent)
      .toContain("This package has records that must be kept");
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });
});

describe("WorkPackageDetailClient tabs (UI-density redesign)", () => {
  function tabButton(container, label) {
    return [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === label);
  }
  function headings(container) {
    return [...container.querySelectorAll("h2")].map((h) => h.textContent);
  }

  it("renders all eight tabs with Overview selected by default", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((b) => b.textContent);
    expect(tabs).toEqual([
      "Overview", "Work steps", "Milestones", "Permits",
      "IFA→IFC redlines", "Budget & Change Orders", "Documents", "Activity / Audit",
    ]);
    expect(tabButton(container, "Overview").getAttribute("aria-selected")).toBe("true");
    expect(headings(container)).toContain("Package");
  });

  it("switching to Milestones shows the placeholder and hides the Overview panels", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    act(() => { tabButton(container, "Milestones").click(); });
    expect(tabButton(container, "Milestones").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Milestone tracking arrives with slice 9");
    expect(headings(container)).not.toContain("Package");
    expect(headings(container)).not.toContain("Lifecycle");
    // Deep-linkable: the switch updates the URL without a refetch. D10: a
    // plain router.replace() observably lagged the address bar by one
    // click, so the switch now writes via the native History API, which
    // jsdom reflects onto window.location synchronously with the click.
    expect(window.location.search).toBe("?tab=milestones");
  });

  it("switching back to Overview restores the package panels", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    act(() => { tabButton(container, "Milestones").click(); });
    act(() => { tabButton(container, "Overview").click(); });
    expect(headings(container)).toContain("Package");
    expect(window.location.search).toBe("");
  });

  it("honors an initial tab from the server-resolved ?tab= deep link", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { initialTab: "milestones" });
    expect(tabButton(container, "Milestones").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Milestone tracking arrives with slice 9");
    expect(headings(container)).not.toContain("Package");
  });

  it("falls back to Overview for an unknown initial tab", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { initialTab: "bogus" });
    expect(tabButton(container, "Overview").getAttribute("aria-selected")).toBe("true");
    expect(headings(container)).toContain("Package");
  });

  it("resyncs the active tab when a soft navigation updates initialTab without remounting (redlines link-controls bug)", () => {
    // Production symptom: a client-side navigation to this same route (a
    // different package, or any Link carrying a new ?tab=) re-runs the
    // server page and hands this already-mounted component a new
    // `initialTab` prop, but React does not remount it — only the
    // `useState` initializer ran, once, on first mount. Without the
    // resync effect, `activeTab` stays on whatever tab was active before,
    // so a navigation that asked for "redlines" kept rendering the
    // previous tab's content (e.g. Documents' "Link existing" controls)
    // under a URL that now read ?tab=redlines. A single renderDetail()
    // call can never catch this — it always mounts fresh, matching props
    // to initial state by construction. This test re-renders the SAME
    // root with a new initialTab, exactly the no-remount scenario.
    stubFetch();
    const { container, root } = renderDetail(BASE_PKG, { initialTab: "documents" });
    expect(tabButton(container, "Documents").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Link existing");

    act(() => {
      root.render(
        <WorkPackageDetailClient
          initialTab="redlines"
          initial={{
            package: BASE_PKG, transitions: [], attestations: [], baselines: [],
            currentBaseline: null, scopeChanges: [], observations: [],
          }}
          initialLinks={[]}
        />,
      );
    });

    expect(tabButton(container, "IFA→IFC redlines").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).not.toContain("Link existing");
    expect(headings(container)).toContain("Drawing readiness");
  });

  it("shows the danger zone only on the Activity / Audit tab", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, {
      deletionEligibility: { isOwner: true, canDelete: true, status: "draft", packageVersion: 1, blockers: [] },
    });
    expect(container.querySelector('section[aria-label="Danger zone"]')).toBeNull();
    act(() => { tabButton(container, "Activity / Audit").click(); });
    expect(container.querySelector('section[aria-label="Danger zone"]')).not.toBeNull();
    expect(window.location.search).toBe("?tab=activity");
  });

  it("preserves the workspace selection in the tab URL when one is active", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { workspaceParam: "owner_2" });
    act(() => { tabButton(container, "Milestones").click(); });
    expect(window.location.search).toBe("?tab=milestones&workspace=owner_2");
    act(() => { tabButton(container, "Overview").click(); });
    expect(window.location.search).toBe("?workspace=owner_2");
  });

  it("D10: the URL updates synchronously with each tab click — never one click behind", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    act(() => { tabButton(container, "Milestones").click(); });
    expect(window.location.search).toBe("?tab=milestones");
    act(() => { tabButton(container, "Permits").click(); });
    // Previously this read "?tab=milestones" here (one click behind) until
    // the next click. It must reflect the just-clicked tab immediately.
    expect(window.location.search).toBe("?tab=permits");
  });
});

describe("WorkPackageDetailClient unsaved-changes guard (D9)", () => {
  function openEdit(container) {
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });
  }

  function typeScope(container, value) {
    const textarea = container.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    act(() => {
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function addOutsideLink(href, label) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    document.body.appendChild(link);
    return link;
  }

  it("prompts before leaving via another link (e.g. the sidebar) once an open edit has unsaved changes, and blocks on cancel", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    typeScope(container, "Changed scope, not yet saved");
    const navLink = addOutsideLink("/forge/work/documents", "Document library");
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    let event;
    act(() => {
      event = new MouseEvent("click", { bubbles: true, cancelable: true });
      navLink.dispatchEvent(event);
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets the navigation through once the user confirms leaving an unsaved edit", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    typeScope(container, "Changed scope, not yet saved");
    const navLink = addOutsideLink("/forge/work/documents", "Document library");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let event;
    act(() => {
      event = new MouseEvent("click", { bubbles: true, cancelable: true });
      navLink.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it("never prompts for the edit form's own Cancel button", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    typeScope(container, "Changed scope, not yet saved");
    const cancelButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    const confirmSpy = vi.spyOn(window, "confirm");
    act(() => { cancelButton.click(); });
    expect(confirmSpy).not.toHaveBeenCalled();
    // Cancel still discards, per the existing contract: the edit form
    // closes and the Edit button reappears.
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Edit")).toBe(true);
  });

  it("never prompts when Edit is open but nothing has actually changed yet", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    const navLink = addOutsideLink("/forge/work/documents", "Document library");
    const confirmSpy = vi.spyOn(window, "confirm");
    act(() => {
      navLink.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

// D20: the Activity / Audit tab showed only the Danger zone, with no
// activity or audit history at all. The status-transition history (real,
// already tracked -- it used to render under Overview -> Lifecycle) now
// shows there instead.
describe("WorkPackageDetailClient Activity / Audit status history (D20)", () => {
  function tabButton(container, label) {
    return [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === label);
  }

  it("shows the status-transition history on the Activity tab, not Overview", () => {
    stubFetch();
    const transitions = [{ id: "t1", at: "2026-11-01T00:00:00Z", from_status: "draft", to_status: "planned", reason: "scheduled" }];
    const { container } = renderDetail(BASE_PKG, { transitions });
    // Not shown on Overview (the default tab) any more.
    expect(container.textContent).not.toContain("draft → planned");
    act(() => { tabButton(container, "Activity / Audit").click(); });
    expect(container.textContent).toContain("Status history");
    expect(container.textContent).toContain("draft → planned");
    expect(container.textContent).toContain("scheduled");
  });

  it("shows a plain-words empty state when there is no transition history yet", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { transitions: [] });
    act(() => { tabButton(container, "Activity / Audit").click(); });
    expect(container.textContent).toContain("No status changes recorded yet.");
  });
});

// D14: a client-side "invalid JSON" message from Freeze baseline used to
// set the page-wide `error` state, so it kept showing on every other tab
// (no dismiss control) until a full reload. It is now scoped to the
// baseline section itself, with its own dismiss control.
describe("WorkPackageDetailClient Freeze baseline error scoping (D14)", () => {
  function tabButton(container, label) {
    return [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === label);
  }
  function setTextarea(container, value) {
    const textarea = container.querySelector("textarea");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function freezeButton(container) {
    return [...container.querySelectorAll("button")].find((b) => b.textContent === "Freeze baseline");
  }

  it("shows the invalid-JSON message locally and never on the top-level banner", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    setTextarea(container, "not json");
    act(() => { freezeButton(container).click(); });
    expect(container.textContent).toContain("Scope items must be valid JSON");
    // Only the baseline section's own local banner renders this -- the
    // page-wide `error` state (which would duplicate it at the top of the
    // page, above the tablist) is never touched by this path.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("does not persist the message across a tab switch, and can be dismissed", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    setTextarea(container, "not json");
    act(() => { freezeButton(container).click(); });
    expect(container.textContent).toContain("Scope items must be valid JSON");
    act(() => { tabButton(container, "Permits").click(); });
    expect(container.textContent).not.toContain("Scope items must be valid JSON");
    act(() => { tabButton(container, "Overview").click(); });
    // Still showing on return to Overview (local state survives the tab
    // switch, unlike the old global-banner bug where it leaked onto OTHER
    // tabs) -- now dismiss it explicitly.
    expect(container.textContent).toContain("Scope items must be valid JSON");
    const dismiss = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Dismiss");
    act(() => { dismiss.click(); });
    expect(container.textContent).not.toContain("Scope items must be valid JSON");
  });

  it("clears the error as soon as the textarea is edited again", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    setTextarea(container, "not json");
    act(() => { freezeButton(container).click(); });
    expect(container.textContent).toContain("Scope items must be valid JSON");
    setTextarea(container, "[]");
    expect(container.textContent).not.toContain("Scope items must be valid JSON");
  });
});

// D1 — the live audit found that clicking "Freeze baseline" with valid JSON
// in the textarea produced no visible change and no message. Root cause: an
// un-awaited refresh() raced the optimistic setBaselines update, so whichever
// resolved last silently won either way. There was zero prior test coverage
// of the success path (only the client-side invalid-JSON path was tested).
describe("WorkPackageDetailClient Freeze baseline success (D1)", () => {
  function setTextarea(container, value) {
    const textarea = container.querySelector("textarea");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function freezeButton(container) {
    return [...container.querySelectorAll("button")].find((b) => b.textContent === "Freeze baseline");
  }

  it("POSTs the parsed membership and renders the frozen version with a plain-words confirmation", async () => {
    const { freezeRequests } = stubFetch();
    const { container } = renderDetail(BASE_PKG);
    const membership = [{ key: "BUNDLE-01", description: "Pull bundle", quantity: 1, unit: "each" }];
    setTextarea(container, JSON.stringify(membership));
    await act(async () => { freezeButton(container).click(); });
    await act(async () => {});
    expect(freezeRequests).toHaveLength(1);
    expect(freezeRequests[0]).toEqual({ action: "freeze", membership });
    expect(container.textContent).not.toContain("No frozen baseline yet");
    expect(container.textContent).toContain("Version 1");
    expect(container.textContent).toContain("Froze baseline version 1.");
  });

  it("surfaces the server's real error instead of silently doing nothing on a 409", async () => {
    stubFetch({
      freezeImpl: async () => ({ ok: false, json: async () => ({ error: "Scope is already frozen; post-freeze changes go through the scope-change workflow." }) }),
    });
    const { container } = renderDetail(BASE_PKG);
    setTextarea(container, JSON.stringify([{ key: "a" }]));
    await act(async () => { freezeButton(container).click(); });
    await act(async () => {});
    expect(container.textContent).toContain("already frozen");
  });
});

// D1 follow-up — live verification on WP-0006 found Freeze baseline still
// fails on an UNTOUCHED form: the example JSON shown in the box is only the
// textarea's placeholder, never its value, so clicking Freeze without typing
// anything sends JSON.parse("") and throws the "must be valid JSON" message
// on a form nobody put invalid input into. There is no stored "current
// scope" anywhere on the package to pre-fill the box with -- freezing a
// baseline for the first time IS how a package's scope items get defined,
// and the backend's freezeScopeBaseline requires at least one item -- so a
// blank box is now sent through as an empty array and the server's own
// plain-words rejection ("A baseline needs at least one scope item.") is
// what the user sees, scoped locally like every other baseline error (D14).
describe("WorkPackageDetailClient Freeze baseline on an untouched form (D1 follow-up)", () => {
  function freezeButton(container) {
    return [...container.querySelectorAll("button")].find((b) => b.textContent === "Freeze baseline");
  }
  function setTextarea(container, value) {
    const textarea = container.querySelector("textarea");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("sends an empty array (not a parse error) when the form is never touched", async () => {
    const { freezeRequests } = stubFetch({
      freezeImpl: async (body) => ({ ok: false, json: async () => ({ error: "A baseline needs at least one scope item." }) }),
    });
    const { container } = renderDetail(BASE_PKG);
    expect(container.querySelector("textarea").value).toBe("");
    await act(async () => { freezeButton(container).click(); });
    await act(async () => {});
    expect(freezeRequests).toHaveLength(1);
    expect(freezeRequests[0]).toEqual({ action: "freeze", membership: [] });
    expect(container.textContent).toContain("A baseline needs at least one scope item.");
    expect(container.textContent).not.toContain("Scope items must be valid JSON");
    expect(container.textContent).toContain("No frozen baseline yet");
  });

  it("treats whitespace-only input the same as blank", async () => {
    const { freezeRequests } = stubFetch({
      freezeImpl: async () => ({ ok: false, json: async () => ({ error: "A baseline needs at least one scope item." }) }),
    });
    const { container } = renderDetail(BASE_PKG);
    setTextarea(container, "   ");
    await act(async () => { freezeButton(container).click(); });
    await act(async () => {});
    expect(freezeRequests[0]).toEqual({ action: "freeze", membership: [] });
    expect(container.textContent).toContain("A baseline needs at least one scope item.");
  });

  it("scopes the server's rejection locally, same as the client-side JSON error (D14)", async () => {
    stubFetch({
      freezeImpl: async () => ({ ok: false, json: async () => ({ error: "A baseline needs at least one scope item." }) }),
    });
    const { container } = renderDetail(BASE_PKG);
    await act(async () => { freezeButton(container).click(); });
    await act(async () => {});
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it("still shows the client-side JSON-parse error for genuinely malformed non-empty input", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    setTextarea(container, "not json");
    await act(async () => { freezeButton(container).click(); });
    expect(container.textContent).toContain("Scope items must be valid JSON");
    expect(container.textContent).not.toContain("A baseline needs at least one scope item.");
  });
});
