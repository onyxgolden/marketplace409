import { describe, expect, it } from "vitest";
import {
  buildLeaseRenewalWorkflowDefinition,
  buildLeaseRenewalEvaluatorResults,
  selectLeasesExpiringSoonForRenewal,
  LEASE_RENEWAL_WORKFLOW_ID,
  LEASE_RENEWAL_DESTINATION_BY_STEP_ID,
  LEASE_RENEWAL_COPY,
} from "../leaseRenewalWorkflow.js";
import { EVALUATOR_RESULT_STATUS } from "../guidedWorkflowContracts.js";

const TODAY = "2026-08-29";
const NOW = "2026-08-29T00:00:00.000Z";
const STEP_ORDER = ["renewal-draft", "renewal-approval", "renewal-review"];

function resultsByStepId(results) {
  return Object.fromEntries(results.map((r) => [r.stepId, r]));
}

function readyRentalData() {
  return {
    leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", end_date: "2026-09-10" }],
    leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "renewal", status: "applied", created_at: "2026-08-01T00:00:00.000Z" }],
  };
}

describe("buildLeaseRenewalWorkflowDefinition", () => {
  it("produces a valid, versioned definition with the 3 documented steps in order", () => {
    const definition = buildLeaseRenewalWorkflowDefinition();
    expect(definition.workflowId).toBe(LEASE_RENEWAL_WORKFLOW_ID);
    expect(definition.steps.map((step) => step.stepId)).toEqual(STEP_ORDER);
  });

  it("is entirely non-mutating -- every step is informational and needs no confirmation", () => {
    const definition = buildLeaseRenewalWorkflowDefinition();
    for (const step of definition.steps) {
      expect(step.consequence).toBe("informational");
      expect(step.requiresExplicitConfirmation).toBe(false);
    }
  });

  it("has a unique semantic target and a destination or null for every step, with no duplicates", () => {
    const definition = buildLeaseRenewalWorkflowDefinition();
    const targetIds = definition.steps.map((step) => step.semanticTargetId);
    expect(new Set(targetIds).size).toBe(targetIds.length);
    for (const stepId of STEP_ORDER) {
      expect(Object.prototype.hasOwnProperty.call(LEASE_RENEWAL_DESTINATION_BY_STEP_ID, stepId)).toBe(true);
    }
    expect(LEASE_RENEWAL_DESTINATION_BY_STEP_ID["renewal-review"]).toBeNull();
    expect(LEASE_RENEWAL_DESTINATION_BY_STEP_ID["renewal-draft"]).toBe("lease-lifecycle");
    expect(LEASE_RENEWAL_DESTINATION_BY_STEP_ID["renewal-approval"]).toBe("lease-lifecycle");
  });
});

describe("selectLeasesExpiringSoonForRenewal", () => {
  it("matches buildRentalDashboardSummary.js's own 30-day predicate", () => {
    const rentalData = {
      leases: [
        { id: "lease_soon", status: "active", end_date: "2026-09-10" }, // 12 days out -- in window
        { id: "lease_far", status: "active", end_date: "2026-12-01" }, // outside 30 days
        { id: "lease_past", status: "active", end_date: "2026-08-01" }, // already past end_date
        { id: "lease_inactive", status: "draft", end_date: "2026-09-05" }, // not active
        { id: "lease_no_end_date", status: "active", end_date: null },
      ],
    };
    const results = selectLeasesExpiringSoonForRenewal(rentalData, TODAY);
    expect(results.map((lease) => lease.id)).toEqual(["lease_soon"]);
  });

  it("includes a lease expiring exactly today or in exactly 30 days (inclusive boundaries)", () => {
    const rentalData = {
      leases: [
        { id: "lease_today", status: "active", end_date: "2026-08-29" },
        { id: "lease_30_days", status: "active", end_date: "2026-09-28" },
        { id: "lease_31_days", status: "active", end_date: "2026-09-29" },
      ],
    };
    const results = selectLeasesExpiringSoonForRenewal(rentalData, TODAY);
    expect(results.map((lease) => lease.id)).toEqual(["lease_today", "lease_30_days"]);
  });

  it("sorts soonest-expiry first", () => {
    const rentalData = {
      leases: [
        { id: "lease_later", status: "active", end_date: "2026-09-20" },
        { id: "lease_sooner", status: "active", end_date: "2026-09-05" },
      ],
    };
    const results = selectLeasesExpiringSoonForRenewal(rentalData, TODAY);
    expect(results.map((lease) => lease.id)).toEqual(["lease_sooner", "lease_later"]);
  });

  it("returns an empty array when no leases qualify", () => {
    const rentalData = { leases: [{ id: "lease_1", status: "active", end_date: "2027-01-01" }] };
    expect(selectLeasesExpiringSoonForRenewal(rentalData, TODAY)).toEqual([]);
  });
});

