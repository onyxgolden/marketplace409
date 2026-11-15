// Placement-harness API mock (plain script, no imports — loaded before
// the harness bundle). Ports the two vitest mocks verbatim in behavior:
// WorkPackageDrawingReadiness.test.jsx setupFetch() for the readiness
// panel, and WorkPackageDetailClient.test.jsx stubFetch() for the detail
// page. Stateful: POSTs mutate the maps, so refreshes reflect the
// mutation exactly as the unit mocks do.
//
// The `scenario` query param selects the fixture variant:
//   default        — P-101 with an OPEN round + ISO-200 APPROVED (stage,
//                    redline, resolve, decision, issue, field, retire)
//   no-open-round  — single P-101 drawing, no rounds (open a review round)
//   pending-field  — default + one pending field hand-redline (reconcile)
// The detail page uses the same mock (its endpoints are always served).
//
// Exposes window.__placementPatches (detail PATCH bodies, for the
// no-change-save assertion) and window.__placementCalls (all calls).
(function () {
  var scenario = new URLSearchParams(location.search).get("scenario") || "default";
  var SHA = "a".repeat(64);

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

  function singleDrawingFixture() {
    var fixture = readinessFixture();
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
    }];
    fixture.counts = {
      drawingsTotal: 1, ifcReleased: 0, pendingReview: 0,
      returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0,
    };
    return fixture;
  }

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

  var fixture = scenario === "no-open-round" ? singleDrawingFixture() : readinessFixture();
  var revisionsMap = defaultRevisions();
  var reviewsMap = scenario === "no-open-round"
    ? { dwg_1: [] }
    : defaultReviews();
  var releasesMap = {};
  var fieldRedlinesMap = scenario === "pending-field"
    ? { dwg_1: [{ id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", createdAt: "2026-11-08T12:00:00Z" }] }
    : {};
  var artifactsMap = {};
  var redlinesByReview = {
    forge_wpdrvw_1: [{ id: "forge_wpdrl_1", comment: "Move this nozzle 50 mm up.", severity: "REQUIRED", resolution: "OPEN", version: 1, anchorPage: 2 }],
  };

  var BASE_PKG = {
    id: "forge_wp_1", code: "WP-0001", title: "Turnover", status: "draft",
    description: null, package_type: "other", priority: "normal",
    project_id: null, property_id: null, planned_start: null, planned_finish: null,
    actual_start: null, actual_finish: null, percent_complete: 0, progress_basis: "pct_estimate",
    planned_qty: null, planned_unit: null, planned_manhours: null,
    earned_qty: null, earned_manhours: null, actual_manhours: null,
    responsible_party: null, scope_baseline_id: null, designated_verifier: null,
    blocked_reason: null, version: 1,
  };

  function ok(body) {
    return { ok: true, status: 200, json: async function () { return body; } };
  }
  function fail(body) {
    return { ok: false, status: 400, json: async function () { return body; } };
  }

  window.__placementPatches = [];
  window.__placementCalls = [];

  var realFetch = window.fetch.bind(window);
  window.fetch = async function (url, options) {
    options = options || {};
    var method = options.method || "GET";
    window.__placementCalls.push({ url: String(url), method: method });
    var parsed;
    try {
      parsed = new URL(String(url), location.origin);
    } catch (e) {
      return realFetch(url, options);
    }
    var path = parsed.pathname;

    // -- Readiness snapshot -------------------------------------------
    if (path === "/api/work-packages/pkg_1/drawings/readiness") {
      return ok(fixture);
    }

    // -- Per-drawing readiness endpoints -------------------------------
    var match = path.match(/^\/api\/work-packages\/pkg_1\/drawings\/(dwg_\d+)\/(revisions|reviews|ifc-releases|field-redlines|artifacts|ifc-stage|retire)(?:\/(.+))?$/);
    if (match) {
      var drawingId = match[1];
      var resource = match[2];
      var rest = match[3];
      if (resource === "reviews" && rest && rest.endsWith("/decision") && method === "POST") {
        var reviewId = rest.split("/")[0];
        var body = JSON.parse(options.body);
        var review = (reviewsMap[drawingId] || []).find(function (r) { return r.id === reviewId; });
        if (review) {
          review.state = body.decision === "RETURN_TO_DRAFTER" ? "RETURNED" : body.decision === "APPROVE_WITH_REDLINES" ? "APPROVED_WITH_REDLINES" : "APPROVED";
          review.version += 1;
          review.closedAt = "2026-11-13T12:00:00Z";
          review.decisionReason = body.reason;
        }
        return ok({ review: review });
      }
      if (resource === "reviews" && rest && rest.endsWith("/redlines") && method === "POST") {
        var redlineBody = JSON.parse(options.body);
        var redline = { id: "forge_wpdrl_2", comment: redlineBody.comment, severity: redlineBody.severity, resolution: "OPEN", version: 1, anchorPage: redlineBody.anchorPage != null ? redlineBody.anchorPage : null };
        var list = (redlinesByReview[rest.split("/")[0]] = redlinesByReview[rest.split("/")[0]] || []);
        list.push(redline);
        return ok({ redline: redline });
      }
      if (resource === "reviews" && rest && rest.includes("/redlines/") && method === "PATCH") {
        var parts = rest.split("/");
        var patchBody = JSON.parse(options.body);
        var target = (redlinesByReview[parts[0]] || []).find(function (r) { return r.id === parts[2]; });
        if (target) {
          target.resolution = patchBody.resolution;
          target.resolutionNote = patchBody.resolutionNote || null;
          target.version += 1;
        }
        return ok({ redline: target });
      }
      if (resource === "reviews" && method === "POST") {
        var openBody = JSON.parse(options.body);
        var created = {
          id: "forge_wpdrvw_9", roundNo: (reviewsMap[drawingId] ? reviewsMap[drawingId].length : 0) + 1,
          state: "OPEN", version: 1, drawingRevisionId: openBody.drawingRevisionId,
          openedAt: "2026-11-13T10:00:00Z",
        };
        (reviewsMap[drawingId] = reviewsMap[drawingId] || []).push(created);
        return ok({ review: created });
      }
      if (resource === "reviews" && rest && method === "GET") {
        var detailId = rest.split("/")[0];
        return ok({
          review: { id: detailId, roundNo: 1, state: "OPEN", version: 1 },
          redlines: redlinesByReview[detailId] || [],
          events: [{ id: "forge_wpdre_1", eventType: "REVIEW_OPENED", createdAt: "2026-11-08T11:00:00Z" }],
        });
      }
      if (resource === "reviews") {
        return ok({ reviews: reviewsMap[drawingId] || [] });
      }
      if (resource === "revisions") {
        return ok({ revisions: (revisionsMap[drawingId] || []).slice() });
      }
      if (resource === "ifc-stage" && method === "POST") {
        var fileName = "W-0005-1-TEST-ISO-IFC.pdf";
        if (options.body && typeof options.body.get === "function") {
          var file = options.body.get("file");
          if (file && file.name) fileName = file.name;
        }
        var artifact = { id: "forge_wpa_9", purpose: "ifc_candidate", originalFilename: fileName, contentSha256: "c".repeat(64), createdAt: "2026-11-13T11:00:00Z", retiredAt: null };
        (artifactsMap[drawingId] = artifactsMap[drawingId] || []).push(artifact);
        return ok({ artifact: artifact });
      }
      if (resource === "artifacts") {
        return ok({ artifacts: artifactsMap[drawingId] || [] });
      }
      if (resource === "ifc-releases" && method === "POST") {
        var issueBody = JSON.parse(options.body);
        var revision = { id: "forge_wpdrv_ifc_9", revisionCode: issueBody.ifcRevisionCode, issuedAs: "IFC", retiredAt: null, createdAt: "2026-11-13T12:00:00Z" };
        (revisionsMap[drawingId] = revisionsMap[drawingId] || []).push(revision);
        var release = { id: "forge_wpdifc_9", ifcRevisionId: revision.id, reviewId: issueBody.reviewId, releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true };
        (releasesMap[drawingId] = releasesMap[drawingId] || []).push(release);
        return ok({ release: release });
      }
      if (resource === "ifc-releases") {
        return ok({ releases: releasesMap[drawingId] || [] });
      }
      if (resource === "field-redlines" && rest && rest.endsWith("/reconcile") && method === "POST") {
        var fieldId = rest.split("/")[0];
        var field = (fieldRedlinesMap[drawingId] || []).find(function (f) { return f.id === fieldId; });
        if (field) field.recordState = "RECONCILED";
        return ok({ fieldRedline: field });
      }
      if (resource === "field-redlines" && method === "POST") {
        var fieldBody = JSON.parse(options.body);
        var newField = { id: "forge_wpdfr_9", drawingRevisionId: fieldBody.drawingRevisionId, artifactRef: fieldBody.artifactRef, sha256: fieldBody.sha256, fieldReason: fieldBody.fieldReason, recordState: "HISTORICAL_PENDING_RECONCILIATION", createdAt: "2026-11-13T11:00:00Z" };
        (fieldRedlinesMap[drawingId] = fieldRedlinesMap[drawingId] || []).push(newField);
        return ok({ fieldRedline: newField });
      }
      if (resource === "field-redlines") {
        return ok({ fieldRedlines: fieldRedlinesMap[drawingId] || [] });
      }
      if (resource === "retire" && method === "POST") {
        return ok({ drawing: { drawingId: drawingId, retiredAt: "2026-11-13T12:00:00Z" } });
      }
    }

    // -- Detail-page endpoints -----------------------------------------
    if (path === "/api/work-packages/property-options") {
      return ok({ properties: [{ slug: "1900-w-decker", label: "1900 W. Decker" }] });
    }
    if (path === "/api/work-packages/forge_wp_1/planning-process" && method !== "POST") {
      return ok({
        checklist: {
          packageId: "forge_wp_1", complexity: "standard", templateVersion: 1,
          canUpdate: true, canReview: false,
          constructionReadiness: {
            status: "not_established",
            detail: "No package-level release decision exists yet.",
          },
          template: [{ stepKey: "pdf-01", version: 1, stepNumber: 1, sortOrder: 1, name: "P & I.D. / MFD", role: "Planning", creditPct: 5, mhrsStandard: 2, description: "P&ID marked up." }],
          instances: [],
          progress: { percentComplete: 0, earnedCreditPct: 0, totalCreditPct: 100, earnedMhrs: 0, totalMhrs: 40, stepsTotal: 1, stepsEarned: 0, stepsByStatus: { "N/A": 0, Complete: 0, Reviewed: 0, "In-Progress": 0, "Needs Revision": 0 }, initialized: true },
        },
      });
    }
    if (path === "/api/work-packages/forge_wp_1" && method === "PATCH") {
      var patch = JSON.parse(options.body);
      window.__placementPatches.push(patch);
      var updated = {};
      Object.assign(updated, BASE_PKG, patch, { property_id: patch.property_id != null ? patch.property_id : null });
      return ok({ package: updated });
    }
    if (path === "/api/work-packages/forge_wp_1" && method !== "POST" && method !== "DELETE") {
      return ok({ package: BASE_PKG, transitions: [], attestations: [], baselines: [], scopeChanges: [], observations: [] });
    }
    if (path === "/api/work-packages/forge_wp_1/drawings/readiness") {
      return ok({
        packageId: "forge_wp_1", packageStatus: "draft", drawings: [],
        counts: { drawingsTotal: 0, ifcReleased: 0, pendingReview: 0, returned: 0, openRequiredRedlines: 0, pendingFieldRedlines: 0 },
      });
    }
    if (path.indexOf("/api/work-links") === 0) {
      return ok({ links: [], documents: [] });
    }
    if (path.indexOf("/api/work-documents") === 0) {
      return ok({ documents: [] });
    }
    if (path.indexOf("/api/forge/designer") === 0) {
      return ok({ projects: [] });
    }
    if (path.indexOf("/api/forge/hierarchy") === 0) {
      if (parsed.searchParams.has("projectId")) return ok({ selection: null });
      return ok({ selector: { ownerId: "owner_1", clients: [] } });
    }

    // Anything else (static assets are real requests, not fetch) falls
    // through — and an unexpected API call fails loudly in the console
    // so a missing mock is visible instead of silently returning HTML.
    if (path.indexOf("/api/") === 0) {
      console.error("[placement-mock] unexpected API call", method, String(url));
      return fail({ error: "Unexpected API call in placement harness: " + method + " " + path });
    }
    return realFetch(url, options);
  };

  window.__placementMockReady = true;
})();
