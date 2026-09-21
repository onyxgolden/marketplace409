import { describe, expect, it } from "vitest";
import { ImportError } from "../chartImportTypes.js";
import {
  detectHeaders,
  normalizeHeader,
  produceCandidates,
} from "../headerDetector.js";
import { parseCsv } from "../spreadsheetParser.js";

const table = (headers) => ({ headers, rows: [], skippedBlankRows: 0 });

describe("normalizeHeader", () => {
  it("lowercases, trims, and collapses punctuation", () => {
    expect(normalizeHeader("  Employee_Name ")).toBe("employee name");
    expect(normalizeHeader("Reports-To")).toBe("reports to");
    expect(normalizeHeader("JOB  TITLE!!")).toBe("job title");
  });
});

describe("produceCandidates", () => {
  it("suggests canonical targets for known headers", () => {
    const [name, title, supervisor] = produceCandidates([
      "Employee Name",
      "Job Role",
      "Reports To",
    ]);
    expect(name.suggestions).toEqual([
      { target: "name", matchedAs: "Employee Name" },
    ]);
    expect(name.ambiguous).toBe(false);
    expect(title.suggestions[0].target).toBe("title");
    expect(supervisor.suggestions[0].target).toBe("supervisor");
  });

  it("leaves unknown headers unmapped but visible", () => {
    const [known, unknown] = produceCandidates(["Name", "Favorite Color"]);
    expect(known.suggestions).toHaveLength(1);
    expect(unknown.suggestions).toEqual([]);
    expect(unknown.ambiguous).toBe(false);
    // Unknown headers are shown as unmapped fields, never hidden.
    expect(unknown.header).toBe("Favorite Color");
  });

  it("marks duplicate target claims ambiguous so the user must choose", () => {
    const [first, second] = produceCandidates(["Employee Name", "Full Name"]);
    expect(first.suggestions[0].target).toBe("name");
    expect(second.suggestions[0].target).toBe("name");
    expect(first.ambiguous).toBe(true);
    expect(second.ambiguous).toBe(true);
  });

  it("suggests workflow targets", () => {
    const [step, next, decision] = produceCandidates([
      "Step",
      "Next Step",
      "Decision",
    ]);
    expect(step.suggestions[0].target).toBe("step");
    expect(next.suggestions[0].target).toBe("nextStep");
    expect(decision.suggestions[0].target).toBe("decision");
  });

  it("returns one candidate per header, in order", () => {
    const candidates = produceCandidates(["Name", "Title", "Mystery"]);
    expect(candidates).toHaveLength(3);
    expect(candidates.map((c) => c.index)).toEqual([0, 1, 2]);
  });
});

describe("detectHeaders", () => {
  it("never auto-commits: requiresConfirmation is always true", async () => {
    const [parsed] = await parseCsv("Name,Title,Supervisor\nAda,CEO,\n");
    const analysis = detectHeaders(parsed);
    expect(analysis.requiresConfirmation).toBe(true);
    expect(analysis.headers).toEqual(["Name", "Title", "Supervisor"]);
    expect(analysis.candidates).toHaveLength(3);
  });

  it("suggestions are hints only — nothing is applied", async () => {
    const [parsed] = await parseCsv("Employee Name,Dept\nAda,Eng\n");
    const analysis = detectHeaders(parsed);
    const dept = analysis.candidates[1];
    expect(dept.suggestions[0].target).toBe("department");
    // The analysis carries no confirmed mapping; the UI must ask the user.
    expect(analysis).not.toHaveProperty("confirmedMappings");
    expect(analysis).not.toHaveProperty("mappings");
  });

  it("rejects tables without a headers array", () => {
    expect(() => detectHeaders(null)).toThrow(ImportError);
    expect(() => detectHeaders({})).toThrow(ImportError);
  });
});
