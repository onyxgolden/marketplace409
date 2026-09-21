import { describe, expect, it } from "vitest";
import { produceCandidates } from "../headerDetector.js";
import { targetsForMode, validateConfirmedMappings } from "../importMapping.js";

function analysis(headers) {
  return {
    headers,
    candidates: produceCandidates(headers),
    requiresConfirmation: true,
  };
}

describe("validateConfirmedMappings", () => {
  it("missing name and supervisor blocks continue", () => {
    const gate = validateConfirmedMappings("org", analysis(["Employee Name", "Reports To"]), []);
    expect(gate.complete).toBe(false);
    expect(gate.missing).toEqual(["name", "supervisor"]);
  });

  it("missing supervisor alone blocks continue", () => {
    const gate = validateConfirmedMappings("org", analysis(["Employee Name"]), [
      { headerIndex: 0, target: "name" },
    ]);
    expect(gate.complete).toBe(false);
    expect(gate.missing).toEqual(["supervisor"]);
  });

  it("optional targets never satisfy required ones", () => {
    const gate = validateConfirmedMappings(
      "org",
      analysis(["Job Title", "Department"]),
      [
        { headerIndex: 0, target: "title" },
        { headerIndex: 1, target: "department" },
      ]
    );
    expect(gate.missing).toEqual(["name", "supervisor"]);
  });

  it("explicit confirmation of name and supervisor completes the gate", () => {
    const gate = validateConfirmedMappings(
      "org",
      analysis(["Employee Name", "Reports To"]),
      [
        { headerIndex: 0, target: "name" },
        { headerIndex: 1, target: "supervisor" },
      ]
    );
    expect(gate.missing).toEqual([]);
    expect(gate.ambiguousUnresolved).toEqual([]);
    expect(gate.complete).toBe(true);
  });

  it("ambiguous headers stay unresolved until the user picks explicitly", () => {
    // "Staff" and "Employee" both suggest the "name" target → ambiguous.
    const headers = ["Staff", "Employee", "Reports To"];
    const full = validateConfirmedMappings("org", analysis(headers), [
      { headerIndex: 0, target: "name" },
      { headerIndex: 2, target: "supervisor" },
    ]);
    expect(full.complete).toBe(false);
    expect(full.ambiguousUnresolved).toContain("Employee");

    // Even explicitly leaving the ambiguous header unmapped counts as a
    // choice: the user must still make it deliberately.
    const decided = validateConfirmedMappings("org", analysis(headers), [
      { headerIndex: 0, target: "name" },
      { headerIndex: 1, target: null },
      { headerIndex: 2, target: "supervisor" },
    ]);
    expect(decided.ambiguousUnresolved).toEqual([]);
    expect(decided.complete).toBe(true);
  });

  it("targetsForMode exposes only the mode's canonical targets", () => {
    expect(targetsForMode("org")).toContain("name");
    expect(targetsForMode("org")).not.toContain("step");
    expect(targetsForMode("workflow")).toContain("step");
    expect(targetsForMode("workflow")).not.toContain("supervisor");
  });
});
