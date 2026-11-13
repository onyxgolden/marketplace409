// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PLANNING_PROCESS_TEMPLATE,
  computePlanningProgress,
} from "@/domains/work-management/planningProcess.js";
import WorkPackagePlanningProcess from "./WorkPackagePlanningProcess.jsx";

function setupFetch({ canUpdate = true, canReview = false, listStatus = 200, listError = "", statusByKey = {} } = {}) {
  const template = PLANNING_PROCESS_TEMPLATE.map((t) => ({
    stepKey: t.stepKey,
    version: 1,
    stepNumber: t.stepNumber,
    sortOrder: t.stepNumber,
    name: t.name,
    role: t.role,
    creditPct: t.creditPct,
    mhrsStandard: t.mhrsStandard,
    description: t.description,
    provenance: "pdf",
  }));
  const defaultStatus = (stepKey) =>
    statusByKey[stepKey] || (["pdf-01", "pdf-02", "pdf-03"].includes(stepKey) ? "Complete" : "In-Progress");
  const instances = template.map((t) => ({
    id: `inst_${t.stepKey}`,
    workPackageId: "pkg_1",
    templateVersion: 1,
    templateStepId: t.stepKey,
    status: defaultStatus(t.stepKey),
    evidenceLink: statusByKey[`${t.stepKey}:evidence`] ?? null,
    reviewedBy: null,
    reviewedAt: null,
    submittedBy: null,
    version: 1,
    updatedBy: "user_9",
    updatedAt: "2026-11-12T00:00:00Z",
  }));
  const revisions = [{
    id: "forge_ppr_1", instanceId: "inst_pdf-01", workPackageId: "pkg_1", templateStepId: "pdf-01",
    actorId: "user_9", action: "status_change", oldStatus: "In-Progress", newStatus: "Complete",
    reason: null, evidenceReference: "https://example.com/p-id.pdf", evidenceDigest: "0123456789abcdef0123456789abcdef",
    attestation: null, isOverride: false, requestId: "req_1",
    oldValues: { status: "In-Progress" }, newValues: { status: "Complete" },
    recordedAt: "2026-11-12T10:00:00Z",
  }];
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    const parsed = new URL(url, "https://test");
    if (parsed.pathname === "/api/work-packages/pkg_1/planning-process" && !options.method) {
      if (listStatus !== 200) {
        return { ok: false, status: listStatus, json: async () => ({ error: listError }) };
      }
      const progress = computePlanningProgress({ template, instances, complexity: "standard" });
      return {
        ok: true,
        json: async () => ({
          checklist: {
            packageId: "pkg_1", complexity: "standard", templateVersion: 1, canUpdate, canReview,
            constructionReadiness: {
              status: "not_established",
              detail: "No package-level release decision exists yet. Planning percent never authorizes construction or releases an IFC drawing.",
            },
            template, instances, progress,
          },
        }),
      };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/planning-process" && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      const inst = instances.find((i) => i.templateStepId === body.templateStepId);
      if (body.status === "Reviewed" && !canReview) {
        return { ok: false, status: 403, json: async () => ({ error: "Only a reviewer can mark a step Reviewed." }) };
      }
      if (body.status === "Complete" && !body.evidenceLink && !body.attestation && !inst.evidenceLink) {
        return { ok: false, status: 400, json: async () => ({ error: "Marking a step Complete needs an evidence link or a completion attestation." }) };
      }
      if ((body.status === "N/A" || body.status === "Needs Revision") && !body.reason) {
        return { ok: false, status: 400, json: async () => ({ error: "This change needs a reason." }) };
      }
      inst.status = body.status;
      if (body.evidenceLink !== undefined) inst.evidenceLink = body.evidenceLink || null;
      inst.version += 1;
      if (body.status === "Reviewed") { inst.reviewedBy = "user_9"; inst.reviewedAt = "2026-11-12T11:00:00Z"; }
      return { ok: true, json: async () => ({ instance: { ...inst } }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/planning-process/revisions") {
      return { ok: true, json: async () => ({ revisions }) };
    }
    return { ok: false, status: 404, json: async () => ({ error: "Not found." }) };
  }));
  return { calls, template, instances, revisions };
}

