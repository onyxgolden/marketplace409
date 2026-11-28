// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkPackageFieldVerification, {
  FieldVerificationBadge,
  FieldVerificationSummary,
  useFieldVerificationBadges,
} from "./WorkPackageFieldVerification.jsx";

const VERIFICATION = {
  id: "forge_wpfv_1",
  workPackageId: "pkg_1",
  targetType: "WORK_STEP",
  stepId: "step_1",
  takeoffLineId: null,
  workLocation: "FIELD",
  inspectionDate: "2026-11-15",
  sourceCheckedAt: "2026-11-15T12:00:00Z",
  sourceStepVersion: 1,
  sourceDrawingRevisionId: null,
  sourceProgressEntryIds: null,
  progressAsOf: null,
  sourceProgressDigest: null,
  sourceProgressTotalQuantity: null,
  sourceFingerprint: "a".repeat(32),
  plannedStepHours: 40,
  plannedLineQuantity: null,
  unit: null,
  observedInstalledQuantity: null,
  observedBasis: null,
  physicalCompletion: "PARTIALLY_COMPLETE",
  acceptanceCriteriaChecked: null,
  fieldReportedHours: 42,
  fieldHoursSource: "Foreman daily log",
  observationNote: "Spool welded and aligned against IFC revision R2.",
  evidenceRef: "field-photo-2026-11-15-01.jpg",
  evidenceSummary: null,
  status: "DRAFT",
  version: 1,
  submittedBy: null,
  submittedAt: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  retiredAt: null,
  createdBy: "owner_1",
  createdAt: "2026-11-15T12:30:00Z",
  targetLabel: "Fabricate spool",
  targetRetired: false,
  sourceStatus: "CURRENT",
  variances: null,
  hoursDifference: { hoursVsPlan: 2, label: "OVER" },
};

const LINE_VERIFICATION = {
  ...VERIFICATION,
  id: "forge_wpfv_2",
  targetType: "TAKEOFF_LINE",
  stepId: null,
  takeoffLineId: "line_1",
  inspectionDate: "2026-11-14",
  sourceProgressEntryIds: ["entry_1"],
  progressAsOf: "2026-11-14",
  sourceProgressDigest: "b".repeat(32),
  sourceProgressTotalQuantity: 12.5,
  plannedStepHours: null,
  plannedLineQuantity: 10,
  unit: "EA",
  observedInstalledQuantity: 12.5,
  observedBasis: "Counted on the rack",
  physicalCompletion: null,
  fieldReportedHours: null,
  fieldHoursSource: null,
  status: "SUBMITTED",
  version: 2,
  submittedBy: "owner_1",
  submittedAt: "2026-11-14T15:00:00Z",
  targetLabel: "W-0005-1 — 10 EA",
  sourceStatus: "CHANGED_SINCE_REVIEW",
  variances: { varianceVsPlan: 2.5, varianceVsRecorded: 0, percentVsPlan: 25, percentVsRecorded: 0 },
  hoursDifference: null,
};

const LINE_DETAIL = {
  verification: LINE_VERIFICATION,
  revisions: [{
    id: "forge_wpfvr_2", version: 1, action: "create",
    reason: "First check", recordedAt: "2026-11-14T12:30:00Z",
    oldValues: {}, newValues: { status: "DRAFT" },
  }],
  links: [],
  activeLinks: [],
};

const DETAIL = {
  verification: VERIFICATION,
  revisions: [{
    id: "forge_wpfvr_1", version: 1, action: "create",
    reason: "First check", recordedAt: "2026-11-15T12:30:00Z",
    oldValues: {}, newValues: { status: "DRAFT" },
  }],
  links: [],
  activeLinks: [],
};

