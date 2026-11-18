import { describe, expect, it } from "vitest";
import {
  LAB_STATUS,
  classifyValue,
  computeDerivedRatios,
  computeLatestDrawSummary,
  flagQualityNote,
  getMarkerPresentation,
  getMarkerSection,
  groupLabsBySection,
  normalizeMarkerName,
  parseFiniteNumber,
  positionPercent,
  selectLatestDraw,
  validateInterval,
} from "./healthLabPresentation";

function lab(overrides) {
  return {
    id: "lab-1",
    profile_id: "profile-1",
    marker_name: "LDL cholesterol",
    collected_on: "2026-11-09",
    value_numeric: 110,
    value_text: null,
    unit: "mg/dL",
    reference_low: 0,
    reference_high: 100,
    flag: "high",
    ...overrides,
  };
}

describe("parseFiniteNumber", () => {
  it("accepts numbers, numeric strings and zero", () => {
    expect(parseFiniteNumber(0)).toBe(0);
    expect(parseFiniteNumber(-3.5)).toBe(-3.5);
    expect(parseFiniteNumber(" 42 ")).toBe(42);
    expect(parseFiniteNumber("5.6")).toBe(5.6);
    expect(parseFiniteNumber(".5")).toBe(0.5);
  });

  it("rejects null, empty, whitespace, non-finite and text values", () => {
    expect(parseFiniteNumber(null)).toBeNull();
    expect(parseFiniteNumber(undefined)).toBeNull();
    expect(parseFiniteNumber("")).toBeNull();
    expect(parseFiniteNumber("   ")).toBeNull();
    expect(parseFiniteNumber(Number.NaN)).toBeNull();
    expect(parseFiniteNumber(Infinity)).toBeNull();
    expect(parseFiniteNumber("<5")).toBeNull();
    expect(parseFiniteNumber(">100")).toBeNull();
    expect(parseFiniteNumber("1,000")).toBeNull();
    expect(parseFiniteNumber("high")).toBeNull();
    expect(parseFiniteNumber({})).toBeNull();
  });
});

describe("validateInterval", () => {
  it("accepts both finite bounds with low < high, including zero", () => {
    expect(validateInterval(0, 100)).toEqual({ low: 0, high: 100 });
    expect(validateInterval("0", "99.9")).toEqual({ low: 0, high: 99.9 });
  });

  it("rejects one-sided, equal, reversed and non-numeric bounds", () => {
    expect(validateInterval(null, 100)).toBeNull();
    expect(validateInterval(0, null)).toBeNull();
    expect(validateInterval(100, 100)).toBeNull();
    expect(validateInterval(100, 0)).toBeNull();
    expect(validateInterval("<5", 100)).toBeNull();
    expect(validateInterval(0, "")).toBeNull();
  });
});

describe("classifyValue and positionPercent", () => {
  const interval = { low: 10, high: 20 };

  it("classifies below, within and above, with boundary equality within range", () => {
    expect(classifyValue(9.99, interval)).toBe(LAB_STATUS.BELOW);
    expect(classifyValue(10, interval)).toBe(LAB_STATUS.WITHIN);
    expect(classifyValue(15, interval)).toBe(LAB_STATUS.WITHIN);
    expect(classifyValue(20, interval)).toBe(LAB_STATUS.WITHIN);
    expect(classifyValue(20.01, interval)).toBe(LAB_STATUS.ABOVE);
  });

  it("positions the marker and clamps it to the edges for outliers", () => {
    expect(positionPercent(10, interval)).toBe(0);
    expect(positionPercent(15, interval)).toBe(50);
    expect(positionPercent(20, interval)).toBe(100);
    expect(positionPercent(0, interval)).toBe(0);
    expect(positionPercent(1000, interval)).toBe(100);
    expect(positionPercent(null, interval)).toBeNull();
    expect(positionPercent(15, null)).toBeNull();
  });
});

