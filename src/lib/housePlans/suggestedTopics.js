// HOUSE PLANS (HP-L6) entity → topic suggestions.
//
// Strictly entity → TOPIC, never entity → requirement. Each entry maps a
// placed drawing object ({ symbolDomain, symbolId }) to topic tags that name
// what the object is about — never what any authority requires, mandates,
// or deems applicable. A mapping like
//   { symbolDomain: "buildingElements", symbolId: "window_*", topics: ["windows"] }
// is allowed; a mapping like
//   { symbolId: "window_double_hung", topics: ["wind_zone_requirements"] }
// is FORBIDDEN because it encodes regulatory applicability.
//
// The Suggested tab matches these topics against reference topicTags and
// renders official-source links. Topics that match nothing contribute
// nothing — FORGE never invents suggestions.
//
// symbolId supports a trailing "*" prefix wildcard (e.g. "window_*") so the
// table stays small as symbol families grow. Exact entries take precedence
// over wildcard entries.

const entry = (symbolDomain, symbolId, topics) =>
  Object.freeze({ symbolDomain, symbolId, topics: Object.freeze([...topics]) });

export const ENTITY_TOPIC_MAP = Object.freeze([
  // buildingElements (object-library slice, parallel track): reviewer-
  // sanctioned example entries. window_double_hung -> ["windows"] is the
  // exact example from the architecture review.
  entry("buildingElements", "window_double_hung", ["windows"]),
  entry("buildingElements", "window_*", ["windows"]),
  entry("buildingElements", "door_*", ["doors"]),
  entry("buildingElements", "stair_*", ["stairs"]),

  // furniture: bath / kitchen / laundry fixtures relate to the plumbing and
  // residential-code topics. Broad, honest topic associations — not claims
  // about what any code requires for a given project.
  ...[
    "toilet",
    "vanity-single",
    "vanity-double",
    "bathtub",
    "shower",
    "shower-48x36",
    "sink-pedestal",
    "sink-bath-round",
    "sink-kitchen-33",
    "cabinet-sink-36",
    "utility-sink",
    "washer",
    "water-heater",
  ].map((symbolId) => entry("furniture", symbolId, ["plumbing", "residential-code"])),

  // furniture: lighting and appliances.
  ...["floor-lamp", "table-lamp"].map((symbolId) =>
    entry("furniture", symbolId, ["electrical", "residential-code"])
  ),
  ...["refrigerator", "range", "dishwasher", "microwave-cart", "dryer"].map(
    (symbolId) => entry("furniture", symbolId, ["appliances", "residential-code"])
  ),
]);

// Words that would turn a topic into a requirement claim. No topic in the
// table may contain them (case-insensitive); enforced by unit test.
export const FORBIDDEN_TOPIC_WORDS = Object.freeze([
  "requirement",
  "required",
  "requires",
  "compliance",
  "compliant",
  "violation",
  "applicable",
  "mandatory",
  "must",
  "shall",
  "code-minimum",
]);

function matchesEntry(mapEntry, domain, symbolId) {
  if (mapEntry.symbolDomain !== domain) return false;
  if (mapEntry.symbolId === symbolId) return true;
  if (mapEntry.symbolId.endsWith("*")) {
    const prefix = mapEntry.symbolId.slice(0, -1);
    return symbolId.startsWith(prefix);
  }
  return false;
}

// Topics for one placed entity. Exact symbolId entries win over wildcard
// entries; unknown entities yield []. Never throws.
export function topicsForEntity(domain, symbolId) {
  if (typeof domain !== "string" || typeof symbolId !== "string") return [];
  const exact = ENTITY_TOPIC_MAP.filter(
    (mapEntry) =>
      mapEntry.symbolDomain === domain && mapEntry.symbolId === symbolId
  );
  const pool = exact.length > 0
    ? exact
    : ENTITY_TOPIC_MAP.filter((mapEntry) => matchesEntry(mapEntry, domain, symbolId));
  const topics = [];
  for (const mapEntry of pool) {
    for (const topic of mapEntry.topics) {
      if (!topics.includes(topic)) topics.push(topic);
    }
  }
  return topics;
}

// Topics for a set of placed entities ({ domain, symbolId }[]), deduplicated.
export function topicsForEntities(entities) {
  if (!Array.isArray(entities)) return [];
  const topics = [];
  for (const entity of entities) {
    if (!entity || typeof entity !== "object") continue;
    for (const topic of topicsForEntity(entity.domain, entity.symbolId)) {
      if (!topics.includes(topic)) topics.push(topic);
    }
  }
  return topics;
}

// Extracts placed symbol instances ({ domain, symbolId }) from a designer
// envelope (levels[] -> design.symbols[]). Tolerates the level carrying
// symbols directly when no design wrapper is present. Never throws.
export function extractPlacedEntities(envelope) {
  const levels = envelope?.levels;
  if (!Array.isArray(levels)) return [];
  const entities = [];
  for (const level of levels) {
    if (!level || typeof level !== "object") continue;
    const design = level.design && typeof level.design === "object" ? level.design : level;
    const symbols = design.symbols;
    if (!Array.isArray(symbols)) continue;
    for (const symbol of symbols) {
      if (
        symbol &&
        typeof symbol === "object" &&
        typeof symbol.domain === "string" &&
        typeof symbol.symbolId === "string"
      ) {
        entities.push({ domain: symbol.domain, symbolId: symbol.symbolId });
      }
    }
  }
  return entities;
}

// References whose topicTags intersect the entity topics. Pure matching
// core behind the Suggested tab; the tab renders the matches with the
// existing ReferenceCard. Never throws on malformed input.
export function matchReferencesByTopics(references, topics) {
  if (!Array.isArray(references) || !Array.isArray(topics) || topics.length === 0) {
    return [];
  }
  const wanted = new Set(topics);
  return references.filter(
    (reference) =>
      reference &&
      Array.isArray(reference.topicTags) &&
      reference.topicTags.some((tag) => wanted.has(tag))
  );
}
