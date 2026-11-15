// @vitest-environment jsdom
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSWRCache } from "@/hooks/swrCache";

import WorkPackageDrawingReadiness, {
  badgeClass,
  formatReviewRoundLabel,
  formatReviewEvent,
  reviewEventDescription,
  reviewOutcomeLabel,
  fieldRecordStateLabel,
  fieldArtifactReference,
} from "./WorkPackageDrawingReadiness.jsx";
import { PackagePageProvider } from "./packagePageContext.jsx";

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

function setupFetch({ fixture = readinessFixture(), revisionsMap = defaultRevisions(), reviewsMap = defaultReviews(), releasesMap = {}, fieldRedlinesMap = {}, artifactsMap = {}, fail = {}, hangRevisions = false, hangRevisionsAfterFirst = false, failRevisionsAfterFirst = false, hangReviews = false, readinessByWorkspace = null } = {}) {
  const calls = [];
  // PR #808 fix round: counts revisions GETs so a test can hang or
  // fail only the revalidation (second and later fetches) while the
  // first fetch settles and seeds the cache.
  let revisionsCalls = 0;
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
      // Slice-7 follow-ups (Finding 3, case 7): a scoped panel's
      // readiness fetch carries ?workspace= / ?forgeProject=, so the
      // mock can serve a different snapshot per scope — the two
      // panels must never share one scope's counts.
      const scoped = readinessByWorkspace?.[parsed.searchParams.get("workspace")];
      return { ok: true, json: async () => scoped || fixture };
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
            events: [{ id: "forge_wpdre_1", eventType: "REVIEW_OPENED", occurredAt: "2026-11-08T11:00:00Z", afterState: "OPEN", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" }],
          }),
        };
      }
      if (resource === "reviews") {
        // Slice-7 follow-ups (Finding 3): the per-drawing open-round
        // count must say Loading… while this list is in flight and
        // say unavailable when it fails — never a false 0.
        if (hangReviews) return new Promise(() => {});
        if (fail.reviews) return { ok: false, json: async () => ({ error: "Reviews could not be loaded." }) };
        return { ok: true, json: async () => ({ reviews: reviewsMap[drawingId] || [] }) };
      }
      if (resource === "revisions") {
        // IFC-CODE-05: a revisions fetch that never resolves, so the
        // release rows render while the revisions list is still
        // loading — they must say so, never report "unavailable".
        if (hangRevisions) return new Promise(() => {});
        revisionsCalls += 1;
        // PR #808 fix round: after the first fetch settles (seeding
        // the cache), later revalidations hang — the component renders
        // stale cached revisions while a refresh is in flight
        // (IFC-CODE-08) — or fail, leaving stale data plus an error
        // (IFC-CODE-10).
        if (hangRevisionsAfterFirst && revisionsCalls > 1) return new Promise(() => {});
        if (failRevisionsAfterFirst && revisionsCalls > 1) return { ok: false, json: async () => ({ error: "Revisions could not be loaded." }) };
        // IFC-CODE-09: the initial revisions fetch rejects outright.
        if (fail.revisions) return { ok: false, json: async () => ({ error: "Revisions could not be loaded." }) };
        // PR #808 fix round: return a fresh snapshot per response,
        // as a real HTTP round-trip would — the map is mutated by
        // later POSTs, and handing out the live array would let a
        // newly issued revision leak into already-cached data
        // without any refetch, masking the stale-cache race the
        // revalidation tests are proving.
        return { ok: true, json: async () => ({ revisions: [...(revisionsMap[drawingId] || [])] }) };
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
        // Slice-7 IFC revision-code fix: the real API returns the
        // toCamelRelease() shape — the release carries ifcRevisionId,
        // never a bare ifcRevisionCode — and issuing creates the IFC
        // revision row the release points at. The fixture mirrors
        // that, so the release row renders from the same data live
        // does.
        const revision = { id: "forge_wpdrv_ifc_9", revisionCode: body.ifcRevisionCode, issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-13T12:00:00Z" };
        (revisionsMap[drawingId] = revisionsMap[drawingId] || []).push(revision);
        const release = { id: "forge_wpdifc_9", ifcRevisionId: revision.id, reviewId: body.reviewId, releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true };
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
        const field = { id: "forge_wpdfr_9", drawingRevisionId: body.drawingRevisionId, artifactRef: body.artifactRef, sha256: body.sha256, fieldReason: body.fieldReason, recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-13T11:00:00Z" };
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

// Slice-7 IFC revision-code fix: the release rows under the "IFC
// releases" heading, as rendered text per row — so a test can assert
// which code and active/retired label belong to the SAME row, not
// merely that both strings appear somewhere on the page.
function releaseRows(container) {
  const heading = [...container.querySelectorAll("p")].find((p) => p.textContent === "IFC releases");
  const list = heading?.parentElement?.querySelector("ul");
  return list ? [...list.querySelectorAll("li")].map((li) => li.textContent) : [];
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
    expect(container.textContent).toContain("Drawings awaiting review");
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
    expect(container.textContent).toContain("Rev 0 (IFA) · Round 1 — Open");
    expect(container.textContent).toContain("No IFC release yet");
  });

  it("expands a review round to show redlines and the decision form", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { findButton(container, "Rev 0 (IFA) · Round 1 — Open").click(); });
    await act(async () => {});
    expect(container.textContent).toContain("Move this nozzle 50 mm up.");
    expect(container.textContent).toContain("REQUIRED");
    expect(container.textContent).toContain("Decide this round");
    expect(container.textContent).toContain("Add a redline");
    // Slice-7 follow-ups (Finding 2): history in plain words — the
    // occurredAt timestamp, the friendly event and outcome, the
    // bound revision, and a truthful actor attribution. No raw enum,
    // no actor ID fragment: the mock actor is Jason's own auth UUID
    // ending in 43af922e — the fragment the live screenshot showed
    // beside a REVIEW_* event under the old row.
    const history = [...container.querySelectorAll("p")].find((p) => p.textContent === "History").parentElement;
    expect(history.textContent).toContain("11/8/2026");
    expect(history.textContent).toContain("Review opened");
    expect(history.textContent).toContain("Rev 0 (IFA)");
    expect(history.textContent).toContain("Recorded by a team member");
    expect(history.textContent).not.toContain("REVIEW_OPENED");
    expect(history.textContent).not.toContain("e1b22131");
    expect(history.textContent).not.toContain("43af922e");
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
    expect(container.textContent).toContain("Rev 1 (IFA) · Round 1 — Open");
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
    expect(container.textContent).toContain("Rev 0 (IFA) · Round 1 — Open");
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
    expect(container.textContent).toContain("Rev 1 (IFA) · Round 1 — Open");
  });

  it("shows the round's exact bound revision in the summary and detail, not the latest", async () => {
    // The dwg_1 round is bound to Rev 0 (forge_wpdrv_1) while Rev 1
    // is the latest revision — the round must name Rev 0.
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const item = roundItem(container, "Rev 0 (IFA) · Round 1 — Open");
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Drawing P-101 · Rev 0 (IFA)");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
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
    const item = roundItem(container, "Revision unavailable · Round 1");
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Revision record unavailable (ID ");
    await expandRound(container, "Revision unavailable · Round 1");
    expect(item.textContent).toContain("Revision under review: Revision record unavailable (ID ");
  });

  it("confirms adding a redline with drawing and bound revision", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
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
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
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
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    await act(async () => { setText(container, "decision-reason-forge_wpdrvw_1", "Looks good."); });
    await act(async () => { findButton(container, "Record decision").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Review decision recorded for drawing P-101, Rev 0 (IFA): approved.");
  });

  // Slice-7 confirmation-placement fix (R2): a failed mutation
  // clears only ITS OWN success state. A stale confirmation from a
  // different action (here: the redline) stays beside that action's
  // form — it is never cleared by an unrelated failure. This test
  // previously encoded the old shared-notice rule ("a failed decision
  // clears the stale one"); the brief's R2 supersedes it.
  it("a failed decision shows the error and no decision notice, keeping the redline confirmation beside the redline form", async () => {
    setupFetch({ fail: { decision: true } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    // A successful redline first, so a confirmation exists beside
    // the redline form.
    await act(async () => { setText(container, "redline-comment-forge_wpdrvw_1", "Check the weld note."); });
    await act(async () => { findButton(container, "Add redline").click(); });
    await act(async () => {});
    await act(async () => {});
    expect(container.querySelector('[role="status"]').textContent).toContain("Redline added");
    // The failing decision must show the error and no decision
    // confirmation — and must NOT clear the redline confirmation.
    await act(async () => { setText(container, "decision-reason-forge_wpdrvw_1", "Looks good."); });
    await act(async () => { findButton(container, "Record decision").click(); });
    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toContain("Review is stale");
    expect(container.textContent).not.toContain("Review decision recorded");
    const statuses = [...container.querySelectorAll('[role="status"]')];
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toContain("Redline added");
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

  // Slice-7 confirmation-placement fix (R2): a failed mutation
  // clears only ITS OWN success state. A stale confirmation from a
  // different action (here: the stage) stays beside that action's
  // form — it is never cleared by an unrelated failure. This test
  // previously encoded the old shared-notice rule ("clears a stale
  // stage notice on failure"); the brief's R2 supersedes it.
  it("confirms issuing an IFC revision with drawing and code, and a failed issue keeps the stage notice beside the stage form", async () => {
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
    expect(container.textContent).not.toContain("IFC revision 2 for drawing ISO-200 issued for construction.");
    // The stage confirmation is untouched by the failed issue.
    const statuses = [...container.querySelectorAll('[role="status"]')];
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toContain("staged for drawing ISO-200");
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
    // Two confirmations are present (stage + issue); read the issue
    // confirmation from the issue form's footer, not the first status
    // in the drawing, which is the stage confirmation.
    const notice = findButton(container, "Issue IFC revision").closest("form").querySelector('[role="status"]');
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
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" }],
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
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" }],
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
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_missing", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" }],
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
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" }],
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
    // Slice-7 IFC revision-code fix: releases mirror the real
    // toCamelRelease() shape — ifcRevisionId pointing at an IFC
    // revision in the loaded list, never a fictional
    // ifcRevisionCode field — and rows render "IFC Rev N".
    setupFetch({
      revisionsMap: {
        dwg_1: [
          { id: "forge_wpdrv_4", revisionCode: "2", issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-13T10:00:00Z" },
          { id: "forge_wpdrv_3", revisionCode: "1", issuedAs: "IFC", retiredAt: "2026-11-13T11:00:00Z", createdAt: "2026-11-10T10:00:00Z" },
          ...defaultRevisions().dwg_1,
        ],
      },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_4", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
          { id: "forge_wpdifc_1", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_1", releasedAt: "2026-11-10T12:00:00Z", retiredAt: "2026-11-13T11:00:00Z", isActive: false },
        ],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("IFC Rev 2 · released");
    expect(container.textContent).toContain("· active");
    expect(container.textContent).toContain("IFC Rev 1 · released");
    expect(container.textContent).toContain("· retired");
    expect(container.textContent).not.toContain("superseded");
  });
});

// Slice-7 save-confirmation placement fix (brief 2026-11-15, R1/R2):
// jsdom cannot measure viewport rectangles (getBoundingClientRect
// returns zeros), so these tests assert PLACEMENT — each confirmation
// renders inside its own action's form or, where the form closes on
// success, at that action's retained location in the same section —
// never at the top of the card — plus wording (brief 4B) and
// isolation (brief 4C). Real viewport geometry (in-viewport
// immediately after success, no scroll, no horizontal clipping,
// desktop 1280x800 + phone 390x844) is proven by the Playwright
// placement spec in e2e/placement/ (brief 4A).
describe("WorkPackageDrawingReadiness confirmation placement", () => {
  // The status belonging to the action whose submit button reads
  // `buttonText`: the [role="status"] inside that button's form.
  function statusInForm(container, buttonText) {
    const button = findButton(container, buttonText);
    if (!button) return null;
    const form = button.closest("form");
    return form ? form.querySelector('[role="status"]') : null;
  }

  it("PLACEMENT-stage: the stage confirmation renders inside the stage form, not at the top of the drawing", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "ISO-200");
    setStageFile(container);
    await submitStageForm(container);
    const statuses = [...container.querySelectorAll('[role="status"]')];
    expect(statuses).toHaveLength(1);
    const notice = statusInForm(container, "Stage IFC PDF");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("IFC PDF W-0005-1-TEST-ISO-IFC.pdf staged for drawing ISO-200 — it is staged, not yet issued.");
    // The old card-top notice was a direct child of the expanded
    // body; this one is nested inside its action's form.
    expect(notice.closest("form")).not.toBeNull();
  });

  it("PLACEMENT-review: the review-open confirmation stays in the Review rounds section after the form closes itself", async () => {
    setupFetch({ fixture: singleDrawingFixture(), reviewsMap: { dwg_1: [] } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "review-rev-dwg_1", "forge_wpdrv_2"); });
    await act(async () => { findButton(container, "Open review").click(); });
    await act(async () => {});
    await act(async () => {});
    // The form hid itself (an open round exists now) but the
    // confirmation must remain at the section's location.
    expect(findButton(container, "Open review")).toBeUndefined();
    const section = [...container.querySelectorAll("p")].find((p) => p.textContent === "Review rounds").parentElement;
    const notice = section.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Review round opened for drawing P-101, Rev 1.");
  });

  it("PLACEMENT-redline: the redline confirmation renders inside the redline form", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    await act(async () => { setText(container, "redline-comment-forge_wpdrvw_1", "Check the weld note."); });
    await act(async () => { findButton(container, "Add redline").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = statusInForm(container, "Add redline");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Redline added to drawing P-101, Rev 0 (IFA).");
  });

  it("PLACEMENT-resolve: an accepted-as-noted redline confirms in its own redline item, after the resolve form closes", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    await act(async () => { findButton(container, "Resolve").click(); });
    await act(async () => { selectOption(container, "resolve-forge_wpdrl_1", "ACCEPTED_AS_NOTED"); });
    await act(async () => { findButton(container, "Save resolution").click(); });
    await act(async () => {});
    await act(async () => {});
    // The resolve form closed; the confirmation stays in the
    // redline item it belongs to — and says accepted as noted,
    // not simply resolved (brief 4B).
    expect(findButton(container, "Save resolution")).toBeUndefined();
    const item = [...container.querySelectorAll("li")].find((li) => li.textContent.includes("Move this nozzle 50 mm up."));
    const notice = item.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Redline accepted as noted for drawing P-101, Rev 0 (IFA).");
  });

  it("PLACEMENT-decision: the decision confirmation stays in the round detail after both forms close", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    await act(async () => { setText(container, "decision-reason-forge_wpdrvw_1", "Looks good."); });
    await act(async () => { findButton(container, "Record decision").click(); });
    await act(async () => {});
    await act(async () => {});
    // Both forms closed with the round; the confirmation must
    // remain in the round detail, not vanish with the form.
    expect(findButton(container, "Record decision")).toBeUndefined();
    expect(findButton(container, "Add redline")).toBeUndefined();
    const round = findButton(container, "Round 1").closest("li");
    const notice = round.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Review decision recorded for drawing P-101, Rev 0 (IFA): approved.");
  });

  it("WORDING-decision: a returned-to-drafter decision says so in plain words", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    await act(async () => { selectOption(container, "decision-forge_wpdrvw_1", "RETURN_TO_DRAFTER"); });
    await act(async () => { setText(container, "decision-reason-forge_wpdrvw_1", "Needs a rework."); });
    await act(async () => { findButton(container, "Record decision").click(); });
    await act(async () => {});
    await act(async () => {});
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Review decision recorded for drawing P-101, Rev 0 (IFA): returned to drafter.");
  });

  it("ISOLATION-stage+issue: stage and issue confirmations coexist, each inside its own form", async () => {
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
    const statuses = [...container.querySelectorAll('[role="status"]')];
    expect(statuses).toHaveLength(2);
    expect(statusInForm(container, "Stage IFC PDF").textContent).toContain("staged for drawing ISO-200");
    expect(statusInForm(container, "Issue IFC revision").textContent).toBe("IFC revision 2 for drawing ISO-200 issued for construction.");
  });

  it("ISOLATION-redline+decision: both confirmations survive, each at its own action's location", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    await act(async () => { setText(container, "redline-comment-forge_wpdrvw_1", "Check the weld note."); });
    await act(async () => { findButton(container, "Add redline").click(); });
    await act(async () => {});
    await act(async () => {});
    await act(async () => { setText(container, "decision-reason-forge_wpdrvw_1", "Looks good."); });
    await act(async () => { findButton(container, "Record decision").click(); });
    await act(async () => {});
    await act(async () => {});
    // The round closed, so the redline form is gone — but its
    // confirmation moved to the retained location alongside the
    // decision confirmation. Neither action's success appears
    // beside the other; each names its own action.
    const statuses = [...container.querySelectorAll('[role="status"]')];
    expect(statuses).toHaveLength(2);
    expect(statuses.map((s) => s.textContent)).toContain("Redline added to drawing P-101, Rev 0 (IFA).");
    expect(statuses.map((s) => s.textContent)).toContain("Review decision recorded for drawing P-101, Rev 0 (IFA): approved.");
  });

  it("ISOLATION-failure: a failed field capture clears no other action's confirmation", async () => {
    setupFetch({ fail: { field: true } });
    const { container } = await renderPanel();
    // The stage form only renders on a drawing with an approved
    // review (ISO-200); the field form lives on P-101.
    await expandDrawing(container, "ISO-200");
    setStageFile(container);
    await submitStageForm(container);
    expect(container.querySelector('[role="status"]').textContent).toContain("staged for drawing ISO-200");
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "field-rev-dwg_1", "forge_wpdrv_2"); });
    await act(async () => { setText(container, "field-ref-dwg_1", "scan-1.pdf"); });
    await act(async () => { setText(container, "field-sha-dwg_1", "d".repeat(64)); });
    await act(async () => { setText(container, "field-reason-dwg_1", "Marked up on site."); });
    await act(async () => { findButton(container, "Capture field hand-redline").click(); });
    await act(async () => {});
    await act(async () => {});
    expect(container.textContent).toContain("Could not capture the field hand-redline.");
    const statuses = [...container.querySelectorAll('[role="status"]')];
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toContain("staged for drawing ISO-200");
  });

  it("PLACEMENT-field: the field hand-redline confirmation renders inside the field form", async () => {
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
    const notice = statusInForm(container, "Capture field hand-redline");
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain("Field hand-redline captured for drawing P-101, Rev 1 (IFA) as a historical record.");
    expect(notice.textContent).toContain("It is not an issued IFC revision.");
  });

  it("PLACEMENT-reconcile: the reconcile confirmation stays in the field item after its form closes", async () => {
    setupFetch({
      fieldRedlinesMap: {
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" }],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { selectOption(container, "recon-rev-forge_wpdfr_1", "forge_wpdrv_2"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Reconcile").click(); });
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    expect(findButton(container, "Reconcile")).toBeUndefined();
    const item = [...container.querySelectorAll("li")].find((li) => li.textContent.includes("Marked up on site."));
    const notice = item.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Field hand-redline reconciled for drawing P-101, Rev 0 (IFA), reconciled as Rev 1 (IFA).");
  });

  it("PLACEMENT-retire: the retire confirmation stays in the drawing after the retire form closes", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    await act(async () => { findButton(container, "Retire drawing").click(); });
    await act(async () => { setText(container, "retire-reason-dwg_1", "Superseded by a new package."); });
    await act(async () => { findButton(container, "Retire drawing").click(); });
    await act(async () => {});
    await act(async () => {});
    // The confirm form closed (its reason input is gone). The mock
    // does not flip the drawing row to retired, so the trigger button
    // shows again — in the live app the retired row hides it, and the
    // section-level confirmation survives either way.
    expect(container.querySelector("#retire-reason-dwg_1")).toBeNull();
    const notice = container.querySelector('[role="status"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toBe("Drawing P-101 retired. Its review history is kept.");
  });
});

