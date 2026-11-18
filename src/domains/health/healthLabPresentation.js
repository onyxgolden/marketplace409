// Pure presentation helpers for the private Health lab layout slice.
//
// Display-only: no database calls, no network, no mutation. Every helper
// works from the already profile-scoped lab rows the dashboard holds.
// Values and lab-supplied reference ranges are descriptive, not diagnoses:
// status words are only "Within range" / "Below range" / "Above range"
// (never "Optimal"), and a stored flag is never a reason to invent an
// interval or an optimal zone.

export const LAB_STATUS = {
  WITHIN: "Within range",
  BELOW: "Below range",
  ABOVE: "Above range",
};

// Sections in display order. "Other" is last and catches every unmapped
// marker -- a marker is never dropped or hidden.
export const LAB_SECTIONS = [
  "Hormone Balance",
  "Metabolic Fitness",
  "Heart Health",
  "Kidney & Liver Essentials",
  "Thyroid Function",
  "CBC Essentials",
  "Other",
];

// Normalizes a marker name for exact alias lookup: lowercase, punctuation
// removed, whitespace collapsed. Never substring matching.
export function normalizeMarkerName(name) {
  if (typeof name !== "string") return "";
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// One canonical normalized-key -> section lookup. An alias may not point to
// more than one section. Variants listed are the same lab name spelled
// another way (hyphen vs no hyphen, "Total" prefix); nothing here is a
// substring or a guessed clinical synonym.
const MARKER_SECTION_ALIASES = {
  // Hormone Balance
  "testosterone total": "Hormone Balance",
  "total testosterone": "Hormone Balance",
  "testosterone free": "Hormone Balance",
  "free testosterone": "Hormone Balance",
  estradiol: "Hormone Balance",
  e2: "Hormone Balance",
  progesterone: "Hormone Balance",
  "dhea s": "Hormone Balance",
  dheas: "Hormone Balance",
  cortisol: "Hormone Balance",
  shbg: "Hormone Balance",
  lh: "Hormone Balance",
  fsh: "Hormone Balance",
  prolactin: "Hormone Balance",
  // Metabolic Fitness
  glucose: "Metabolic Fitness",
  "fasting glucose": "Metabolic Fitness",
  hba1c: "Metabolic Fitness",
  "hemoglobin a1c": "Metabolic Fitness",
  insulin: "Metabolic Fitness",
  "fasting insulin": "Metabolic Fitness",
  "c peptide": "Metabolic Fitness",
  cpeptide: "Metabolic Fitness",
  // Heart Health
  "total cholesterol": "Heart Health",
  hdl: "Heart Health",
  "hdl cholesterol": "Heart Health",
  ldl: "Heart Health",
  "ldl cholesterol": "Heart Health",
  triglycerides: "Heart Health",
  tgl: "Heart Health",
  tg: "Heart Health",
  apob: "Heart Health",
  "apolipoprotein b": "Heart Health",
  "lipoprotein a": "Heart Health",
  "lp a": "Heart Health",
  lpa: "Heart Health",
  "hs crp": "Heart Health",
  "high sensitivity crp": "Heart Health",
  // Kidney & Liver Essentials
  creatinine: "Kidney & Liver Essentials",
  egfr: "Kidney & Liver Essentials",
  bun: "Kidney & Liver Essentials",
  "urea nitrogen": "Kidney & Liver Essentials",
  sodium: "Kidney & Liver Essentials",
  potassium: "Kidney & Liver Essentials",
  chloride: "Kidney & Liver Essentials",
  co2: "Kidney & Liver Essentials",
  bicarbonate: "Kidney & Liver Essentials",
  calcium: "Kidney & Liver Essentials",
  albumin: "Kidney & Liver Essentials",
  "total protein": "Kidney & Liver Essentials",
  ast: "Kidney & Liver Essentials",
  alt: "Kidney & Liver Essentials",
  "alkaline phosphatase": "Kidney & Liver Essentials",
  alp: "Kidney & Liver Essentials",
  bilirubin: "Kidney & Liver Essentials",
  "total bilirubin": "Kidney & Liver Essentials",
  "bilirubin total": "Kidney & Liver Essentials",
  // Thyroid Function
  tsh: "Thyroid Function",
  "free t4": "Thyroid Function",
  ft4: "Thyroid Function",
  "free t3": "Thyroid Function",
  ft3: "Thyroid Function",
  "total t4": "Thyroid Function",
  "total t3": "Thyroid Function",
  "thyroid peroxidase antibodies": "Thyroid Function",
  tpoab: "Thyroid Function",
  "thyroglobulin antibodies": "Thyroid Function",
  tgab: "Thyroid Function",
  // CBC Essentials
  wbc: "CBC Essentials",
  rbc: "CBC Essentials",
  hemoglobin: "CBC Essentials",
  hematocrit: "CBC Essentials",
  mcv: "CBC Essentials",
  mch: "CBC Essentials",
  mchc: "CBC Essentials",
  rdw: "CBC Essentials",
  platelets: "CBC Essentials",
  neutrophils: "CBC Essentials",
  lymphocytes: "CBC Essentials",
  monocytes: "CBC Essentials",
  eosinophils: "CBC Essentials",
  basophils: "CBC Essentials",
};

export function getMarkerSection(markerName) {
  return MARKER_SECTION_ALIASES[normalizeMarkerName(markerName)] || "Other";
}

// Strict finite-number parsing. Zero is valid input; null, undefined,
// empty/whitespace strings, NaN, Infinity, and text such as "<5" or
// ">100" are not. Never coerces null or "" into 0.
const DECIMAL_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
export function parseFiniteNumber(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!DECIMAL_PATTERN.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Both bounds must be finite numbers with low < high. One-sided, equal,
// reversed, missing or non-numeric bounds are not a usable interval.
export function validateInterval(referenceLow, referenceHigh) {
  const low = parseFiniteNumber(referenceLow);
  const high = parseFiniteNumber(referenceHigh);
  if (low == null || high == null || !(low < high)) return null;
  return { low, high };
}

// Comparison to the recorded bounds only. Boundary equality counts as
// within range.
export function classifyValue(value, interval) {
  if (value == null || !interval) return null;
  if (value < interval.low) return LAB_STATUS.BELOW;
  if (value > interval.high) return LAB_STATUS.ABOVE;
  return LAB_STATUS.WITHIN;
}

// Rendering-only clamp: the marker pins to the edge for out-of-range
// values; the status text (not the position) carries the out-of-range fact.
export function positionPercent(value, interval) {
  if (value == null || !interval) return null;
  const raw = (100 * (value - interval.low)) / (interval.high - interval.low);
  return Math.min(100, Math.max(0, raw));
}

const FLAG_LABELS = {
  low: "Low",
  high: "High",
  normal: "Normal",
  critical: "Critical",
  unknown: "Unknown",
};

// The stored flag is a provenance/consistency qualifier, never a status
// source. Returns a data-quality note when the flag conflicts with the
// numeric comparison, or when a critical flag is recorded alongside a
// valid interval. Returns null when there is no valid interval (value
// only, no status, no bucket count -- even for a stored high/critical
// flag) or when the flag agrees with the numeric status.
export function flagQualityNote(flag, status) {
  if (!status) return null;
  if (flag === "critical") return "Recorded flag: Critical";
  const expected = { low: LAB_STATUS.BELOW, high: LAB_STATUS.ABOVE, normal: LAB_STATUS.WITHIN }[flag];
  if (expected && expected !== status) return `Recorded flag: ${FLAG_LABELS[flag]}; check source range`;
  return null;
}

// Full per-row presentation: numeric value, usable interval, status,
// bar position, and any flag data-quality note. Rows without a finite
// numeric value or a valid interval carry status null and are rendered
// as value only.
export function getMarkerPresentation(row) {
  const value = parseFiniteNumber(row?.value_numeric ?? row?.value_text);
  const interval = validateInterval(row?.reference_low, row?.reference_high);
  const status = value != null && interval ? classifyValue(value, interval) : null;
  return {
    value,
    interval,
    status,
    position: status ? positionPercent(value, interval) : null,
    flagNote: flagQualityNote(row?.flag, status),
    flagLabel: FLAG_LABELS[row?.flag] || null,
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export function isValidCollectedDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

// Greatest valid collected_on across the given rows, or null when no row
// carries a valid date.
function latestDate(labs) {
  const dated = (labs || []).filter((row) => isValidCollectedDate(row?.collected_on));
  if (!dated.length) return null;
  return dated.reduce(
    (current, row) => (row.collected_on > current ? row.collected_on : current),
    dated[0].collected_on,
  );
}

// Latest draw, deterministically: the greatest valid collected_on for the
// selected profile only. Duplicate rows for the same marker on that date
// count once -- the record with the smallest id wins, so the choice is
// stable across renders. Returns null when no row carries a valid date.
export function selectLatestDraw(labs) {
  const date = latestDate(labs);
  if (!date) return null;
  const byMarker = new Map();
  for (const row of (labs || []).filter((row) => row.collected_on === date)) {
    const key = normalizeMarkerName(row.marker_name);
    const existing = byMarker.get(key);
    if (!existing || String(row.id ?? "") < String(existing.id ?? "")) byMarker.set(key, row);
  }
  return { date, rows: [...byMarker.values()] };
}

function formatPercent(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((1000 * numerator) / denominator) / 10;
}

// Latest-draw summary for the Labs tab. N classified of M unique markers
// on the latest date; unclassified rows are excluded from the denominator
// but shown as an explicit count. Percentages are rounded to 1 decimal at
// display; counts are authoritative. When nothing classifies, the caller
// shows "No comparable reference ranges for the latest date" instead of
// deceptive 0% tiles.
export function computeLatestDrawSummary(labs) {
  const latest = selectLatestDraw(labs);
  if (!latest) return null;
  const total = latest.rows.length;
  const buckets = { within: 0, below: 0, above: 0 };
  for (const row of latest.rows) {
    const { status } = getMarkerPresentation(row);
    if (status === LAB_STATUS.WITHIN) buckets.within += 1;
    else if (status === LAB_STATUS.BELOW) buckets.below += 1;
    else if (status === LAB_STATUS.ABOVE) buckets.above += 1;
  }
  const classified = buckets.within + buckets.below + buckets.above;
  return {
    date: latest.date,
    total,
    classified,
    unclassified: total - classified,
    buckets,
    percentages: {
      within: formatPercent(buckets.within, classified),
      below: formatPercent(buckets.below, classified),
      above: formatPercent(buckets.above, classified),
    },
  };
}

// Groups profile-scoped labs into sections in display order, markers
// alphabetical within a section, each marker's history newest first.
// Every row is kept; unmapped markers land in "Other".
export function groupLabsBySection(labs) {
  const grouped = groupLabsByMarkerName(labs);
  return LAB_SECTIONS.map((section) => ({
    section,
    markers: Object.keys(grouped)
      .filter((markerName) => getMarkerSection(markerName) === section)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((markerName) => ({ markerName, points: grouped[markerName] })),
  })).filter((group) => group.markers.length > 0);
}

function groupLabsByMarkerName(labs) {
  const groups = {};
  for (const lab of labs || []) {
    (groups[lab.marker_name] ??= []).push(lab);
  }
  for (const points of Object.values(groups)) {
    points.sort((a, b) => {
      const byDate = String(b.collected_on || "").localeCompare(String(a.collected_on || ""));
      if (byDate) return byDate;
      return String(a.id ?? "").localeCompare(String(b.id ?? ""));
    });
  }
  return groups;
}

// --- Derived ratios (virtual display objects only; never persisted) ---

function normalizeUnit(unit) {
  return typeof unit === "string" ? unit.toLowerCase().replace(/\s+/g, "") : "";
}

// Input roles, each with its accepted aliases (same normalized keys as the
// section map, plus the ratio-specific spellings).
const RATIO_INPUT_ALIASES = {
  triglycerides: ["triglycerides", "tgl", "tg"],
  hdl: ["hdl", "hdl cholesterol"],
  ldl: ["ldl", "ldl cholesterol"],
  apob: ["apob", "apolipoprotein b"],
  totalCholesterol: ["total cholesterol"],
};

const RATIO_DEFINITIONS = [
  {
    key: "triglycerides-hdl",
    label: "Triglycerides/HDL (calculated)",
    numerator: "triglycerides",
    denominator: "hdl",
  },
  {
    key: "ldl-apob",
    label: "LDL/ApoB (calculated)",
    numerator: "ldl",
    denominator: "apob",
  },
  {
    key: "total-cholesterol-hdl",
    label: "Total cholesterol/HDL (calculated)",
    numerator: "totalCholesterol",
    denominator: "hdl",
  },
];

// One unambiguous input value for a role on the latest date: all rows for
// the role's aliases must agree on one (value, unit) pair, or the input is
// ambiguous and the ratio is omitted rather than arbitrarily chosen.
function findRatioInput(latestRows, role) {
  const aliases = new Set(RATIO_INPUT_ALIASES[role]);
  const candidates = latestRows.filter((row) => aliases.has(normalizeMarkerName(row.marker_name)));
  const distinct = new Map();
  for (const row of candidates) {
    const value = parseFiniteNumber(row?.value_numeric ?? row?.value_text);
    if (value == null) return null;
    const unit = normalizeUnit(row?.unit);
    if (!unit) return null;
    distinct.set(`${value}|${unit}`, { value, unit, markerName: row.marker_name });
  }
  if (distinct.size !== 1) return null;
  return distinct.values().next().value;
}

// Computes the three supported ratios from the latest draw only: same
// date, same profile (callers pass profile-scoped rows), same compatible
// units, denominator > 0, non-negative numerator. A ratio that cannot be
// computed is omitted, never zero-filled or flagged. Conflicting duplicate
// inputs are detected here on the raw latest-date rows -- the summary's
// one-per-marker dedup would hide the conflict, so ratios deliberately
// see every row on the date.
export function computeDerivedRatios(labs) {
  const date = latestDate(labs);
  if (!date) return [];
  const latestRows = (labs || []).filter((row) => row.collected_on === date);
  const results = [];
  for (const definition of RATIO_DEFINITIONS) {
    const numerator = findRatioInput(latestRows, definition.numerator);
    const denominator = findRatioInput(latestRows, definition.denominator);
    if (!numerator || !denominator) continue;
    if (numerator.unit !== denominator.unit) continue;
    if (!(denominator.value > 0) || numerator.value < 0) continue;
    const value = numerator.value / denominator.value;
    if (!Number.isFinite(value)) continue;
    results.push({
      key: definition.key,
      label: definition.label,
      value,
      displayValue: value.toFixed(2),
      inputsLabel: `Calculated from ${numerator.markerName} and ${denominator.markerName} on ${date}`,
      date,
    });
  }
  return results;
}