let root;
let container;
async function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<WorkPackagePlanningProcess packageId="pkg_1" />);
  });
}

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  container?.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// React tracks input values: set through the native setter so onChange fires.
function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pickStatus(name, status) {
  const select = container.querySelector(`select[aria-label="Status for ${name}"]`);
  expect(select).not.toBeNull();
  return act(async () => {
    select.value = status;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("WorkPackagePlanningProcess", () => {
  it("renders exactly 22 rows with the computed 15% progress (steps 1-3 Complete)", async () => {
    setupFetch();
    await render();
    expect(container.textContent).toContain("15%");
    expect(container.textContent).toContain("Earned 6 of 40 planning hours");
    expect(container.textContent).toContain("P & I.D. / MFD");
    expect(container.textContent).toContain("MOC Ready");
    expect(container.textContent).not.toContain("Phase 0");
    expect(container.textContent).not.toContain("Scope Package Development");
    const badges = [...container.querySelectorAll("span")].filter((s) => s.textContent === "Reporting only");
    expect(badges).toHaveLength(11);
    expect(container.querySelectorAll("select").length).toBe(22);
    // F1: below 100% the standing note shows; no ready badge.
    expect(container.textContent).toContain("never authorizes construction");
    expect(container.textContent).not.toContain("construction readiness not established");
  });

  it("at 100% shows 'Planning 100% — construction readiness not established', never a ready badge", async () => {
    const weightedComplete = Object.fromEntries(
      PLANNING_PROCESS_TEMPLATE.filter((t) => t.creditPct > 0).map((t) => [t.stepKey, "Complete"]),
    );
    setupFetch({ statusByKey: weightedComplete });
    await render();
    expect(container.textContent).toContain("100%");
    expect(container.textContent).toContain("Planning 100% — construction readiness not established.");
    expect(container.textContent).not.toContain("ready for construction");
    expect(container.textContent).not.toContain("Ready to build");
  });

  it("changing a status opens a confirm panel; confirming PATCHes with version + request ID and reports the new percent", async () => {
    const { calls } = setupFetch();
    await render();
    await pickStatus("Job Plan Developed", "Complete");
    // The panel appears; nothing is written yet.
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(container.textContent).toContain("Change to Complete");
    const evidence = container.querySelector('input[aria-label="Change evidence link for Job Plan Developed"]');
    expect(evidence).not.toBeNull();
    await act(async () => { setInputValue(evidence, "https://example.com/job-plan.pdf"); });
    const confirm = [...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm change");
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch).toBeDefined();
    const body = JSON.parse(patch.body);
    expect(body.templateStepId).toBe("pdf-15");
    expect(body.status).toBe("Complete");
    expect(body.evidenceLink).toBe("https://example.com/job-plan.pdf");
    expect(body.expectedVersion).toBe(1);
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(container.textContent).toContain('Step "Job Plan Developed" marked Complete');
    // 15% + 15% (step 15) = 30%
    expect(container.textContent).toContain("planning progress is now 30%");
  });

  it("Complete without evidence or attestation cannot be confirmed", async () => {
    setupFetch();
    await render();
    await pickStatus("Job Plan Developed", "Complete");
    const confirm = [...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm change");
    expect(confirm.disabled).toBe(true);
    expect(container.textContent).toContain("needs an evidence link or a completion attestation");
  });

  it("N/A needs a reason in the panel before confirming", async () => {
    const { calls } = setupFetch();
    await render();
    await pickStatus("Engineering Request", "N/A");
    const confirm = [...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm change");
    expect(confirm.disabled).toBe(true);
    const reason = container.querySelector('input[aria-label="Reason for Engineering Request"]');
    await act(async () => { setInputValue(reason, "No engineering request needed on this package."); });
    await act(async () => { confirm.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(JSON.parse(patch.body).reason).toBe("No engineering request needed on this package.");
    expect(container.textContent).toContain('Step "Engineering Request" marked N/A');
  });

  it("returning from Needs Revision starts with an empty evidence field — a stored link is not fresh evidence", async () => {
    setupFetch({
      statusByKey: { "pdf-15": "Needs Revision", "pdf-15:evidence": "https://example.com/job-plan-v1.pdf" },
    });
    await render();
    await pickStatus("Job Plan Developed", "Complete");
    expect(container.textContent).toContain("fresh evidence is needed after a send-back");
    const evidence = container.querySelector('input[aria-label="Change evidence link for Job Plan Developed"]');
    expect(evidence.value).toBe("");
    const confirm = [...container.querySelectorAll("button")].find((b) => b.textContent === "Confirm change");
    expect(confirm.disabled).toBe(true);
    await act(async () => { setInputValue(evidence, "https://example.com/job-plan-v2.pdf"); });
    expect(confirm.disabled).toBe(false);
  });

  it("disables the Reviewed option when the caller cannot review", async () => {
    setupFetch({ canUpdate: true, canReview: false });
    await render();
    const select = container.querySelector('select[aria-label="Status for Job Plan Developed"]');
    const reviewed = [...select.options].find((o) => o.value === "Reviewed");
    expect(reviewed.disabled).toBe(true);
    expect(container.textContent).toContain("only a reviewer can mark a step Reviewed");
  });

  it("disables all status changes when the caller cannot update", async () => {
    setupFetch({ canUpdate: false, canReview: false });
    await render();
    const selects = container.querySelectorAll("select");
    expect([...selects].every((s) => s.disabled)).toBe(true);
    expect(container.textContent).toContain("You can view this checklist but not change it");
  });

  it("shows the not-applied empty state instead of crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => ({ notApplied: true, checklist: null }),
    })));
    await render();
    expect(container.textContent).toContain("database change for this feature hasn't been applied");
  });

  it("shows an error with a retry button when loading fails", async () => {
    setupFetch({ listStatus: 500, listError: "Database is down." });
    await render();
    expect(container.textContent).toContain("Database is down.");
    expect(container.querySelector("button")?.textContent).toContain("Try again");
  });

  it("keeps status history closed by default and loads it only when opened", async () => {
    const { calls } = setupFetch();
    await render();
    expect(container.textContent).not.toContain("In-Progress → Complete");
    expect(calls.some((c) => c.url.includes("/revisions"))).toBe(false);
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Show history");
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(calls.some((c) => c.url.includes("/revisions"))).toBe(true);
    expect(container.textContent).toContain("P & I.D. / MFD");
    expect(container.textContent).toContain("In-Progress → Complete");
    expect(container.textContent).toContain("2026-11-12 10:00:00 UTC");
    expect(container.textContent).toContain("by user_9");
  });
});
