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
//   pending-field-opaque — default + one pending field hand-redline
//                    whose reference is an opaque UUID (Finding 2: the
//                    row must say "Reference recorded", never the ID)
//   duplicate-rounds — P-101 with Rev 0 Round 1 OPEN + Rev 1 Round 1
//                    APPROVED (Slice-7 follow-ups Finding 1)
//   active-ifc     — P-101 with an active IFC release, a historical OPEN
//                    round, and a 0 summary count (Finding 3 zero-correct)
//   stale-summary  — default drawings but a 0 summary count beside the
//                    IFA In review badge (Finding 3 inconsistent read)
// The detail page uses the same mock (its endpoints are always served).
//
// Exposes window.__placementPatches (detail PATCH bodies, for the
// no-change-save assertion) and window.__placementCalls (all calls,
// each with the parsed JSON body when the call sent one).
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
  // Slice-7 follow-ups (Finding 3): active IFC + historical OPEN round
  // with a correct 0 summary count — the badge is IFC, not IFA In
  // review, so no stale-summary warning may fire.
  if (scenario === "active-ifc") {
    fixture.drawings[0].badge = "IFC — Issued for construction";
    fixture.drawings[0].constructionUsable = true;
    fixture.drawings[0].activeIfcRelease = { id: "forge_wpdifc_1", ifcRevisionId: "forge_wpdrv_2", reviewId: "forge_wpdrvw_1", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true };
    fixture.counts = Object.assign({}, fixture.counts, { pendingReview: 0, ifcReleased: 1 });
  }
  // Slice-7 follow-ups (Finding 3): a 0 count beside an IFA In review
  // badge is an inconsistent read — the stale-summary warning must show.
  if (scenario === "stale-summary") {
    fixture.counts = Object.assign({}, fixture.counts, { pendingReview: 0 });
  }
  var revisionsMap = defaultRevisions();
  var reviewsMap = scenario === "no-open-round"
    ? { dwg_1: [] }
    : scenario === "duplicate-rounds"
      ? {
          dwg_1: [
            { id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN", version: 1, drawingRevisionId: "forge_wpdrv_1", openedAt: "2026-11-08T11:00:00Z" },
            { id: "forge_wpdrvw_4", roundNo: 1, state: "APPROVED", version: 2, drawingRevisionId: "forge_wpdrv_2", openedAt: "2026-11-09T11:00:00Z" },
          ],
          dwg_2: [{ id: "forge_wpdrvw_2", roundNo: 1, state: "APPROVED", version: 2, drawingRevisionId: "forge_wpdrv_9", openedAt: "2026-11-09T11:00:00Z" }],
        }
      : defaultReviews();
  var releasesMap = scenario === "active-ifc"
    ? { dwg_1: [{ id: "forge_wpdifc_1", ifcRevisionId: "forge_wpdrv_2", reviewId: "forge_wpdrvw_1", releasedAt: "2026-11-13T12:00:00Z", retiredAt: null, isActive: true }] }
    : {};
  var fieldRedlinesMap = scenario === "pending-field"
    ? { dwg_1: [
        { id: "forge_wpdfr_1", drawingRevisionId: "forge_wpdrv_1", artifactRef: "scan-1.pdf", sha256: "d".repeat(64), fieldReason: "Marked up on site.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-08T12:00:00Z" },
      ] }
    : scenario === "pending-field-opaque"
      ? { dwg_1: [
          { id: "forge_wpdfr_2", drawingRevisionId: "forge_wpdrv_1", artifactRef: "e1b22131-9100-4a79-bbe2-b82d43af922e", sha256: "e".repeat(64), fieldReason: "Marked up on site, reference filed as an ID.", recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-09T12:00:00Z" },
        ] }
      : {};
  var artifactsMap = {};
  var redlinesByReview = {
    forge_wpdrvw_1: [{ id: "forge_wpdrl_1", comment: "Move this nozzle 50 mm up.", severity: "REQUIRED", resolution: "OPEN", version: 1, anchorPage: 2 }],
  };
  // Slice-7 follow-ups (Finding 2): the review-detail events carry
  // the REAL mapper shape — occurredAt (never createdAt), afterState,
  // and a real actor UUID (Jason's own auth id, ending 43af922e: the
  // fragment the live screenshot showed beside a REVIEW_* event under
  // the old row). The history must render friendly words, never the
  // raw enum or any fragment of that UUID.
  var eventsByReview = {
    forge_wpdrvw_1: [
      { id: "forge_wpdre_1", eventType: "REVIEW_OPENED", occurredAt: "2026-11-08T11:00:00Z", afterState: "OPEN", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
      { id: "forge_wpdre_2", eventType: "REDLINE_ADDED", occurredAt: "2026-11-08T12:00:00Z", afterState: "OPEN", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
      { id: "forge_wpdre_3", eventType: "REDLINE_RESOLVED", occurredAt: "2026-11-09T10:00:00Z", afterState: "RESOLVED", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
    ],
    forge_wpdrvw_2: [
      { id: "forge_wpdre_4", eventType: "REVIEW_OPENED", occurredAt: "2026-11-09T11:00:00Z", afterState: "OPEN", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
      { id: "forge_wpdre_5", eventType: "REVIEW_APPROVED", occurredAt: "2026-11-09T12:00:00Z", afterState: "APPROVED", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
    ],
    forge_wpdrvw_4: [
      { id: "forge_wpdre_6", eventType: "REVIEW_OPENED", occurredAt: "2026-11-09T11:00:00Z", afterState: "OPEN", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
      { id: "forge_wpdre_7", eventType: "REVIEW_APPROVED", occurredAt: "2026-11-09T12:00:00Z", afterState: "APPROVED", actorId: "e1b22131-9100-4a79-bbe2-b82d43af922e" },
    ],
  };

  // Hierarchy manager (PlannerHierarchyManager): the ROUTE's shape —
  // camelCase records, as the real GET route returns after the
  // application service maps the inventory RPC (snake_case records).
  // The RPC shape itself is proven by the migration + service tests;
  // the placement mock stands in for the HTTP API, so it serves what
  // the route serves. Stateful: POST/PATCH/DELETE mutate the tree, so
  // reloads reflect the mutation exactly as the unit mocks do.
  // Scenario `hierarchy-readonly` serves canManage false; every other
  // scenario serves canManage true.
  function hierarchyInventoryFixture() {
    return {
      ownerId: "owner_1",
      canManage: scenario !== "hierarchy-readonly",
      clients: [
        {
          id: "forge_cli_1", name: "Acme",
          externalReference: "ACME-1", status: "active", notes: "",
          version: 3, createdBy: "owner_1", updatedBy: "owner_1",
          createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
          sites: [
            {
              id: "forge_site_1", clientId: "forge_cli_1", name: "Plant 1",
              siteType: "industrial",
              addressLine1: "", addressLine2: "", city: "Beaumont", region: "TX",
              postalCode: "77701", countryCode: "US", status: "active", version: 2,
              createdBy: "owner_1", updatedBy: "owner_1",
              createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
              projects: [
                { id: "forge_prj_1", siteId: "forge_site_1", name: "Turnaround", projectCode: "TA-01", description: "", projectType: "", plannedStart: null, plannedFinish: null, status: "active", version: 5, createdBy: "owner_1", updatedBy: "owner_1", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", packageCount: 2 },
                { id: "forge_prj_2", siteId: "forge_site_1", name: "Revamp", projectCode: null, description: "", projectType: "", plannedStart: null, plannedFinish: null, status: "archived", version: 1, createdBy: "owner_1", updatedBy: "owner_1", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", packageCount: 0 },
              ],
            },
            {
              id: "forge_site_2", clientId: "forge_cli_1", name: "Plant 2",
              siteType: "industrial",
              addressLine1: "", addressLine2: "", city: "", region: "",
              postalCode: "", countryCode: "", status: "active", version: 1,
              createdBy: "owner_1", updatedBy: "owner_1",
              createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
              projects: [],
            },
          ],
        },
        {
          id: "forge_cli_2", name: "Beta",
          externalReference: "", status: "archived", notes: "",
          version: 1, createdBy: "owner_1", updatedBy: "owner_1",
          createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
          sites: [],
        },
      ],
    };
  }
  var inventoryState = hierarchyInventoryFixture();
  var hierarchyCounters = { client: 100, site: 100, project: 100 };

  function hierarchyFind(entity, id) {
    for (var i = 0; i < inventoryState.clients.length; i++) {
      var client = inventoryState.clients[i];
      if (entity === "client" && client.id === id) return client;
      for (var j = 0; j < client.sites.length; j++) {
        var site = client.sites[j];
        if (entity === "site" && site.id === id) return site;
        for (var k = 0; k < site.projects.length; k++) {
          if (entity === "project" && site.projects[k].id === id) return site.projects[k];
        }
      }
    }
    return null;
  }

  function hierarchyRemove(entity, id) {
    for (var i = 0; i < inventoryState.clients.length; i++) {
      var client = inventoryState.clients[i];
      if (entity === "client" && client.id === id) {
        inventoryState.clients.splice(i, 1);
        return;
      }
      for (var j = 0; j < client.sites.length; j++) {
        var site = client.sites[j];
        if (entity === "site" && site.id === id) {
          client.sites.splice(j, 1);
          return;
        }
        site.projects = site.projects.filter(function (p) { return !(entity === "project" && p.id === id); });
      }
    }
  }

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

  // Slice-9 busts fixture: one detected labor-cost candidate against
  // the frozen baseline, one recorded bust, and a mutable recorded
  // list that POST /busts appends to (state resets per page load).
  var bustsCandidate = {
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
  var bustsRecorded = [{
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
  }];

  function ok(body) {
    return { ok: true, status: 200, json: async function () { return body; } };
  }
  function fail(body) {
    return { ok: false, status: 400, json: async function () { return body; } };
  }
  function status(body, code) {
    return { ok: code >= 200 && code < 300, status: code, json: async function () { return body; } };
  }

  window.__placementPatches = [];
  window.__placementCalls = [];

  var realFetch = window.fetch.bind(window);
  window.fetch = async function (url, options) {
    options = options || {};
    var method = options.method || "GET";
    // Record the parsed JSON body when the call sent one, so tests can
    // assert what a PATCH actually carried ("" vs null matters: the
    // hierarchy RPC reads null as "unchanged" and "" as "clear").
    var callBody = null;
    if (options.body) {
      try { callBody = JSON.parse(options.body); } catch (e) { callBody = null; }
    }
    window.__placementCalls.push({ url: String(url), method: method, body: callBody });
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
          events: eventsByReview[detailId] || [],
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
        var newField = { id: "forge_wpdfr_9", drawingRevisionId: fieldBody.drawingRevisionId, artifactRef: fieldBody.artifactRef, sha256: fieldBody.sha256, fieldReason: fieldBody.fieldReason, recordState: "HISTORICAL_PENDING_RECONCILIATION", capturedAt: "2026-11-13T11:00:00Z" };
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
    // -- Hierarchy manager inventory (stateful CRUD) -------------------
    if (path === "/api/forge/hierarchy" && parsed.searchParams.get("includeArchived") === "true" && method === "GET") {
      return ok({ inventory: inventoryState });
    }
    if (path === "/api/forge/hierarchy" && (method === "POST" || method === "PATCH" || method === "DELETE")) {
      var hBody = JSON.parse(options.body || "{}");
      var hKey = hBody.entity === "client" ? "client" : hBody.entity === "site" ? "site" : "project";
      if (method === "POST") {
        if (hBody.entity === "client") {
          if (inventoryState.clients.some(function (c) { return c.name.toLowerCase() === String(hBody.name || "").trim().toLowerCase(); })) {
            return status({ error: "A client with that name already exists." }, 409);
          }
          var createdClient = { id: "forge_cli_new" + (hierarchyCounters.client++), name: hBody.name, externalReference: hBody.externalReference || null, status: "active", notes: hBody.notes || null, version: 1, createdBy: "owner_1", updatedBy: "owner_1", createdAt: "2026-11-13T00:00:00Z", updatedAt: "2026-11-13T00:00:00Z", sites: [] };
          inventoryState.clients.push(createdClient);
          return status({ client: createdClient }, 201);
        }
        if (hBody.entity === "site") {
          var parentClient = hierarchyFind("client", hBody.clientId);
          if (!parentClient) return status({ error: "That client could not be found." }, 404);
          var createdSite = { id: "forge_site_new" + (hierarchyCounters.site++), clientId: hBody.clientId, name: hBody.name, siteType: hBody.siteType || null, addressLine1: hBody.addressLine1 || null, addressLine2: hBody.addressLine2 || null, city: hBody.city || null, region: hBody.region || null, postalCode: hBody.postalCode || null, countryCode: hBody.countryCode || null, status: "active", version: 1, createdBy: "owner_1", updatedBy: "owner_1", createdAt: "2026-11-13T00:00:00Z", updatedAt: "2026-11-13T00:00:00Z", projects: [] };
          parentClient.sites.push(createdSite);
          return status({ site: createdSite }, 201);
        }
        var parentSite = hierarchyFind("site", hBody.siteId);
        if (!parentSite) return status({ error: "That site could not be found." }, 404);
        var createdProject = { id: "forge_prj_new" + (hierarchyCounters.project++), siteId: hBody.siteId, name: hBody.name, projectCode: hBody.projectCode || null, description: hBody.description || null, projectType: hBody.projectType || null, plannedStart: hBody.plannedStart || null, plannedFinish: hBody.plannedFinish || null, status: "planned", version: 1, createdBy: "owner_1", updatedBy: "owner_1", createdAt: "2026-11-13T00:00:00Z", updatedAt: "2026-11-13T00:00:00Z", packageCount: 0 };
        parentSite.projects.push(createdProject);
        return status({ project: createdProject }, 201);
      }
      var hRecord = hierarchyFind(hBody.entity, hBody.id);
      if (!hRecord) return status({ error: "That record could not be found." }, 404);
      if (hBody.expectedVersion !== hRecord.version) {
        return status({ error: "This record was changed by someone else. Reload and try again." }, 409);
      }
      if (method === "PATCH") {
        for (var hField in hBody) {
          if (["entity", "id", "expectedVersion", "requestId", "clientId", "siteId"].indexOf(hField) !== -1) continue;
          if (hBody[hField] === null || hBody[hField] === undefined) continue;
          hRecord[hField] = hBody[hField];
        }
        hRecord.version += 1;
        var hOut = {};
        hOut[hKey] = hRecord;
        return ok(hOut);
      }
      if (hRecord.status !== "archived") {
        return status({ error: "Archive the record first — only archived records can be permanently deleted." }, 409);
      }
      if (hBody.entity === "client" && (hRecord.sites || []).length > 0) {
        return status({ error: "That record still has items under it (" + hRecord.sites.length + " sites). Remove or move the sites first." }, 409);
      }
      if (hBody.entity === "site" && (hRecord.projects || []).length > 0) {
        return status({ error: "That record still has items under it (" + hRecord.projects.length + " projects). Remove or move the projects first." }, 409);
      }
      if (hBody.entity === "project" && (hRecord.packageCount || 0) > 0) {
        return status({ error: "That record still has items under it (" + hRecord.packageCount + " assigned packages). Unassign or explicitly move packages first." }, 409);
      }
      hierarchyRemove(hBody.entity, hBody.id);
      return ok({ deleted: true, id: hBody.id });
    }
    if (path.indexOf("/api/forge/hierarchy") === 0) {
      if (parsed.searchParams.has("projectId")) return ok({ selection: null });
      return ok({ selector: { ownerId: "owner_1", clients: [] } });
    }

    // -- Busts endpoints (slice 9) ------------------------------------
    // Stateful: POST /busts records the bust (server-computed variance,
    // as the real RPC does), so a refresh after a confirm shows it in
    // the recorded list.
    if (path === "/api/work-packages/pkg_1/busts/candidates" && method === "GET") {
      return ok({
        packageId: "pkg_1", packageStatus: "in_progress", asOf: "2026-11-15",
        baseline: { id: "base_2", versionNumber: 2 },
        controlEstimate: null,
        candidates: [bustsCandidate],
        insufficiencies: [{ dimension: "MANPOWER_SHORTFALL", reason: "No assignments on file for 2026-11-09." }],
        targets: {
          takeoffLines: [{ id: "line_1", drawingNumber: "W-0005-1", quantity: 10, unit: "EA" }],
          steps: [{ id: "step_1", title: "Fabricate spool" }],
        },
      });
    }
    if (path === "/api/work-packages/pkg_1/busts" && method === "POST") {
      var bustBody = JSON.parse(options.body);
      window.__placementLastBustPost = bustBody;
      var createdBust = {
        id: "forge_wpbust_new",
        status: "OPEN",
        dimension: bustBody.dimension,
        scopeType: bustBody.scopeType,
        takeoffLineId: bustBody.takeoffLineId || null,
        workStepId: bustBody.workStepId || null,
        craft: bustBody.craft || null,
        workDate: bustBody.workDate || null,
        shiftKey: bustBody.shiftKey || null,
        targetLabel: bustBody.scopeType === "PACKAGE" ? "Whole package" : "Takeoff line W-0005-1",
        baselineId: bustBody.baselineId || null,
        baselineVersion: bustBody.baselineVersion != null ? bustBody.baselineVersion : null,
        plannedValue: bustBody.plannedValue,
        observedValue: bustBody.observedValue,
        varianceValue: bustBody.observedValue - bustBody.plannedValue,
        variancePercent: bustBody.plannedValue ? Math.round(((bustBody.observedValue - bustBody.plannedValue) / bustBody.plannedValue) * 10000) / 100 : null,
        unit: bustBody.unit,
        comparisonAsOf: bustBody.comparisonAsOf,
        evidenceSummary: bustBody.evidenceSummary,
        evidenceRef: bustBody.evidenceRef || null,
        sourceFingerprint: bustBody.sourceFingerprint || "fp_mock",
        version: 1,
        createdAt: "2026-11-15T10:00:00Z",
      };
      bustsRecorded.push(createdBust);
      return ok({ bust: createdBust });
    }
    if (path === "/api/work-packages/pkg_1/busts" && method === "GET") {
      return ok({ busts: bustsRecorded.slice(), total: bustsRecorded.length, limit: 100, offset: 0 });
    }
    var bustDetailMatch = path.match(/^\/api\/work-packages\/pkg_1\/busts\/(forge_wpbust_[a-z0-9_]+)$/);
    if (bustDetailMatch && method === "GET") {
      var detailBust = bustsRecorded.find(function (b) { return b.id === bustDetailMatch[1]; }) || bustsRecorded[0];
      return ok({
        bust: detailBust,
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
      });
    }
    if (path === "/api/work-packages/pkg_1/change-orders" && method === "GET") {
      return ok({
        changeOrders: [{ id: "co_2", changeOrderNumber: 2, description: "Cover the overrun", status: "approved" }],
        packageStatus: "in_progress",
      });
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
