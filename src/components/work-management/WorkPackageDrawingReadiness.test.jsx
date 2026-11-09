// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackageDrawingReadiness, { badgeClass } from "./WorkPackageDrawingReadiness.jsx";

const SHA = "a".repeat(64);

function readinessFixture() {
  return {
    packageId: "pkg_1",
    packageStatus: "in_progress",
    drawings: [
      {
        drawingId: "dwg_1", drawingNumber: "P-101", drawingType: "P&ID", title: "Process line",
        badge: "IFA — In review", constructionUsable: false,
        latestRevision: { id: "forge_wpdrv_1", revisionCode: "A", issuedAs: "IFA" },
        latestReview: { id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1 },
        activeIfcRelease: null, openRequiredRedlines: 1, pendingFieldRedlines: 0,
      },
      {
        drawingId: "dwg_2", drawingNumber: "ISO-200", drawingType: "Isometric", title: "Spool 200",
        badge: "IFA — Approved; IFC not issued", constructionUsable: false,
        latestRevision: { id: "forge_wpdrv_2", revisionCode: "B", issuedAs: "IFA" },
        latestReview: { id: "forge_wpdrvw_2", roundNo: 1, state: "APPROVED", version: 2 },
        activeIfcRelease: null, openRequiredRedlines: 0, pendingFieldRedlines: 1,
      },
    ],
    counts: {
      drawingsTotal: 2, ifcReleased: 0, pendingReview: 1,
      returned: 0, openRequiredRedlines: 1, pendingFieldRedlines: 1,
    },
  };
}

function setupFetch() {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body });
    const parsed = new URL(url, "https://test");
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/readiness") {
      return { ok: true, json: async () => readinessFixture() };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/dwg_1/revisions") {
      return { ok: true, json: async () => ({ revisions: [{ id: "forge_wpdrv_1", revisionCode: "A", issuedAs: "IFA", createdAt: "2026-11-08T10:00:00Z" }] }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/dwg_1/reviews") {
      return { ok: true, json: async () => ({ reviews: [{ id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-08T11:00:00Z" }] }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/dwg_1/ifc-releases") {
      return { ok: true, json: async () => ({ releases: [] }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/dwg_1/field-redlines") {
      return { ok: true, json: async () => ({ fieldRedlines: [] }) };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/dwg_1/reviews/forge_wpdrvw_1") {
      return {
        ok: true,
        json: async () => ({
          review: { id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1 },
          redlines: [{ id: "forge_wpdrl_1", comment: "Move this nozzle 50 mm up.", severity: "REQUIRED", resolution: "OPEN", version: 1, anchorPage: 2 }],
          events: [{ id: "forge_wpdre_1", eventType: "REVIEW_OPENED", createdAt: "2026-11-08T11:00:00Z" }],
        }),
      };
    }
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/dwg_1/reviews" && options.method === "POST") {
      return { ok: true, json: async () => ({ review: { id: "forge_wpdrvw_9", roundNo: 2, state: "OPEN", version: 1 } }) };
    }
    throw new Error(`unexpected fetch ${options.method || "GET"} ${url}`);
  }));
  return { calls };
}

async function renderPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<WorkPackageDrawingReadiness packageId="pkg_1" />);
  });
  await act(async () => {});
  return { container, root };
}

function findButton(container, text) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent.includes(text));
}

beforeEach(() => {
  clearSWRCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  clearSWRCache();
});

describe("WorkPackageDrawingReadiness", () => {
  it("withdrawn badges read as not usable, never green (fix round 1)", () => {
    expect(badgeClass("Withdrawn — package cancelled")).toBe("bg-slate-200 text-slate-600");
    expect(badgeClass("Withdrawn — package verified closed")).toBe("bg-slate-200 text-slate-600");
    expect(badgeClass("IFC — Issued for construction")).toBe("bg-green-100 text-green-800");
  });

  it("renders the counts and one badge per drawing", async () => {
    setupFetch();
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Drawing readiness");
    expect(container.textContent).toContain("Pending review");
    expect(container.textContent).toContain("IFA — In review");
    // An approved IFA review is never labelled issued IFC.
    expect(container.textContent).toContain("IFA — Approved; IFC not issued");
    expect(container.textContent).not.toContain("IFC — Issued for construction");
    expect(container.textContent).toContain("1 open required redline");
    expect(container.textContent).toContain("1 field hand-redline awaiting reconciliation");
  });

  it("expands a drawing to show revisions and review rounds", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await act(async () => {
      findButton(container, "P-101").click();
    });
    await act(async () => {});
    expect(container.textContent).toContain("Rev A");
    expect(container.textContent).toContain("Round 1 — OPEN");
    expect(container.textContent).toContain("No IFC release yet");
  });

  it("expands a review round to show redlines and the decision form", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await act(async () => { findButton(container, "P-101").click(); });
    await act(async () => {});
    await act(async () => { findButton(container, "Round 1 — OPEN").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Move this nozzle 50 mm up.");
    expect(container.textContent).toContain("REQUIRED");
    expect(container.textContent).toContain("Decide this round");
    expect(container.textContent).toContain("Add a redline");
    expect(container.textContent).toContain("REVIEW_OPENED");
  });

  it("shows the field hand-redline disclaimer, never as an issued revision", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await act(async () => { findButton(container, "P-101").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Field hand-redline history");
    expect(container.textContent).toContain("never makes an IFA drawing construction-usable");
  });
});