describe("getMarkerPresentation", () => {
  it("classifies a valid row and keeps the stored flag silent when it agrees", () => {
    const presentation = getMarkerPresentation(lab({ value_numeric: 110, reference_low: 0, reference_high: 100, flag: "high" }));
    expect(presentation.status).toBe(LAB_STATUS.ABOVE);
    expect(presentation.position).toBe(100);
    expect(presentation.flagNote).toBeNull();
  });

  it("shows value only for a missing range, even with a stored high flag", () => {
    const presentation = getMarkerPresentation(lab({ reference_low: null, reference_high: null, flag: "high" }));
    expect(presentation.status).toBeNull();
    expect(presentation.position).toBeNull();
    expect(presentation.flagNote).toBeNull();
  });

  it("shows value only for a non-numeric value", () => {
    const presentation = getMarkerPresentation(lab({ value_numeric: null, value_text: "Positive", flag: "normal" }));
    expect(presentation.value).toBeNull();
    expect(presentation.status).toBeNull();
  });

  it("flags a conflict between the stored flag and the numeric comparison", () => {
    const presentation = getMarkerPresentation(lab({ value_numeric: 50, reference_low: 0, reference_high: 100, flag: "high" }));
    expect(presentation.status).toBe(LAB_STATUS.WITHIN);
    expect(presentation.flagNote).toBe("Recorded flag: High; check source range");
  });

  it("keeps a recorded critical flag as a separate qualifier, never a boundary", () => {
    const presentation = getMarkerPresentation(lab({ value_numeric: 50, reference_low: 0, reference_high: 100, flag: "critical" }));
    expect(presentation.status).toBe(LAB_STATUS.WITHIN);
    expect(presentation.flagNote).toBe("Recorded flag: Critical");
  });

  it("shows no flag note when there is no valid interval, even for critical", () => {
    const presentation = getMarkerPresentation(lab({ reference_low: null, reference_high: null, flag: "critical" }));
    expect(presentation.flagNote).toBeNull();
  });
});

describe("flagQualityNote", () => {
  it("returns null without a status or when the flag agrees", () => {
    expect(flagQualityNote("high", null)).toBeNull();
    expect(flagQualityNote("unknown", LAB_STATUS.WITHIN)).toBeNull();
    expect(flagQualityNote("normal", LAB_STATUS.WITHIN)).toBeNull();
    expect(flagQualityNote("low", LAB_STATUS.BELOW)).toBeNull();
  });
});

describe("normalizeMarkerName and getMarkerSection", () => {
  it("normalizes case, punctuation and whitespace", () => {
    expect(normalizeMarkerName("  Hemoglobin A1c ")).toBe("hemoglobin a1c");
    expect(normalizeMarkerName("DHEA-S")).toBe("dhea s");
    expect(normalizeMarkerName("Lipoprotein(a)")).toBe("lipoprotein a");
  });

  it("maps every listed family and defaults unknown markers to Other", () => {
    expect(getMarkerSection("Total Testosterone")).toBe("Hormone Balance");
    expect(getMarkerSection("HbA1c")).toBe("Metabolic Fitness");
    expect(getMarkerSection("ApoB")).toBe("Heart Health");
    expect(getMarkerSection("eGFR")).toBe("Kidney & Liver Essentials");
    expect(getMarkerSection("Free T4")).toBe("Thyroid Function");
    expect(getMarkerSection("Hematocrit")).toBe("CBC Essentials");
    expect(getMarkerSection("Vitamin D")).toBe("Other");
    expect(getMarkerSection("")).toBe("Other");
    expect(getMarkerSection(null)).toBe("Other");
  });

  it("never matches by substring", () => {
    expect(getMarkerSection("Total cholesterol esters")).toBe("Other");
    expect(getMarkerSection("Glucose tolerance")).toBe("Other");
  });
});

describe("selectLatestDraw", () => {
  it("picks the greatest valid date and dedupes markers deterministically by id", () => {
    const rows = [
      lab({ id: "b", marker_name: "LDL cholesterol", collected_on: "2026-11-09", value_numeric: 110 }),
      lab({ id: "a", marker_name: "LDL cholesterol", collected_on: "2026-11-09", value_numeric: 109 }),
      lab({ id: "c", marker_name: "HDL cholesterol", collected_on: "2026-11-09", value_numeric: 50 }),
      lab({ id: "d", marker_name: "LDL cholesterol", collected_on: "2026-08-10", value_numeric: 140 }),
      lab({ id: "e", marker_name: "TSH", collected_on: "not-a-date", value_numeric: 2 }),
    ];
    const latest = selectLatestDraw(rows);
    expect(latest.date).toBe("2026-11-09");
    expect(latest.rows).toHaveLength(2);
    expect(latest.rows.find((row) => row.marker_name === "LDL cholesterol").id).toBe("a");
  });

  it("returns null when no row carries a valid date", () => {
    expect(selectLatestDraw([])).toBeNull();
    expect(selectLatestDraw([lab({ collected_on: "2026-13-40" })])).toBeNull();
  });
});

