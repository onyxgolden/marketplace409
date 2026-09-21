import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(),
}));
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { HOUSE_PLANS_FLAG_KEY } from "@/lib/housePlans/housePlansFlags";
import { GET } from "./route";

const AUSTIN_CENSUS_RESPONSE = {
  result: {
    geographies: {
      States: [{ GEOID: "48", NAME: "Texas", BASENAME: "Texas", STATE: "48", STUSAB: "TX" }],
      Counties: [{ GEOID: "48453", NAME: "Travis County", BASENAME: "Travis", STATE: "48", COUNTY: "453" }],
      "Incorporated Places": [{ GEOID: "4805000", NAME: "Austin city", BASENAME: "Austin", STATE: "48", PLACE: "05000" }],
    },
  },
};

function authed() {
  return { user: { id: "user_1" }, effectiveOwnerId: "user_1", supabaseClient: {} };
}

function getRequest(lat, lon) {
  const params = new URLSearchParams();
  if (lat !== undefined) params.set("lat", String(lat));
  if (lon !== undefined) params.set("lon", String(lon));
  return new Request(`http://localhost/api/forge/designer/house-plans/jurisdiction?${params.toString()}`);
}

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_FLAG = process.env[HOUSE_PLANS_FLAG_KEY];

describe("GET /api/forge/designer/house-plans/jurisdiction (HP-L5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env[HOUSE_PLANS_FLAG_KEY] = "true";
    createAuthenticatedForgeApplication.mockResolvedValue(authed());
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    if (ORIGINAL_FLAG === undefined) delete process.env[HOUSE_PLANS_FLAG_KEY];
    else process.env[HOUSE_PLANS_FLAG_KEY] = ORIGINAL_FLAG;
    vi.restoreAllMocks();
  });

  it("returns 404 when the House Plans flag is off, without calling auth or Census", async () => {
    delete process.env[HOUSE_PLANS_FLAG_KEY];
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const response = await GET(getRequest(30.2672, -97.7431));
    expect(response.status).toBe(404);
    expect(createAuthenticatedForgeApplication).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    createAuthenticatedForgeApplication.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    const response = await GET(getRequest(30.2672, -97.7431));
    expect(response.status).toBe(401);
  });

  it("returns 400 for missing or blank coordinates without calling Census", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    // Missing params entirely, missing lat, missing lon, blank lat/lon.
    // Number(null)/Number("") coerce to 0 — these must stay invalid, not
    // become a real Census lookup for (0,0).
    const queries = ["", "lon=-97.7431", "lat=30.2672", "lat=&lon="];
    for (const query of queries) {
      const response = await GET(
        new Request(`http://localhost/api/forge/designer/house-plans/jurisdiction?${query}`)
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Provide a valid latitude (-90 to 90) and longitude (-180 to 180).",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid coordinates without calling Census", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    for (const [lat, lon] of [[200, -97.7431], [30.2672, -200], ["abc", -97.7431]]) {
      const response = await GET(getRequest(lat, lon));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Provide a valid latitude (-90 to 90) and longitude (-180 to 180).",
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves coordinates to a LIKELY jurisdiction with factual Census geography", async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(String(url)).toContain("geocoding.geo.census.gov");
      return { ok: true, status: 200, json: async () => AUSTIN_CENSUS_RESPONSE };
    });
    globalThis.fetch = fetchMock;

    const response = await GET(getRequest(30.2672, -97.7431));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.resolution.jurisdictionState).toBe("LIKELY");
    expect(body.resolution.provenance).toBe("US Census Geocoder");
    expect(body.resolution.geography.state).toMatchObject({ name: "Texas", abbreviation: "TX" });
    expect(body.resolution.geography.county).toMatchObject({ name: "Travis County" });
    expect(body.resolution.geography.place).toMatchObject({ name: "Austin city" });
    expect(body.resolution.latitude).toBe(30.2672);
    expect(body.resolution.longitude).toBe(-97.7431);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns UNRESOLVED when Census returns no usable geography", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: { geographies: {} } }),
    }));
    const response = await GET(getRequest(0, 0));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.resolution.jurisdictionState).toBe("UNRESOLVED");
    expect(body.resolution.geography).toBeNull();
  });

  it("returns UNRESOLVED (not 500) when the Census call fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const response = await GET(getRequest(30.2672, -97.7431));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resolution.jurisdictionState).toBe("UNRESOLVED");
  });

  it("returns UNRESOLVED when Census responds non-OK", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503 }));
    const response = await GET(getRequest(30.2672, -97.7431));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resolution.jurisdictionState).toBe("UNRESOLVED");
  });

  it("never logs the project coordinates on lookup failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await GET(getRequest(30.2672, -97.7431));
    const logged = errorSpy.mock.calls.flat().map(String).join(" ");
    expect(logged).not.toContain("30.2672");
    expect(logged).not.toContain("-97.7431");
  });
});
