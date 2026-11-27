// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));

import { clearSWRCache } from "@/hooks/swrCache";

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

function stubFetch({ properties = OPTIONS, failOptions = false, failPatch = false, patchImpl = null, deleteImpl = null, getEligibility = undefined, freezeImpl = null, seedBaselines = [], seedChanges = [], decideImpl = null, steps = [], allocationBefore = null, allocationAfter = null, changeSummary = null } = {}) {
  const patches = [];
  const deletes = [];
  const freezeRequests = [];
  const decideRequests = [];
  // E4 (D4.1 fix round): held/controlled budget responses. The
  // budget-allocation GET returns allocationBefore until a work-step
  // PATCH lands, then allocationAfter — the server recomputes the
  // labor forecast from step hours, so the stub mirrors a real
  // backend that reflects writes (the same D1 rule as the baselines
  // above). The work-steps GET returns the mutable committed list
  // for the same reason.
  const committedSteps = steps.map((s) => ({ ...s }));
  let stepPatched = false;
  const budgetCalls = [];
  const stepPatches = [];
  // Approve-button fix: the decide stub mirrors the real backend's atomic
  // decision — a decided change leaves "proposed", and an approval inserts
  // the superseding baseline — so a test can prove the row moves to
  // "approved" and version N+1 appears, not just that a request fired.
  const committedChanges = seedChanges.map((c) => ({ ...c }));
  // D1: a real backend's GET reflects whatever the scope POST actually
  // committed. A GET stub that always returns [] regardless of prior
  // writes would make the awaited-refresh fix look broken for a reason
  // that's an artifact of the stub, not the component.
  const committedBaselines = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    // Slice-7 PDF blockers: pageQuery appends ?workspace=&forgeProject=
    // to scoped fetches, so exact matches run against the bare path.
    const bare = typeof url === "string" ? url.split("?")[0] : url;
    if (bare === `/api/work-packages/${BASE_PKG.id}/scope` && options.method === "POST") {
      const body = JSON.parse(options.body);
      freezeRequests.push(body);
      if (freezeImpl) return freezeImpl(body);
      const baseline = { id: "forge_wsb_1", version: committedBaselines.length + 1, package_id: BASE_PKG.id, membership: body.membership, membership_hash: "fnv1a:test" };
      committedBaselines.push(baseline);
      return { ok: true, json: async () => ({ success: true, baseline }) };
    }
    const decideMatch = typeof url === "string" && url.split("?")[0].match(new RegExp(`^/api/work-packages/${BASE_PKG.id}/scope/([^/]+)$`));
    if (decideMatch && options.method === "POST") {
      const body = JSON.parse(options.body);
      decideRequests.push({ changeId: decideMatch[1], ...body });
      if (decideImpl) return decideImpl(body);
      const change = committedChanges.find((c) => c.id === decideMatch[1]);
      if (!change) return { ok: false, json: async () => ({ error: "Scope change not found." }) };
      change.status = body.approve ? "approved" : "rejected";
      let baseline = null;
      if (body.approve) {
        baseline = { id: "forge_wsb_decide", version: seedBaselines.length + committedBaselines.length + 1, package_id: BASE_PKG.id, membership: body.newMembership, membership_hash: "fnv1a:test-decide" };
        committedBaselines.push(baseline);
      }
      return { ok: true, json: async () => ({ success: true, change: { ...change }, baseline }) };
    }
    if (bare === "/api/work-packages/property-options") {
      if (failOptions) return { ok: false, json: async () => ({ error: "Unable to complete the request." }) };
      return { ok: true, json: async () => ({ properties }) };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}/planning-process` && (!options.method || options.method === "GET")) {
      return {
        ok: true,
        json: async () => ({
          checklist: {
            packageId: BASE_PKG.id, complexity: "standard", templateVersion: 1,
            canUpdate: true, canReview: false,
            constructionReadiness: {
              status: "not_established",
              detail: "No package-level release decision exists yet. Planning percent never authorizes construction or releases an IFC drawing.",
            },
            template: [{ stepKey: "pdf-01", version: 1, stepNumber: 1, sortOrder: 1, name: "P & I.D. / MFD", role: "Planning", creditPct: 5, mhrsStandard: 2, description: "P&ID marked up." }],
            instances: [{ id: "inst_pdf_01", workPackageId: BASE_PKG.id, templateVersion: 1, templateStepId: "pdf-01", status: "Complete", evidenceLink: null, reviewedBy: null, reviewedAt: null, submittedBy: null, version: 1, updatedBy: "user_1", updatedAt: "t1" }],
            progress: { percentComplete: 5, earnedCreditPct: 5, totalCreditPct: 100, earnedMhrs: 2, totalMhrs: 40, stepsTotal: 1, stepsEarned: 1, stepsByStatus: { "N/A": 0, Complete: 1, Reviewed: 0, "In-Progress": 0, "Needs Revision": 0 }, initialized: true },
          },
        }),
      };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}` && options.method === "PATCH") {
      patches.push(JSON.parse(options.body));
      if (patchImpl) return patchImpl();
      if (failPatch) return { ok: false, json: async () => ({ error: "Package changed while editing; refresh and retry." }) };
      return { ok: true, json: async () => ({ package: { ...BASE_PKG, ...patches[patches.length - 1], property_id: patches[patches.length - 1].property_id ?? null } }) };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}` && options.method === "DELETE") {
      deletes.push(JSON.parse(options.body));
      if (deleteImpl) return deleteImpl();
      return { ok: true, json: async () => ({ success: true, deletion: { package_id: BASE_PKG.id, code: BASE_PKG.code } }) };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}` && (!options.method || options.method === "GET")) {
      return { ok: true, json: async () => ({ package: BASE_PKG, transitions: [], attestations: [], baselines: [...seedBaselines, ...committedBaselines], scopeChanges: committedChanges, observations: [], ...(getEligibility !== undefined ? { deletionEligibility: getEligibility } : {}) }) };
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
    if (bare === `/api/work-packages/${BASE_PKG.id}/drawings/readiness`) {
      return {
        ok: true,
        json: async () => ({
          packageId: BASE_PKG.id, packageStatus: BASE_PKG.status, drawings: [],
          counts: { drawingsTotal: 0, ifcReleased: 0, pendingReview: 0, returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0 },
        }),
      };
    }
    // Slice 9: the Busts tab mounts the busts panel, which fetches
    // its candidates and its recorded list.
    if (bare === `/api/work-packages/${BASE_PKG.id}/busts/candidates`) {
      return {
        ok: true,
        json: async () => ({
          packageId: BASE_PKG.id, packageStatus: BASE_PKG.status, asOf: "2026-11-15",
          baseline: null, controlEstimate: null, candidates: [], insufficiencies: [],
          targets: { takeoffLines: [], steps: [] },
        }),
      };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}/busts`) {
      return { ok: true, json: async () => ({ busts: [], total: 0, limit: 100, offset: 0 }) };
    }
    // Field verification: the Overview header strip fetches the list
    // summary on every mount; the tab mounts the full panel (which
    // also reads the work-steps package status and the progress
    // summary for its target pickers).
    if (bare === `/api/work-packages/${BASE_PKG.id}/field-verifications`) {
      return {
        ok: true,
        json: async () => ({
          verifications: [],
          summary: { total: 0, draft: 0, submitted: 0, accepted: 0, returned: 0, rejected: 0, retired: 0, changedSinceReview: 0 },
          total: 0, limit: 100, offset: 0,
        }),
      };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}/work-steps`) {
      // D4: the dashboard fetches active then retired separately — a
      // retiredOnly page that returned the seeded steps too would
      // duplicate every row in the drill tests.
      const parsed = new URL(url, "https://test");
      const retiredOnly = parsed.searchParams.get("retiredOnly") === "true";
      return { ok: true, json: async () => ({ steps: retiredOnly ? [] : committedSteps, generation: 1, packageStatus: BASE_PKG.status }) };
    }
    // E4: the dashboard's Cost split reads the budget-allocation
    // payload (the server-computed labor forecast lives there).
    if (bare === `/api/work-packages/${BASE_PKG.id}/budget-allocation` && allocationBefore) {
      budgetCalls.push({ at: Date.now(), patched: stepPatched });
      return { ok: true, json: async () => (stepPatched ? allocationAfter : allocationBefore) };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}/change-orders` && changeSummary) {
      return { ok: true, json: async () => changeSummary };
    }
    // E4: the grid cell commit PATCHes one step field.
    const stepPatchMatch = typeof url === "string" && url.split("?")[0].match(new RegExp(`^/api/work-packages/${BASE_PKG.id}/work-steps/([^/]+)$`));
    if (stepPatchMatch && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      stepPatches.push(body);
      const step = committedSteps.find((s) => s.id === stepPatchMatch[1]);
      if (!step) return { ok: false, json: async () => ({ error: "Step not found." }) };
      if ("plannedPersonHours" in body) step.plannedPersonHours = body.plannedPersonHours;
      step.version = (step.version ?? 1) + 1;
      stepPatched = true;
      return { ok: true, json: async () => ({ step: { ...step } }) };
    }
    if (bare === `/api/work-packages/${BASE_PKG.id}/progress/summary`) {
      return { ok: true, json: async () => ({ summary: { packageId: BASE_PKG.id, asOf: "2026-11-15", lines: [] } }) };
    }
    // PR B: the project-link block fetches the hierarchy tree (and the
    // current assignment's name when the package is linked). An empty
    // tree keeps the block quiet — no error alert — in these tests.
    if (typeof url === "string" && url.startsWith("/api/forge/hierarchy?projectId=")) {
      return { ok: true, json: async () => ({ selection: null }) };
    }
    if (bare === "/api/forge/hierarchy") {
      return { ok: true, json: async () => ({ selector: { ownerId: "owner_1", clients: [] } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
  return { patches, deletes, freezeRequests, decideRequests, budgetCalls, stepPatches };
}

// D9: the unsaved-changes guard attaches a document-level click listener
// in a useEffect cleanup — unlike this file's other effects, that outlives
// a bare `document.body.innerHTML = ""` (clears nodes, not React's own
// commit/cleanup lifecycle) and keeps firing in later tests unless the
// root is actually unmounted first.
const activeRoots = [];

function renderDetail(pkg = BASE_PKG, { deletionEligibility, initialTab, workspaceParam, forgeProjectParam, transitions = [], baselines = [], scopeChanges = [], ownerId = null, initialDetailFocus = null } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoots.push(root);
  act(() => {
    root.render(
      <WorkPackageDetailClient
        initialTab={initialTab}
        workspaceParam={workspaceParam}
        forgeProjectParam={forgeProjectParam}
        ownerId={ownerId}
        initialDetailFocus={initialDetailFocus}
        initial={{
          package: pkg,
          transitions,
          attestations: [],
          baselines,
          currentBaseline: null,
          scopeChanges,
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
  // The Property field is Commercial-mode-only since the mode selector
  // slice (Industrial shows Unit/Area/System instead; BASE_PKG's
  // package_type "other" is ambiguous and infers Industrial by
  // default) — these tests are about the Property field itself,
  // unrelated to mode, so they set mode: "commercial" explicitly.
  it("shows 'No property assigned' when unassigned", () => {
    stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, mode: "commercial" });
    expect(propertyField(container).textContent).toBe("No property assigned");
  });

  it("shows the linked property label with a link back to the property page", async () => {
    stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, mode: "commercial", property_id: "1900-w-decker" });
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
    const { container } = renderDetail({ ...BASE_PKG, mode: "commercial", property_id: "1900-w-decker" });
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

describe("WorkPackageDetailClient edit-form mode toggle (PR #775 fix round)", () => {
  // Server-side, updateWorkPackage refuses a save whose package_type is
  // exclusive to the package's OLD mode once mode has changed — so
  // toggling mode in the edit form on a typed package must reset
  // package_type to the shared "other" value before save, the same way
  // the create form already does, or every such save 400s with no way
  // for the user to recover from the form.
  it("resets Type to Other when flipping to a mode that doesn't offer the stored type, and the save succeeds", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, mode: "industrial", package_type: "engineering" });
    await settle();
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });

    const typeSelectBefore = container.querySelector("#edit_package_type");
    expect(typeSelectBefore.value).toBe("engineering");

    const modeSelect = container.querySelector("#edit_mode");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(modeSelect, "commercial");
    act(() => { modeSelect.dispatchEvent(new Event("change", { bubbles: true })); });

    // "engineering" is industrial-only — flipping to commercial must reset
    // the visible Type select to "other" before the user ever saves.
    const typeSelectAfter = container.querySelector("#edit_package_type");
    expect(typeSelectAfter.value).toBe("other");

    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();

    expect(patches).toHaveLength(1);
    expect(patches[0].mode).toBe("commercial");
    expect(patches[0].package_type).toBe("other");
  });

  it("leaves Type untouched when the stored type is still valid under the new mode", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, mode: "industrial", package_type: "other" });
    await settle();
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });

    const modeSelect = container.querySelector("#edit_mode");
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(modeSelect, "commercial");
    act(() => { modeSelect.dispatchEvent(new Event("change", { bubbles: true })); });

    // "other" is offered under both modes — flipping must not force a reset.
    expect(container.querySelector("#edit_package_type").value).toBe("other");

    const saveButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => { saveButton.click(); });
    await settle();

    expect(patches).toHaveLength(1);
    expect(patches[0].mode).toBe("commercial");
    expect(patches[0].package_type).toBe("other");
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
    // Slice-7 confirmation-placement fix (R3): a save with no changes
    // no longer PATCHes, so this payload-shape test makes a trivial
    // change first — trailing whitespace on the title, which the
    // payload passes through unchanged, so the asserted Project and
    // property values are unaffected. (A trailing space on Project
    // itself would be a server no-op: the payload trims it away.)
    const titleInput = container.querySelector("form input:not([type='date'])");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, "Turnover ");
    act(() => { titleInput.dispatchEvent(new Event("input", { bubbles: true })); });
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
    // Slice-7 confirmation-placement fix (R3): a save with no changes
    // no longer PATCHes, so this payload-shape test makes a trivial
    // change first — trailing whitespace on the title, which the
    // payload passes through, so the asserted date value is unchanged.
    const titleInput = container.querySelector("form input:not([type='date'])");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, "Turnover ");
    act(() => { titleInput.dispatchEvent(new Event("input", { bubbles: true })); });
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
    // Slice-7 confirmation-placement fix (R3): see the test above —
    // a trivial title change first, so a PATCH is actually sent.
    const titleInput = container.querySelector("form input:not([type='date'])");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, "Turnover ");
    act(() => { titleInput.dispatchEvent(new Event("input", { bubbles: true })); });
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
    // Slice-7 confirmation-placement fix (R3): a save with no changes
    // sends no PATCH, so a trivial title change first puts a real
    // save in flight for the disabled-buttons assertion.
    const titleInput = container.querySelector("form input:not([type='date'])");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(titleInput, "Turnover ");
    act(() => { titleInput.dispatchEvent(new Event("input", { bubbles: true })); });
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

// Slice-7 save-confirmation placement fix (brief 2026-11-15, R3):
// a Package Edit Save with no changes must confirm truthfully — never
// claim data was saved when no mutation occurred, and never PATCH a
// no-op. The confirmation renders in the edit form footer while
// editing and below the Package header once the form closes on save.
describe("WorkPackageDetailClient Package Edit confirmation (Slice-7 R3)", () => {
  function openEdit(container) {
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });
  }

  function setTitle(container, value) {
    const input = container.querySelector("form input:not([type='date'])");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    act(() => { input.dispatchEvent(new Event("input", { bubbles: true })); });
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

  function packageSectionStatus(container) {
    const heading = [...container.querySelectorAll("h2")].find((h) => h.textContent === "Package");
    return heading.closest("section").querySelector('[role="status"]');
  }

  it("a no-change save confirms truthfully and sends no PATCH", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    await saveEdit(container);
    expect(patches).toHaveLength(0);
    // The form closed and the confirmation sits in the Package
    // section, naming the package — not claiming a save happened.
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Edit")).toBeTruthy();
    const notice = packageSectionStatus(container);
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("No changes to Turnover — nothing needed saving.");
  });

  it("a whitespace-only project change is a server no-op: no PATCH, up-to-date confirmation", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail({ ...BASE_PKG, project_id: "Decker refresh" });
    await settle();
    openEdit(container);
    // The form differs from the persisted package (trailing space),
    // but the normalized payload is identical — no mutation occurred.
    setProjectInput(container, "Decker refresh ");
    await saveEdit(container);
    expect(patches).toHaveLength(0);
    const notice = packageSectionStatus(container);
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Turnover is up to date — no changes were needed.");
  });

  it("a real save confirms with the saved title and sends one PATCH", async () => {
    const { patches } = stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    setTitle(container, "Turnover 2");
    await saveEdit(container);
    expect(patches).toHaveLength(1);
    expect(patches[0].title).toBe("Turnover 2");
    const notice = packageSectionStatus(container);
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Turnover 2 saved.");
    // The retained notice sits at the bottom of the Package section,
    // below the read-only fields — not below the header, which is a
    // full form-height above the Save button on this long form and
    // would be off-screen after the user scrolled down to save.
    const section = [...container.querySelectorAll("h2")].find((h) => h.textContent === "Package").closest("section");
    const dl = section.querySelector("dl");
    expect(dl.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a failed save shows the error and manufactures no success notice", async () => {
    const { patches } = stubFetch({ failPatch: true });
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    setTitle(container, "Turnover 2");
    await saveEdit(container);
    expect(patches).toHaveLength(1);
    expect(container.textContent).toContain("Package changed while editing; refresh and retry.");
    expect(container.querySelector('[role="status"]')).toBeNull();
    // The form stays open for a retry.
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("reopening Edit clears the previous save confirmation", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await settle();
    openEdit(container);
    setTitle(container, "Turnover 2");
    await saveEdit(container);
    expect(packageSectionStatus(container).textContent).toBe("Turnover 2 saved.");
    // Starting a new edit clears that action's previous confirmation.
    openEdit(container);
    expect(container.querySelector('[role="status"]')).toBeNull();
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
    expect(dialog.textContent).toContain("0001");
    expect(dialog.textContent).toContain("Turnover");
    expect(dialog.textContent).toContain("audit record");
    expect(dialog.textContent).toContain("can't be undone");
    // Cancel is the focused default.
    expect(document.activeElement).toBe(dialogButton(container, "Cancel"));
    // Wrong / partial codes never enable Delete.
    expect(dialogButton(container, "Delete").disabled).toBe(true);
    typeCode(container, "000");
    expect(dialogButton(container, "Delete").disabled).toBe(true);
    typeCode(container, "wp-0001");
    expect(dialogButton(container, "Delete").disabled).toBe(true);
    typeCode(container, "0001");
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
    typeCode(container, "0001");
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
    expect(deletes[0]).toEqual({ confirmCode: "0001", expectedVersion: 1 });
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
    typeCode(container, "0001");
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
    typeCode(container, "0001");
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
    typeCode(container, "0001");
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

  it("renders all eleven tabs with Overview selected by default", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((b) => b.textContent);
    expect(tabs).toEqual([
      "Overview", "Work steps", "Planning Checklist", "Milestones", "Permits",
      "IFA→IFC redlines", "Budget & Change Orders", "Busts", "Field verification", "Documents", "Activity / Audit",
    ]);
    expect(tabButton(container, "Overview").getAttribute("aria-selected")).toBe("true");
    expect(headings(container)).toContain("Package");
  });

  it("switching to Busts mounts the busts panel", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await act(async () => { tabButton(container, "Busts").click(); });
    expect(tabButton(container, "Busts").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Detected — needs review");
    expect(container.textContent).toContain("No busts detected — nothing is over its frozen allowance.");
    expect(container.textContent).toContain("No busts recorded yet.");
  });

  it("switching to Field verification mounts the field verification panel", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await act(async () => { tabButton(container, "Field verification").click(); });
    await act(async () => {});
    expect(tabButton(container, "Field verification").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Field verification records what was checked. It does not change recorded progress or the approved plan.");
    expect(container.textContent).toContain("No verifications recorded yet.");
  });

  it("switching to Planning Checklist mounts the checklist with its computed progress", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    await act(async () => { tabButton(container, "Planning Checklist").click(); });
    expect(tabButton(container, "Planning Checklist").getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Planning progress");
    expect(container.textContent).toContain("P & I.D. / MFD");
    expect(container.textContent).toContain("Earned 2 of 40 planning hours");
  });

  it("switching to Milestones shows the Milestones tab and hides the Overview panels", () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG);
    act(() => { tabButton(container, "Milestones").click(); });
    expect(tabButton(container, "Milestones").getAttribute("aria-selected")).toBe("true");
    expect(headings(container)).toContain("Milestones");
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
    expect(headings(container)).toContain("Milestones");
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

  it("fix round 1: a package-identity change (key remount) discards package A's data and any in-progress edit, never leaking it into package B", async () => {
    // ChatGPT's P1 on the first fix round: resyncing only `activeTab` left
    // every package-derived value (pkg, transitions, attestations,
    // baselines, changes, editForm, deletionEligibility) seeded once from
    // the `initial` prop, with no package-identity reconciliation. Under
    // the exact no-remount mechanism this bug lives in, a navigation from
    // package A to package B could show B's tab/heading while the actual
    // content and any mutation target still referenced A. The real fix
    // keys <WorkPackageDetailClient> by packageId in the parent route, so
    // React fully unmounts/remounts on a genuine package change. A single
    // renderDetail() call can't catch a remount regression — it always
    // mounts fresh. This test re-renders the SAME root with a DIFFERENT
    // key and a different package, exactly as the parent route now does,
    // and must still show it as a clean instance: no stale A title, no
    // stale open edit, correct B id/code/title throughout.
    stubFetch();
    const PKG_B = { ...BASE_PKG, id: "forge_wp_2", code: "WP-0002", title: "Second package" };
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      if (url === `/api/work-packages/${PKG_B.id}/drawings/readiness` || url === `/api/work-packages/${BASE_PKG.id}/drawings/readiness`) {
        const forId = url.includes(PKG_B.id) ? PKG_B.id : BASE_PKG.id;
        return {
          ok: true,
          json: async () => ({
            packageId: forId, packageStatus: BASE_PKG.status, drawings: [],
            counts: { drawingsTotal: 0, ifcReleased: 0, pendingReview: 0, returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0 },
          }),
        };
      }
      if (url === "/api/work-packages/property-options") return { ok: true, json: async () => ({ properties: OPTIONS }) };
      if (typeof url === "string" && url.startsWith("/api/work-links")) return { ok: true, json: async () => ({ links: [], documents: [] }) };
      if (typeof url === "string" && url.startsWith("/api/work-documents")) return { ok: true, json: async () => ({ documents: [] }) };
      if (typeof url === "string" && url.startsWith("/api/forge/designer")) return { ok: true, json: async () => ({ projects: [] }) };
      // PR B: the project-link block fetches the hierarchy tree (and the
    // current assignment's name when the package is linked). An empty
    // tree keeps the block quiet — no error alert — in these tests.
    if (typeof url === "string" && url.startsWith("/api/forge/hierarchy?projectId=")) {
      return { ok: true, json: async () => ({ selection: null }) };
    }
    if (url === "/api/forge/hierarchy") {
      return { ok: true, json: async () => ({ selector: { ownerId: "owner_1", clients: [] } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
    }));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    activeRoots.push(root);
    act(() => {
      root.render(
        <WorkPackageDetailClient
          key={BASE_PKG.id}
          initialTab="overview"
          initial={{ package: BASE_PKG, transitions: [], attestations: [], baselines: [], currentBaseline: null, scopeChanges: [], observations: [] }}
          initialLinks={[]}
        />,
      );
    });
    await settle();
    expect(container.textContent).toContain(BASE_PKG.title);

    // Open Edit on package A and type an unsaved change — this is the
    // "in-progress mutation target" the review warns could otherwise leak.
    const editButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
    act(() => { editButton.click(); });
    const textarea = container.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    act(() => {
      setter.call(textarea, "Unsaved edit for package A — must never reach package B");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Cancel")).toBe(true);

    // Non-vacuous check, step 1: re-render the SAME root with the SAME key
    // (i.e. the pre-fix-round page.jsx, which never keyed this component at
    // all) while swapping in package B's data and tab. React reuses the
    // existing instance — this must reproduce the exact reported bug:
    // package A's title and its unsaved edit both survive under package
    // B's own tab. If this assertion ever stops failing, the fix below is
    // no longer being proven against anything.
    act(() => {
      root.render(
        <WorkPackageDetailClient
          key={BASE_PKG.id}
          initialTab="redlines"
          initial={{ package: PKG_B, transitions: [], attestations: [], baselines: [], currentBaseline: null, scopeChanges: [], observations: [] }}
          initialLinks={[]}
        />,
      );
    });
    await settle();
    expect(tabButton(container, "IFA→IFC redlines").getAttribute("aria-selected")).toBe("true");
    // The Edit form/title live only under the Overview tab's conditional
    // render — switch back to it to actually observe whether A's stale
    // state survived underneath the tab switch.
    act(() => { tabButton(container, "Overview").click(); });
    expect(container.querySelector("input").value).toBe(BASE_PKG.title);
    expect(container.textContent).toContain("Unsaved edit for package A");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Cancel")).toBe(true);

    // Step 2: the real fix — re-render with a DIFFERENT key, exactly what
    // the parent route's key={packageId} now produces for a genuine
    // package-identity change.
    act(() => {
      root.render(
        <WorkPackageDetailClient
          key={PKG_B.id}
          initialTab="redlines"
          initial={{ package: PKG_B, transitions: [], attestations: [], baselines: [], currentBaseline: null, scopeChanges: [], observations: [] }}
          initialLinks={[]}
        />,
      );
    });
    await settle();
    expect(tabButton(container, "IFA→IFC redlines").getAttribute("aria-selected")).toBe("true");
    expect(headings(container)).toContain("Drawing readiness");

    // Clean instance: switching back to Overview now shows package B's own
    // title with no trace of A's title or its unsaved edit, and the Edit
    // form is closed (a fresh mount always starts with editing=false), not
    // left open on A's stale draft.
    act(() => { tabButton(container, "Overview").click(); });
    expect(container.textContent).not.toContain(BASE_PKG.title);
    expect(container.textContent).not.toContain("Unsaved edit for package A");
    expect(container.textContent).toContain(PKG_B.title);
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Cancel")).toBe(false);
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

describe("WorkPackageDetailClient tab switches preserve package scope (slice-7 PDF blockers)", () => {
  function tabButton(container, label) {
    return [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === label);
  }

  // The Defect 2 regression: switchTab rebuilt the URL with only tab +
  // workspace, silently dropping ?forgeProject=, so every panel fetch
  // after the first tab switch lost scope and failed closed 404 while
  // the server-rendered header still looked fine.
  it("keeps forgeProject=unassigned across tab switches and back to Overview", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { workspaceParam: "owner_1", forgeProjectParam: "unassigned" });
    await settle();
    act(() => { tabButton(container, "Documents").click(); });
    expect(tabButton(container, "Documents").getAttribute("aria-selected")).toBe("true");
    expect(window.location.search).toContain("tab=documents");
    expect(window.location.search).toContain("workspace=owner_1");
    expect(window.location.search).toContain("forgeProject=unassigned");
    act(() => { tabButton(container, "Overview").click(); });
    expect(window.location.search).not.toContain("tab=");
    expect(window.location.search).toContain("forgeProject=unassigned");
  });

  it("keeps an assigned project id across tab switches", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { workspaceParam: "owner_1", forgeProjectParam: "forge_prj_1" });
    await settle();
    act(() => { tabButton(container, "IFA→IFC redlines").click(); });
    expect(window.location.search).toContain("tab=redlines");
    expect(window.location.search).toContain("forgeProject=forge_prj_1");
  });

  it("nested panel fetches carry forgeProject after a tab switch", async () => {
    stubFetch();
    const { container } = renderDetail(BASE_PKG, { workspaceParam: "owner_1", forgeProjectParam: "unassigned" });
    await settle();
    act(() => { tabButton(container, "Documents").click(); });
    await settle();
    act(() => { tabButton(container, "IFA→IFC redlines").click(); });
    await settle();
    const urls = globalThis.fetch.mock.calls.map(([u]) => String(u));
    const scoped = urls.filter((u) => u.includes("forgeProject=unassigned"));
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.some((u) => u.startsWith("/api/work-links"))).toBe(true);
    expect(scoped.some((u) => u.includes("/drawings/readiness"))).toBe(true);
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

// Approve-button fix — live-verified Nov 15 on WP-0008: approving a
// post-freeze change did nothing. Root cause was in onDecide: Approve
// asked for the NEW full scope membership through a native prompt(), and
// the automated live browser auto-dismisses native dialogs, so prompt()
// returned null and the handler silently returned without any request —
// no error, no confirmation, status stayed "proposed" — while Reject (no
// prompt) worked on the first attempt. Approval now opens an inline
// editor pre-filled with the current baseline's membership, in the page,
// like the Freeze baseline box. These tests prove the prompt is gone and
// the approve path works end to end in the component.
describe("WorkPackageDetailClient post-freeze change approval (Approve button)", () => {
  const V1_MEMBERSHIP = [{ key: "BUNDLE-01", description: "Pull bundle", quantity: 1, unit: "each" }];
  const V1_BASELINE = { id: "forge_wsb_1", version: 1, package_id: BASE_PKG.id, membership: V1_MEMBERSHIP, membership_hash: "fnv1a:1992bc300c83440e", frozen_at: "2026-11-15T19:05:30" };
  const CHANGE = { id: "forge_wsc_1", package_id: BASE_PKG.id, baseline_version: 1, change_type: "addition", description: "Add labor-hours allowance of 10 hours to scope item BUNDLE-01 (Pull bundle).", status: "proposed" };

  function renderWithProposal() {
    return renderDetail(BASE_PKG, { baselines: [V1_BASELINE], scopeChanges: [CHANGE] });
  }

  function approveButton(container) {
    return [...container.querySelectorAll("button")].find((b) => b.textContent === "Approve");
  }

  function rejectButton(container) {
    return [...container.querySelectorAll("button")].find((b) => b.textContent === "Reject");
  }

  function approveEditor(container) {
    return container.querySelector('textarea[aria-label="New scope list"]');
  }

  function setApproveEditor(container, value) {
    const textarea = approveEditor(container);
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function confirmButton(container) {
    return [...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm approval");
  }

  it("opens an inline editor pre-filled with the current baseline membership — never a native prompt", async () => {
    const promptSpy = vi.fn(() => { throw new Error("prompt() must not be called"); });
    vi.stubGlobal("prompt", promptSpy);
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [CHANGE] });
    const { container } = renderWithProposal();
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    expect(promptSpy).not.toHaveBeenCalled();
    expect(approveEditor(container)).not.toBeNull();
    expect(approveEditor(container).value).toBe(JSON.stringify(V1_MEMBERSHIP, null, 2));
    // Opening the editor fires no request on its own.
    expect(decideRequests).toHaveLength(0);
  });

  it("confirming approval POSTs the edited membership, marks the change approved, and freezes version 2", async () => {
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [CHANGE] });
    const { container } = renderWithProposal();
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    const laborItem = { key: "BUNDLE-01-LABOR", description: "Labor hours allowance", quantity: 10, unit: "hours" };
    setApproveEditor(container, JSON.stringify([...V1_MEMBERSHIP, laborItem], null, 2));
    await act(async () => { confirmButton(container).click(); });
    await act(async () => {});
    expect(decideRequests).toHaveLength(1);
    expect(decideRequests[0]).toEqual({ changeId: CHANGE.id, approve: true, newMembership: [...V1_MEMBERSHIP, laborItem] });
    expect(container.textContent).toContain("Approved — baseline version 2 is now frozen.");
    expect(container.textContent).toContain("Version 2");
    expect(container.textContent).toContain("approved");
    expect(approveEditor(container)).toBeNull();
  });

  it("shows a local error and posts nothing for malformed JSON", async () => {
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [CHANGE] });
    const { container } = renderWithProposal();
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    setApproveEditor(container, "not json");
    await act(async () => { confirmButton(container).click(); });
    await act(async () => {});
    expect(decideRequests).toHaveLength(0);
    expect(container.textContent).toContain("New scope list must be valid JSON");
    expect(approveEditor(container)).not.toBeNull();
  });

  it("shows a local error and posts nothing for an empty list", async () => {
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [CHANGE] });
    const { container } = renderWithProposal();
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    setApproveEditor(container, "[]");
    await act(async () => { confirmButton(container).click(); });
    await act(async () => {});
    expect(decideRequests).toHaveLength(0);
    expect(container.textContent).toContain("requires the new scope list");
  });

  it("cancel closes the editor with no request", async () => {
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [CHANGE] });
    const { container } = renderWithProposal();
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    expect(approveEditor(container)).not.toBeNull();
    const cancel = [...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel");
    await act(async () => { cancel.click(); });
    await act(async () => {});
    expect(approveEditor(container)).toBeNull();
    expect(decideRequests).toHaveLength(0);
  });

  it("reject still posts straight through with no editor", async () => {
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [CHANGE] });
    const { container } = renderWithProposal();
    await act(async () => { rejectButton(container).click(); });
    await act(async () => {});
    expect(approveEditor(container)).toBeNull();
    expect(decideRequests).toHaveLength(1);
    expect(decideRequests[0]).toEqual({ changeId: CHANGE.id, approve: false, newMembership: null });
    expect(container.textContent).toContain("rejected");
  });

  // Fix round 1 (ChatGPT NEEDS CHANGES on PR #815): onStartApprove used
  // to fall back to the latest baseline whenever the change's referenced
  // version was not found — including when the row named an explicit
  // version. That let a user confirm a membership the proposal was never
  // made against. An explicit unmatched version must now fail closed.
  it("fails closed when the change names a baseline version that is not loaded — no editor, no request", async () => {
    const MISSING_VERSION_CHANGE = { ...CHANGE, baseline_version: 99 };
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [MISSING_VERSION_CHANGE] });
    const { container } = renderDetail(BASE_PKG, { baselines: [V1_BASELINE], scopeChanges: [MISSING_VERSION_CHANGE] });
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    expect(approveEditor(container)).toBeNull();
    expect(confirmButton(container)).toBeUndefined();
    expect(decideRequests).toHaveLength(0);
    expect(container.textContent).toContain("baseline version 99");
    expect(container.textContent).toContain("Approval is blocked");
  });

  it("pre-fills from the referenced older baseline when a newer baseline also exists", async () => {
    const V2_MEMBERSHIP = [{ key: "BUNDLE-01", description: "Pull bundle", quantity: 2, unit: "each" }];
    const V2_BASELINE = { id: "forge_wsb_2", version: 2, package_id: BASE_PKG.id, membership: V2_MEMBERSHIP, membership_hash: "fnv1a:test-v2", frozen_at: "2026-11-15T20:00:00" };
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE, V2_BASELINE], seedChanges: [CHANGE] });
    const { container } = renderDetail(BASE_PKG, { baselines: [V1_BASELINE, V2_BASELINE], scopeChanges: [CHANGE] });
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    expect(approveEditor(container)).not.toBeNull();
    expect(approveEditor(container).value).toBe(JSON.stringify(V1_MEMBERSHIP, null, 2));
    expect(decideRequests).toHaveLength(0);
  });

  it("still falls back to the latest baseline when the change carries no baseline version", async () => {
    const NO_VERSION_CHANGE = { ...CHANGE, baseline_version: null };
    const { decideRequests } = stubFetch({ seedBaselines: [V1_BASELINE], seedChanges: [NO_VERSION_CHANGE] });
    const { container } = renderDetail(BASE_PKG, { baselines: [V1_BASELINE], scopeChanges: [NO_VERSION_CHANGE] });
    await act(async () => { approveButton(container).click(); });
    await act(async () => {});
    expect(approveEditor(container)).not.toBeNull();
    expect(approveEditor(container).value).toBe(JSON.stringify(V1_MEMBERSHIP, null, 2));
    expect(decideRequests).toHaveLength(0);
  });
});

describe("WorkPackageDetailClient D4 dashboard drill", () => {
  const PIPEFITTER_STEP = {
    id: "forge_wps_1", workPackageId: "forge_wp_1", title: "Fabricate pipe spool",
    description: "Shop work", sequenceNo: 1, craftKey: "pipefitter", craftLabel: "Pipefitter",
    plannedDurationDays: 3, plannedPersonHours: 24.5, sourceNote: null,
    supersedesStepId: null, version: 1, retiredAt: null, retiredBy: null,
    createdBy: "user_1", updatedBy: "user_1", createdAt: "t1", updatedAt: "t1",
  };
  const WELDER_STEP = {
    ...PIPEFITTER_STEP, id: "forge_wps_2", title: "Install supports", description: null,
    sequenceNo: 2, craftKey: "welder", craftLabel: "Welder",
    plannedDurationDays: 2, plannedPersonHours: 16, sourceNote: null,
  };

  it("drills a dashboard craft row to the filtered Work steps tab and back", async () => {
    clearSWRCache();
    stubFetch({ steps: [PIPEFITTER_STEP, WELDER_STEP] });
    const { container } = renderDetail(BASE_PKG, { ownerId: "owner_1" });
    await settle();
    await settle();
    await settle();
    const dashboard = container.querySelector("#package-dashboard");
    expect(dashboard).not.toBeNull();
    expect(dashboard.textContent).toContain("WP-0001");
    const pipefitter = [...dashboard.querySelectorAll('[data-testid="dashboard-planning"] button')]
      .find((b) => b.textContent.includes("Pipefitter"));
    expect(pipefitter).not.toBeUndefined();
    await act(async () => { pipefitter.click(); });
    await settle();
    await settle();
    expect(window.location.search).toContain("tab=steps");
    expect(window.location.search).toContain("detailFocus=craft%3Apipefitter");
    const banner = container.querySelector('[data-testid="steps-craft-filter-banner"]');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("Showing only Pipefitter — 1 of 2 steps.");
    // Back to dashboard clears the focus and the URL param.
    const back = [...container.querySelectorAll("button")].find((b) => b.textContent === "Back to dashboard");
    await act(async () => { back.click(); });
    await settle();
    expect(container.querySelector('[data-testid="steps-craft-filter-banner"]')).toBeNull();
    expect(window.location.search).not.toContain("detailFocus");
  });

  it("parses ?detailFocus= on load", async () => {
    clearSWRCache();
    stubFetch({ steps: [PIPEFITTER_STEP, WELDER_STEP] });
    const { container } = renderDetail(BASE_PKG, { ownerId: "owner_1", initialTab: "steps", initialDetailFocus: "craft:welder" });
    await settle();
    await settle();
    expect(container.querySelector('[data-testid="steps-craft-filter-banner"]').textContent)
      .toContain("Showing only Welder — 1 of 2 steps.");
  });

  it("ignores a junk detailFocus instead of filtering on it", async () => {
    clearSWRCache();
    stubFetch({ steps: [PIPEFITTER_STEP, WELDER_STEP] });
    const { container } = renderDetail(BASE_PKG, { ownerId: "owner_1", initialTab: "steps", initialDetailFocus: "craft:; drop table" });
    await settle();
    await settle();
    expect(container.querySelector('[data-testid="steps-craft-filter-banner"]')).toBeNull();
    expect(container.textContent).toContain("Fabricate pipe spool");
    expect(container.textContent).toContain("Install supports");
  });

  it("rejects a pattern-valid but nonexistent craft key from ?detailFocus= — full grid, no echo, focus cleared", async () => {
    clearSWRCache();
    stubFetch({ steps: [PIPEFITTER_STEP, WELDER_STEP] });
    // The real route carries the focus in the URL (page.jsx passes it
    // as initialDetailFocus); seed it the same way a shared link would.
    window.history.replaceState(null, "", "/forge/work/forge_wp_1?tab=steps&detailFocus=craft%3Aelectrician");
    const { container } = renderDetail(BASE_PKG, { ownerId: "owner_1", initialTab: "steps", initialDetailFocus: "craft:electrician" });
    await settle();
    await settle();
    await settle();
    expect(container.querySelector('[data-testid="steps-craft-filter-banner"]')).toBeNull();
    expect(container.textContent).toContain("Fabricate pipe spool");
    expect(container.textContent).toContain("Install supports");
    expect(container.textContent).not.toContain("electrician");
    expect(window.location.search).not.toContain("detailFocus");
  });
});

describe("E4 stale labor forecast (D4.1 fix round)", () => {
  // WP-0020 numbers from the disposable evidence pass: the Electrical
  // 8h→12h edit moved the Cost split "Planned labor forecast"
  // $2,136.00 → $2,492.00, but the dashboard only showed the new
  // figure after a navigation/reload. The forecast is server-computed
  // into the budget-allocation payload, so the dashboard can only
  // learn it when its budget read revalidates — and a step edit never
  // bumped the dashboard's refresh key, so the stale figure sat
  // until a remount. This test proves the fix: one deterministic
  // run with held/controlled responses and settled state, no remount.
  const ELECTRICAL_STEP = {
    id: "forge_wps_elec", workPackageId: "forge_wp_1", title: "Electrical",
    description: null, sequenceNo: 1, craftKey: "electrical", craftLabel: "Electrical",
    plannedDurationDays: 2, plannedPersonHours: 8, sourceNote: null,
    supersedesStepId: null, version: 1, retiredAt: null, retiredBy: null,
    createdBy: "user_1", updatedBy: "user_1", createdAt: "t1", updatedAt: "t1",
  };

  function allocationWithForecast(forecastCents) {
    return {
      packageCode: "WP-0001",
      packageTitle: "Turnover",
      packageStatus: "draft",
      notApplied: false,
      estimate: {
        id: "est_1", workPackageId: "forge_wp_1",
        originalControlEstimateCents: 10000000, currentControlEstimateCents: 10000000,
        contingencyCents: 500000, version: 1,
      },
      allocation: {
        id: "alloc_1", workPackageId: "forge_wp_1", controlEstimateId: "est_1",
        controlEstimateVersion: 1, allocatedTotalCents: 10000000, version: 1,
        lines: [
          { id: "l1", category: "labor", description: "Crew", amountCents: 5000000, sortOrder: 0 },
          { id: "l2", category: "material", description: "Pipe", amountCents: 5000000, sortOrder: 1 },
        ],
      },
      plannedLaborForecastCents: forecastCents,
    };
  }

  const CHANGE_SUMMARY_E4 = {
    summary: {
      hasEstimate: true, originalControlEstimateCents: 10000000,
      currentEstimateCents: 10000000, contingencyCents: 500000,
      runningContractPriceCents: 10000000, contingencyRemainingCents: 500000,
      laborCostCents: 213600, totalJobCostCents: 10000000,
      countsByStatus: {}, countedChangeOrderCount: 0,
      countedNonDeviationCents: 0, countedDeviationCents: 0,
      laborByCraft: [], stepsWithoutCraftHours: 0, totalsError: null, warnings: [],
    },
    changeOrders: [],
  };

  function tabButton(container, label) {
    return [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === label);
  }

  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function waitFor(check, rounds = 20) {
    for (let i = 0; i < rounds; i++) {
      try {
        check();
        return;
      } catch {
        await act(async () => {});
      }
    }
    check();
  }

  it("refreshes the Cost split Planned labor forecast to $2,492 after the Electrical 8h→12h edit, without a remount", async () => {
    clearSWRCache();
    const { budgetCalls, stepPatches } = stubFetch({
      steps: [ELECTRICAL_STEP],
      allocationBefore: allocationWithForecast(213600),
      allocationAfter: allocationWithForecast(249200),
      changeSummary: CHANGE_SUMMARY_E4,
    });
    const { container } = renderDetail(BASE_PKG, { ownerId: "owner_1" });
    // Baseline: the dashboard first paints the stale forecast.
    await waitFor(() => {
      expect(container.textContent).toContain("Planned labor forecast $2,136.00");
    });
    const budgetCallsBeforeEdit = budgetCalls.length;

    // Edit Electrical 8h → 12h through the Work steps grid (the same
    // cell commit the evidence pass used). The dashboard stays mounted
    // above the tabs the whole time — no remount, no navigation.
    await act(async () => { tabButton(container, "Work steps").click(); });
    await waitFor(() => {
      expect(container.querySelector('[aria-label="Planned hours for step 1"]')).not.toBeNull();
    });
    const hoursCell = container.querySelector('[aria-label="Planned hours for step 1"]');
    await act(async () => {
      hoursCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    const editor = container.querySelector('input[aria-label="Planned hours for step 1"]');
    expect(editor).not.toBeNull();
    setInputValue(editor, "12");
    await act(async () => {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await waitFor(() => {
      expect(container.textContent).toContain("Work step updated");
    });
    expect(stepPatches).toHaveLength(1);
    expect(stepPatches[0]).toMatchObject({ expectedVersion: 1, plannedPersonHours: 12 });
    const patchDoneAt = performance.now();

    // Settled state: the forecast refreshes on the still-mounted
    // dashboard, with no second navigation or reload.
    await waitFor(() => {
      expect(container.textContent).toContain("Planned labor forecast $2,492.00");
    });
    const forecastUpdatedAt = performance.now();
    const deltaMs = forecastUpdatedAt - patchDoneAt;
    // eslint-disable-next-line no-console
    console.info(`E4: forecast $2,136.00 → $2,492.00 in ${deltaMs.toFixed(0)} ms after the step PATCH; budget-allocation refetches after the edit: ${budgetCalls.length - budgetCallsBeforeEdit}`);
    expect(container.textContent).not.toContain("$2,136.00");
    expect(budgetCalls.length - budgetCallsBeforeEdit).toBeGreaterThan(0);
    expect(budgetCalls.some((c) => c.patched)).toBe(true);
    expect(deltaMs).toBeLessThan(5000);
  });
});

describe("Cancellation block (Slice A)", () => {
  const CANCEL_TRANSITION = {
    id: "t_cancel", from_status: "in_progress", to_status: "cancelled",
    reason: "Duplicate scope — superseded by WP-0001", at: "2026-11-05T10:00:00Z", actor: "owner_1",
  };
  it("shows the Cancellation block with date, actor, from-status, and the full reason", () => {
    const { container } = renderDetail(
      { ...BASE_PKG, owner_id: "owner_1", status: "cancelled" },
      { transitions: [CANCEL_TRANSITION] },
    );
    const text = container.textContent;
    expect(text).toContain("Cancellation");
    expect(text).toContain("Canceled on ");
    expect(text).toMatch(/Canceled on 11\/5\/2026/);
    expect(text).toContain("by Owner");
    expect(text).toContain("From in progress → Cancelled");
    expect(text).toContain("Reason: Duplicate scope — superseded by WP-0001");
  });
  it("labels a non-owner actor as User plus the first 8 id characters — never a fabricated name", () => {
    const { container } = renderDetail(
      { ...BASE_PKG, owner_id: "owner_1", status: "cancelled" },
      { transitions: [{ ...CANCEL_TRANSITION, actor: "e1b22131-9100-4a79-bbe2-b82d43af922e" }] },
    );
    expect(container.textContent).toContain("by User e1b22131");
  });
  it("uses the newest cancel row when several exist", () => {
    const older = { ...CANCEL_TRANSITION, id: "t_old", from_status: "draft", at: "2026-11-01T10:00:00Z", reason: "First cancel" };
    const { container } = renderDetail(
      { ...BASE_PKG, owner_id: "owner_1", status: "cancelled" },
      { transitions: [older, CANCEL_TRANSITION] },
    );
    const text = container.textContent;
    expect(text).toContain("Reason: Duplicate scope — superseded by WP-0001");
    expect(text).not.toContain("First cancel");
  });
  it("shows the legacy fallbacks when the cancel row is absent", () => {
    const { container } = renderDetail(
      { ...BASE_PKG, owner_id: "owner_1", status: "cancelled" },
      { transitions: [] },
    );
    const text = container.textContent;
    expect(text).toContain("Cancellation");
    expect(text).toContain("by Actor unavailable (legacy)");
    expect(text).toContain("Reason: No reason recorded");
    expect(text).not.toContain("From in progress");
  });
  it("shows no Cancellation block for a non-cancelled package, or a reopened one", () => {
    const draft = renderDetail(BASE_PKG, { transitions: [CANCEL_TRANSITION] });
    expect(draft.container.textContent).not.toContain("Cancellation");
    const reopened = renderDetail(
      { ...BASE_PKG, owner_id: "owner_1", status: "draft" },
      { transitions: [CANCEL_TRANSITION] },
    );
    expect(reopened.container.textContent).not.toContain("Cancellation");
  });
});

describe("Cancellation block hydration (Slice A fix round, React #418)", () => {
  // The cancellation instant sits across the UTC/Chicago midnight line:
  // 2026-11-05T02:30:00Z is 11/5/2026 2:30 AM in UTC but 11/4/2026
  // 8:30 PM in America/Chicago. A locale-dependent render therefore
  // produces different server and client markup — React #418. With the
  // default Overview tab and empty attestations/baselines, the
  // Cancellation block is the only locale-dependent timestamp in the
  // server tree, so this test isolates the Slice A occurrence.
  const CROSS_MIDNIGHT_CANCEL = {
    id: "t_cancel_x", from_status: "in_progress", to_status: "cancelled",
    reason: "Duplicate scope — superseded by WP-0001", at: "2026-11-05T02:30:00Z", actor: "owner_1",
  };
  it("renders server markup under UTC and hydrates under America/Chicago without mismatch", async () => {
    stubFetch();
    const pkg = { ...BASE_PKG, owner_id: "owner_1", status: "cancelled" };
    const element = (
      <WorkPackageDetailClient
        initial={{
          package: pkg,
          transitions: [CROSS_MIDNIGHT_CANCEL],
          attestations: [],
          baselines: [],
          currentBaseline: null,
          scopeChanges: [],
          observations: [],
        }}
        initialLinks={[]}
      />
    );
    const prevTz = process.env.TZ;
    const onRecoverableError = vi.fn();
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root = null;
    try {
      process.env.TZ = "UTC";
      const serverHtml = renderToString(element);
      // The pinned server representation is America/Chicago, so the
      // server markup already reads the Chicago date — not the UTC one.
      expect(serverHtml).toContain("11/4/2026, 8:30:00 PM");

      process.env.TZ = "America/Chicago";
      container.innerHTML = serverHtml;
      await act(async () => {
        root = hydrateRoot(container, element, { onRecoverableError });
        await Promise.resolve();
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      const hydrationErrors = consoleSpy.mock.calls.filter((args) =>
        String(args[0]).includes("hydrat"),
      );
      expect(hydrationErrors).toEqual([]);
      expect(container.textContent).toContain("Canceled on 11/4/2026, 8:30:00 PM");
    } finally {
      if (root) await act(async () => { root.unmount(); });
      container.remove();
      consoleSpy.mockRestore();
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});
