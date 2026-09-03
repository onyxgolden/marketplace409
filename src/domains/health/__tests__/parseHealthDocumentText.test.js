import { describe, expect, it } from "vitest";
import { parseHealthDocumentText } from "../parseHealthDocumentText";

describe("parseHealthDocumentText", () => {
  it("proposes medication fields but keeps them review-required", () => {
    const proposal = parseHealthDocumentText({ documentType: "medication_label", extractedText: "SAMPLE PATIENT\nDEMOZINE 12MG TABLETS\nTAKE 1 TABLET BY MOUTH DAILY\n2+ REFILLS" });
    expect(proposal).toMatchObject({ proposalType: "regimen_item", confidence: "review_required", fields: { name: "DEMOZINE", dose: "12 mg", instructions: "TAKE 1 TABLET BY MOUTH DAILY", refillsRemaining: 2 } });
  });

  it("parses prescription labels the same way as medication labels, not as unclassified", () => {
    const proposal = parseHealthDocumentText({ documentType: "prescription", extractedText: "SAMPLE PATIENT\nDEMOZINE 12MG TABLETS\nTAKE 1 TABLET BY MOUTH DAILY\n2+ REFILLS" });
    expect(proposal).toMatchObject({ proposalType: "regimen_item", confidence: "review_required", fields: { name: "DEMOZINE", dose: "12 mg", instructions: "TAKE 1 TABLET BY MOUTH DAILY", refillsRemaining: 2 } });
  });

  it("extracts only recognized lab candidates for human confirmation", () => {
    const proposal = parseHealthDocumentText({ documentType: "lab_report", extractedText: "Hemoglobin A1c 7.7 %\nCholesterol, Total 222 mg/dL\nLDL-C Calculated 133 mg/dL" });
    expect(proposal.confidence).toBe("review_required");
    expect(proposal.fields.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ markerName: "Hemoglobin A1c", valueNumeric: 7.7 }),
      expect.objectContaining({ markerName: "Total cholesterol", valueNumeric: 222 }),
      expect.objectContaining({ markerName: "LDL cholesterol", valueNumeric: 133 }),
    ]));
    expect(proposal.fields.results.every((result) => result.flag === "unknown")).toBe(true);
  });

  it("never invents fields when extraction is empty", () => {
    expect(parseHealthDocumentText({ documentType: "lab_report", extractedText: "" })).toMatchObject({ proposalType: "unclassified", confidence: "none", fields: {} });
  });
});
