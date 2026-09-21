import { describe, expect, it } from "vitest";
import {
  buildCensusGeocoderUrl,
  buildLikelyJurisdiction,
  CENSUS_BENCHMARK,
  CENSUS_GEOCODER_BASE_URL,
  CENSUS_VINTAGE,
  confirmJurisdictionByUser,
  JURISDICTION_PROVENANCE,
  jurisdictionDisplayLabel,
  parseCensusGeographies,
  unresolvedJurisdiction,
  validateCoordinates,
} from "./jurisdictionResolution";

// Fixture modeled on the live US Census Geocoder coordinate response
// (verified 2026-09-21 against geocoding.geo.census.gov for
// 30.2672,-97.7431). Factual geography only -- no regulatory content.
const AUSTIN_CENSUS_RESPONSE = {
  result: {
    geographies: {
      States: [
        { GEOID: "48", NAME: "Texas", BASENAME: "Texas", STATE: "48", STUSAB: "TX" },
      ],
      Counties: [
        { GEOID: "48453", NAME: "Travis County", BASENAME: "Travis", STATE: "48", COUNTY: "453" },
      ],
      "County Subdivisions": [
        { GEOID: "4845390165", NAME: "Austin CCD", BASENAME: "Austin", STATE: "48", COUNTY: "453" },
      ],
      "Incorporated Places": [
        { GEOID: "4805000", NAME: "Austin city", BASENAME: "Austin", STATE: "48", PLACE: "05000" },
      ],
      "Census Tracts": [
        { GEOID: "48453001103", NAME: "Census Tract 11.03", BASENAME: "11.03", STATE: "48", COUNTY: "453" },
      ],
    },
  },
};

describe("validateCoordinates (HP-L5)", () => {
  it("accepts valid latitude/longitude", () => {
    expect(validateCoordinates({ latitude: 30.2672, longitude: -97.7431 }).ok).toBe(true);
  });

  it("rejects out-of-range and non-numeric coordinates", () => {
    expect(validateCoordinates({ latitude: 91, longitude: -97 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: -91, longitude: -97 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: 30, longitude: 181 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: 30, longitude: -181 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: NaN, longitude: -97 }).ok).toBe(false);
    expect(validateCoordinates({ latitude: "30", longitude: -97 }).ok).toBe(false);
    expect(validateCoordinates({}).ok).toBe(false);
  });

  it("never throws on malformed input", () => {
    for (const bad of [null, undefined, 42, "coords", [], [30, -97]]) {
      expect(() => validateCoordinates(bad)).not.toThrow();
      expect(validateCoordinates(bad).ok).toBe(false);
    }
  });
});

describe("buildCensusGeocoderUrl (HP-L5)", () => {
  it("builds the coordinate lookup URL with benchmark, vintage, and json format", () => {
    const url = buildCensusGeocoderUrl(30.2672, -97.7431);
    expect(url.startsWith(CENSUS_GEOCODER_BASE_URL)).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("x")).toBe("-97.7431");
    expect(parsed.searchParams.get("y")).toBe("30.2672");
    expect(parsed.searchParams.get("benchmark")).toBe(CENSUS_BENCHMARK);
    expect(parsed.searchParams.get("vintage")).toBe(CENSUS_VINTAGE);
    expect(parsed.searchParams.get("format")).toBe("json");
  });
});

describe("parseCensusGeographies (HP-L5)", () => {
  it("extracts factual state/county/place geography from a Census response", () => {
    const parsed = parseCensusGeographies(AUSTIN_CENSUS_RESPONSE);
    expect(parsed.ok).toBe(true);
    expect(parsed.geography.state).toMatchObject({ name: "Texas", fips: "48", abbreviation: "TX" });
    expect(parsed.geography.county).toMatchObject({ name: "Travis County", fips: "48453" });
    expect(parsed.geography.place).toMatchObject({ name: "Austin city", fips: "4805000" });
    expect(parsed.geography.countySubdivision).toMatchObject({ name: "Austin CCD" });
    expect(parsed.geography.tract).toMatchObject({ name: "Census Tract 11.03" });
    expect(Object.isFrozen(parsed.geography)).toBe(true);
  });

  it("succeeds without a place for unincorporated locations", () => {
    const rural = {
      result: {
        geographies: {
          States: [{ GEOID: "48", NAME: "Texas", STUSAB: "TX" }],
          Counties: [{ GEOID: "48453", NAME: "Travis County" }],
          "Incorporated Places": [],
        },
      },
    };
    const parsed = parseCensusGeographies(rural);
    expect(parsed.ok).toBe(true);
    expect(parsed.geography.place).toBeNull();
    expect(parsed.geography.county).toMatchObject({ name: "Travis County" });
  });

  it("reads Census Designated Places when no incorporated place exists", () => {
    const cdp = {
      result: {
        geographies: {
          States: [{ GEOID: "48", NAME: "Texas", STUSAB: "TX" }],
          Counties: [{ GEOID: "48453", NAME: "Travis County" }],
          "Census Designated Places": [{ GEOID: "4812345", NAME: "Lost Creek CDP" }],
        },
      },
    };
    const parsed = parseCensusGeographies(cdp);
    expect(parsed.ok).toBe(true);
    expect(parsed.geography.place).toMatchObject({ name: "Lost Creek CDP", fips: "4812345" });
  });

  it("fails cleanly when no usable geography is present", () => {
    expect(parseCensusGeographies({ result: { geographies: {} } }).ok).toBe(false);
    expect(parseCensusGeographies({ result: { geographies: { States: [] } } }).ok).toBe(false);
  });

  it("never throws on malformed payloads", () => {
    for (const bad of [null, undefined, {}, [], "nope", { result: null }, { result: { geographies: null } }]) {
      expect(() => parseCensusGeographies(bad)).not.toThrow();
      expect(parseCensusGeographies(bad).ok).toBe(false);
    }
  });
});

