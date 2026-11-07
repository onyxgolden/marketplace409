// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackageSteps from "./WorkPackageSteps.jsx";

const STEP_1 = {
  id: "forge_wps_1", workPackageId: "pkg_1", title: "Fabricate pipe spool",
  description: "Shop work", sequenceNo: 1, craftKey: "pipefitter", craftLabel: "Pipefitter",
  plannedDurationDays: 3, plannedPersonHours: 24.5, sourceNote: "Per P&ID rev C",
  supersedesStepId: null, version: 1, retiredAt: null, retiredBy: null,
  createdBy: "user_1", updatedBy: "user_1", createdAt: "t1", updatedAt: "t1",
};
const STEP_2 = {
  ...STEP_1, id: "forge_wps_2", title: "Install supports", description: null,
  sequenceNo: 2, craftKey: "welder", craftLabel: "Welder",
  plannedDurationDays: 2, plannedPersonHours: 16, sourceNote: null,
};
const RETIRED_STEP = {
  ...STEP_1, id: "forge_wps_3", title: "Old plan", sequenceNo: 3,
  craftLabel: null, craftKey: null, plannedDurationDays: null, plannedPersonHours: null,
  sourceNote: null, description: null, version: 2, retiredAt: "t2", retiredBy: "user_1",
};
const DRAWINGS = [
  { id: "dwg_1", drawingNumber: "P-101", drawingType: "p_id", title: "Main line" },
  { id: "dwg_2", drawingNumber: "C-201", drawingType: "cut_sheet", title: "Spool sheet" },
];
const LINK_1 = {
  id: "forge_wpsl_1", stepId: "forge_wps_1", drawingId: "dwg_1", originalDrawingId: "dwg_1",
  refinementNote: "Per P&ID rev C", version: 1, retiredAt: null, retiredBy: null,
  createdBy: "user_1", createdAt: "t1", drawing: DRAWINGS[0],
};
const DAY_TOTALS = [{ workDate: "2026-11-09", plannedPersonHours: 48, assignmentCount: 1 }];
const REVISIONS = [{
  id: "forge_wpsr_1", version: 1, action: "create", recordedAt: "2026-11-07T10:00:00Z",
  reason: null, oldValues: null,
  newValues: { title: "Fabricate pipe spool", sequence_no: 1, version: 1 },
}];