describe("buildLeaseRenewalEvaluatorResults -- a fully applied renewal", () => {
  it("marks renewal-draft and renewal-approval COMPLETE, and the always-REQUIRED final review", () => {
    const definition = buildLeaseRenewalWorkflowDefinition();
    const results = buildLeaseRenewalEvaluatorResults(definition, readyRentalData(), "lease_1", NOW);
    const byId = resultsByStepId(results);
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
    expect(byId["renewal-approval"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
    expect(byId["renewal-review"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renewal-review"].reasonCode).toBe("final_review");
  });
});

describe("buildLeaseRenewalEvaluatorResults -- renewal-draft", () => {
  const definition = buildLeaseRenewalWorkflowDefinition();

  it("REQUIRED when no renewal has been drafted yet", () => {
    const data = { leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }], leaseChanges: [] };
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renewal-draft"].reasonCode).toBe("no_renewal_drafted_yet");
  });

  it("COMPLETE once a draft renewal exists", () => {
    const data = readyRentalData();
    data.leaseChanges[0].status = "draft";
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
    expect(byId["renewal-draft"].reasonCode).toBe("renewal_drafted");
  });

  it("ignores an amendment drafted on the same lease -- never mistakes it for the renewal", () => {
    const data = { leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }],
      leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "amendment", status: "draft", created_at: NOW }] };
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renewal-draft"].reasonCode).toBe("no_renewal_drafted_yet");
  });

  it("ignores a proration drafted on the same lease", () => {
    const data = { leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }],
      leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "proration", status: "draft", created_at: NOW }] };
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
  });

  it("ignores a voided renewal draft -- an abandoned draft never counts as drafted", () => {
    const data = { leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }],
      leaseChanges: [{ id: "change_1", lease_id: "lease_1", change_type: "renewal", status: "void", created_at: NOW }] };
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renewal-draft"].reasonCode).toBe("no_renewal_drafted_yet");
  });

  it("BLOCKED when the lease id doesn't resolve to a real lease at all", () => {
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, readyRentalData(), "nonexistent_lease", NOW));
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["renewal-draft"].reasonCode).toBe("lease_not_found");
  });
});

describe("buildLeaseRenewalEvaluatorResults -- renewal-approval", () => {
  const definition = buildLeaseRenewalWorkflowDefinition();

  it("BLOCKED when no renewal has been drafted yet", () => {
    const data = { leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }], leaseChanges: [] };
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-approval"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["renewal-approval"].reasonCode).toBe("renewal_not_drafted_yet");
  });

  it("REQUIRED when a draft renewal exists but hasn't been approved", () => {
    const data = readyRentalData();
    data.leaseChanges[0].status = "draft";
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-approval"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renewal-approval"].reasonCode).toBe("renewal_pending_approval");
  });

  it("COMPLETE when the renewal has been applied", () => {
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, readyRentalData(), "lease_1", NOW));
    expect(byId["renewal-approval"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
    expect(byId["renewal-approval"].reasonCode).toBe("renewal_applied");
  });

  it("BLOCKED, not REQUIRED, when a renewal is stuck at approved-but-not-applied", () => {
    const data = readyRentalData();
    data.leaseChanges[0].status = "approved";
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-approval"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["renewal-approval"].reasonCode).toBe("renewal_approved_but_not_applied");
  });

  it("picks the most recently created renewal when several exist across the lease's history", () => {
    const data = {
      leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }],
      leaseChanges: [
        { id: "change_old", lease_id: "lease_1", change_type: "renewal", status: "applied", created_at: "2024-08-01T00:00:00.000Z" },
        { id: "change_new", lease_id: "lease_1", change_type: "renewal", status: "draft", created_at: "2026-08-01T00:00:00.000Z" },
      ],
    };
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    // If the stale 2024 "applied" row were (wrongly) selected instead of the newer draft, this would
    // read COMPLETE. Since it correctly resolves to the newer draft, it must read REQUIRED.
    expect(byId["renewal-approval"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renewal-approval"].reasonCode).toBe("renewal_pending_approval");
  });

  it("never picks a different lease's renewal by accident", () => {
    const data = {
      leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }, { id: "lease_2", status: "active", end_date: "2026-09-15" }],
      leaseChanges: [{ id: "change_1", lease_id: "lease_2", change_type: "renewal", status: "applied", created_at: NOW }],
    };
    const byId = resultsByStepId(buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW));
    expect(byId["renewal-draft"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renewal-approval"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
  });
});

describe("buildLeaseRenewalEvaluatorResults -- copy completeness and walking order", () => {
  it("every reasonCode used for a REQUIRED or BLOCKED status has matching copy text", () => {
    const definition = buildLeaseRenewalWorkflowDefinition();
    const scenarios = [
      { leases: [], leaseChanges: [] },
      { leases: [{ id: "lease_1", status: "active", end_date: "2026-09-10" }], leaseChanges: [] },
      (() => { const d = readyRentalData(); d.leaseChanges[0].status = "draft"; return d; })(),
      (() => { const d = readyRentalData(); d.leaseChanges[0].status = "approved"; return d; })(),
      readyRentalData(),
    ];
    for (const data of scenarios) {
      for (const result of buildLeaseRenewalEvaluatorResults(definition, data, "lease_1", NOW)) {
        if (result.status === EVALUATOR_RESULT_STATUS.REQUIRED || result.status === EVALUATOR_RESULT_STATUS.BLOCKED) {
          expect(LEASE_RENEWAL_COPY[result.stepId]?.[result.reasonCode], `missing copy for ${result.stepId}/${result.reasonCode}`).toBeTruthy();
        }
      }
    }
  });
});
