import { describe, expect, it } from "vitest";
import {
  IMPORT_MODES,
  ImportError,
  REQUIRED_TARGETS,
  assertImportMode,
  missingRequiredTargets,
} from "../chartImportTypes.js";

describe("missingRequiredTargets", () => {
  it("org requires name and supervisor", () => {
    expect(missingRequiredTargets("org", [])).toEqual(["name", "supervisor"]);
  });

  it("org with only name mapped still misses supervisor", () => {
    expect(
      missingRequiredTargets("org", [{ headerIndex: 0, target: "name" }])
    ).toEqual(["supervisor"]);
  });

  it("org with name and supervisor confirmed is complete", () => {
    expect(
      missingRequiredTargets("org", [
        { headerIndex: 0, target: "name" },
        { headerIndex: 2, target: "supervisor" },
      ])
    ).toEqual([]);
  });

  it("optional targets never satisfy required ones", () => {
    expect(
      missingRequiredTargets("org", [
        { headerIndex: 1, target: "title" },
        { headerIndex: 3, target: "department" },
      ])
    ).toEqual(["name", "supervisor"]);
  });

  it("workflow requires step and nextStep", () => {
    expect(missingRequiredTargets("workflow", [])).toEqual(["step", "nextStep"]);
    expect(
      missingRequiredTargets("workflow", [{ headerIndex: 0, target: "step" }])
    ).toEqual(["nextStep"]);
    expect(
      missingRequiredTargets("workflow", [
        { headerIndex: 0, target: "step" },
        { headerIndex: 1, target: "nextStep" },
      ])
    ).toEqual([]);
  });

  it("missing required mapping must fail before preview", () => {
    // The mapping UI blocks continue while this list is non-empty.
    const missing = missingRequiredTargets("org", [
      { headerIndex: 0, target: "name" },
    ]);
    expect(missing.length).toBeGreaterThan(0);
  });

  it("rejects unknown modes", () => {
    expect(() => missingRequiredTargets("mindmap", [])).toThrow(ImportError);
  });
});

describe("assertImportMode", () => {
  it("accepts org and workflow", () => {
    expect(assertImportMode("org")).toBe("org");
    expect(assertImportMode("workflow")).toBe("workflow");
    expect(IMPORT_MODES).toEqual(["org", "workflow"]);
    expect(REQUIRED_TARGETS.org).toEqual(["name", "supervisor"]);
  });
});

describe("ImportError", () => {
  it("carries code, message, and details", () => {
    const err = new ImportError("empty-file", "The CSV file is empty.", {
      fileName: "a.csv",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ImportError");
    expect(err.code).toBe("empty-file");
    expect(err.message).toBe("The CSV file is empty.");
    expect(err.details).toEqual({ fileName: "a.csv" });
  });

  it("details default to null", () => {
    expect(new ImportError("x", "y").details).toBeNull();
  });
});
