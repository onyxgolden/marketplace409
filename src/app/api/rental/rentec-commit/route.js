import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";
import { resolveRentecImportCandidatesForCommit } from "@/domains/rentec-rental-migration/rentec-import-manifest.preview";
import { sanitizeRentecOwnerInputs } from "@/domains/rentec-rental-migration/rentec-owner-input-resolution.preview";
import { scopeRentecEvidenceToProperty } from "@/domains/rentec-rental-migration/rentec-single-property-scope";

const checksumPattern = /^[a-f0-9]{64}$/;

// Commits one Rentec property's worth of already-reviewed import
// candidates. Deliberately a separate route from rentec-api-preview
// (which is read-only end to end) rather than another operation on it —
// this is the one place in the whole Rentec pipeline that writes real
// data, and it should be easy to find, log, and reason about on its own.
export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;

    const body = await request.json();
    const propertyId = String(body?.propertyId || "").trim();
    const expectedChecksum = String(body?.expectedChecksum || "");
    if (!propertyId) {
      return NextResponse.json({ error: "A Rentec property id is required." }, { status: 400 });
    }
    if (!checksumPattern.test(expectedChecksum)) {
      return NextResponse.json({ error: "A valid expected checksum from the last preview is required." }, { status: 400 });
    }

    let ownerInputs;
    try {
      ownerInputs = sanitizeRentecOwnerInputs(body?.ownerInputs);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid owner inputs." }, { status: 400 });
    }

    const client = createRentecApiClient();
    const [rentec, unitsResult, tenantsResult, leasesResult] = await Promise.all([
      client.operationalEvidence(),
      authenticated.supabaseClient.from("rental_units").select("id,property_id,label,status"),
      authenticated.supabaseClient.from("rental_tenants").select("id,email,status"),
      authenticated.supabaseClient.from("rental_leases").select("id,unit_id,start_date,monthly_rent_cents,status"),
    ]);
    const fetchError = unitsResult.error || tenantsResult.error || leasesResult.error;
    if (fetchError) throw fetchError;

    const scoped = scopeRentecEvidenceToProperty({
      rentecProperties: rentec.properties,
      rentecTenants: rentec.tenants,
      rentecLeases: rentec.leases,
      propertyId,
    });

    const resolved = resolveRentecImportCandidatesForCommit({
      ...scoped,
      forgeUnits: unitsResult.data || [],
      forgeTenants: tenantsResult.data || [],
      forgeLeases: leasesResult.data || [],
      ownerInputs,
    });

    // Rebuilding from live data and comparing checksums, rather than
    // trusting a payload of candidate rows from the client, is the whole
    // point: the browser never had the real records to send back (see
    // rentec-import-manifest.preview.js), and this also catches Rentec or
    // FORGE data having changed since the user reviewed the preview.
    if (resolved.checksum !== expectedChecksum) {
      return NextResponse.json(
        { error: "Rentec or Rental Manager data changed since this import was last previewed. Preview again before committing." },
        { status: 409 },
      );
    }
    if (resolved.blockers.length > 0) {
      return NextResponse.json(
        { error: "This import still has unresolved items and cannot be committed.", blockers: resolved.blockers },
        { status: 409 },
      );
    }
    if (resolved.units.length === 0 && resolved.tenants.length === 0 && resolved.leases.length === 0) {
      return NextResponse.json({ error: "There is nothing new to import for this property." }, { status: 409 });
    }

    const { data, error: commitError } = await authenticated.supabaseClient.rpc("commit_rentec_rental_import", {
      p_owner_id: authenticated.user.id,
      p_units: resolved.units,
      p_tenants: resolved.tenants,
      p_leases: resolved.leases,
    });
    if (commitError) throw commitError;

    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    console.error("Rentec import commit error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to commit Rentec import." }, { status: 500 });
  }
}
