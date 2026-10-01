import { describe, expect, it } from "vitest";
import {
  SETUP_WIZARD_STEPS,
  SETUP_WIZARD_STEP_IDS,
  buildSetupWizardStatus,
  countActiveProperties,
  evaluateSetupWizardStep,
  isWorkspaceUnsetup,
} from "./setupWizard";

function emptyWorkspace() {
  return { units: [], tenants: [], bankAccountCount: 0, settingsConfigured: false, members: [] };
}

describe("setup wizard step order", () => {
  it("follows Rentec's Basic Setup Steps order", () => {
    expect(SETUP_WIZARD_STEP_IDS).toEqual(["settings", "banking", "owners", "managers", "properties", "tenants"]);
  });

  it("explains why the order matters on every step", () => {
    for (const step of SETUP_WIZARD_STEPS) {
      expect(step.title, step.id).toBeTruthy();
      expect(step.whyOrder, step.id).toMatch(/^.{20,}$/);
      expect(step.actions.length, step.id).toBeGreaterThan(0);
    }
  });

  it("deep-links only to existing surfaces (function ids or external hrefs)", () => {
    for (const step of SETUP_WIZARD_STEPS) {
      for (const action of step.actions) {
        expect(["function", "href"], `${step.id}/${action.label}`).toContain(action.kind);
        if (action.kind === "function") expect(action.functionId).toMatch(/^[a-z-]+$/);
        if (action.kind === "href") expect(action.href).toMatch(/^\//);
      }
    }
  });
});

describe("isWorkspaceUnsetup", () => {
  it("is true for a brand-new workspace with no units", () => {
    expect(isWorkspaceUnsetup(emptyWorkspace())).toBe(true);
  });

  it("is true when every unit is archived", () => {
    expect(isWorkspaceUnsetup({ ...emptyWorkspace(), units: [{ status: "inactive" }, { status: "INACTIVE" }] })).toBe(true);
  });

  it("is false once one active property exists, even with nothing else set up", () => {
    expect(isWorkspaceUnsetup({ ...emptyWorkspace(), units: [{ status: "active" }] })).toBe(false);
    expect(isWorkspaceUnsetup({ ...emptyWorkspace(), units: [{ status: "preparing" }] })).toBe(false);
  });

  it("ignores banking/settings progress: accounts but no properties is still unsetup", () => {
    expect(isWorkspaceUnsetup({ ...emptyWorkspace(), bankAccountCount: 2, settingsConfigured: true })).toBe(true);
  });
});

describe("countActiveProperties", () => {
  it("skips archived units case-insensitively", () => {
    expect(countActiveProperties([{ status: "active" }, { status: "Inactive" }, {}, { status: null }])).toBe(3);
  });
});

describe("evaluateSetupWizardStep", () => {
  it("settings completes from any configured company setting", () => {
    expect(evaluateSetupWizardStep("settings", emptyWorkspace())).toBe(false);
    expect(evaluateSetupWizardStep("settings", { ...emptyWorkspace(), settingsConfigured: true })).toBe(true);
  });

  it("banking completes with one active bank account", () => {
    expect(evaluateSetupWizardStep("banking", emptyWorkspace())).toBe(false);
    expect(evaluateSetupWizardStep("banking", { ...emptyWorkspace(), bankAccountCount: 1 })).toBe(true);
  });

  it("owners is complete by definition — the signed-in owner is the owner record", () => {
    expect(evaluateSetupWizardStep("owners", emptyWorkspace())).toBe(true);
  });

  it("managers completes only when a manager-role member exists", () => {
    expect(evaluateSetupWizardStep("managers", emptyWorkspace())).toBe(false);
    expect(
      evaluateSetupWizardStep("managers", {
        ...emptyWorkspace(),
        members: [{ role: "manager", status: "active" }],
      })
    ).toBe(true);
    // An invited (not yet accepted) manager is still a manager on the team.
    expect(
      evaluateSetupWizardStep("managers", {
        ...emptyWorkspace(),
        members: [{ role: "manager", status: "invited" }],
      })
    ).toBe(true);
  });

  it("managers is not satisfied by co_owner, bookkeeper, or read_only members", () => {
    for (const role of ["co_owner", "bookkeeper", "read_only"]) {
      expect(
        evaluateSetupWizardStep("managers", {
          ...emptyWorkspace(),
          members: [{ role, status: "active" }],
        }),
        role
      ).toBe(false);
    }
    // Even several non-manager members do not satisfy a step named "Managers".
    expect(
      evaluateSetupWizardStep("managers", {
        ...emptyWorkspace(),
        members: [
          { role: "co_owner", status: "active" },
          { role: "bookkeeper", status: "active" },
          { role: "read_only", status: "invited" },
        ],
      })
    ).toBe(false);
  });

  it("properties completes with one active property", () => {
    expect(evaluateSetupWizardStep("properties", emptyWorkspace())).toBe(false);
    expect(evaluateSetupWizardStep("properties", { ...emptyWorkspace(), units: [{ status: "active" }] })).toBe(true);
    expect(evaluateSetupWizardStep("properties", { ...emptyWorkspace(), units: [{ status: "inactive" }] })).toBe(false);
  });

  it("tenants completes with one tenant row", () => {
    expect(evaluateSetupWizardStep("tenants", emptyWorkspace())).toBe(false);
    expect(evaluateSetupWizardStep("tenants", { ...emptyWorkspace(), tenants: [{ id: "t1" }] })).toBe(true);
  });

  it("throws on an unknown step id", () => {
    expect(() => evaluateSetupWizardStep("nope", emptyWorkspace())).toThrow("Unknown setup wizard step");
  });
});

describe("buildSetupWizardStatus", () => {
  it("reports unsetup and zero progress for a fresh workspace", () => {
    const status = buildSetupWizardStatus(emptyWorkspace());
    expect(status.unsetup).toBe(true);
    expect(status.completeCount).toBe(0);
    expect(status.totalCount).toBe(4);
    expect(status.steps.map((step) => [step.id, step.complete])).toEqual([
      ["settings", false],
      ["banking", false],
      ["owners", true],
      ["managers", false],
      ["properties", false],
      ["tenants", false],
    ]);
  });

  it("derives progress from data only — a mid-setup workspace shows partial completion", () => {
    const status = buildSetupWizardStatus({
      ...emptyWorkspace(),
      settingsConfigured: true,
      bankAccountCount: 2,
    });
    expect(status.unsetup).toBe(true);
    expect(status.completeCount).toBe(2);
    const byId = Object.fromEntries(status.steps.map((step) => [step.id, step.complete]));
    expect(byId.settings).toBe(true);
    expect(byId.banking).toBe(true);
    expect(byId.properties).toBe(false);
    expect(byId.tenants).toBe(false);
  });

  it("a fully set-up workspace is not unsetup and every required step is done", () => {
    const status = buildSetupWizardStatus({
      units: [{ status: "active" }],
      tenants: [{ id: "t1" }],
      bankAccountCount: 1,
      settingsConfigured: true,
      members: [{ role: "manager", status: "active" }],
    });
    expect(status.unsetup).toBe(false);
    expect(status.completeCount).toBe(status.totalCount);
    expect(status.steps.every((step) => step.complete)).toBe(true);
  });
});
