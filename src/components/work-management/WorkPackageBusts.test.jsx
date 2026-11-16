// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkPackageBusts from "./WorkPackageBusts.jsx";

const CANDIDATE = {
  dimension: "LABOR_COST",
  scopeType: "PACKAGE",
  takeoffLineId: null,
  workStepId: null,
  craft: null,
  workDate: null,
  shiftKey: null,
  baselineId: "base_1",
  baselineVersion: 1,
  plannedValue: 1000000,
  observedValue: 1250000,
  varianceValue: 250000,
  variancePercent: 25,
  unit: "USD_CENTS",
  comparisonAsOf: "2026-11-15",
  sourceFingerprint: "fp_cost_1",
  targetLabel: "Whole package",
  suggestedEvidenceSummary: "Actual cost $12,500.50 against a $10,000.00 frozen baseline.",
  alreadyRecorded: false,
  alreadyRecordedBustId: null,
};

const BUST = {
  id: "forge_wpbust_1",
  status: "OPEN",
  dimension: "LABOR_COST",
  scopeType: "PACKAGE",
  targetLabel: "Whole package",
  plannedValue: 1000000,
  observedValue: 1250000,
  varianceValue: 250000,
  variancePercent: 25,
  unit: "USD_CENTS",
  comparisonAsOf: "2026-11-15",
  baselineVersion: 1,
  evidenceSummary: "Actual cost is over the frozen baseline.",
  evidenceRef: null,
  version: 1,
  createdAt: "2026-11-15T10:00:00Z",
};

const DETAIL = {
  bust: BUST,
  revisions: [{
    id: "forge_wpbustr_1", version: 1, action: "create",
    reason: "Bust recorded", recordedAt: "2026-11-15T10:00:00Z",
    oldValues: {}, newValues: { status: "OPEN" },
  }],
  links: [{
    id: "forge_wpbustco_1", changeOrderId: "co_2",
    changeOrderNumber: 2, changeOrderStatus: "approved", unlinkedAt: null, version: 1,
  }],
  activeLinks: [{
    id: "forge_wpbustco_1", changeOrderId: "co_2",
    changeOrderNumber: 2, changeOrderStatus: "approved", unlinkedAt: null, version: 1,
  }],
};

const ORDER = {
  id: "co_2", changeOrderNumber: 2, description: "Cover the overrun", status: "approved",
};

function stubFetch(pkgId, {
  candidates = [CANDIDATE],
  busts = [BUST],
  total = 1,
  packageStatus = "in_progress",
  baseline = { id: "base_2", versionNumber: 2 },
  insufficiencies = [{ dimension: "MANPOWER_SHORTFALL", reason: "No assignments on file for 2026-11-09." }],
  targets = { takeoffLines: [], steps: [] },
  detail = DETAIL,
  changeOrders = [ORDER],
} = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    if (url === `/api/work-packages/${pkgId}/busts` && options.method === "POST") {
      const created = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          bust: { ...BUST, id: "forge_wpbust_new", version: 1, ...created, evidenceSummary: created.evidenceSummary },
        }),
      };
    }
    if (url === `/api/work-packages/${pkgId}/busts/candidates`) {
      return {
        ok: true,
        json: async () => ({
          packageId: pkgId, packageStatus, asOf: "2026-11-15",
          baseline, controlEstimate: null, candidates, insufficiencies, targets,
        }),
      };
    }
    if (url.startsWith(`/api/work-packages/${pkgId}/busts?`)) {
      return { ok: true, json: async () => ({ busts, total, limit: 100, offset: 0 }) };
    }
    if (url === `/api/work-packages/${pkgId}/busts/${BUST.id}`) {
      return { ok: true, json: async () => detail };
    }
    if (url === `/api/work-packages/${pkgId}/change-orders`) {
      return { ok: true, json: async () => ({ changeOrders, packageStatus }) };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls };
}

