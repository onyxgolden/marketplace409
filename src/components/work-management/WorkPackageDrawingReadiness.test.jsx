// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackageDrawingReadiness, { badgeClass } from "./WorkPackageDrawingReadiness.jsx";

const SHA = "a".repeat(64);

// Slice-7 review-gating fix: this fixture is the REAL API shape — the
// flat latest-revision fields the readiness snapshot actually emits
// (see toCamelReadinessDrawing) plus the revisions endpoint. It must
// NEVER carry a nested latestRevision / latestReview object: the old
// fixture did, and that masked the bug — the component gated on a
// nested object the API never emits, so the review workflow was hidden
// live even with issued IFA revisions.
function readinessFixture() {
  return {
    packageId: "pkg_1",
    packageStatus: "in_progress",
    drawings: [
      {
        drawingId: "dwg_1", drawingNumber: "P-101", drawingType: "p_id", title: "Process line",
        badge: "IFA — In review", constructionUsable: false, retiredAt: null,
        latestRevisionId: "forge_wpdrv_2", latestRevisionCode: "1", latestIssuedAs: "IFA",
        latestDocumentRef: "controlled-drawings:owner/pkg_1/req-1/sha.pdf",
        latestContentSha256: SHA, latestIssuedAt: "2026-11-08T10:00:00Z",
        latestReviewId: "forge_wpdrvw_1", latestReviewRoundNo: 1, latestReviewState: "OPEN",
        latestReviewOpenedAt: "2026-11-08T11:00:00Z", latestReviewClosedAt: null,
        latestReviewDecisionReason: null,
        activeIfcRelease: null, openRequiredRedlines: 1, pendingFieldRedlines: 0,
      },
      {
        drawingId: "dwg_2", drawingNumber: "ISO-200", drawingType: "isometric", title: "Spool 200",
        badge: "IFA — Approved; IFC not issued", constructionUsable: false, retiredAt: null,
        latestRevisionId: "forge_wpdrv_9", latestRevisionCode: "B", latestIssuedAs: "IFA",
        latestDocumentRef: "controlled-drawings:owner/pkg_1/req-2/sha.pdf",
        latestContentSha256: "b".repeat(64), latestIssuedAt: "2026-11-09T10:00:00Z",
        latestReviewId: "forge_wpdrvw_2", latestReviewRoundNo: 1, latestReviewState: "APPROVED",
        latestReviewOpenedAt: "2026-11-09T11:00:00Z", latestReviewClosedAt: "2026-11-09T12:00:00Z",
        latestReviewDecisionReason: "Looks good.",
        activeIfcRelease: null, openRequiredRedlines: 0, pendingFieldRedlines: 1,
      },
    ],
    counts: {
      drawingsTotal: 2, ifcReleased: 0, pendingReview: 1,
      returned: 0, openRequiredRedlines: 1, pendingFieldRedlines: 1,
    },
  };
}

function singleDrawingFixture(overrides = {}) {
  const fixture = readinessFixture();
  fixture.drawings = [{
    drawingId: "dwg_1", drawingNumber: "P-101", drawingType: "p_id", title: "Process line",
    badge: "IFA — Awaiting review", constructionUsable: false, retiredAt: null,
    latestRevisionId: "forge_wpdrv_2", latestRevisionCode: "1", latestIssuedAs: "IFA",
    latestDocumentRef: "controlled-drawings:owner/pkg_1/req-1/sha.pdf",
    latestContentSha256: SHA, latestIssuedAt: "2026-11-08T10:00:00Z",
    latestReviewId: null, latestReviewRoundNo: null, latestReviewState: null,
    latestReviewOpenedAt: null, latestReviewClosedAt: null,
    latestReviewDecisionReason: null,
    activeIfcRelease: null, openRequiredRedlines: 0, pendingFieldRedlines: 0,
    ...overrides,
  }];
  fixture.counts = {
    drawingsTotal: 1, ifcReleased: 0, pendingReview: 0,
    returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0,
  };
  return fixture;
}

