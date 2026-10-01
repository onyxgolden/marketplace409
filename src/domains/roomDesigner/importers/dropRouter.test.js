import { describe, expect, it } from "vitest";
import { DROP_REFUSED_FORMATS, classifyDroppedFile } from "./dropRouter.js";

describe("classifyDroppedFile", () => {
  it("routes each supported extension to its importer kind, case-insensitively", () => {
    expect(classifyDroppedFile("plan.pdf")).toEqual({ kind: "pdf" });
    expect(classifyDroppedFile("Plan.PDF")).toEqual({ kind: "pdf" });
    expect(classifyDroppedFile("house.dxf")).toEqual({ kind: "dxf" });
    expect(classifyDroppedFile("house.DXF")).toEqual({ kind: "dxf" });
    expect(classifyDroppedFile("drawing.vsdx")).toEqual({ kind: "vsdx" });
  });

  it("refuses every closed CAD format by name, with actionable guidance", () => {
    for (const format of DROP_REFUSED_FORMATS) {
      const result = classifyDroppedFile(`plan.${format.extension}`);
      expect(result.kind).toBe("refused");
      expect(result.label).toBe(format.label);
      expect(result.message).toBe(format.message);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it("refuses .dwg specifically, matching the existing DxfImportSection refusal in spirit", () => {
    const result = classifyDroppedFile("plan.dwg");
    expect(result.kind).toBe("refused");
    expect(result.message).toMatch(/DXF/);
  });

  it("reports unknown for anything else, including no extension and the legacy .vsd format", () => {
    expect(classifyDroppedFile("plan.vsd")).toEqual({ kind: "unknown", extension: "vsd" });
    expect(classifyDroppedFile("plan.ai")).toEqual({ kind: "unknown", extension: "ai" });
    expect(classifyDroppedFile("noextension")).toEqual({ kind: "unknown", extension: "" });
    expect(classifyDroppedFile("")).toEqual({ kind: "unknown", extension: "" });
    expect(classifyDroppedFile(undefined)).toEqual({ kind: "unknown", extension: "" });
  });

  it("never throws on malformed input", () => {
    expect(() => classifyDroppedFile(null)).not.toThrow();
    expect(() => classifyDroppedFile(42)).not.toThrow();
  });
});