describe("jurisdiction state transitions (HP-L5)", () => {
  it("buildLikelyJurisdiction produces a frozen LIKELY record with provenance", () => {
    const { geography } = parseCensusGeographies(AUSTIN_CENSUS_RESPONSE);
    const resolution = buildLikelyJurisdiction(geography, {
      latitude: 30.2672,
      longitude: -97.7431,
      retrievedAt: "2026-09-21T00:00:00.000Z",
    });
    expect(resolution.jurisdictionState).toBe("LIKELY");
    expect(resolution.provenance).toBe(JURISDICTION_PROVENANCE);
    expect(resolution.retrievedAt).toBe("2026-09-21T00:00:00.000Z");
    expect(resolution.latitude).toBe(30.2672);
    expect(resolution.longitude).toBe(-97.7431);
    expect(resolution.geography.state.name).toBe("Texas");
    expect(Object.isFrozen(resolution)).toBe(true);
  });

  it("unresolvedJurisdiction produces a frozen UNRESOLVED record with a reason", () => {
    const resolution = unresolvedJurisdiction({ reason: "lookup failed" });
    expect(resolution.jurisdictionState).toBe("UNRESOLVED");
    expect(resolution.geography).toBeNull();
    expect(resolution.reason).toBe("lookup failed");
    expect(Object.isFrozen(resolution)).toBe(true);
  });

  it("confirmJurisdictionByUser promotes only on explicit confirmation", () => {
    const { geography } = parseCensusGeographies(AUSTIN_CENSUS_RESPONSE);
    const likely = buildLikelyJurisdiction(geography, {});
    const confirmed = confirmJurisdictionByUser(likely, { confirmed: true });
    expect(confirmed.jurisdictionState).toBe("CONFIRMED_BY_USER");
    expect(Object.isFrozen(confirmed)).toBe(true);
    // original untouched
    expect(likely.jurisdictionState).toBe("LIKELY");

    // anything but an explicit true leaves the record unchanged
    for (const options of [{}, { confirmed: false }, { confirmed: "yes" }, { confirmed: 1 }]) {
      expect(confirmJurisdictionByUser(likely, options)).toBe(likely);
    }
  });

  it("confirmJurisdictionByUser never auto-promotes or throws on bad input", () => {
    expect(confirmJurisdictionByUser(null, { confirmed: true })).toBeNull();
    expect(confirmJurisdictionByUser(undefined, { confirmed: true })).toBeUndefined();
    const verified = { jurisdictionState: "VERIFIED_SOURCE" };
    expect(confirmJurisdictionByUser(verified, { confirmed: true })).toBe(verified);
  });
});

describe("jurisdictionDisplayLabel (HP-L5)", () => {
  it("labels place, county, and state factually", () => {
    const { geography } = parseCensusGeographies(AUSTIN_CENSUS_RESPONSE);
    expect(jurisdictionDisplayLabel(buildLikelyJurisdiction(geography, {}))).toBe(
      "Austin city, Travis County, Texas"
    );
  });

  it("falls back gracefully without a place or geography", () => {
    expect(
      jurisdictionDisplayLabel({ geography: { place: null, county: { name: "Travis County" }, state: { name: "Texas" } } })
    ).toBe("Travis County, Texas");
    expect(jurisdictionDisplayLabel(unresolvedJurisdiction({}))).toBe("Jurisdiction unresolved");
    expect(jurisdictionDisplayLabel(null)).toBe("Jurisdiction unresolved");
  });

  it("never uses compliance or determination language", () => {
    const { geography } = parseCensusGeographies(AUSTIN_CENSUS_RESPONSE);
    const label = jurisdictionDisplayLabel(buildLikelyJurisdiction(geography, {})).toLowerCase();
    for (const banned of ["compliant", "determination", "approved", "code", "requires"]) {
      expect(label).not.toContain(banned);
    }
  });
});
