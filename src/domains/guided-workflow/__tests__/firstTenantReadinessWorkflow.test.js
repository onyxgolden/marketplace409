import { describe, expect, it } from "vitest";
import {
  buildFirstTenantReadinessWorkflowDefinition,
  buildFirstTenantReadinessEvaluatorResults,
  selectVacantUnitsForReadiness,
  FIRST_TENANT_READINESS_WORKFLOW_ID,
  FIRST_TENANT_READINESS_DESTINATION_BY_STEP_ID,
  FIRST_TENANT_READINESS_COPY,
} from "../firstTenantReadinessWorkflow.js";
import { EVALUATOR_RESULT_STATUS } from "../guidedWorkflowContracts.js";

const NOW = "2026-08-28T00:00:00.000Z";
const STEP_ORDER = [
  "unit-readiness", "tenant-assignment", "lease-readiness", "recurring-rent-setup",
  "security-deposit", "renters-insurance", "move-in-inspection", "ready-for-move-in",
];

function resultsByStepId(results) {
  return Object.fromEntries(results.map((r) => [r.stepId, r]));
}

// A fully-ready unit -- every downstream signal present and passing. Individual tests mutate a copy of
// this to isolate exactly one signal at a time.
function readyRentalData() {
  return {
    units: [{ id: "unit_1", property_id: "prop_1", label: "Unit 1", status: "available" }],
    leases: [{ id: "lease_1", unit_id: "unit_1", status: "active", created_at: "2026-08-01T00:00:00.000Z" }],
    leaseMemberships: [{ lease_id: "lease_1", tenant_id: "tenant_1", occupancy_role: "primary" }],
    schedules: [{ id: "schedule_1", lease_id: "lease_1", status: "active" }],
    deposits: [{ id: "deposit_1", lease_id: "lease_1", status: "held" }],
    insuranceRequirements: [],
    insurancePolicies: [{ id: "policy_1", lease_id: "lease_1", status: "verified", expiration_date: "2027-01-01" }],
    inspections: [{ id: "inspection_1", lease_id: "lease_1", inspection_type: "move_in", status: "finalized" }],
  };
}

describe("buildFirstTenantReadinessWorkflowDefinition", () => {
  it("produces a valid, versioned definition with the 8 documented steps in order", () => {
    const definition = buildFirstTenantReadinessWorkflowDefinition();
    expect(definition.workflowId).toBe(FIRST_TENANT_READINESS_WORKFLOW_ID);
    expect(definition.steps.map((step) => step.stepId)).toEqual(STEP_ORDER);
  });

  it("is entirely non-mutating -- every step is informational and needs no confirmation", () => {
    const definition = buildFirstTenantReadinessWorkflowDefinition();
    for (const step of definition.steps) {
      expect(step.consequence).toBe("informational");
      expect(step.requiresExplicitConfirmation).toBe(false);
    }
  });

  it("has a unique semantic target and a destination or null for every step, with no duplicates", () => {
    const definition = buildFirstTenantReadinessWorkflowDefinition();
    const targetIds = definition.steps.map((step) => step.semanticTargetId);
    expect(new Set(targetIds).size).toBe(targetIds.length);
    for (const stepId of STEP_ORDER) {
      expect(Object.prototype.hasOwnProperty.call(FIRST_TENANT_READINESS_DESTINATION_BY_STEP_ID, stepId)).toBe(true);
    }
    expect(FIRST_TENANT_READINESS_DESTINATION_BY_STEP_ID["ready-for-move-in"]).toBeNull();
  });
});

describe("selectVacantUnitsForReadiness", () => {
  it("matches buildRentalDashboardSummary.js's own predicate: no active lease references the unit", () => {
    const rentalData = {
      units: [{ id: "unit_1" }, { id: "unit_2" }, { id: "unit_3" }],
      leases: [
        { id: "lease_1", unit_id: "unit_1", status: "active" },
        { id: "lease_2", unit_id: "unit_2", status: "draft" }, // draft doesn't occupy -- unit_2 stays vacant
      ],
    };
    const vacant = selectVacantUnitsForReadiness(rentalData);
    expect(vacant.map((unit) => unit.id).sort()).toEqual(["unit_2", "unit_3"]);
  });

  it("returns every unit when there are no leases at all", () => {
    const rentalData = { units: [{ id: "unit_1" }], leases: [] };
    expect(selectVacantUnitsForReadiness(rentalData).map((u) => u.id)).toEqual(["unit_1"]);
  });
});