const SOURCES_STEP = {
  packageId: "pkg_1",
  packageStatus: "in_progress",
  asOf: "2026-11-15",
  targetType: "WORK_STEP",
  targetId: "step_1",
  targetLabel: "Fabricate spool",
  targetRetired: false,
  stepVersion: 1,
  plannedStepHours: 40,
  craftKey: "pipefitters",
  craftLabel: "Pipefitters",
  plannedLineQuantity: null,
  unit: null,
  drawingId: null,
  drawingNumber: null,
  latestRevision: null,
  progressAsOf: null,
  installedAsOf: null,
  progressEntryIds: null,
  sourceProgressDigest: null,
  sourceFingerprint: "a".repeat(32),
};

function stubFetch(pkgId, {
  verifications = [VERIFICATION, LINE_VERIFICATION],
  summary = { total: 2, draft: 1, submitted: 1, accepted: 0, returned: 0, rejected: 0, retired: 0, changedSinceReview: 1 },
  packageStatus = "in_progress",
  detail = DETAIL,
  sources = SOURCES_STEP,
  steps = [{ id: "step_1", title: "Fabricate spool" }],
  lines = [{ lineId: "line_1", drawingId: "dwg_1", lineNo: 1, description: "Spool", baselineQuantity: 10, baselineUnit: "EA", installed: 12.5 }],
  notApplied = false,
  listError = false,
} = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined });
    if (notApplied && url.includes("/field-verifications")) {
      // The real route returns a 503 carrying notApplied: true (FV-1:
      // fail() forwards the flag) — the list fetcher turns that into
      // { notApplied: true } data, so the panel renders its honest
      // "isn't available yet" state, not the red error branch.
      return { ok: false, status: 503, json: async () => ({ error: "Field verification isn't available yet — the database change for this feature hasn't been applied.", notApplied: true }) };
    }
    if (listError && url.startsWith(`/api/work-packages/${pkgId}/field-verifications?`)) {
      return { ok: false, status: 500, json: async () => ({ error: "Unable to complete the request." }) };
    }
    if (url === `/api/work-packages/${pkgId}/field-verifications` && options.method === "POST") {
      const created = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          verification: {
            ...VERIFICATION, id: "forge_wpfv_new", version: 1,
            targetType: created.targetType, stepId: created.stepId, takeoffLineId: created.takeoffLineId,
            observationNote: created.observationNote,
          },
        }),
      };
    }
    if (url.startsWith(`/api/work-packages/${pkgId}/field-verifications?`)) {
      return { ok: true, json: async () => ({ verifications, summary, total: verifications.length, limit: 100, offset: 0 }) };
    }
    if (url.startsWith(`/api/work-packages/${pkgId}/field-verifications/sources?`)) {
      return { ok: true, json: async () => sources };
    }
    if (url === `/api/work-packages/${pkgId}/field-verifications/${VERIFICATION.id}`) {
      return { ok: true, json: async () => detail };
    }
    if (url === `/api/work-packages/${pkgId}/field-verifications/${LINE_VERIFICATION.id}`) {
      return { ok: true, json: async () => LINE_DETAIL };
    }
    if (url === `/api/work-packages/${pkgId}/field-verifications/${VERIFICATION.id}/decision` && options.method === "POST") {
      return {
        ok: true,
        json: async () => ({ verification: { ...VERIFICATION, status: "SUBMITTED", version: 2, submittedBy: "owner_1" } }),
      };
    }
    if (url === `/api/work-packages/${pkgId}/field-verifications/badges`) {
      return { ok: true, json: async () => ({ byWorkStep: { step_1: { count: 1, statuses: ["DRAFT"] } }, byTakeoffLine: { line_1: { count: 1, statuses: ["SUBMITTED"] } } }) };
    }
    if (url.startsWith(`/api/work-packages/${pkgId}/work-steps?`)) {
      return { ok: true, json: async () => ({ steps, generation: 1, packageStatus }) };
    }
    if (url === `/api/work-packages/${pkgId}/progress/summary`) {
      return { ok: true, json: async () => ({ summary: { packageId: pkgId, asOf: "2026-11-15", lines } }) };
    }
    if (url.startsWith(`/api/work-packages/${pkgId}/busts?`)) {
      return { ok: true, json: async () => ({ busts: [], total: 0 }) };
    }
    if (url === `/api/work-packages/${pkgId}/change-orders`) {
      return { ok: true, json: async () => ({ changeOrders: [] }) };
    }
    if (url === `/api/work-packages/${pkgId}/drawings`) {
      return { ok: true, json: async () => ({ drawings: [] }) };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls };
}