// Slice-7 IFC revision-code fix (brief 2026-11-14): the release row
// reads its code from the same drawing's loaded revisions, matched by
// the persisted ifcRevisionId — the read model never exposes
// ifcRevisionCode, so the old row rendered blank. Every fixture here
// mirrors the real toCamelRelease() shape (ifcRevisionId, releasedAt,
// retiredAt, isActive) and never supplies a fictional
// ifcRevisionCode field.
describe("WorkPackageDrawingReadiness IFC revision code", () => {
  const ifcRevisions = () => ([
    { id: "forge_wpdrv_3", revisionCode: "2", issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-13T10:00:00Z" },
    { id: "forge_wpdrv_6", revisionCode: "5", issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-14T10:00:00Z" },
  ]);

  it("IFC-CODE-01: one matched release shows its own IFC Rev code and active state", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [...ifcRevisions(), ...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const rows = releaseRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("IFC Rev 2");
    expect(rows[0]).toContain("released");
    expect(rows[0]).toContain("· active");
    expect(rows[0]).not.toContain("IFC revision ·");
    expect(rows[0]).not.toContain("unavailable");
  });

  it("IFC-CODE-02: two releases each show their own code with independent active/retired labels", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [...ifcRevisions(), ...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
          { id: "forge_wpdifc_5", ifcRevisionId: "forge_wpdrv_6", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-14T12:00:00Z", retiredAt: "2026-11-14T13:00:00Z", isActive: false },
        ],
      },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const rows = releaseRows(container);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("IFC Rev 2");
    expect(rows[0]).toContain("· active");
    expect(rows[0]).not.toContain("retired");
    expect(rows[1]).toContain("IFC Rev 5");
    expect(rows[1]).toContain("· retired");
    expect(rows[1]).not.toContain("· active");
    expect(container.textContent).not.toContain("superseded");
  });

  it("IFC-CODE-03: shuffled revisions and releases stay bound to their IDs, never to order", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      // Revisions reversed (Rev 5 before Rev 2) and releases reversed
      // (retired Rev 5 first) — a position-based label would swap them.
      revisionsMap: { dwg_1: [...ifcRevisions().reverse(), ...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_5", ifcRevisionId: "forge_wpdrv_6", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-14T12:00:00Z", retiredAt: "2026-11-14T13:00:00Z", isActive: false },
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const rows = releaseRows(container);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("IFC Rev 5");
    expect(rows[0]).toContain("· retired");
    expect(rows[1]).toContain("IFC Rev 2");
    expect(rows[1]).toContain("· active");
  });

  it("IFC-CODE-04: a referenced revision ID absent after fetch reports unavailable with the full ID", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_9", ifcRevisionId: "forge_wpdrv_missing", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const rows = releaseRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("IFC revision record unavailable (ID forge_wpdrv_missing)");
    expect(rows[0]).toContain("· active");
    expect(rows[0]).not.toContain("IFC Rev");
  });

  it("IFC-CODE-05: while revisions are still loading the row says loading, never unavailable or blank", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [...ifcRevisions(), ...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      reviewsMap: { dwg_1: [] },
      hangRevisions: true,
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const rows = releaseRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("IFC revision loading…");
    expect(rows[0]).toContain("· active");
    expect(rows[0]).not.toContain("unavailable");
    expect(rows[0]).not.toContain("IFC Rev");
  });

  it("IFC-CODE-06: a missing reference and a non-IFC match each get an explicit truthful fallback", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [...ifcRevisions(), ...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_8", ifcRevisionId: "", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
          // Points at Rev 1, which is IFA — must never be labelled IFC.
          { id: "forge_wpdifc_7", ifcRevisionId: "forge_wpdrv_2", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T11:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      reviewsMap: { dwg_1: [] },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const rows = releaseRows(container);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("IFC revision reference missing");
    expect(rows[1]).toContain("inconsistent");
    expect(rows[1]).toContain("not IFC");
    expect(rows[1]).toContain("ID forge_wpdrv_2");
    expect(rows[1]).not.toContain("IFC Rev 1");
  });

  it("IFC-CODE-07: review rounds, redlines, staged IFC and release rows are unchanged, with unchanged server payloads", async () => {
    const { calls } = setupFetch({
      revisionsMap: { dwg_1: [...ifcRevisions(), ...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    // The matched release row still renders alongside the rounds.
    expect(releaseRows(container)[0]).toContain("IFC Rev 2");
    expect(container.textContent).toContain("Rev 0 (IFA) · Round 1 — Open");
    // Redline flow: same payload as before the fix.
    await expandRound(container, "Rev 0 (IFA) · Round 1 — Open");
    await act(async () => { setText(container, "redline-comment-forge_wpdrvw_1", "Check the weld note."); });
    await act(async () => { findButton(container, "Add redline").click(); });
    await act(async () => {});
    await act(async () => {});
    const redlinePost = calls.find((c) => c.method === "POST" && c.url.includes("/redlines") && !c.url.includes("/reconcile"));
    expect(redlinePost).toBeDefined();
    expect(JSON.parse(redlinePost.body).drawingRevisionId).toBe("forge_wpdrv_1");
    const p101Item = findButton(container, "P-101").closest("li");
    expect(p101Item.querySelector('[role="status"]').textContent).toBe("Redline added to drawing P-101, Rev 0 (IFA).");
    // Staged-IFC flow on the second drawing: same payloads as before.
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
    const issuePost = calls.find((c) => c.method === "POST" && c.url.includes("/ifc-releases"));
    expect(issuePost).toBeDefined();
    const issueBody = JSON.parse(issuePost.body);
    expect(issueBody.ifcRevisionCode).toBe("2");
    expect(issueBody.stagedArtifactId).toBe("forge_wpa_9");
    expect(issueBody.reviewId).toBe("forge_wpdrvw_2");
    const iso200Item = findButton(container, "ISO-200").closest("li");
    // Two confirmations are present (stage + issue); read the issue
    // confirmation from the issue form's footer, not the first status
    // in the drawing, which is the stage confirmation.
    const issueNotice = findButton(iso200Item, "Issue IFC revision").closest("form").querySelector('[role="status"]');
    expect(issueNotice).not.toBeNull();
    expect(issueNotice.textContent).toBe("IFC revision 2 for drawing ISO-200 issued for construction.");
    // The P-101 release row survived the mutations untouched.
    expect(releaseRows(container)[0]).toContain("IFC Rev 2");
  });

  it("IFC-CODE-08: a cached revisions list missing a new release's ID stays loading while revalidation is pending", async () => {
    setupFetch({
      revisionsMap: {
        dwg_2: [
          { id: "forge_wpdrv_3", revisionCode: "2", issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-13T10:00:00Z" },
          ...defaultRevisions().dwg_2,
        ],
      },
      releasesMap: {
        dwg_2: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      // The first revisions fetch settles (seeding the cache); the
      // revalidation after the issue hangs, so the component renders
      // stale cached revisions while a refresh is in flight.
      hangRevisionsAfterFirst: true,
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "ISO-200");
    let rows = releaseRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("IFC Rev 2");
    // Issue a second IFC revision (code 3). The POST creates its
    // revision + release, then refreshAll() revalidates revisions
    // and releases in parallel: the releases refresh settles with
    // the new release while the revisions revalidation is still in
    // flight.
    setStageFile(container);
    await submitStageForm(container);
    await act(async () => { selectOption(container, "ifc-rev-dwg_2", "forge_wpdrvw_2"); });
    await act(async () => { setText(container, "ifc-code-dwg_2", "3"); });
    await act(async () => { selectOption(container, "ifc-file-dwg_2", "forge_wpa_9"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Issue IFC revision").click(); });
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    rows = releaseRows(container);
    expect(rows).toHaveLength(2);
    // The old release still renders its exact code from cached data;
    // the new release — whose revision is not in the stale cached
    // list — stays loading while the revalidation is pending, and
    // must never claim the record is unavailable.
    expect(rows[0]).toContain("IFC Rev 2");
    expect(rows[1]).toContain("IFC revision loading…");
    expect(rows[1]).not.toContain("unavailable");
    expect(rows[1]).not.toContain("IFC Rev");
  });

  it("IFC-CODE-09: a revisions fetch that fails outright reports load failure, never perpetual loading or unavailable", async () => {
    setupFetch({
      fixture: singleDrawingFixture(),
      revisionsMap: { dwg_1: [...ifcRevisions(), ...defaultRevisions().dwg_1] },
      releasesMap: {
        dwg_1: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      reviewsMap: { dwg_1: [] },
      fail: { revisions: true },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const rows = releaseRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("IFC revision load failed");
    expect(rows[0]).toContain("unable to verify");
    expect(rows[0]).toContain("ID forge_wpdrv_3");
    expect(rows[0]).toContain("· active");
    expect(rows[0]).not.toContain("IFC revision loading…");
    expect(rows[0]).not.toContain("unavailable");
    expect(rows[0]).not.toContain("IFC Rev");
  });

  it("IFC-CODE-10: a failed revalidation with stale cached revisions reports load failure for the unmatched release", async () => {
    setupFetch({
      revisionsMap: {
        dwg_2: [
          { id: "forge_wpdrv_3", revisionCode: "2", issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-13T10:00:00Z" },
          ...defaultRevisions().dwg_2,
        ],
      },
      releasesMap: {
        dwg_2: [
          { id: "forge_wpdifc_2", ifcRevisionId: "forge_wpdrv_3", reviewId: "forge_wpdrvw_2", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
        ],
      },
      // The first revisions fetch settles (seeding the cache); the
      // revalidation after the issue fails, leaving stale cached
      // data plus the error.
      failRevisionsAfterFirst: true,
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "ISO-200");
    let rows = releaseRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("IFC Rev 2");
    // Issue a second IFC revision (code 3). The POST creates its
    // revision + release, then refreshAll() revalidates: the releases
    // refresh settles with the new release while the revisions
    // revalidation fails. The matched old release still renders its
    // exact code from the stale cache; the unmatched new release
    // must say the code could not be verified, never "unavailable".
    setStageFile(container);
    await submitStageForm(container);
    await act(async () => { selectOption(container, "ifc-rev-dwg_2", "forge_wpdrvw_2"); });
    await act(async () => { setText(container, "ifc-code-dwg_2", "3"); });
    await act(async () => { selectOption(container, "ifc-file-dwg_2", "forge_wpa_9"); });
    await act(async () => {});
    await act(async () => { findButton(container, "Issue IFC revision").click(); });
    await act(async () => {});
    await act(async () => {});
    await act(async () => {});
    rows = releaseRows(container);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("IFC Rev 2");
    expect(rows[1]).toContain("IFC revision load failed");
    expect(rows[1]).toContain("unable to verify");
    expect(rows[1]).toContain("ID forge_wpdrv_ifc_9");
    expect(rows[1]).not.toContain("unavailable");
    expect(rows[1]).not.toContain("IFC revision loading…");
  });
});

// Slice-7 follow-ups (brief 2026-11-15): duplicate Round 1 labels,
// raw history identifiers, and the "Pending review" 0 beside an OPEN
// round — all display-only, all proven against the real API shapes
// (occurredAt / capturedAt from the mappers, never createdAt).
describe("WorkPackageDrawingReadiness Slice-7 follow-ups", () => {
  it("F1: the shared round formatter names the bound revision, never renumbers", () => {
    const revisions = [
      { id: "forge_wpdrv_2", revisionCode: "1", issuedAs: "IFA", retiredAt: null },
      { id: "forge_wpdrv_1", revisionCode: "0", issuedAs: "IFA", retiredAt: null },
    ];
    const rev0Round = { roundNo: 1, state: "OPEN", drawingRevisionId: "forge_wpdrv_1" };
    const rev1Round = { roundNo: 1, state: "APPROVED", drawingRevisionId: "forge_wpdrv_2" };
    expect(formatReviewRoundLabel(rev0Round, revisions, true)).toBe("Rev 0 (IFA) · Round 1 — Open");
    expect(formatReviewRoundLabel(rev1Round, revisions, true)).toBe("Rev 1 (IFA) · Round 1 — Approved");
    // Same round number on two revisions is two distinct rounds, not a duplicate.
    expect(formatReviewRoundLabel(rev0Round, revisions, true)).not.toBe(formatReviewRoundLabel(rev1Round, revisions, true));
    // State words are human, never the raw enum.
    expect(formatReviewRoundLabel({ ...rev0Round, state: "APPROVED_WITH_REDLINES" }, revisions, true)).toContain("Approved with redlines");
    expect(formatReviewRoundLabel({ ...rev0Round, state: "RETURNED" }, revisions, true)).toContain("Returned to drafter");
    expect(formatReviewRoundLabel({ ...rev0Round, state: "CANCELLED" }, revisions, true)).toContain("Cancelled");
    // Loading and missing are distinct neutral states, no raw ID.
    expect(formatReviewRoundLabel(rev0Round, [], false)).toBe("Revision loading… · Round 1");
    expect(formatReviewRoundLabel({ ...rev0Round, drawingRevisionId: "forge_wpdrv_missing" }, revisions, true)).toBe("Revision unavailable · Round 1");
  });

  it("F1: two genuine Round 1s on Rev 0 and Rev 1 render distinctly", async () => {
    setupFetch({
      reviewsMap: {
        dwg_1: [
          { id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-08T11:00:00Z" },
          { id: "forge_wpdrvw_2", roundNo: 1, state: "APPROVED", version: 2, drawingRevisionId: "forge_wpdrv_2", openedAt: "2026-11-09T11:00:00Z" },
        ],
        dwg_2: [],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Rev 0 (IFA) · Round 1 — Open");
    expect(container.textContent).toContain("Rev 1 (IFA) · Round 1 — Approved");
    // Both buttons exist as separate elements.
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent.includes("Round 1")).length).toBe(2);
    expect(container.textContent).toContain("Open review rounds: 1");
    expect(container.textContent).not.toContain("Review numbering needs verification");
  });

  it("F1: two rounds sharing revision AND round number warn and stay distinct by opened date", async () => {
    setupFetch({
      reviewsMap: {
        dwg_1: [
          { id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-08T11:00:00Z" },
          { id: "forge_wpdrvw_9", roundNo: 1, state: "OPEN", version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-09T11:00:00Z" },
        ],
        dwg_2: [],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    // Both render with the same label — that IS the problem being
    // surfaced, not hidden by renumbering — and the warning names it.
    expect([...container.querySelectorAll("button")].filter((b) => b.textContent === "Rev 0 (IFA) · Round 1 — Open").length).toBe(2);
    expect(container.textContent).toContain("Review numbering needs verification");
    // The two records stay distinct by the dates they opened.
    expect(container.textContent).toContain("opened 11/8/2026");
    expect(container.textContent).toContain("opened 11/9/2026");
    expect(container.textContent).toContain("Open review rounds: 2");
  });

  it("F1: the accepted-review IFC picker uses the same revision-qualified label", async () => {
    setupFetch();
    const { container } = await renderPanel();
    await expandDrawing(container, "ISO-200");
    const select = container.querySelector("#ifc-rev-dwg_2");
    expect(select).not.toBeNull();
    const options = [...select.querySelectorAll("option")].map((o) => o.textContent);
    expect(options).toContain("Rev B (IFA) · Round 1 — Approved");
    expect(options).not.toContain("Round 1 — APPROVED");
  });

  it("F2: every Slice-7 event type and outcome has a plain-words form, unknowns fall back without raw tokens", () => {
    expect(reviewEventDescription("REVIEW_OPENED")).toBe("Review opened");
    expect(reviewEventDescription("REDLINE_ADDED")).toBe("Redline added");
    expect(reviewEventDescription("REDLINE_RESOLVED")).toBe("Redline resolved");
    expect(reviewEventDescription("REDLINE_RETIRED")).toBe("Redline retired");
    expect(reviewEventDescription("REVIEW_APPROVED")).toBe("Review approved");
    expect(reviewEventDescription("REVIEW_APPROVED_WITH_REDLINES")).toBe("Review approved with redlines");
    expect(reviewEventDescription("REVIEW_RETURNED")).toBe("Review returned to drafter");
    expect(reviewEventDescription("REVIEW_CANCELLED")).toBe("Review cancelled");
    expect(reviewEventDescription("IFC_RELEASED")).toBe("IFC released");
    expect(reviewEventDescription("IFC_RELEASE_RETIRED")).toBe("IFC release retired");
    expect(reviewEventDescription("DRAWING_RETIRED")).toBe("Drawing retired");
    expect(reviewEventDescription("FIELD_REDLINE_CAPTURED")).toBe("Field hand-redline captured");
    expect(reviewEventDescription("FIELD_REDLINE_RECONCILED")).toBe("Field hand-redline reconciled");
    expect(reviewEventDescription("SOMETHING_NEW")).toBe("Review activity recorded");
    expect(reviewOutcomeLabel("OPEN")).toBe("Open");
    expect(reviewOutcomeLabel("APPROVED_WITH_REDLINES")).toBe("Approved with redlines");
    expect(reviewOutcomeLabel("RETURNED")).toBe("Returned to drafter");
    expect(reviewOutcomeLabel("CANCELLED")).toBe("Cancelled");
    expect(reviewOutcomeLabel("IFC")).toBe("Issued for construction");
    expect(reviewOutcomeLabel("HISTORICAL_PENDING_RECONCILIATION")).toBe("Awaiting reconciliation");
    expect(reviewOutcomeLabel("RECONCILED")).toBe("Reconciled");
    expect(reviewOutcomeLabel("UNKNOWN_STATE")).toBeNull();
    // A full row: timestamp from occurredAt, description, bound
    // revision, outcome, attribution — no actor ID anywhere.
    const row = formatReviewEvent(
      { eventType: "REVIEW_APPROVED_WITH_REDLINES", occurredAt: "2026-11-09T12:00:00Z", afterState: "APPROVED_WITH_REDLINES", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
      "Rev 0 (IFA)",
    );
    expect(row).toContain("11/9/2026");
    expect(row).toContain("Review approved with redlines");
    expect(row).toContain("Rev 0 (IFA)");
    expect(row).toContain("Approved with redlines");
    expect(row).toContain("Recorded by a team member");
    expect(row).not.toContain("43af922e");
    // A release event carries no round-revision label — the released
    // revision is not the round's revision.
    const releaseRow = formatReviewEvent(
      { eventType: "IFC_RELEASED", occurredAt: "2026-11-13T12:00:00Z", afterState: "IFC", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
      "Rev 0 (IFA)",
    );
    expect(releaseRow).toContain("IFC released");
    expect(releaseRow).toContain("Issued for construction");
    expect(releaseRow).not.toContain("Rev 0 (IFA)");
    // Unknown event and outcome: friendly fallback, outcome omitted.
    const unknownRow = formatReviewEvent(
      { eventType: "FUTURE_EVENT", occurredAt: "2026-11-13T12:00:00Z", afterState: "FUTURE_STATE", actorId: "x" },
      "Rev 0 (IFA)",
    );
    expect(unknownRow).toContain("Review activity recorded");
    expect(unknownRow).not.toContain("FUTURE_EVENT");
    expect(unknownRow).not.toContain("FUTURE_STATE");
  });

  it("F2: a field reference shows only when it reads as one — opaque IDs say the reference was recorded", () => {
    expect(fieldArtifactReference("scan-1.pdf")).toBe("Reference: scan-1.pdf");
    expect(fieldArtifactReference("e1b22131-9100-4a79-bbe2-b82d43af922e")).toBe("Reference recorded");
    expect(fieldArtifactReference("a".repeat(64))).toBe("Reference recorded");
    expect(fieldArtifactReference("")).toBeNull();
    expect(fieldRecordStateLabel("HISTORICAL_PENDING_RECONCILIATION")).toBe("Awaiting reconciliation");
    expect(fieldRecordStateLabel("RECONCILED")).toBe("Reconciled");
    expect(fieldRecordStateLabel("RETIRED")).toBe("Retired");
  });

  it("F2: field hand-redline history shows a human state, the captured timestamp and a labelled reference", async () => {
    setupFetch({
      fieldRedlinesMap: {
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" }],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const history = [...container.querySelectorAll("p")].find((p) => p.textContent === "Field hand-redline history").parentElement;
    expect(history.textContent).toContain("Awaiting reconciliation");
    // The timestamp comes from capturedAt: the old row read
    // createdAt, which the mapper never exposes, and rendered "—".
    expect(history.textContent).toContain("11/8/2026");
    expect(history.textContent).toContain("Reference: scan-1.pdf");
    expect(history.textContent).not.toContain("HISTORICAL_PENDING_RECONCILIATION");
  });

  it("F2: an opaque-UUID field reference renders 'Reference recorded' with no ID fragment", async () => {
    setupFetch({
      fieldRedlinesMap: {
        dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "e1b22131-9100-4a79-bbe2-b82d43af922e", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" }],
      },
    });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    const history = [...container.querySelectorAll("p")].find((p) => p.textContent === "Field hand-redline history").parentElement;
    expect(history.textContent).toContain("Reference recorded");
    expect(history.textContent).not.toContain("43af922e");
    expect(history.textContent).not.toContain("e1b22131");
  });

  it("F3: the summary counts drawings awaiting review and spells out what it counts", async () => {
    setupFetch();
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Drawings awaiting review");
    expect(container.textContent).not.toContain("Pending review");
    expect(container.textContent).toContain("Counts drawings, not review rounds");
    expect(container.textContent).toContain("active IFC release does not count");
    // The default fixture has pendingReview 1 and a dwg_1 badge of
    // IFA — In review: the count and the badge agree, so no warning.
    expect(container.textContent).not.toContain("Readiness summary may be out of date");
  });

  it("F3: a 0 count beside an IFA In review badge shows the stale-summary warning with a manual retry", async () => {
    const fixture = readinessFixture();
    fixture.counts = { ...fixture.counts, pendingReview: 0 };
    setupFetch({ fixture });
    const { container } = await renderPanel();
    expect(container.textContent).toContain("Readiness summary may be out of date");
    expect(findButton(container, "Retry")).not.toBeUndefined();
  });

  it("F3: an active-IFC drawing with a historical OPEN round counts 0 in the summary and 1 in its own open-round count", async () => {
    const fixture = readinessFixture();
    fixture.drawings = [{
      ...fixture.drawings[0],
      badge: "IFC — Issued for construction", constructionUsable: true,
      activeIfcRelease: { id: "forge_wpdifc_1", ifcRevisionId: "forge_wpdrv_2", reviewId: "forge_wpdrvw_1", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true },
    }];
    fixture.counts = { ...fixture.counts, pendingReview: 0, ifcReleased: 1 };
    setupFetch({ fixture });
    const { container } = await renderPanel();
    // The 0 is correct here: an active IFC does not count — and no
    // stale warning fires, because the badge is IFC, not IFA In review.
    expect(container.textContent).not.toContain("Readiness summary may be out of date");
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Open review rounds: 1");
  });

  it("F3: the per-drawing open-round count says Loading… while the list is in flight, never a false 0", async () => {
    setupFetch({ hangReviews: true });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Open review rounds: Loading…");
    expect(container.textContent).not.toContain("Open review rounds: 0");
  });

  it("F3: a failed reviews fetch says the count is unavailable instead of 0", async () => {
    setupFetch({ fail: { reviews: true } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Open review rounds: unavailable");
    expect(container.textContent).not.toContain("Open review rounds: 0");
  });

  it("F3: a full 200-row reviews page labels the count as shown, not total", async () => {
    // listReviews pages at 200 rows and returns no total: a full
    // page means more rounds may exist beyond the loaded list.
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `forge_wpdrvw_${100 + i}`, roundNo: i + 1, state: i === 0 ? "OPEN" : "CANCELLED",
      version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-08T11:00:00Z",
    }));
    setupFetch({ reviewsMap: { dwg_1: many, dwg_2: [] } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Open rounds shown: 1");
    expect(container.textContent).not.toContain("Open review rounds: 1");
  });

  it("F3: below the 200-row cap the list is exhaustive, so the count reads as a total", async () => {
    const many = Array.from({ length: 199 }, (_, i) => ({
      id: `forge_wpdrvw_${100 + i}`, roundNo: i + 1, state: i === 0 ? "OPEN" : "CANCELLED",
      version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-08T11:00:00Z",
    }));
    setupFetch({ reviewsMap: { dwg_1: many, dwg_2: [] } });
    const { container } = await renderPanel();
    await expandDrawing(container, "P-101");
    expect(container.textContent).toContain("Open review rounds: 1");
    expect(container.textContent).not.toContain("Open rounds shown");
  });

  it("F3: two scopes of the same package keep their own readiness counts", async () => {
    const fixtureA = readinessFixture();
    const fixtureB = readinessFixture();
    fixtureB.counts = { ...fixtureB.counts, pendingReview: 0 };
    fixtureB.drawings = fixtureB.drawings.map((d) => ({ ...d, badge: "IFA — Approved; IFC not issued" }));
    setupFetch({ readinessByWorkspace: { ws_a: fixtureA, ws_b: fixtureB } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <>
          <div data-scope="a">
            <PackagePageProvider workspace="ws_a" forgeProject="proj_a">
              <WorkPackageDrawingReadiness packageId="pkg_1" />
            </PackagePageProvider>
          </div>
          <div data-scope="b">
            <PackagePageProvider workspace="ws_b" forgeProject="proj_b">
              <WorkPackageDrawingReadiness packageId="pkg_1" />
            </PackagePageProvider>
          </div>
        </>,
      );
    });
    await act(async () => {});
    const scopeA = container.querySelector('[data-scope="a"]');
    const scopeB = container.querySelector('[data-scope="b"]');
    // Scope A still shows its own 1; scope B shows its own 0 and no
    // stale warning, because its badges are not IFA In review.
    expect(scopeA.textContent).toContain("Drawings awaiting review");
    expect(scopeA.textContent.match(/Drawings awaiting review\s*1/)).not.toBeNull();
    expect(scopeB.textContent.match(/Drawings awaiting review\s*0/)).not.toBeNull();
    expect(scopeB.textContent).not.toContain("Readiness summary may be out of date");
  });
});