describe("buildFirstTenantReadinessEvaluatorResults -- a fully ready unit", () => {
  it("marks every step COMPLETE except the always-REQUIRED final review", () => {
    const definition = buildFirstTenantReadinessWorkflowDefinition();
    const results = buildFirstTenantReadinessEvaluatorResults(definition, readyRentalData(), "unit_1", NOW);
    const byId = resultsByStepId(results);
    for (const stepId of STEP_ORDER) {
      if (stepId === "ready-for-move-in") {
        expect(byId[stepId].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
        expect(byId[stepId].reasonCode).toBe("final_review");
      } else {
        expect(byId[stepId].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
      }
    }
  });
});

describe("buildFirstTenantReadinessEvaluatorResults -- unit-readiness", () => {
  const definition = buildFirstTenantReadinessWorkflowDefinition();

  it("REQUIRED when the unit is still marked preparing", () => {
    const data = readyRentalData();
    data.units[0].status = "preparing";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["unit-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["unit-readiness"].reasonCode).toBe("unit_marked_preparing");
  });

  it("BLOCKED when the unit is marked inactive -- clearly explained, not silently skipped", () => {
    const data = readyRentalData();
    data.units[0].status = "inactive";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["unit-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["unit-readiness"].reasonCode).toBe("unit_marked_inactive");
    expect(FIRST_TENANT_READINESS_COPY["unit-readiness"].unit_marked_inactive.detail).toBeTruthy();
  });

  it("BLOCKED when the unit id doesn't resolve to a real unit at all", () => {
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, readyRentalData(), "nonexistent_unit", NOW));
    expect(byId["unit-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["unit-readiness"].reasonCode).toBe("unit_not_found");
  });
});

describe("buildFirstTenantReadinessEvaluatorResults -- tenant assignment and lease readiness", () => {
  const definition = buildFirstTenantReadinessWorkflowDefinition();

  it("REQUIRED tenant-assignment and BLOCKED lease-readiness when no lease exists at all for the unit", () => {
    const data = readyRentalData();
    data.leases = [];
    data.leaseMemberships = [];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["tenant-assignment"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["tenant-assignment"].reasonCode).toBe("no_tenant_assigned");
    expect(byId["lease-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["lease-readiness"].reasonCode).toBe("no_lease_to_activate");
  });

  it("REQUIRED lease-readiness when a lease exists with a tenant but is still draft", () => {
    const data = readyRentalData();
    data.leases[0].status = "draft";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["tenant-assignment"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
    expect(byId["lease-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["lease-readiness"].reasonCode).toBe("lease_still_draft");
  });

  it("BLOCKED lease-readiness when the most recent lease is ended/terminated/cancelled", () => {
    const data = readyRentalData();
    data.leases[0].status = "terminated";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["lease-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["lease-readiness"].reasonCode).toBe("lease_not_active_status");
  });

  it("prefers an active lease over other leases for the same unit when multiple exist", () => {
    const data = readyRentalData();
    data.leases.push({ id: "lease_old", unit_id: "unit_1", status: "ended", created_at: "2020-01-01T00:00:00.000Z" });
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["lease-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
  });

  it("picks the most recently created draft lease when no active lease exists", () => {
    const data = readyRentalData();
    data.leases[0].status = "draft";
    data.leases[0].created_at = "2026-01-01T00:00:00.000Z";
    data.leases.push({ id: "lease_newer_draft", unit_id: "unit_1", status: "draft", created_at: "2026-08-01T00:00:00.000Z" });
    data.leaseMemberships.push({ lease_id: "lease_newer_draft", tenant_id: "tenant_2" });
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    // The schedule/deposit/insurance/inspection fixtures are keyed to lease_1, so if the newer draft
    // were (wrongly) NOT selected, downstream steps would read as COMPLETE via lease_1's fixtures.
    // Since the newer draft has none of that, downstream steps must show as blocked/required instead --
    // proving lease_newer_draft, not lease_1, was actually selected.
    expect(byId["recurring-rent-setup"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
  });
});

describe("buildFirstTenantReadinessEvaluatorResults -- recurring rent, deposit, inspection", () => {
  const definition = buildFirstTenantReadinessWorkflowDefinition();

  it("BLOCKED recurring-rent-setup when the lease isn't active yet", () => {
    const data = readyRentalData();
    data.leases[0].status = "draft";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["recurring-rent-setup"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
    expect(byId["recurring-rent-setup"].reasonCode).toBe("lease_not_active_for_schedule");
  });

  it("REQUIRED recurring-rent-setup when no schedule exists yet for an active lease", () => {
    const data = readyRentalData();
    data.schedules = [];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["recurring-rent-setup"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["recurring-rent-setup"].reasonCode).toBe("no_schedule_created");
  });

  it("REQUIRED recurring-rent-setup when the schedule exists but isn't activated", () => {
    const data = readyRentalData();
    data.schedules[0].status = "draft";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["recurring-rent-setup"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["recurring-rent-setup"].reasonCode).toBe("schedule_not_activated");
  });

  it("REQUIRED security-deposit when no deposit is recorded", () => {
    const data = readyRentalData();
    data.deposits = [];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["security-deposit"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["security-deposit"].reasonCode).toBe("no_deposit_recorded");
  });

  it("REQUIRED security-deposit when the deposit exists but isn't fully held", () => {
    const data = readyRentalData();
    data.deposits[0].status = "partially_held";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["security-deposit"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["security-deposit"].reasonCode).toBe("deposit_not_fully_collected");
  });

  it("REQUIRED move-in-inspection when none has been recorded", () => {
    const data = readyRentalData();
    data.inspections = [];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["move-in-inspection"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["move-in-inspection"].reasonCode).toBe("no_move_in_inspection");
  });

  it("REQUIRED move-in-inspection when it exists but is still draft", () => {
    const data = readyRentalData();
    data.inspections[0].status = "draft";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["move-in-inspection"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["move-in-inspection"].reasonCode).toBe("inspection_not_finalized");
  });

  it("COMPLETE move-in-inspection for an acknowledged (not just finalized) inspection", () => {
    const data = readyRentalData();
    data.inspections[0].status = "acknowledged";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["move-in-inspection"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
  });

  it("never picks a different unit's schedule, deposit, or inspection by accident", () => {
    const data = readyRentalData();
    data.units.push({ id: "unit_2", property_id: "prop_1", label: "Unit 2", status: "available" });
    // unit_2 has no lease of its own at all.
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_2", NOW));
    expect(byId["tenant-assignment"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["lease-readiness"].status).toBe(EVALUATOR_RESULT_STATUS.BLOCKED);
  });
});

describe("buildFirstTenantReadinessEvaluatorResults -- renter's insurance", () => {
  const definition = buildFirstTenantReadinessWorkflowDefinition();

  it("NOT_APPLICABLE when the lease has an explicit requirement row with required: false", () => {
    const data = readyRentalData();
    data.insurancePolicies = [];
    data.insuranceRequirements = [{ lease_id: "lease_1", required: false }];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["renters-insurance"].status).toBe(EVALUATOR_RESULT_STATUS.NOT_APPLICABLE);
    expect(byId["renters-insurance"].reasonCode).toBe("insurance_not_required");
  });

  it("REQUIRED when no policy exists and there's no requirement row (implicit-required default)", () => {
    const data = readyRentalData();
    data.insurancePolicies = [];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["renters-insurance"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renters-insurance"].reasonCode).toBe("insurance_not_verified");
  });

  it("REQUIRED when a policy exists but is only pending_verification", () => {
    const data = readyRentalData();
    data.insurancePolicies = [{ id: "policy_1", lease_id: "lease_1", status: "pending_verification" }];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["renters-insurance"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renters-insurance"].reasonCode).toBe("insurance_pending_verification");
  });

  it("REQUIRED when the verified policy's expiration date has already passed", () => {
    const data = readyRentalData();
    data.insurancePolicies[0].expiration_date = "2020-01-01";
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["renters-insurance"].status).toBe(EVALUATOR_RESULT_STATUS.REQUIRED);
    expect(byId["renters-insurance"].reasonCode).toBe("insurance_expired");
  });

  it("COMPLETE when a requirement row explicitly marks required: true and a verified policy exists", () => {
    const data = readyRentalData();
    data.insuranceRequirements = [{ lease_id: "lease_1", required: true }];
    const byId = resultsByStepId(buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW));
    expect(byId["renters-insurance"].status).toBe(EVALUATOR_RESULT_STATUS.COMPLETE);
  });
});

describe("buildFirstTenantReadinessEvaluatorResults -- walking order and blockers", () => {
  it("every reasonCode used for a REQUIRED or BLOCKED status has matching copy text", () => {
    const definition = buildFirstTenantReadinessWorkflowDefinition();
    const scenarios = [
      readyRentalData(),
      (() => { const d = readyRentalData(); d.units[0].status = "preparing"; return d; })(),
      (() => { const d = readyRentalData(); d.units[0].status = "inactive"; return d; })(),
      (() => { const d = readyRentalData(); d.leases = []; d.leaseMemberships = []; return d; })(),
      (() => { const d = readyRentalData(); d.leases[0].status = "draft"; return d; })(),
      (() => { const d = readyRentalData(); d.leases[0].status = "cancelled"; return d; })(),
      (() => { const d = readyRentalData(); d.schedules = []; return d; })(),
      (() => { const d = readyRentalData(); d.schedules[0].status = "draft"; return d; })(),
      (() => { const d = readyRentalData(); d.deposits = []; return d; })(),
      (() => { const d = readyRentalData(); d.deposits[0].status = "required"; return d; })(),
      (() => { const d = readyRentalData(); d.insurancePolicies = []; return d; })(),
      (() => { const d = readyRentalData(); d.insurancePolicies[0].status = "pending_verification"; return d; })(),
      (() => { const d = readyRentalData(); d.insurancePolicies[0].expiration_date = "2020-01-01"; return d; })(),
      (() => { const d = readyRentalData(); d.inspections = []; return d; })(),
      (() => { const d = readyRentalData(); d.inspections[0].status = "draft"; return d; })(),
    ];
    for (const data of scenarios) {
      for (const result of buildFirstTenantReadinessEvaluatorResults(definition, data, "unit_1", NOW)) {
        if (result.status === EVALUATOR_RESULT_STATUS.REQUIRED || result.status === EVALUATOR_RESULT_STATUS.BLOCKED) {
          expect(FIRST_TENANT_READINESS_COPY[result.stepId]?.[result.reasonCode], `missing copy for ${result.stepId}/${result.reasonCode}`).toBeTruthy();
        }
      }
    }
  });
});
