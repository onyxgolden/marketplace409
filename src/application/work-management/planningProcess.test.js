// Work Package Planner — planning-process steps, application-service
// proof (mocked db; the real-SQL legs live in the migration test).
// Verdict rules under test: F2 (evidence/reason/self-review/stale
// version/idempotency params pass through), F3 (22-row template,
// fail-closed on partial instances), F4 (unavailable, never 0/100).

import { describe, it, expect, vi } from "vitest";
import {
  PLANNING_PROCESS_TEMPLATE,
} from "@/domains/work-management/planningProcess.js";
import {
  getPlanningChecklist,
  getPlanningSummary,
  listPlanningRevisions,
  mapPlanningProcessRpcError,
  setPlanningComplexity,
  setPlanningStepStatus,
} from "./planningProcess.js";

function rpcResult(instances, overrides = {}) {
  return {
    packageId: "pkg_1",
    complexity: "standard",
    templateVersion: 1,
    canUpdate: true,
    canReview: false,
    isOwner: true,
    constructionReadiness: {
      status: "not_established",
      detail: "No package-level release decision exists yet. Planning percent never authorizes construction or releases an IFC drawing.",
    },
    template: PLANNING_PROCESS_TEMPLATE.map((t) => ({
      version: 1,
      step_key: t.stepKey,
      step_number: t.stepNumber,
      sort_order: t.stepNumber,
      name: t.name,
      role: t.role,
      credit_pct: t.creditPct,
      mhrs_standard: t.mhrsStandard,
      description: t.description,
      provenance: "Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20",
    })),
    instances: instances.map((i) => ({
      id: `inst_${i.templateStepId}`,
      work_package_id: "pkg_1",
      template_version: 1,
      template_step_id: i.templateStepId,
      status: i.status,
      evidence_link: i.evidenceLink ?? null,
      reviewed_by: null,
      reviewed_at: null,
      submitted_by: i.submittedBy ?? null,
      version: i.version ?? 1,
      updated_by: "user_9",
      updated_at: "2026-11-12T00:00:00Z",
    })),
    ...overrides,
  };
}

function allInstances(status = "In-Progress") {
  return PLANNING_PROCESS_TEMPLATE.map((t) => ({ templateStepId: t.stepKey, status }));
}

function mockDb({ rpcImpl, fromImpl } = {}) {
  return {
    rpc: vi.fn(rpcImpl || (async () => ({ data: null, error: null }))),
    from: vi.fn(fromImpl || (() => { throw new Error("unexpected from() call"); })),
  };
}

describe("getPlanningChecklist", () => {
  it("returns the checklist with percent complete computed from the rows", async () => {
    const db = mockDb({
      rpcImpl: async () => ({
        data: rpcResult(allInstances().map((i) =>
          (["pdf-01", "pdf-02", "pdf-03"].includes(i.templateStepId) ? { ...i, status: "Complete" } : i))),
        error: null,
      }),
    });
    const result = await getPlanningChecklist(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.notApplied).toBe(false);
    expect(result.checklist.template).toHaveLength(22);
    expect(result.checklist.instances).toHaveLength(22);
    expect(result.checklist.templateVersion).toBe(1);
    expect(result.checklist.constructionReadiness.status).toBe("not_established");
    // 5+5+5 = 15% — computed by the domain, never from the RPC.
    expect(result.checklist.progress.percentComplete).toBe(15);
    expect(result.checklist.progress.earnedMhrs).toBe(6);
    expect(result.checklist.progress.totalMhrs).toBe(40);
    expect(result.checklist.canReview).toBe(false);
    expect(result.checklist.isOwner).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_planning_process_checklist", {
      p_owner_id: "owner_1",
      p_package_id: "pkg_1",
    });
  });

  it("reports notApplied when the RPC does not exist yet (pre-migration window)", async () => {
    const db = mockDb({
      rpcImpl: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    });
    const result = await getPlanningChecklist(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result).toEqual({ ok: true, notApplied: true, checklist: null });
  });

  it("maps a missing package to 404", async () => {
    const db = mockDb({
      rpcImpl: async () => ({ data: null, error: { message: "WPP10_PACKAGE_NOT_FOUND" } }),
    });
    const result = await getPlanningChecklist(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result).toEqual({ ok: false, httpStatus: 404, error: "Work package not found." });
  });

  it("fails closed (503) when the RPC returns a partial instance set", async () => {
    const db = mockDb({
      rpcImpl: async () => ({
        data: rpcResult([
          { templateStepId: "pdf-01", status: "Complete" },
          { templateStepId: "pdf-02", status: "Complete" },
          { templateStepId: "pdf-03", status: "Complete" },
        ]),
        error: null,
      }),
    });
    const result = await getPlanningChecklist(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
  });

  it("maps a template-invalid RPC failure to 503", async () => {
    const db = mockDb({
      rpcImpl: async () => ({ data: null, error: { message: "WPP10_TEMPLATE_INVALID: template version 1 has 21 rows" } }),
    });
    const result = await getPlanningChecklist(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result.httpStatus).toBe(503);
  });
});

