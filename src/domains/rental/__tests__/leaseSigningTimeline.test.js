import { describe, expect, it } from "vitest";
import { buildLeaseSigningSteps } from "../leaseSigningTimeline";

describe("buildLeaseSigningSteps", () => {
  it("shows a partial signature round as in progress with my state in the detail", () => {
    const steps = buildLeaseSigningSteps({
      versionNumber: 3,
      signatures: [{ displayName: "A. Tenant", signedAt: "2026-09-10T14:00:00.000Z" }],
      totalTenants: 2,
      signedByMe: false,
    });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Lease prepared", "complete"],
      ["Tenant signatures — 1 of 2", "current"],
      ["Completed", "upcoming"],
    ]);
    expect(steps[1].detail).toContain("Your signature is needed.");
  });

  it("completes the round when every tenant signed", () => {
    const steps = buildLeaseSigningSteps({
      versionNumber: 1,
      signatures: [
        { displayName: "A. Tenant", signedAt: "2026-09-10T14:00:00.000Z" },
        { displayName: "B. Tenant", signedAt: "2026-09-11T14:00:00.000Z" },
      ],
      totalTenants: 2,
      signedByMe: true,
      mySignedAt: "2026-09-11T14:00:00.000Z",
    });
    expect(steps.every(step => step.state === "complete")).toBe(true);
    expect(steps[1].detail).toContain("You signed");
  });

  it("is honest when no signatures are required", () => {
    const steps = buildLeaseSigningSteps({ versionNumber: 2, totalTenants: 0 });
    expect(steps.map(step => [step.label, step.state])).toEqual([
      ["Lease prepared", "complete"],
      ["No signatures required", "current"],
    ]);
  });
});
