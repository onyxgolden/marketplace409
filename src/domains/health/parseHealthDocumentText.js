const MARKERS = Object.freeze([
  ["Hemoglobin A1c", /(?:hemoglobin\s+)?a1c\D{0,12}(\d+(?:\.\d+)?)/i, "%"],
  ["Glucose", /\bglucose\D{0,12}(\d+(?:\.\d+)?)/i, "mg/dL"],
  ["Total cholesterol", /(?:total\s+cholesterol|cholesterol,?\s+total)\D{0,12}(\d+(?:\.\d+)?)/i, "mg/dL"],
  ["LDL cholesterol", /(?:ldl(?:-c)?(?:\s+calculated)?|ldl\s+cholesterol)\D{0,12}(\d+(?:\.\d+)?)/i, "mg/dL"],
  ["HDL cholesterol", /(?:hdl(?:-c)?|hdl\s+cholesterol)\D{0,12}(\d+(?:\.\d+)?)/i, "mg/dL"],
  ["Triglycerides", /\btriglycerides\D{0,12}(\d+(?:\.\d+)?)/i, "mg/dL"],
  ["Estradiol", /\bestradiol\D{0,12}(\d+(?:\.\d+)?)/i, "pg/mL"],
  ["Testosterone, total", /testosterone,?\s+total\D{0,12}(\d+(?:\.\d+)?)/i, "ng/dL"],
  ["eGFR", /\begfr(?:\s*\([^)]*\))?\D{0,12}(\d+(?:\.\d+)?)/i, "mL/min/1.73m²"],
  ["Creatinine", /\bcreatinine(?:,?\s+serum)?\D{0,12}(\d+(?:\.\d+)?)/i, "mg/dL"],
]);

function text(value) { return String(value || "").replace(/\r/g, "\n").trim(); }

export function parseHealthDocumentText({ documentType, extractedText }) {
  const source = text(extractedText);
  if (!source) return Object.freeze({ proposalType: "unclassified", parserVersion: "health-doc-v1", confidence: "none", fields: {} });
  if (documentType === "medication_label") return parseMedicationLabel(source);
  if (documentType === "lab_report") return parseLabReport(source);
  return Object.freeze({ proposalType: "unclassified", parserVersion: "health-doc-v1", confidence: "none", fields: { sourceExcerpt: source.slice(0, 500) } });
}

function parseMedicationLabel(source) {
  const lines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => /\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml)\b/i.test(line) && !/take|refill|qty/i.test(line));
  const match = candidate?.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*(mcg|mg|g|ml)\b(?:\s+(tablets?|capsules?))?/i);
  const instruction = lines.find((line) => /^(take|inject|apply|use)\b/i.test(line));
  const refillMatch = source.match(/(\d+)\+?\s*refills?/i);
  const fields = {
    category: "prescription",
    name: match?.[1]?.trim() || "",
    dose: match ? `${match[2]} ${match[3].toLowerCase()}` : "",
    form: match?.[4]?.toLowerCase() || "",
    instructions: instruction || "",
    refillsRemaining: refillMatch ? Number(refillMatch[1]) : null,
    sourceExcerpt: lines.slice(0, 12).join("\n"),
  };
  return Object.freeze({ proposalType: "regimen_item", parserVersion: "health-medication-label-v1", confidence: match ? "review_required" : "low", fields });
}

function parseLabReport(source) {
  const results = MARKERS.flatMap(([markerName, pattern, unit]) => {
    const match = source.match(pattern);
    if (!match) return [];
    return [{ markerName, valueNumeric: Number(match[1]), unit, referenceLow: null, referenceHigh: null, flag: "unknown" }];
  });
  return Object.freeze({
    proposalType: "lab_results", parserVersion: "health-lab-known-markers-v1",
    confidence: results.length ? "review_required" : "low",
    fields: { collectedOn: null, sourceName: null, results, sourceExcerpt: source.slice(0, 1000) },
  });
}
