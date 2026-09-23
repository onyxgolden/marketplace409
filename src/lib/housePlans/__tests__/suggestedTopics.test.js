import {
  ENTITY_TOPIC_MAP,
  FORBIDDEN_TOPIC_WORDS,
  extractPlacedEntities,
  matchReferencesByTopics,
  topicsForEntities,
  topicsForEntity,
} from "../suggestedTopics";

describe("suggestedTopics (HP-L6) — strictly entity → topic", () => {
  it("maps the review's sanctioned example: window_double_hung → windows", () => {
    expect(topicsForEntity("buildingElements", "window_double_hung")).toEqual(["windows"]);
  });

  it("matches wildcard symbol families and prefers exact entries", () => {
    expect(topicsForEntity("buildingElements", "window_slider")).toEqual(["windows"]);
    expect(topicsForEntity("buildingElements", "door_single_36")).toEqual(["doors"]);
    expect(topicsForEntity("buildingElements", "stair_l_shaped")).toEqual(["stairs"]);
  });

  it("maps plumbing fixtures to plumbing + residential-code topics", () => {
    expect(topicsForEntity("furniture", "toilet")).toEqual([
      "plumbing",
      "residential-code",
    ]);
    expect(topicsForEntity("furniture", "washer")).toContain("plumbing");
    expect(topicsForEntity("furniture", "water-heater")).toContain("plumbing");
  });

  it("maps lighting to electrical and appliances to appliances", () => {
    expect(topicsForEntity("furniture", "floor-lamp")).toContain("electrical");
    expect(topicsForEntity("furniture", "refrigerator")).toContain("appliances");
  });

  it("returns [] for unknown entities instead of inventing topics", () => {
    expect(topicsForEntity("furniture", "mystery-object")).toEqual([]);
    expect(topicsForEntity("unknown-domain", "toilet")).toEqual([]);
    expect(topicsForEntity(null, null)).toEqual([]);
  });

  it("never encodes requirement applicability: no topic contains forbidden words", () => {
    for (const mapEntry of ENTITY_TOPIC_MAP) {
      for (const topic of mapEntry.topics) {
        for (const word of FORBIDDEN_TOPIC_WORDS) {
          expect(topic.toLowerCase()).not.toContain(word);
        }
      }
    }
    // The sanctioned example topic is present and nothing names a requirement.
    const allTopics = new Set(
      ENTITY_TOPIC_MAP.flatMap((entry) => entry.topics)
    );
    expect(allTopics.has("windows")).toBe(true);
    expect(allTopics.has("wind_zone_requirements")).toBe(false);
  });

  it("deduplicates topics across a set of placed entities", () => {
    const topics = topicsForEntities([
      { domain: "buildingElements", symbolId: "window_double_hung" },
      { domain: "buildingElements", symbolId: "window_slider" },
      { domain: "furniture", symbolId: "toilet" },
      { domain: "furniture", symbolId: "mystery-object" },
      null,
      "not-an-object",
    ]);
    expect(topics).toEqual(["windows", "plumbing", "residential-code"]);
  });
});

describe("extractPlacedEntities (HP-L6)", () => {
  const envelope = {
    levels: [
      {
        id: "L01",
        design: {
          symbols: [
            { domain: "furniture", symbolId: "toilet" },
            { domain: "buildingElements", symbolId: "window_double_hung" },
            { domain: "furniture", symbolId: 42 }, // malformed: skipped
          ],
        },
      },
      {
        id: "L02",
        // symbols may sit directly on the level when there is no design wrapper
        symbols: [{ domain: "furniture", symbolId: "washer" }],
      },
    ],
  };

  it("extracts { domain, symbolId } pairs from levels, skipping malformed symbols", () => {
    expect(extractPlacedEntities(envelope)).toEqual([
      { domain: "furniture", symbolId: "toilet" },
      { domain: "buildingElements", symbolId: "window_double_hung" },
      { domain: "furniture", symbolId: "washer" },
    ]);
  });

  it("returns [] for missing or malformed envelopes instead of throwing", () => {
    expect(extractPlacedEntities(null)).toEqual([]);
    expect(extractPlacedEntities({})).toEqual([]);
    expect(extractPlacedEntities({ levels: "nope" })).toEqual([]);
  });
});

describe("matchReferencesByTopics (HP-L6)", () => {
  const references = [
    { id: "r1", topicTags: ["windows", "windstorm"] },
    { id: "r2", topicTags: ["plumbing"] },
    { id: "r3", topicTags: ["egress"] },
    { id: "r4", topicTags: null },
  ];

  it("matches references whose topic tags intersect the entity topics", () => {
    const matches = matchReferencesByTopics(references, ["windows", "plumbing"]);
    expect(matches.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("matches nothing when topics are empty or no tags intersect", () => {
    expect(matchReferencesByTopics(references, [])).toEqual([]);
    expect(matchReferencesByTopics(references, ["landscaping"])).toEqual([]);
    expect(matchReferencesByTopics([], ["windows"])).toEqual([]);
  });

  it("tolerates malformed input without throwing", () => {
    expect(matchReferencesByTopics(null, ["windows"])).toEqual([]);
    expect(matchReferencesByTopics(references, null)).toEqual([]);
  });
});