function setupFetch({ list = [STEP_1, STEP_2], revisions = REVISIONS, listStatus = 200, listError = "" } = {}) {
  let currentSteps = list.map((s) => ({ ...s }));
  let generation = 2;
  let links = [LINK_1].filter((l) => list.some((s) => s.id === l.stepId));
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    const parsed = new URL(url, "https://test");
    const base = "/api/work-packages/pkg_1/work-steps";
    const renumber = () => {
      currentSteps.filter((s) => !s.retiredAt)
        .sort((a, b) => a.sequenceNo - b.sequenceNo)
        .forEach((s, i) => { s.sequenceNo = i + 1; });
    };
    if (parsed.pathname === base && !options.method) {
      if (listStatus !== 200) {
        return { ok: false, status: listStatus, json: async () => ({ error: listError }) };
      }
      const includeRetired = parsed.searchParams.get("includeRetired") === "true";
      const rows = includeRetired ? currentSteps : currentSteps.filter((s) => !s.retiredAt);
      return { ok: true, json: async () => ({ steps: rows, generation, packageStatus: "in_progress" }) };
    }
    if (parsed.pathname === base && options.method === "POST") {
      const body = JSON.parse(options.body);
      const active = currentSteps.filter((s) => !s.retiredAt);
      const position = body.insertAt ?? active.length + 1;
      const created = {
        ...STEP_1, id: "forge_wps_new", title: body.title, description: body.description ?? null,
        craftLabel: body.craftLabel ?? null, craftKey: body.craftLabel ? body.craftLabel.toLowerCase() : null,
        plannedDurationDays: body.plannedDurationDays ?? null,
        plannedPersonHours: body.plannedPersonHours ?? null,
        sourceNote: body.sourceNote ?? null, supersedesStepId: body.supersedesStepId ?? null,
        sequenceNo: position, version: 1, retiredAt: null,
      };
      active.splice(position - 1, 0, created);
      currentSteps = [...active, ...currentSteps.filter((s) => s.retiredAt)];
      renumber();
      generation += 1;
      return { ok: true, json: async () => ({ step: created }) };
    }
    if (parsed.pathname === `${base}/reorder` && options.method === "POST") {
      const body = JSON.parse(options.body);
      const byId = new Map(currentSteps.map((s) => [s.id, s]));
      const ordered = body.stepIds.map((id) => byId.get(id));
      ordered.forEach((s, i) => { s.sequenceNo = i + 1; });
      currentSteps = [...ordered, ...currentSteps.filter((s) => s.retiredAt)];
      generation += 1;
      return { ok: true, json: async () => ({ steps: ordered, generation }) };
    }
    const stepMatch = parsed.pathname.match(/^\/api\/work-packages\/pkg_1\/work-steps\/([^/]+)$/);
    if (stepMatch && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      const step = currentSteps.find((s) => s.id === stepMatch[1]);
      // Mirror the backend presence semantics: a key present with
      // null clears the stored value, an absent key preserves it.
      const updated = {
        ...step,
        title: body.title ?? step.title,
        description: "description" in body ? body.description : step.description,
        craftLabel: "craftLabel" in body ? body.craftLabel : step.craftLabel,
        craftKey: "craftLabel" in body
          ? (body.craftLabel ? body.craftLabel.toLowerCase().replace(/ /g, "-") : null)
          : step.craftKey,
        plannedDurationDays: "plannedDurationDays" in body ? body.plannedDurationDays : step.plannedDurationDays,
        plannedPersonHours: "plannedPersonHours" in body ? body.plannedPersonHours : step.plannedPersonHours,
        sourceNote: "sourceNote" in body ? body.sourceNote : step.sourceNote,
        version: step.version + 1,
      };
      currentSteps = currentSteps.map((s) => (s.id === step.id ? updated : s));
      return { ok: true, json: async () => ({ step: updated }) };
    }
    if (parsed.pathname === `${base}/forge_wps_1/retire` && options.method === "POST") {
      const step = currentSteps.find((s) => s.id === "forge_wps_1");
      const retired = { ...step, version: step.version + 1, retiredAt: "t2", retiredBy: "user_1" };
      currentSteps = currentSteps.map((s) => (s.id === step.id ? retired : s));
      renumber();
      generation += 1;
      return { ok: true, json: async () => ({ step: retired }) };
    }
    if (parsed.pathname === `${base}/forge_wps_1/revisions`) {
      return { ok: true, json: async () => ({ step: currentSteps.find((s) => s.id === "forge_wps_1"), revisions }) };
    }
    if (parsed.pathname === `${base}/forge_wps_1/drawings` && !options.method) {
      return { ok: true, json: async () => ({ links }) };
    }
    if (parsed.pathname === `${base}/forge_wps_1/drawings` && options.method === "POST") {
      const body = JSON.parse(options.body);
      const drawing = DRAWINGS.find((d) => d.id === body.drawingId);
      const created = {
        id: "forge_wpsl_new", stepId: "forge_wps_1", drawingId: body.drawingId,
        originalDrawingId: body.drawingId, refinementNote: body.refinementNote ?? null,
        version: 1, retiredAt: null, retiredBy: null, createdBy: "user_1", createdAt: "t1",
        drawing,
      };
      links = [...links, created];
      return { ok: true, json: async () => ({ link: created }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings" && !options.method) {
      return { ok: true, json: async () => ({ drawings: DRAWINGS }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/craft-assignments" && !options.method) {
      return { ok: true, json: async () => ({ dayTotals: DAY_TOTALS }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/progress/summary" && !options.method) {
      return {
        ok: true,
        json: async () => ({
          summary: {
            packageId: "pkg_1", asOf: "2026-11-07",
            lines: [{ lineId: "tl_1" }, { lineId: "tl_2" }],
            package: { aggregatePercent: 40 },
          },
        }),
      };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls, getSteps: () => currentSteps, getLinks: () => links };
}

async function renderPanel(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<WorkPackageSteps packageId="pkg_1" {...props} />);
  });
  await act(async () => {});
  return { container, root };
}

function buttonByText(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
}

function setInput(container, labelText, value) {
  const inputs = [...container.querySelectorAll("input, select")];
  const input = inputs.find((el) => el.getAttribute("aria-label") === labelText)
    || inputs.find((el) => el.placeholder === labelText)
    || inputs.find((el) => container.querySelector(`label[for="${el.id}"]`)?.textContent.includes(labelText));
  if (!input) throw new Error(`no input for ${labelText}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      input.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

async function submitForm(container, submitButtonText = null) {
  const form = submitButtonText
    ? buttonByText(container, submitButtonText)?.closest("form")
    : container.querySelector("form");
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

async function waitFor(check) {
  for (let i = 0; i < 10; i++) {
    try {
      check();
      return;
    } catch {
      await act(async () => {});
    }
  }
  check();
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSWRCache();
  document.body.innerHTML = "";
});

describe("WorkPackageSteps", () => {
  it("renders steps in schedule order with estimates and package context", async () => {
    setupFetch();
    const { container } = await renderPanel();
    expect(container.textContent).toContain("#1 Fabricate pipe spool");
    expect(container.textContent).toContain("#2 Install supports");
    expect(container.textContent).toContain("Planned 3 days");
    expect(container.textContent).toContain("Planned 24.5 person-hours");
    expect(container.textContent).toContain("Planned crew (from craft assignments)");
    expect(container.textContent).toContain("48 person-hours");
    expect(container.textContent).toContain("Takeoff progress (from progress entries)");
    expect(container.textContent).toContain("40% installed across 2 takeoff lines");
  });

  it("creates a step and confirms it in plain words", async () => {
    const { calls } = setupFetch({ list: [] });
    const { container } = await renderPanel();
    setInput(container, "Step title", "Set pipe");
    setInput(container, "Craft (optional)", "Welder");
    setInput(container, "Days (optional)", "2");
    setInput(container, "Person-hours (optional)", "16");
    await submitForm(container);
    expect(container.textContent).toContain("Work step added");
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/work-steps") && !c.url.includes("/reorder"));
    expect(JSON.parse(post.body)).toMatchObject({
      title: "Set pipe", craftLabel: "Welder", plannedDurationDays: 2, plannedPersonHours: 16,
    });
  });

  it("edits a step, clears the description, and keeps untouched fields", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Shop work");
    await act(async () => { buttonByText(container, "Edit").click(); });
    expect(container.querySelector('input[aria-label="Step title"]').value).toBe("Fabricate pipe spool");
    setInput(container, "Description", "");
    await submitForm(container, "Save changes");
    expect(container.textContent).toContain("Work step updated");
    const patch = calls.find((c) => c.method === "PATCH");
    const body = JSON.parse(patch.body);
    expect(body).toMatchObject({ expectedVersion: 1, description: null });
    expect(body).toMatchObject({ title: "Fabricate pipe spool", craftLabel: "Pipefitter" });
    await waitFor(() => {
      expect(container.textContent).not.toContain("Shop work");
      expect(container.textContent).toContain("Pipefitter");
    });
  });

  it("retires a step only with a reason", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Retire").click(); });
    expect(buttonByText(container, "Retire this step").disabled).toBe(true);
    setInput(container, "Reason for retiring", "No longer needed");
    await act(async () => { buttonByText(container, "Retire this step").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Work step retired");
    const retire = calls.find((c) => c.url.endsWith("/retire"));
    expect(JSON.parse(retire.body)).toMatchObject({ expectedVersion: 1, reason: "No longer needed" });
    // The retired step leaves the active list (its name still shows
    // in the confirmation and in the "Replaces" dropdown — both are
    // correct), and the next step closes the gap to #1.
    await waitFor(() => {
      const rows = [...container.querySelectorAll("ul.mt-4 > li")];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain("#1 Install supports");
    });
  });

  it("moves a step down and saves the new order with the generation guard", async () => {
    const { calls } = setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "↓ Move down").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Schedule order updated");
    const reorder = calls.find((c) => c.url.endsWith("/reorder"));
    expect(JSON.parse(reorder.body)).toMatchObject({
      stepIds: ["forge_wps_2", "forge_wps_1"],
      expectedGeneration: 2,
    });
    await waitFor(() => {
      expect(container.textContent).toContain("#1 Install supports");
      expect(container.textContent).toContain("#2 Fabricate pipe spool");
    });
  });

  it("shows history on demand", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "History").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Added");
    expect(container.textContent).toContain("version 1");
  });

  it("links a drawing to a step and shows it", async () => {
    const { calls } = setupFetch({ list: [STEP_2] });
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Drawings").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("No drawings linked yet.");
    setInput(container, "Drawing to link", "dwg_1");
    setInput(container, "Refinement note", "Per P&ID rev C");
    await submitForm(container, "Link drawing");
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/drawings"));
    expect(JSON.parse(post.body)).toMatchObject({ drawingId: "dwg_1", refinementNote: "Per P&ID rev C" });
    await waitFor(() => {
      expect(container.textContent).toContain("P-101 (p_id)");
    });
  });

  it("shows a linked drawing from the start", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await act(async () => { buttonByText(container, "Drawings").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("P-101 (p_id) — Main line");
    expect(container.textContent).toContain("Per P&ID rev C");
  });

  it("hides retired steps unless asked, and offers them as supersession candidates", async () => {
    setupFetch({ list: [STEP_1, STEP_2, RETIRED_STEP] });
    const { container } = await renderPanel();
    const stepRows = () => [...container.querySelectorAll("ul.mt-4 > li")];
    expect(container.textContent).toContain("Fabricate pipe spool");
    // The retired step is not a list row — though its name does
    // appear in the "Replaces" dropdown, which is how a replacement
    // step is authored.
    expect(stepRows().some((li) => li.textContent.includes("Old plan"))).toBe(false);
    await act(async () => {
      container.querySelector('input[type="checkbox"]').click();
    });
    await act(async () => {});
    expect(stepRows().some((li) => li.textContent.includes("Old plan"))).toBe(true);
    const supersedes = container.querySelector("#step-supersedes");
    expect(supersedes.textContent).toContain("#3 Old plan");
  });

  it("shows the plain-words unavailable message while the migration is unapplied", async () => {
    setupFetch({
      listStatus: 503,
      listError: "Work steps aren't available yet — the database change for this feature hasn't been applied.",
    });
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Work steps aren't available yet");
  });
});