function renderPanel(pkgId) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkPackageBusts packageId={pkgId} />);
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectValue(select, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function setTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickButton(container, text) {
  const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
  expect(button).not.toBe(undefined);
  return act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkPackageBusts", () => {
  it("renders the candidate, the recorded bust, and the insufficiency", async () => {
    stubFetch("pkg_1");
    const { container } = renderPanel("pkg_1");
    await settle();
    const text = container.textContent;
    expect(text).toContain("Busts");
    expect(text).toContain("Detected — needs review");
    expect(text).toContain("Labor cost");
    expect(text).toContain("Whole package");
    expect(text).toContain("$2,500.00 over");
    expect(text).toContain("Manpower shortfall");
    expect(text).toContain("No assignments on file for 2026-11-09.");
    expect(text).toContain("Recorded busts (1)");
    expect(text).toContain("Actual cost is over the frozen baseline.");
    expect(text).toContain("Open");
    expect(text).toContain("Record a bust manually");
  });

  it("confirms a candidate through POST with the candidate's figures and shows the confirmation", async () => {
    const { calls } = stubFetch("pkg_2");
    const { container } = renderPanel("pkg_2");
    await settle();
    await clickButton(container, "Confirm bust");
    await settle();
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/work-packages/pkg_2/busts");
    expect(post).toBeDefined();
    expect(post.body).toEqual(expect.objectContaining({
      dimension: "LABOR_COST",
      scopeType: "PACKAGE",
      baselineId: "base_1",
      baselineVersion: 1,
      plannedValue: 1000000,
      observedValue: 1250000,
      unit: "USD_CENTS",
      evidenceSummary: "Actual cost $12,500.50 against a $10,000.00 frozen baseline.",
      comparisonAsOf: "2026-11-15",
      sourceFingerprint: "fp_cost_1",
      requestId: expect.any(String),
    }));
    expect(container.textContent).toContain("Bust recorded — Labor cost is open for review.");
  });

  it("shows an already-recorded candidate with no confirm button", async () => {
    stubFetch("pkg_3", {
      candidates: [{ ...CANDIDATE, alreadyRecorded: true, alreadyRecordedBustId: BUST.id }],
    });
    const { container } = renderPanel("pkg_3");
    await settle();
    expect(container.textContent).toContain("already recorded — see below");
    expect(container.textContent).toContain("Already recorded as an open bust — confirming again would duplicate it.");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent.trim() === "Confirm bust")).toBe(false);
  });

  it("records a manual labor-cost bust in dollars and sends whole cents", async () => {
    const { calls } = stubFetch("pkg_4", { candidates: [], busts: [], total: 0 });
    const { container } = renderPanel("pkg_4");
    await settle();
    await clickButton(container, "Record a bust");
    await settle();
    setSelectValue(container.querySelector("#manual-dimension"), "LABOR_COST");
    await settle();
    setInputValue(container.querySelector("#manual-planned"), "10000");
    setInputValue(container.querySelector("#manual-observed"), "12500");
    setTextareaValue(container.querySelector("#manual-evidence"), "Verified against the signed timesheets for week 46.");
    await clickButton(container, "Record bust");
    await settle();
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/work-packages/pkg_4/busts");
    expect(post).toBeDefined();
    expect(post.body).toEqual(expect.objectContaining({
      dimension: "LABOR_COST",
      scopeType: "PACKAGE",
      baselineId: "base_2",
      baselineVersion: 2,
      plannedValue: 1000000,
      observedValue: 1250000,
      unit: "USD_CENTS",
      evidenceSummary: "Verified against the signed timesheets for week 46.",
    }));
    expect(container.textContent).toContain("Bust recorded — Labor cost is open for review.");
  });

  it("keeps the manual Record bust button disabled until the evidence is long enough", async () => {
    stubFetch("pkg_5", { candidates: [], busts: [], total: 0 });
    const { container } = renderPanel("pkg_5");
    await settle();
    await clickButton(container, "Record a bust");
    await settle();
    const button = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === "Record bust");
    expect(button.disabled).toBe(true);
    setInputValue(container.querySelector("#manual-planned"), "400");
    setInputValue(container.querySelector("#manual-observed"), "440.5");
    setTextareaValue(container.querySelector("#manual-evidence"), "Too short");
    await settle();
    expect(button.disabled).toBe(true);
    setTextareaValue(container.querySelector("#manual-evidence"), "Confirmed against the signed timesheets.");
    await settle();
    expect(button.disabled).toBe(false);
  });

  it("expands a recorded bust to show its history and linked change order", async () => {
    stubFetch("pkg_6", { candidates: [] });
    const { container } = renderPanel("pkg_6");
    await settle();
    await clickButton(container, "Detail");
    await settle();
    const text = container.textContent;
    expect(text).toContain("History");
    expect(text).toContain("Recorded");
    expect(text).toContain("Bust recorded");
    expect(text).toContain("Linked change orders");
    expect(text).toContain("Change order 2 (approved)");
    expect(text).toContain("Move bust to");
  });

  it("pauses Resolved by change: shows the reason and disables the move without posting", async () => {
    const { calls } = stubFetch("pkg_6", { candidates: [] });
    const { container } = renderPanel("pkg_6");
    await settle();
    await clickButton(container, "Detail");
    await settle();
    setSelectValue(container.querySelector(`#transition-${BUST.id}`), "RESOLVED_BY_CHANGE");
    await settle();
    // Fill every other field, so only the pause can be blocking it.
    setInputValue(container.querySelector(`#disposition-${BUST.id}`), "Resolved by the approved change.");
    setInputValue(container.querySelector(`#transition-reason-${BUST.id}`), "Closing the bust.");
    await settle();
    expect(container.textContent).toContain("Resolved by change is paused");
    expect(container.textContent).toContain("must stay open or under review");
    expect(container.textContent).toContain("only if it is actually true");
    expect(container.textContent).not.toContain("Use Accepted overrun");
    expect(container.textContent).not.toContain("uses the current frozen baseline");
    const move = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === "Move bust");
    expect(move.disabled).toBe(true);
    // No transition POST was made — the paused move is not submittable.
    expect(calls.some((c) => c.method === "POST" && String(c.url).includes("/transition"))).toBe(false);
  });

  it("is read-only on a closed package: notice, no confirm, no manual form", async () => {
    stubFetch("pkg_7", { packageStatus: "cancelled" });
    const { container } = renderPanel("pkg_7");
    await settle();
    expect(container.textContent).toContain("This work package is closed — busts are read-only.");
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent.trim() === "Confirm bust")).toBe(false);
    expect(container.textContent).not.toContain("Record a bust manually");
  });
});