describe("computeLatestDrawSummary", () => {
  it("counts unique markers with 1-decimal percentages and an explicit unclassified count", () => {
    const rows = [
      lab({ id: "1", marker_name: "LDL cholesterol", collected_on: "2026-11-09", value_numeric: 110, reference_low: 0, reference_high: 100, flag: "high" }),
      lab({ id: "2", marker_name: "HDL cholesterol", collected_on: "2026-11-09", value_numeric: 50, reference_low: 40, reference_high: 60, flag: "normal" }),
      lab({ id: "3", marker_name: "Triglycerides", collected_on: "2026-11-09", value_numeric: 90, reference_low: 0, reference_high: 150, flag: "normal" }),
      lab({ id: "4", marker_name: "TSH", collected_on: "2026-11-09", value_numeric: 1.0, reference_low: 0.4, reference_high: 4.5, flag: "normal" }),
      lab({ id: "5", marker_name: "Cortisol", collected_on: "2026-11-09", value_numeric: 2.33, reference_low: null, reference_high: null, flag: "unknown" }),
      // Duplicate marker on the same date counts once.
      lab({ id: "6", marker_name: "LDL cholesterol", collected_on: "2026-11-09", value_numeric: 111, reference_low: 0, reference_high: 100, flag: "high" }),
      // Earlier date never blends in.
      lab({ id: "7", marker_name: "Glucose", collected_on: "2026-08-10", value_numeric: 500, reference_low: 70, reference_high: 99, flag: "high" }),
    ];
    const summary = computeLatestDrawSummary(rows);
    expect(summary.date).toBe("2026-11-09");
    expect(summary.total).toBe(5);
    expect(summary.classified).toBe(4);
    expect(summary.unclassified).toBe(1);
    expect(summary.buckets).toEqual({ within: 3, below: 0, above: 1 });
    expect(summary.percentages).toEqual({ within: 75, below: 0, above: 25 });
  });

  it("classifies by comparison even when the stored flag is unknown", () => {
    const rows = [lab({ marker_name: "LDL cholesterol", value_numeric: 110, reference_low: 0, reference_high: 100, flag: "unknown" })];
    const summary = computeLatestDrawSummary(rows);
    expect(summary.classified).toBe(1);
    expect(summary.buckets.above).toBe(1);
  });

  it("returns zero classified with null percentages when nothing has a usable range", () => {
    const rows = [lab({ reference_low: null, reference_high: null })];
    const summary = computeLatestDrawSummary(rows);
    expect(summary.classified).toBe(0);
    expect(summary.unclassified).toBe(1);
    expect(summary.percentages).toEqual({ within: null, below: null, above: null });
  });

  it("returns null with no rows", () => {
    expect(computeLatestDrawSummary([])).toBeNull();
  });

  it("rounds percentages to 1 decimal", () => {
    const rows = [
      lab({ id: "1", marker_name: "A", value_numeric: 1, reference_low: 0, reference_high: 2, flag: "normal" }),
      lab({ id: "2", marker_name: "B", value_numeric: 3, reference_low: 0, reference_high: 2, flag: "high" }),
      lab({ id: "3", marker_name: "C", value_numeric: 3, reference_low: 0, reference_high: 2, flag: "high" }),
    ];
    const summary = computeLatestDrawSummary(rows);
    expect(summary.percentages).toEqual({ within: 33.3, below: 0, above: 66.7 });
  });
});

describe("groupLabsBySection", () => {
  it("orders sections, sorts markers alphabetically, keeps every row and sorts history newest first", () => {
    const rows = [
      lab({ id: "1", marker_name: "Vitamin D", collected_on: "2026-08-10" }),
      lab({ id: "2", marker_name: "TSH", collected_on: "2026-11-09" }),
      lab({ id: "3", marker_name: "LDL cholesterol", collected_on: "2026-08-10" }),
      lab({ id: "4", marker_name: "HDL cholesterol", collected_on: "2026-11-09" }),
      lab({ id: "5", marker_name: "LDL cholesterol", collected_on: "2026-11-09" }),
    ];
    const groups = groupLabsBySection(rows);
    expect(groups.map((group) => group.section)).toEqual(["Heart Health", "Thyroid Function", "Other"]);
    const heart = groups[0];
    expect(heart.markers.map((marker) => marker.markerName)).toEqual(["HDL cholesterol", "LDL cholesterol"]);
    expect(heart.markers[1].points.map((point) => point.collected_on)).toEqual(["2026-11-09", "2026-08-10"]);
  });
});