describe("setPlanningStepStatus", () => {
  function setDb() {
    return mockDb({
      rpcImpl: async () => ({
        data: {
          id: "inst_pdf-01", work_package_id: "pkg_1", template_version: 1, template_step_id: "pdf-01",
          status: "Complete", evidence_link: "https://example.invalid/pid", reviewed_by: null, reviewed_at: null,
          submitted_by: "user_9", version: 2, updated_by: "user_9", updated_at: "2026-11-12T00:00:00Z",
        },
        error: null,
      }),
    });
  }

  it("passes reason, attestation, expected version and request ID to the RPC", async () => {
    const db = setDb();
    const result = await setPlanningStepStatus(db, {
      ownerId: "owner_1", packageId: "pkg_1", templateStepId: "pdf-01", status: "Complete",
      evidenceLink: "https://example.invalid/pid", reason: null, attestation: null,
      expectedVersion: 1, requestId: "req_123",
    });
    expect(result.ok).toBe(true);
    expect(result.instance.status).toBe("Complete");
    expect(result.instance.version).toBe(2);
    expect(result.instance.submittedBy).toBe("user_9");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_planning_process_set_status", {
      p_owner_id: "owner_1",
      p_package_id: "pkg_1",
      p_template_step_id: "pdf-01",
      p_status: "Complete",
      p_evidence_link: "https://example.invalid/pid",
      p_reason: null,
      p_attestation: null,
      p_expected_version: 1,
      p_request_id: "req_123",
    });
  });

  it("rejects an unknown status before touching the database", async () => {
    const db = mockDb();
    const result = await setPlanningStepStatus(db, {
      ownerId: "owner_1", packageId: "pkg_1", templateStepId: "pdf-01", status: "Pending",
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("rejects an over-long evidence link, reason, or attestation before touching the database", async () => {
    const db = mockDb();
    for (const extra of [
      { evidenceLink: "x".repeat(2001) },
      { reason: "x".repeat(501) },
      { attestation: "x".repeat(501) },
      { expectedVersion: 0 },
    ]) {
      const result = await setPlanningStepStatus(db, {
        ownerId: "owner_1", packageId: "pkg_1", templateStepId: "pdf-01", status: "Complete", ...extra,
      });
      expect(result.ok).toBe(false);
      expect(result.httpStatus).toBe(400);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps F2/F3/F5 failures to plain words with the right status", async () => {
    const cases = [
      ["WPP10_REVIEW_FORBIDDEN", 403, /Only a reviewer/],
      ["WPP10_REVIEW_CAPABILITY_REQUIRED", 403, /reviewer capability/],
      ["WPP10_UPDATE_FORBIDDEN", 403, /don't have permission/],
      ["WPP10_SELF_REVIEW_FORBIDDEN", 403, /different reviewer/],
      ["WPP10_EVIDENCE_REQUIRED", 400, /evidence link or a completion attestation/],
      ["WPP10_FRESH_EVIDENCE_REQUIRED", 400, /fresh evidence/],
      ["WPP10_REASON_REQUIRED", 400, /needs a reason/],
      ["WPP10_STALE_VERSION", 409, /changed while you were editing/],
      ["WPP10_EXPECTED_VERSION_REQUIRED", 400, /expectedVersion must be a positive whole number/],
      ["WPP10_REQUEST_ID_REQUIRED", 400, /request ID is required/],
      ["WPP10_INVALID_REQUEST_ID", 400, /128 characters or fewer/],
      ["WPP10_REQUEST_ID_CONFLICT", 409, /already used for a different change/],
      ["WPP10_REVIEWED_LOCKED", 409, /only a reviewer can send it back/],
      ["WPP10_TWO_STEP_REQUIRED", 400, /two steps/],
      ["WPP10_REVIEW_BASIS_REQUIRED", 400, /already on the record/],
      ["WPP10_REVIEW_EVIDENCE_SAME_REQUEST", 400, /cannot add new evidence/],
      ["WPP10_INVALID_COMPLEXITY", 400, /Planning complexity must be one of/],
      ["WPP10_INVALID_PACKAGE_UPDATE", 400, /package update is not valid/],
      ["WPP10_COMPLEXITY_FORBIDDEN", 403, /don't have permission to change the planning complexity/],
      ["WPP10_VERIFIER_FORBIDDEN", 403, /Only the workspace owner may designate a verifier/],
      ["WPP10_PACKAGE_TERMINAL", 409, /closed/],
    ];
    for (const [code, httpStatus, pattern] of cases) {
      const db = mockDb({ rpcImpl: async () => ({ data: null, error: { message: code } }) });
      const result = await setPlanningStepStatus(db, {
        ownerId: "owner_1", packageId: "pkg_1", templateStepId: "pdf-01", status: "Complete",
        evidenceLink: "https://example.invalid/pid", expectedVersion: 1, requestId: "req_map_1",
      });
      expect(result.httpStatus).toBe(httpStatus);
      expect(result.error).toMatch(pattern);
    }
  });

  it("requires a positive expectedVersion before touching the database", async () => {
    const db = mockDb();
    for (const expectedVersion of [undefined, null, 0, -1, 1.5]) {
      const result = await setPlanningStepStatus(db, {
        ownerId: "owner_1", packageId: "pkg_1", templateStepId: "pdf-01", status: "Complete",
        evidenceLink: "https://example.invalid/pid", expectedVersion,
      });
      expect(result.ok).toBe(false);
      expect(result.httpStatus).toBe(400);
    }
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("generates a request ID when the client omits one", async () => {
    const db = setDb();
    const result = await setPlanningStepStatus(db, {
      ownerId: "owner_1", packageId: "pkg_1", templateStepId: "pdf-01", status: "Complete",
      evidenceLink: "https://example.invalid/pid", expectedVersion: 1,
    });
    expect(result.ok).toBe(true);
    const args = db.rpc.mock.calls[0][1];
    expect(typeof args.p_request_id).toBe("string");
    expect(args.p_request_id.length).toBeGreaterThan(0);
  });
});

describe("listPlanningRevisions", () => {
  it("returns an empty list when the table does not exist yet", async () => {
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn(async () => ({ data: null, error: { code: "42P01", message: 'relation "forge_work_planning_process_revisions" does not exist' } })) };
    const db = mockDb({ fromImpl: () => chain });
    const result = await listPlanningRevisions(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result).toEqual({ ok: true, revisions: [] });
  });

  it("rejects a limit over 200", async () => {
    const db = mockDb();
    const result = await listPlanningRevisions(db, { ownerId: "owner_1", packageId: "pkg_1", limit: 201 });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
  });

  it("maps the F2 event fields", async () => {
    const row = {
      id: "rev_1", instance_id: "inst_pdf-01", work_package_id: "pkg_1", template_step_id: "pdf-01",
      actor_id: "user_9", action: "status_change", old_status: "In-Progress", new_status: "Complete",
      reason: null, evidence_reference: "https://example.invalid/pid", evidence_digest: "0123456789abcdef0123456789abcdef",
      attestation: null, is_override: false, request_id: "req_1",
      old_values: { status: "In-Progress", evidence_link: null },
      new_values: { status: "Complete", evidence_link: "https://example.invalid/pid" },
      recorded_at: "2026-11-12T00:00:00Z",
    };
    const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), range: vi.fn(async () => ({ data: [row], error: null })) };
    const db = mockDb({ fromImpl: () => chain });
    const result = await listPlanningRevisions(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.revisions[0]).toMatchObject({
      oldStatus: "In-Progress", newStatus: "Complete",
      evidenceReference: "https://example.invalid/pid",
      evidenceDigest: "0123456789abcdef0123456789abcdef",
      isOverride: false, requestId: "req_1",
    });
  });
});

describe("getPlanningSummary", () => {
  function summaryDb({ instances, complexity = "standard", templateVersion = 1 }) {
    const templateChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(async () => ({
        data: PLANNING_PROCESS_TEMPLATE.map((t) => ({
          version: 1, step_key: t.stepKey, step_number: t.stepNumber, sort_order: t.stepNumber,
          name: t.name, role: t.role, credit_pct: t.creditPct, mhrs_standard: t.mhrsStandard,
          description: t.description, provenance: "pdf",
        })),
        error: null,
      })),
    };
    const instanceChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    instanceChain.eq.mockReturnValueOnce(instanceChain).mockReturnValueOnce({
      data: instances.map((i) => ({
        id: `inst_${i.templateStepId}`, work_package_id: "pkg_1", template_version: 1,
        template_step_id: i.templateStepId, status: i.status, evidence_link: null,
        reviewed_by: null, reviewed_at: null, submitted_by: null, version: 1,
        updated_by: "user_9", updated_at: "2026-11-12T00:00:00Z",
      })),
      error: null,
    });
    const packageChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: { planning_complexity: complexity, planning_template_version: templateVersion }, error: null })),
    };
    return {
      from: vi.fn((table) => {
        if (table === "forge_work_planning_process_template") return templateChain;
        if (table === "forge_work_planning_process_instances") return instanceChain;
        return packageChain;
      }),
      rpc: vi.fn(),
    };
  }

  it("computes the summary without creating instances (read-only)", async () => {
    const db = summaryDb({
      instances: allInstances().map((i) => (i.templateStepId === "pdf-15" ? { ...i, status: "Complete" } : i)),
    });
    const result = await getPlanningSummary(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.summary.progress.percentComplete).toBe(15);
    expect(result.summary.progress.earnedMhrs).toBe(6);
    expect(result.summary.templateVersion).toBe(1);
    expect(result.summary.constructionReadiness.status).toBe("not_established");
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns null summary when the migration has not applied", async () => {
    const failing = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn(async () => ({ data: null, error: { code: "42P01", message: 'relation "forge_work_planning_process_template" does not exist' } })),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    const db = { from: vi.fn(() => failing), rpc: vi.fn() };
    const result = await getPlanningSummary(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result).toEqual({ ok: true, summary: null });
  });

  it("returns null summary for a partial instance set (fail closed, F4)", async () => {
    const db = summaryDb({ instances: [{ templateStepId: "pdf-15", status: "Complete" }] });
    const result = await getPlanningSummary(db, { ownerId: "owner_1", packageId: "pkg_1" });
    expect(result).toEqual({ ok: true, summary: null });
  });
});