// The revisions endpoint lists newest issued first (issued_at DESC,
// id DESC) — Rev 1 before Rev 0, exactly the live S7-PDF-LIVE-01 shape.
function defaultRevisions() {
  return {
    dwg_1: [
      { id: "forge_wpdrv_2", revisionCode: "1", issuedAs: "IFA", retiredAt: null, createdAt: "2026-11-08T10:00:00Z" },
      { id: "forge_wpdrv_1", revisionCode: "0", issuedAs: "IFA", retiredAt: null, createdAt: "2026-11-07T10:00:00Z" },
    ],
    dwg_2: [
      { id: "forge_wpdrv_9", revisionCode: "B", issuedAs: "IFA", retiredAt: null, createdAt: "2026-11-09T10:00:00Z" },
    ],
  };
}

function defaultReviews() {
  return {
    dwg_1: [{ id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-08T11:00:00Z" }],
    dwg_2: [{ id: "forge_wpdrvw_2", roundNo: 1, state: "APPROVED", version: 2, drawingRevisionId: "forge_wpdrv_9", openedAt: "2026-11-09T11:00:00Z" }],
  };
}

function setupFetch({ fixture = readinessFixture(), revisionsMap = defaultRevisions(), reviewsMap = defaultReviews() } = {}) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method, body: options.body });
    const parsed = new URL(url, "https://test");
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/readiness") {
      return { ok: true, json: async () => fixture };
    }
    const match = parsed.pathname.match(/^\/api\/work-packages\/pkg_1\/drawings\/(dwg_\d+)\/(revisions|reviews|ifc-releases|field-redlines)(?:\/(.+))?$/);
    if (match) {
      const [, drawingId, resource, reviewId] = match;
      if (resource === "reviews" && method === "POST") {
        const body = JSON.parse(options.body);
        const review = {
          id: "forge_wpdrvw_9", roundNo: (reviewsMap[drawingId]?.length || 0) + 1,
          state: "OPEN", version: 1, drawingRevisionId: body.drawingRevisionId,
          openedAt: "2026-11-13T10:00:00Z",
        };
        (reviewsMap[drawingId] = reviewsMap[drawingId] || []).push(review);
        return { ok: true, json: async () => ({ review }) };
      }
      if (resource === "revisions") {
        return { ok: true, json: async () => ({ revisions: revisionsMap[drawingId] || [] }) };
      }
      if (resource === "reviews" && reviewId) {
        return {
          ok: true,
          json: async () => ({
            review: { id: reviewId, roundNo: 1, state: "OPEN", version: 1 },
            redlines: [{ id: "forge_wpdrl_1", comment: "Move this nozzle 50 mm up.", severity: "REQUIRED", resolution: "OPEN", version: 1, anchorPage: 2 }],
            events: [{ id: "forge_wpdre_1", eventType: "REVIEW_OPENED", createdAt: "2026-11-08T11:00:00Z" }],
          }),
        };
      }
      if (resource === "reviews") {
        return { ok: true, json: async () => ({ reviews: reviewsMap[drawingId] || [] }) };
      }
      if (resource === "ifc-releases") {
        return { ok: true, json: async () => ({ releases: [] }) };
      }
      if (resource === "field-redlines") {
        return { ok: true, json: async () => ({ fieldRedlines: [] }) };
      }
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
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

async function expandDrawing(container, label) {
  await act(async () => {
    findButton(container, label).click();
  });
  await act(async () => {});
}

function selectOption(container, selectId, value) {
  const select = container.querySelector(`#${selectId}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
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
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Rev 1");
    expect(container.textContent).toContain("Rev 0");
    expect(container.textContent).toContain("Round 1 — OPEN");
    expect(container.textContent).toContain("No IFC release yet");
  });

  it("expands a review round to show redlines and the decision form", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
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
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Field hand-redline history");
    expect(container.textContent).toContain("never makes an IFA drawing construction-usable");
  });

  // Slice-7 review-gating fix (S7-RG-01/02/03): the live case — flat
  // snapshot fields, Rev 0 + Rev 1 from the revisions endpoint, no
  // open review — must render "Open a review round" with both
  // revisions selectable.
  it("renders 'Open a review round' from the real API shape with Rev 0 + Rev 1", async () => {
    setupFetch({ fixture: singleDrawingFixture(), reviewsMap: { dwg_1: [] } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    // The header label comes from the flat snapshot fields.
    expect(container.textContent).toContain("Rev 1 · IFA");
    expect(container.textContent).toContain("Open a review round");
    const select = container.querySelector("#review-rev-dwg_1");
    expect(select).not.toBeNull();
    const options = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("Rev 1");
    expect(options).toContain("Rev 0");
    // The field hand-redline form renders too: non-retired revisions exist.
    expect(container.textContent).toContain("Capture a field hand-redline");
  });

  it("opening a review binds the exact revision id chosen and refreshes to the new OPEN round", async () => {
    const { calls } = setupFetch({ fixture: singleDrawingFixture(), reviewsMap: { dwg_1: [] } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "review-rev-dwg_1", "forge_wpdrv_2"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Open review").click(); });
    await act(async () => {});
    await act(async () => {});
    const post = calls.find((c) => c.method === "POST" && c.url.includes("/reviews"));
    expect(post).toBeDefined();
    expect(JSON.parse(post.body).drawingRevisionId).toBe("forge_wpdrv_2");
    expect(container.textContent).toContain("Round 1 — OPEN");
    // The round is now open, so the form closes itself.
    expect(container.textContent).not.toContain("Open a review round");
  });

  it("lists the snapshot's latest revision first when the endpoint order disagrees (backdated issue date)", async () => {
    // The endpoint lists newest ISSUED first; the snapshot's latest is
    // newest CREATED first. A backdated issue date can make them
    // disagree — the snapshot pointer (latestRevisionId) is the
    // authority, so Rev 1 leads the selector even though the endpoint
    // returned Rev 0 first.
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [
        { id: "forge_wpdrv_1", revisionCode: "0", issuedAs: "IFA", retiredAt: null, createdAt: "2026-11-07T10:00:00Z" },
        { id: "forge_wpdrv_2", revisionCode: "1", issuedAs: "IFA", retiredAt: null, createdAt: "2026-11-08T10:00:00Z" },
      ] },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const select = container.querySelector("#review-rev-dwg_1");
    const options = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toEqual(["Select a revision…", "Rev 1", "Rev 0"]);
  });

  it("hides 'Open a review round' when the drawing has no revisions", async () => {
    setupFetch({ fixture: singleDrawingFixture(), revisionsMap: { dwg_1: [] }, reviewsMap: { dwg_1: [] } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).not.toContain("Open a review round");
    expect(container.textContent).not.toContain("Capture a field hand-redline");
  });

  it("hides 'Open a review round' when only retired IFA revisions exist", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [{ id: "forge_wpdrv_1", revisionCode: "0", issuedAs: "IFA", retiredAt: "2026-11-10T00:00:00Z", createdAt: "2026-11-07T10:00:00Z" }] },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).not.toContain("Open a review round");
    expect(container.textContent).not.toContain("Capture a field hand-redline");
  });

  it("hides 'Open a review round' when only IFC revisions exist, but keeps the field form", async () => {
    setupFetch({
      fixture: singleDrawingFixture({ latestRevisionId: "forge_wpdrv_3", latestRevisionCode: "A", latestIssuedAs: "IFC" }),
      revisionsMap: { dwg_1: [{ id: "forge_wpdrv_3", revisionCode: "A", issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-09T10:00:00Z" }] },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).not.toContain("Open a review round");
    // A field hand-redline may mark up any non-retired revision.
    expect(container.textContent).toContain("Capture a field hand-redline");
  });

  it("hides 'Open a review round' on a retired drawing", async () => {
    setupFetch({
      fixture: singleDrawingFixture({ retiredAt: "2026-11-12T00:00:00Z", badge: "Retired" }),
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).not.toContain("Open a review round");
    expect(container.textContent).not.toContain("Capture a field hand-redline");
    expect(container.textContent).not.toContain("Upload a controlled PDF");
  });

  it("hides 'Open a review round' while a review round is OPEN", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).not.toContain("Open a review round");
    expect(container.textContent).toContain("Round 1 — OPEN");
  });
});
