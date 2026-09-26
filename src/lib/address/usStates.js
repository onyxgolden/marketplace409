// Frozen list of US states (+ DC) for structured address entry.
// Generic industry data only — no proprietary or program-specific naming.
export const US_STATES = Object.freeze([
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
]);

const CODE_SET = new Set(US_STATES.map((state) => state.code));
const NAME_TO_CODE = new Map(US_STATES.map((state) => [state.name.toLowerCase(), state.code]));

/** True when `value` is a recognized two-letter US state code (case-insensitive). */
export function isUsStateCode(value) {
  return typeof value === "string" && CODE_SET.has(value.trim().toUpperCase());
}

/** Normalizes a state code or full state name to its two-letter code, or null. */
export function normalizeUsStateCode(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (CODE_SET.has(trimmed.toUpperCase())) return trimmed.toUpperCase();
  return NAME_TO_CODE.get(trimmed.toLowerCase()) || null;
}

/** Display name for a state code, or the code itself when unknown. */
export function usStateName(code) {
  const found = US_STATES.find((state) => state.code === String(code || "").trim().toUpperCase());
  return found ? found.name : String(code || "");
}