describe("setPlanningComplexity", () => {
  it("calls the complexity RPC with expected version and a generated request ID, and returns the package row", async () => {
    const pkgRow = {
      id: "pkg_1", owner_id: "owner_1", planning_complexity: "high", version: 2,
      updated_by: "user_9", updated_at: "2026-11-12T00:00:00Z",
    };
    const db = mockDb({ rpcImpl: async () => ({ data: pkgRow, error: null }) });
    const result = await setPlanningComplexity(db, {
      ownerId: "owner_1", packageId: "pkg_1", complexity: "high", expectedVersion: 1,
    });
    expect(result).toEqual({ ok: true, package: pkgRow });
    expect(db.rpc).toHaveBeenCalledWith("forge_work_planning_process_set_complexity", {
      p_owner_id: "owner_1",
      p_package_id: "pkg_1",
      p_complexity: "high",
      p_expected_version: 1,
      p_request_id: expect.any(String),
    });
  });

  it("rejects an unknown complexity and a missing expectedVersion before touching the database", async () => {
    const db = mockDb();
    const badComplexity = await setPlanningComplexity(db, {
      ownerId: "owner_1", packageId: "pkg_1", complexity: "extreme", expectedVersion: 1,
    });
    expect(badComplexity.ok).toBe(false);
    expect(badComplexity.httpStatus).toBe(400);
    const noVersion = await setPlanningComplexity(db, {
      ownerId: "owner_1", packageId: "pkg_1", complexity: "high",
    });
    expect(noVersion.ok).toBe(false);
    expect(noVersion.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a stale-version RPC failure to 409", async () => {
    const db = mockDb({ rpcImpl: async () => ({ data: null, error: { message: "WPP10_STALE_VERSION" } }) });
    const result = await setPlanningComplexity(db, {
      ownerId: "owner_1", packageId: "pkg_1", complexity: "high", expectedVersion: 1, requestId: "req_cx_1",
    });
    expect(result.httpStatus).toBe(409);
  });
});

describe("mapPlanningProcessRpcError", () => {
  it("throws unknown errors through (route turns them into a 500)", () => {
    expect(() => mapPlanningProcessRpcError(new Error("boom"))).toThrow("boom");
  });
});
