import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { isHousePlansEnabled } from "@/lib/housePlans/housePlansFlags";
import {
  buildCensusGeocoderUrl,
  buildLikelyJurisdiction,
  parseCensusGeographies,
  unresolvedJurisdiction,
  validateCoordinates,
} from "@/lib/housePlans/jurisdictionResolution";

// HOUSE PLANS (HP-L5) — read-only jurisdiction resolution API.
//
// Resolves user-provided project coordinates to FACTUAL jurisdiction
// geography (state, county, incorporated place) via the US Census Geocoder
// -- a free public factual source, no key required. The route performs the
// single authorized Census call server-side; coordinates are never sent to
// analytics or any other third party, and the Census response is transient
// (never persisted or cached).
//
// Link-only scope: FORGE records what the geocoder reports the location is
// inside. It never interprets which building code, authority, or
// requirement applies. The furthest this slice advances a project is
// LIKELY; CONFIRMED_BY_USER requires an explicit user action in a later
// slice. No compliance/check engine.

const CENSUS_TIMEOUT_MS = 10000;

// Absent or blank query parameters must stay invalid: Number(null) and
// Number("") both coerce to 0, which would silently turn a missing
// coordinate into a real Census lookup for (0,0) in the Gulf of Guinea.
function readCoordinates(searchParams) {
  const latitude = parseCoordinateParam(searchParams.get("lat"));
  const longitude = parseCoordinateParam(searchParams.get("lon"));
  return { latitude, longitude };
}

function parseCoordinateParam(value) {
  if (value === null || value.trim() === "") return undefined;
  return Number(value);
}

// GET /api/forge/designer/house-plans/jurisdiction?lat=..&lon=..
// Resolves the coordinates to a jurisdiction resolution record.
// Read-only: no persistence, no state changes.
export async function GET(request) {
  try {
    if (!isHousePlansEnabled()) {
      return NextResponse.json(
        { error: "House Plans is not enabled." },
        { status: 404 }
      );
    }
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;

    const { latitude, longitude } = readCoordinates(new URL(request.url).searchParams);
    const validation = validateCoordinates({ latitude, longitude });
    if (!validation.ok) {
      return NextResponse.json(
        { error: "Provide a valid latitude (-90 to 90) and longitude (-180 to 180)." },
        { status: 400 }
      );
    }

    let payload;
    try {
      const response = await fetch(buildCensusGeocoderUrl(latitude, longitude), {
        signal: AbortSignal.timeout(CENSUS_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Census Geocoder responded ${response.status}`);
      payload = await response.json();
    } catch (error) {
      // Never log the coordinates; the failure is generic by design.
      console.error("House Plans jurisdiction lookup error", error?.message || error);
      return NextResponse.json(
        {
          success: true,
          resolution: unresolvedJurisdiction({
            reason: "jurisdiction lookup unavailable",
            latitude,
            longitude,
          }),
        },
        { status: 200 }
      );
    }

    const parsed = parseCensusGeographies(payload);
    if (!parsed.ok) {
      return NextResponse.json(
        {
          success: true,
          resolution: unresolvedJurisdiction({
            reason: "no usable geography returned",
            latitude,
            longitude,
          }),
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      resolution: buildLikelyJurisdiction(parsed.geography, { latitude, longitude }),
    });
  } catch (error) {
    console.error("House Plans jurisdiction error", error);
    return NextResponse.json(
      { error: "Unable to resolve the project jurisdiction." },
      { status: 500 }
    );
  }
}