function renderPanel(pkgId, props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<WorkPackageFieldVerification packageId={pkgId} {...props} />);
  });
  return { container, root };
}

async function settle() {
  await act(async () => {});
}

function clickButton(container, label) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  if (!button) throw new Error(`button "${label}" not found`);
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return button;
}

function setInputValue(container, id, value) {
  const input = container.querySelector(`#${id}`);
  if (!input) throw new Error(`input #${id} not found`);
  act(() => {
    const proto = input.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : input.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setSelectValue(container, id, value) {
  const select = container.querySelector(`#${id}`);
  if (!select) throw new Error(`select #${id} not found`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("WorkPackageFieldVerification", () => {
  it("renders the summary counts, the read-only wording, and the list with planned/observed/difference", async () => {
    stubFetch("pkg_1");
    const { container } = renderPanel("pkg_1");
    await settle();
    await settle();
    expect(container.textContent).toContain("Field verification records what was checked. It does not change recorded progress or the approved plan.");
    expect(container.textContent).toContain("Submitted 1");
    expect(container.textContent).toContain("Accepted 0");
    expect(container.textContent).toContain("Changed since review 1");
    expect(container.textContent).toContain("Fabricate spool");
    expect(container.textContent).toContain("Planned 40 hours");
    expect(container.textContent).toContain("W-0005-1 — 10 EA");
    expect(container.textContent).toContain("Observed 12.5 EA");
    expect(container.textContent).toContain("Changed since review");
  });

  it("shows the changed-source wording on a stale verification and the difference wording on a mismatch", async () => {
    stubFetch("pkg_1");
    const { container } = renderPanel("pkg_1");
    await settle();
    await settle();
    // Expand the line verification (second Detail button).
    const detailButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Detail");
    expect(detailButtons).toHaveLength(2);
    act(() => {
      detailButtons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    await settle();
    expect(container.textContent).toContain("This observation was checked against an earlier version. Review the updated source before confirming current work.");
    expect(container.textContent).toContain("A newer record is required to confirm changes made after this review.");
    expect(container.textContent).toContain("Recorded progress differs from the field observation. Review the progress entry separately.");
  });

  it("records a draft from the sources preview, passing the reviewed fingerprint back", async () => {
    const { calls } = stubFetch("pkg_1");
    const { container } = renderPanel("pkg_1");
    await settle();
    await settle();
    clickButton(container, "Record a verification");
    await settle();
    setSelectValue(container, "fv-target", "step_1");
    await settle();
    await settle();
    expect(container.textContent).toContain("Step version 1 · planned 40 hours");
    setInputValue(container, "fv-note", "Spool welded and aligned against IFC revision R2.");
    await settle();
    clickButton(container, "Record verification");
    await settle();
    await settle();
    const create = calls.find((c) => c.url === "/api/work-packages/pkg_1/field-verifications" && c.method === "POST");
    expect(create).toBeDefined();
    expect(create.body.sourceFingerprint).toBe("a".repeat(32));
    expect(create.body.targetType).toBe("WORK_STEP");
    expect(create.body.stepId).toBe("step_1");
    expect(create.body.physicalCompletion).toBe("PARTIALLY_COMPLETE");
    expect(container.textContent).toContain("Verification recorded as a draft");
  });

  it("submits a draft for review from the detail view", async () => {
    const { calls } = stubFetch("pkg_1");
    const { container } = renderPanel("pkg_1");
    await settle();
    await settle();
    const detailButtons = [...container.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Detail");
    act(() => {
      detailButtons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    await settle();
    expect(container.textContent).toContain("Recorded");
    setSelectValue(container, `decision-${VERIFICATION.id}`, "submit");
    await settle();
    clickButton(container, "Record decision");
    await settle();
    await settle();
    const decision = calls.find((c) => c.url === `/api/work-packages/pkg_1/field-verifications/${VERIFICATION.id}/decision` && c.method === "POST");
    expect(decision).toBeDefined();
    expect(decision.body.action).toBe("submit");
    expect(decision.body.expectedVersion).toBe(1);
    expect(decision.body.sourceFingerprint).toBe("a".repeat(32));
    expect(container.textContent).toContain("Verification submitted for independent review.");
  });

  it("shows the not-applied message when the migration has not landed", async () => {
    // A different package id than the other tests: the SWR cache is
    // shared across tests in this file, and pkg_1 already holds the
    // applied-migration payload from the earlier tests.
    stubFetch("pkg_na", { notApplied: true });
    const { container } = renderPanel("pkg_na");
    await settle();
    await settle();
    expect(container.textContent).toContain("Field verification isn't available yet");
    // The honest branch — neutral wording — not the red error branch:
    // the flag reached the client and selected the unavailable state.
    expect(container.querySelector(".text-red-600")).toBeNull();
  });

  it("still shows the red error branch on an unrelated list failure", async () => {
    // A different package id than the other tests: the SWR cache is
    // shared across tests in this file.
    stubFetch("pkg_err", { listError: true });
    const { container } = renderPanel("pkg_err");
    await settle();
    await settle();
    const error = container.querySelector(".text-red-600");
    expect(error).not.toBeNull();
    expect(error.textContent).toContain("Unable to complete the request.");
    expect(container.textContent).not.toContain("isn't available yet");
  });

  it("filters the list to one target when deep-linked from a step row", async () => {
    stubFetch("pkg_1");
    const { container } = renderPanel("pkg_1", {
      initialFilter: { targetType: "WORK_STEP", targetId: "step_1" },
    });
    await settle();
    await settle();
    expect(container.textContent).toContain("Fabricate spool");
    expect(container.textContent).not.toContain("W-0005-1 — 10 EA");
    expect(container.textContent).toContain("Showing verifications for one target.");
  });
});

describe("FieldVerificationBadge and FieldVerificationSummary", () => {
  it("renders nothing without a badge and a count with one", () => {
    const empty = document.createElement("div");
    document.body.appendChild(empty);
    const rootEmpty = createRoot(empty);
    act(() => {
      rootEmpty.render(<FieldVerificationBadge badge={null} />);
    });
    expect(empty.textContent).toBe("");
    const filled = document.createElement("div");
    document.body.appendChild(filled);
    const rootFilled = createRoot(filled);
    act(() => {
      rootFilled.render(<FieldVerificationBadge badge={{ count: 2, statuses: ["DRAFT", "SUBMITTED"] }} />);
    });
    expect(filled.textContent).toContain("2 verifications");
  });

  it("summary shows the header counts from the list endpoint", async () => {
    stubFetch("pkg_1");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<FieldVerificationSummary packageId="pkg_1" />);
    });
    await settle();
    await settle();
    expect(container.textContent).toContain("Submitted 1");
    expect(container.textContent).toContain("Accepted 0");
    expect(container.textContent).toContain("Changed since review 1");
  });

  it("summary renders nothing when the migration has not landed", async () => {
    // The summary shares the panel's list SWR key, so it reads the
    // same { notApplied: true } entry — and renders nothing rather
    // than an error. A fresh package id: the SWR cache is shared
    // across tests in this file.
    stubFetch("pkg_na_sum", { notApplied: true });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<FieldVerificationSummary packageId="pkg_na_sum" />);
    });
    await settle();
    await settle();
    expect(container.textContent).toBe("");
  });
});