describe("computeDerivedRatios", () => {
  const latestDate = "2026-11-09";
  function ratioRows(overridesByMarker) {
    return Object.entries(overridesByMarker).map(([markerName, overrides], index) => lab({
      id: `r${index}`,
      marker_name: markerName,
      collected_on: latestDate,
      value_numeric: 100,
      reference_low: null,
      reference_high: null,
      flag: "unknown",
      ...overrides,
    }));
  }

  it("computes all three ratios to two decimals from same-date, same-unit inputs", () => {
    const rows = ratioRows({
      Triglycerides: { value_numeric: 150 },
      "HDL cholesterol": { value_numeric: 50 },
      "LDL cholesterol": { value_numeric: 110 },
      ApoB: { value_numeric: 80 },
      "Total cholesterol": { value_numeric: 220 },
    });
    const ratios = computeDerivedRatios(rows);
    expect(ratios.map((ratio) => ratio.key)).toEqual([
      "triglycerides-hdl",
      "ldl-apob",
      "total-cholesterol-hdl",
    ]);
    expect(ratios.map((ratio) => ratio.displayValue)).toEqual(["3.00", "1.38", "4.40"]);
    expect(ratios[0].inputsLabel).toBe("Calculated from Triglycerides and HDL cholesterol on 2026-11-09");
  });

  it("accepts aliases such as TGL for triglycerides", () => {
    const rows = ratioRows({ TGL: { value_numeric: 100 }, HDL: { value_numeric: 40 } });
    const ratios = computeDerivedRatios(rows);
    expect(ratios).toHaveLength(1);
    expect(ratios[0].displayValue).toBe("2.50");
  });

  it("omits a ratio on a zero denominator, negative numerator or missing input", () => {
    expect(computeDerivedRatios(ratioRows({ Triglycerides: { value_numeric: 100 }, "HDL cholesterol": { value_numeric: 0 } }))).toEqual([]);
    expect(computeDerivedRatios(ratioRows({ Triglycerides: { value_numeric: -5 }, "HDL cholesterol": { value_numeric: 50 } }))).toEqual([]);
    expect(computeDerivedRatios(ratioRows({ Triglycerides: { value_numeric: 100 } }))).toEqual([]);
  });

  it("omits a ratio when units are mixed or unknown", () => {
    expect(computeDerivedRatios(ratioRows({
      Triglycerides: { value_numeric: 150, unit: "mg/dL" },
      "HDL cholesterol": { value_numeric: 50, unit: "mmol/L" },
    }))).toEqual([]);
    expect(computeDerivedRatios(ratioRows({
      Triglycerides: { value_numeric: 150, unit: "mg/dL" },
      "HDL cholesterol": { value_numeric: 50, unit: "" },
    }))).toEqual([]);
  });

  it("omits a ratio when the inputs are on different dates", () => {
    const rows = ratioRows({ Triglycerides: { value_numeric: 150 } });
    rows.push(lab({ id: "old", marker_name: "HDL cholesterol", collected_on: "2026-08-10", value_numeric: 50, reference_low: null, reference_high: null, flag: "unknown" }));
    expect(computeDerivedRatios(rows)).toEqual([]);
  });

  it("omits a ratio on conflicting duplicate inputs but keeps it when duplicates agree", () => {
    const agreeing = ratioRows({ Triglycerides: { value_numeric: 150 }, "HDL cholesterol": { value_numeric: 50 } });
    agreeing.push(lab({ id: "dup", marker_name: "Triglycerides", collected_on: latestDate, value_numeric: 150, reference_low: null, reference_high: null, flag: "unknown" }));
    expect(computeDerivedRatios(agreeing)).toHaveLength(1);

    const conflicting = ratioRows({ Triglycerides: { value_numeric: 150 }, "HDL cholesterol": { value_numeric: 50 } });
    conflicting.push(lab({ id: "dup", marker_name: "Triglycerides", collected_on: latestDate, value_numeric: 160, reference_low: null, reference_high: null, flag: "unknown" }));
    expect(computeDerivedRatios(conflicting)).toEqual([]);
  });

  it("returns no ratios with no rows", () => {
    expect(computeDerivedRatios([])).toEqual([]);
  });
});
