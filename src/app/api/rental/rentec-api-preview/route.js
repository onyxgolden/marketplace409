import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { createRentecApiClient } from "@/domains/rentec-rental-migration/rentec-api.client";
import { previewRentecLegacyReconciliation } from "@/domains/rentec-rental-migration/rentec-legacy-reconciliation.preview";
import { previewRentecOperationalMigration } from "@/domains/rentec-rental-migration/rentec-operational-migration.preview";
import { buildRentecImportManifest } from "@/domains/rentec-rental-migration/rentec-import-manifest.preview";

const fingerprintPattern = /^[a-f0-9]{16}$/;

async function loadLegacyRentecEvents(supabaseClient, ownerId) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseClient.from("financial_events")
      .select("event_date,amount,description,property_id,normalized_category")
      .eq("owner_id", ownerId)
      .eq("source_system", "rentec")
      .order("event_date", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function validFingerprints(value) {
  return Array.isArray(value) && value.length <= 10000 && value.every((record) =>
    record && fingerprintPattern.test(record.exact) && fingerprintPattern.test(record.probable) && fingerprintPattern.test(record.propertyProbable) && fingerprintPattern.test(record.conflict)
      && /^(\d{4}|Unknown year|Invalid year)$/.test(record.year) && typeof record.property === "string" && record.property.length <= 100
      && ["Rent", "Deposit", "Late fee", "Maintenance", "Utilities", "Taxes", "Insurance", "Management", "Financing", "Purchase", "Other"].includes(record.category)
      && Number.isSafeInteger(record.amountCents) && record.amountCents >= 0);
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    const client = createRentecApiClient();
    if (body?.operation === "inventory") return NextResponse.json({ success: true, data: await client.inventory() });
    if (body?.operation === "transactions") return NextResponse.json({ success: true, data: await client.transactionPage({ propertyId: String(body.propertyId || ""), propertyName: String(body.propertyName || ""), page: Number(body.page || 1) }) });
    if (body?.operation === "files") return NextResponse.json({ success: true, data: await client.fileInventory({ associationType: String(body.associationType || "all"), associationId: String(body.associationId || "") }) });
    if (body?.operation === "plan-operational") {
      const [rentec, unitsResult, tenantsResult, leasesResult] = await Promise.all([
        client.operationalEvidence(),
        authenticated.supabaseClient.from("rental_units").select("id,property_id,label,status"),
        authenticated.supabaseClient.from("rental_tenants").select("id,email,status"),
        authenticated.supabaseClient.from("rental_leases").select("id,unit_id,start_date,monthly_rent_cents,status"),
      ]);
      const error = unitsResult.error || tenantsResult.error || leasesResult.error;
      if (error) throw error;
      return NextResponse.json({ success: true, data: previewRentecOperationalMigration({
        rentecProperties: rentec.properties, rentecTenants: rentec.tenants, rentecLeases: rentec.leases,
        forgeUnits: unitsResult.data || [], forgeTenants: tenantsResult.data || [], forgeLeases: leasesResult.data || [],
      }) });
    }
    if (body?.operation === "manifest-preview") {
      const [rentec, unitsResult, tenantsResult, leasesResult] = await Promise.all([
        client.operationalEvidence(),
        authenticated.supabaseClient.from("rental_units").select("id,property_id,label,status"),
        authenticated.supabaseClient.from("rental_tenants").select("id,email,status"),
        authenticated.supabaseClient.from("rental_leases").select("id,unit_id,start_date,monthly_rent_cents,status"),
      ]);
      const error = unitsResult.error || tenantsResult.error || leasesResult.error;
      if (error) throw error;
      return NextResponse.json({ success: true, data: buildRentecImportManifest({
        rentecProperties: rentec.properties, rentecTenants: rentec.tenants, rentecLeases: rentec.leases,
        forgeUnits: unitsResult.data || [], forgeTenants: tenantsResult.data || [], forgeLeases: leasesResult.data || [],
      }) });
    }
    if (body?.operation === "reconcile-legacy") {
      if (!validFingerprints(body.fingerprints)) return NextResponse.json({ error: "Valid private Rentec reconciliation fingerprints are required." }, { status: 400 });
      const legacyEvents = await loadLegacyRentecEvents(authenticated.supabaseClient, authenticated.user.id);
      return NextResponse.json({ success: true, data: previewRentecLegacyReconciliation({ apiRecords: body.fingerprints, legacyEvents }) });
    }
    return NextResponse.json({ error: "A supported Rentec preview operation is required." }, { status: 400 });
  } catch (error) {
    console.error("Rentec API preview error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview Rentec data." }, { status: 500 });
  }
}
