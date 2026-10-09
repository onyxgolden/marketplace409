// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
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

function stubFetch({ properties = OPTIONS, failOptions = false, failPatch = false, patchImpl = null, deleteImpl = null, getEligibility = undefined } = {}) {
  const patches = [];
  const deletes = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
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
      return { ok: true, json: async () => ({ package: BASE_PKG, transitions: [], attestations: [], baselines: [], scopeChanges: [], observations: [], ...(getEligibility !== undefined ? { deletionEligibility: getEligibility } : {}) }) };
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
    throw new Error(`unexpected fetch ${url}`);
  }));
  return { patches, deletes };
}

function renderDetail(pkg = BASE_PKG, { deletionEligibility } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <WorkPackageDetailClient
        initial={{
          package: pkg,
          transitions: [],
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
  document.body.innerHTML = "";
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
    const { container } = renderDetail(BASE_PKG);
    expect(dangerZone(container)).toBeNull();
    expect(container.textContent).not.toContain("Danger zone");
  });

  it("renders no delete affordance for non-owners", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, {
      deletionEligibility: { ...ELIGIBLE, isOwner: false },
    });
    expect(dangerZone(container)).toBeNull();
  });

  it("shows exact blocker categories, counts, and next steps when blocked", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { deletionEligibility: BLOCKED });
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
    const { container } = renderDetail({ ...BASE_PKG, status: "in_progress" }, {
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
    const { container } = renderDetail(BASE_PKG, { deletionEligibility: ELIGIBLE });
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
    const { container } = renderDetail(BASE_PKG, { deletionEligibility: ELIGIBLE });
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
    const { container } = renderDetail(BASE_PKG, { deletionEligibility: ELIGIBLE });
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
    const { container } = renderDetail(BASE_PKG, { deletionEligibility: ELIGIBLE });
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
    const { container } = renderDetail(BASE_PKG, { deletionEligibility: ELIGIBLE });
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
    const { container } = renderDetail(BASE_PKG, { deletionEligibility: ELIGIBLE });
    act(() => { deleteTrigger(container).click(); });
    typeCode(container, "WP-0001");
    await act(async () => { dialogButton(container, "Delete").click(); });
    await settle();
    expect(dialogEl(container)).toBeNull();
    expect(routerMocks.push).not.toHaveBeenCalled();
    // The refreshed danger zone explains the fresh blockers, error visible,
    // and the package itself is still on screen.
    const zone = dangerZone(container);
    expect(zone.textContent).toContain("Budget history (1)");
    expect(container.querySelector('[role="alert"]').textContent)
      .toContain("This package has records that must be kept");
    expect(container.textContent).toContain("Turnover");
  });
});
