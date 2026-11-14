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

function setupFetch({ fixture = readinessFixture(), revisionsMap = defaultRevisions(), reviewsMap = defaultReviews(), releasesMap = {}, fieldRedlinesMap = {}, artifactsMap = {}, fail = {} } = {}) {
  const calls = [];
  // Slice-7 friction fix: the round detail's redlines are stateful so
  // a resolve can be observed (the redline flips to RESOLVED on the
  // next detail fetch) instead of always re-rendering OPEN.
  const redlinesByReview = {
    forge_wpdrvw_1: [{ id: "forge_wpdrl_1", comment: "Move this nozzle 50 mm up.", severity: "REQUIRED", resolution: "OPEN", version: 1, anchorPage: 2 }],
  };
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method, body: options.body });
    const parsed = new URL(url, "https://test");
    if (parsed.pathname === "/api/work-packages/pkg_1/drawings/readiness") {
      return { ok: true, json: async () => fixture };
    }
    const match = parsed.pathname.match(/^\/api\/work-packages\/pkg_1\/drawings\/(dwg_\d+)\/(revisions|reviews|ifc-releases|field-redlines|artifacts|ifc-stage|retire)(?:\/(.+))?$/);
    if (match) {
      const [, drawingId, resource, rest] = match;
      if (resource === "reviews" && rest && rest.endsWith("/decision") && method === "POST") {
        if (fail.decision) return { ok: false, json: async () => ({ error: "Review is stale — reload and try again." }) };
        const reviewId = rest.split("/")[0];
        const body = JSON.parse(options.body);
        const review = (reviewsMap[drawingId] || []).find((r) => r.id === reviewId);
        if (review) {
          review.state = body.decision === "RETURN_TO_DRAFTER" ? "RETURNED" : body.decision === "APPROVE_WITH_REDLINES" ? "APPROVED_WITH_REDLINES" : "APPROVED";
          review.version += 1;
          review.closedAt = "2026-11-13T12:00:00Z";
          review.decisionReason = body.reason;
        }
        return { ok: true, json: async () => ({ review }) };
      }
      if (resource === "reviews" && rest && rest.endsWith("/redlines") && method === "POST") {
        if (fail.redline) return { ok: false, json: async () => ({ error: "Could not add the redline." }) };
        const body = JSON.parse(options.body);
        const redline = { id: "forge_wpdrl_2", comment: body.comment, severity: body.severity, resolution: "OPEN", version: 1, anchorPage: body.anchorPage ?? null };
        (redlinesByReview[rest.split("/")[0]] = redlinesByReview[rest.split("/")[0]] || []).push(redline);
        return { ok: true, json: async () => ({ redline }) };
      }
      if (resource === "reviews" && rest && rest.includes("/redlines/") && method === "PATCH") {
        const [reviewId, , redlineId] = rest.split("/");
        const body = JSON.parse(options.body);
        const redline = (redlinesByReview[reviewId] || []).find((r) => r.id === redlineId);
        if (redline) {
          redline.resolution = body.resolution;
          redline.resolutionNote = body.resolutionNote || null;
          redline.version += 1;
        }
        return { ok: true, json: async () => ({ redline }) };
      }
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
      if (resource === "reviews" && rest && method === "GET") {
        const reviewId = rest.split("/")[0];
        return {
          ok: true,
          json: async () => ({
            review: { id: reviewId, roundNo: 1, state: "OPEN", version: 1 },
            redlines: redlinesByReview[reviewId] || [],
            events: [{ id: "forge_wpdre_1", eventType: "REVIEW_OPENED", createdAt: "2026-11-08T11:00:00Z" }],
          }),
        };
      }
      if (resource === "reviews") {
        return { ok: true, json: async () => ({ reviews: reviewsMap[drawingId] || [] }) };
      }
      if (resource === "revisions") {
        return { ok: true, json: async () => ({ revisions: revisionsMap[drawingId] || [] }) };
      }
      if (resource === "ifc-stage" && method === "POST") {
        if (fail.stage) return { ok: false, json: async () => ({ error: "Could not stage the IFC PDF." }) };
        const artifact = { id: "forge_wpa_9", purpose: "ifc_candidate", originalFilename: "W-0005-1-TEST-ISO-IFC.pdf", contentSha256: "c".repeat(64), createdAt: "2026-11-13T11:00:00Z", retiredAt: null };
        (artifactsMap[drawingId] = artifactsMap[drawingId] || []).push(artifact);
        return { ok: true, json: async () => ({ artifact }) };
      }
      if (resource === "artifacts") {
        return { ok: true, json: async () => ({ artifacts: artifactsMap[drawingId] || [] }) };
      }
      if (resource === "ifc-releases" && method === "POST") {
        if (fail.issue) return { ok: false, json: async () => ({ error: "Could not issue the IFC revision." }) };
        const body = JSON.parse(options.body);
        const release = { id: "forge_wpdifc_9", ifcRevisionCode: body.ifcRevisionCode, releasedAt: "2026-11-13T12:00:00Z", isActive: true, retiredAt: null };
        (releasesMap[drawingId] = releasesMap[drawingId] || []).push(release);
        return { ok: true, json: async () => ({ release }) };
      }
      if (resource === "ifc-releases") {
        return { ok: true, json: async () => ({ releases: releasesMap[drawingId] || [] }) };
      }
      if (resource === "field-redlines" && rest && rest.endsWith("/reconcile") && method === "POST") {
        const fieldId = rest.split("/")[0];
        const field = (fieldRedlinesMap[drawingId] || []).find((f) => f.id === fieldId);
        if (field) field.recordState = "RECONCILED";
        return { ok: true, json: async () => ({ fieldRedline: field }) };
      }
      if (resource === "field-redlines" && method === "POST") {
        if (fail.field) return { ok: false, json: async () => ({ error: "Could not capture the field hand-redline." }) };
        const body = JSON.parse(options.body);
        const field = { id: "forge_wpdfr_9", drawingRevisionId: body.drawingRevisionId, artifactRef: body.artifactRef, sha256: body.sha256, fieldReason: body.fieldReason, recordState: "HISTORICAL_PENDING_RECONCILIATION", createdAt: "2026-11-13T11:00:00Z" };
        (fieldRedlinesMap[drawingId] = fieldRedlinesMap[drawingId] || []).push(field);
        return { ok: true, json: async () => ({ fieldRedline: field }) };
      }
      if (resource === "field-redlines") {
        return { ok: true, json: async () => ({ fieldRedlines: fieldRedlinesMap[drawingId] || [] }) };
      }
      if (resource === "retire" && method === "POST") {
        return { ok: true, json: async () => ({ drawing: { drawingId, retiredAt: "2026-11-13T12:00:00Z" } }) };
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

function setText(container, inputId, value) {
  const input = container.querySelector(`#${inputId}`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function setStageFile(container, name = "W-0005-1-TEST-ISO-IFC.pdf") {
  const form = [...container.querySelectorAll("form")].find((f) => f.textContent.includes("Stage an IFC PDF"));
  const input = form.querySelector('input[type="file"]');
  const file = new File([new TextEncoder().encode("%PDF-1.7\n%test\n%%EOF\n")], name, { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file] });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// jsdom does not fire a submit event when a submit button is clicked
// on a form containing a file input, so the stage form is submitted
// by dispatching the event directly — the same pattern
// WorkPackageDocuments.test.jsx uses for the controlled upload form.
async function submitStageForm(container) {
  const form = [...container.querySelectorAll("form")].find((f) => f.textContent.includes("Stage an IFC PDF"));
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
  await act(async () => {});
}

async function expandRound(container, label) {
  await act(async () => { findButton(container, label).click(); });
  await act(async () => {});
}

function roundItem(container, label) {
  const button = findButton(container, label);
  return button?.closest("li") || null;
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

// Slice-7 friction fix round (F1/F3): success confirmations name the
// drawing, revision and outcome; a round shows its exact bound
// revision; a release label follows its persisted retirement state.
describe("WorkPackageDrawingReadiness friction fix", () => {
  it("confirms opening a review round with drawing and revision", async () => {
    setupFetch({ fixture: singleDrawingFixture(), reviewsMap: { dwg_1: [] } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "review-rev-dwg_1", "forge_wpdrv_2"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Open review").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Review round opened for drawing P-101, Rev 1.");
    expect(container.textContent).toContain("Round 1 — OPEN");
  });

  it("shows the round's exact bound revision in the summary and detail, not the latest", async () => {
    // The dwg_1 round is bound to Rev 0 (forge_wpdrv_1) while Rev 1
    // is the latest revision — the round must name Rev 0.
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const item = roundItem(container, "Round 1 — OPEN");
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Drawing P-101 · Rev 0 (IFA)");
    await expandRound(container, "Round 1 — OPEN");
    expect(item.textContent).toContain("Revision under review: Rev 0 (IFA)");
    expect(item.textContent).not.toContain("Revision record unavailable");
  });

  it("falls back truthfully when the bound revision is not in the loaded list", async () => {
    setupFetch({
      reviewsMap: {
        dwg_1: [{ id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1, drawingRevisionId: "forge_wpdrv_missing", openedAt: "2026-11-08T11:00:00Z" }],
        dwg_2: [],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const item = roundItem(container, "Round 1 — OPEN");
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Revision record unavailable (ID ");
    await expandRound(container, "Round 1 — OPEN");
    expect(item.textContent).toContain("Revision under review: Revision record unavailable (ID ");
  });

  it("confirms adding a redline with drawing and bound revision", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Round 1 — OPEN");
    await act(async () => { setText(container, "redline-comment-forge_wpdrvw_1", "Check the weld note."); });
    await act(async () => { findButton(container, "Add redline").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Redline added to drawing P-101, Rev 0 (IFA).");
  });

  it("confirms resolving a redline and shows the resolved state", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Round 1 — OPEN");
    await act(async () => { findButton(container, "Resolve").click(); });
    await act(async () => {});
    await act(async () => { findButton(container, "Save resolution").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Redline resolved for drawing P-101, Rev 0 (IFA).");
    expect(container.textContent).toContain("RESOLVED");
  });

  it("confirms recording a decision with drawing, revision and outcome", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Round 1 — OPEN");
    await act(async () => { setText(container, "decision-reason-forge_wpdrvw_1", "Looks good."); });
    await act(async () => { findButton(container, "Record decision").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Review decision recorded for drawing P-101, Rev 0 (IFA): approved.");
  });

  it("a failed decision shows the error and no success notice, clearing the stale one", async () => {
    setupFetch({ fail: { decision: true } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Round 1 — OPEN");
    // A successful redline first, so a stale confirmation exists.
    await act(async () => { setText(container, "redline-comment-forge_wpdrvw_1", "Check the weld note."); });
    await act(async () => { findButton(container, "Add redline").click(); });
    await act(async () => {});
    await act(async () => {});
    expect(container.querySelector('[role="status"]').textContent).toContain("Redline added");
    // The failing decision must clear it and show the error instead.
    await act(async () => { setText(container, "decision-reason-forge_wpdrvw_1", "Looks good."); });
    await act(async () => { findButton(container, "Record decision").click(); });
    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toContain("Review is stale");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain("Review decision recorded");
  });

  it("confirms staging an IFC PDF as staged, not issued, naming file and drawing", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "ISO-200");
    setStageFile(container);
    await submitStageForm(container);
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("IFC PDF W-0005-1-TEST-ISO-IFC.pdf staged for drawing ISO-200 — it is staged, not yet issued.");
    expect(container.textContent).toContain("Staged: W-0005-1-TEST-ISO-IFC.pdf");
  });

  it("confirms issuing an IFC revision with drawing and code, and clears a stale stage notice on failure", async () => {
    setupFetch({ fail: { issue: true } });
    const { container } = await renderPanel();
    await expandDrawing(container, "ISO-200");
    setStageFile(container);
    await submitStageForm(container);
    expect(container.querySelector('[role="status"]').textContent).toContain("staged for drawing ISO-200");
    await act(async () => { selectOption(container, "ifc-rev-dwg_2", "forge_wpdrvw_2"); });
    await act(async () => { setText(container, "ifc-code-dwg_2", "2"); });
    await act(async () => { selectOption(container, "ifc-file-dwg_2", "forge_wpa_9"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Issue IFC revision").click(); });
    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toContain("Could not issue the IFC revision.");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).not.toContain("IFC revision 2 for drawing ISO-200 issued for construction.");
  });

  it("confirms issuing an IFC revision with drawing and code", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "ISO-200");
    setStageFile(container);
    await submitStageForm(container);
    await act(async () => { selectOption(container, "ifc-rev-dwg_2", "forge_wpdrvw_2"); });
    await act(async () => { setText(container, "ifc-code-dwg_2", "2"); });
    await act(async () => { selectOption(container, "ifc-file-dwg_2", "forge_wpa_9"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Issue IFC revision").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("IFC revision 2 for drawing ISO-200 issued for construction.");
  });

  it("confirms capturing a field hand-redline with drawing and revision", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "field-rev-dwg_1", "forge_wpdrv_2"); });
    await act(async () => { setText(container, "field-ref-dwg_1", "scan-1.pdf"); });
    await act(async () => { setText(container, "field-sha-dwg_1", "d".repeat(64)); });
    await act(async () => { setText(container, "field-reason-dwg_1", "Marked up on site."); });
    await act(async () => { findButton(container, "Capture field hand-redline").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("Field hand-redline captured for drawing P-101, Rev 1 (IFA) as a historical record.");
  });

  it("confirms reconciling a field hand-redline with drawing and revision", async () => {
    setupFetch({
      fieldRedlinesMap: {
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", createdAt: "2026-11-08T12:00:00Z" }],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "recon-rev-forge_wpdfr_1", "forge_wpdrv_2"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Reconcile").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Field hand-redline reconciled for drawing P-101, Rev 0 (IFA), reconciled as Rev 1 (IFA).");
  });

  it("confirms retiring a field hand-redline without a new revision, still naming the original revision", async () => {
    setupFetch({
      fieldRedlinesMap: {
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", createdAt: "2026-11-08T12:00:00Z" }],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    // No reconciled revision selected: the empty option is
    // "Retire without a new revision".
    await act(async () => { findButton(container, "Reconcile").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Field hand-redline reconciled for drawing P-101, Rev 0 (IFA) — retired without a new revision.");
  });

  it("uses the truthful unavailable-ID fallback when the original marked-up revision is missing", async () => {
    setupFetch({
      fieldRedlinesMap: {
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_missing", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", createdAt: "2026-11-08T12:00:00Z" }],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "recon-rev-forge_wpdfr_1", "forge_wpdrv_2"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Reconcile").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("Revision record unavailable (ID");
    expect(notice.textContent).toContain("reconciled as Rev 1 (IFA)");
  });

  it("does not claim retirement when the selected reconciliation revision record is unavailable", async () => {
    setupFetch({
      fieldRedlinesMap: {
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", createdAt: "2026-11-08T12:00:00Z" }],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    // Friction fix round 2 (F1): a reconciliation revision ID was
    // submitted, but its record is absent from the loaded revisions
    // list — unavailable, not unselected. jsdom resets a select to
    // "" when its value matches no option, so the ID is put into
    // the form state through the change event itself (writable, so
    // React's later value sync cannot throw): this is the state a
    // revision selected from a list that no longer contains it
    // would leave behind.
    const select = container.querySelector("#recon-rev-forge_wpdfr_1");
    Object.defineProperty(select, "value", { value: "forge_wpdrv_missing", writable: true, configurable: true });
    await act(async () => { select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => {});
    await act(async () => { findButton(container, "Reconcile").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).not.toContain("retired without a new revision");
    expect(notice.textContent).toContain("Rev 0 (IFA)");
    expect(notice.textContent).toContain("reconciled against a revision record that is unavailable");
  });

  it("confirms retiring a drawing by name", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { findButton(container, "Retire drawing").click(); });
    await act(async () => { setText(container, "retire-reason-dwg_1", "Superseded by a new package."); });
    await act(async () => { findButton(container, "Retire drawing").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Drawing P-101 retired. Its review history is kept.");
  });

  it("renders a new release active and a retired release retired, never superseded by default", async () => {
    setupFetch({
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_2", ifcRevisionCode: "2", releasedAt: "2026-11-13T12:00:00Z", isActive: true, retiredAt: null },
          { id: "forge_wpdifc_1", ifcRevisionCode: "1", releasedAt: "2026-11-10T12:00:00Z", isActive: false, retiredAt: "2026-11-13T11:00:00Z" },
        ],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("IFC revision 2 · released");
    expect(container.textContent).toContain("· active");
    expect(container.textContent).toContain("IFC revision 1 · released");
    expect(container.textContent).toContain("· retired");
    expect(container.textContent).not.toContain("superseded");
  });
});
