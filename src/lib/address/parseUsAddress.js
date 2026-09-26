import { normalizeUsStateCode } from "./usStates";

// Lightweight client-side US address parser. No external service — it splits a
// pasted full address into street / unit / city / state / ZIP so the structured
// fields can be prefilled. Handles the common shapes:
//
//   "123 Main St, Apt 4, Springfield, IL 62701"
//   "123 Main St Apt 4, Springfield, IL 62701-1234"
//   "123 Main St, Springfield, IL 62701"
//   "1600 Pennsylvania Ave NW, Washington, DC 20500"
//   "123 Main St\nSpringfield, IL 62701"            (multi-line paste)
//
// Returns { street, unit, city, state, zip } or null when the text does not
// look like a complete address (at minimum street + city + state + ZIP).

const UNIT_DESIGNATORS = /(?:\b(apt|apartment|unit|suite|ste|fl|floor|bldg|building|rm|room)\b\.?|#)\s*([\w-]+)/i;
const ZIP_AT_END = /(\d{5})(?:-(\d{4}))?\s*$/;

function collapseWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function parseUsAddress(raw) {
  if (typeof raw !== "string") return null;
  const text = collapseWhitespace(raw.replace(/\r?\n/g, ", "));
  if (!text) return null;

  const zipMatch = text.match(ZIP_AT_END);
  if (!zipMatch) return null;
  const zip = zipMatch[2] ? `${zipMatch[1]}-${zipMatch[2]}` : zipMatch[1];
  const beforeZip = collapseWhitespace(text.slice(0, zipMatch.index));

  // Split on commas: the last segment should be "City ST" or "City, ST".
  const segments = beforeZip.split(",").map((part) => collapseWhitespace(part)).filter(Boolean);
  if (segments.length < 2) return null;

  const tail = segments[segments.length - 1];
  const tailTokens = tail.split(" ");
  let state = null;
  let city = "";

  if (tailTokens.length >= 2) {
    // "Springfield IL" — city and state share the last segment.
    state = normalizeUsStateCode(tailTokens[tailTokens.length - 1]);
    if (state) {
      city = tailTokens.slice(0, -1).join(" ");
      segments.splice(segments.length - 1, 1);
    }
  }
  if (!state) {
    // "Springfield", "IL" (or "Illinois") — state sits in its own segment.
    state = normalizeUsStateCode(tail);
    if (state && segments.length >= 2) {
      city = segments[segments.length - 2];
      segments.splice(segments.length - 2, 2);
    }
  }

  if (!state || !city) return null;

  const streetRaw = collapseWhitespace(segments.join(" "));
  if (!streetRaw) return null;

  let street = streetRaw;
  let unit = "";
  const unitMatch = street.match(UNIT_DESIGNATORS);
  if (unitMatch) {
    const isHash = unitMatch[0].trimStart().startsWith("#");
    const designator = isHash ? "#" : unitMatch[1].replace(/^\w/, (c) => c.toUpperCase());
    const number = unitMatch[2];
    unit = isHash ? `#${number}` : `${designator} ${number}`;
    street = collapseWhitespace(street.replace(unitMatch[0], ""));
  }

  return { street, unit, city, state, zip };
}

/** True when pasted text is worth attempting to parse (has separators or a ZIP). */
export function looksLikeFullAddress(raw) {
  if (typeof raw !== "string") return false;
  const text = raw.trim();
  return text.length > 12 && (/[,]/.test(text) || /\n/.test(text) || /\d{5}(?:-\d{4})?/.test(text));
}
