import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import {
  computePropertyDepreciationReport,
} from "@/domains/rental-depreciation/depreciation";

export const runtime = "nodejs";

// Rentec parity R19: per-property depreciation schedule report — the CPA
// hand-off. GET ?propertyId=&year= computes the report server-side from the
// asset register using the pure domain engine. Readable by every workspace
// member (read-only included).
//
// BOOKS INTEGRATION DECISION (report-only): depreciation is a non-cash
// expense. This report never posts to the property ledger, never touches the
// bank register, and never moves cash. The ledger stays cash-based; hand the
// printed report to the CPA, who decides whether/where to book it.

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { searchParams } = new URL(request.url);
    const propertyId = (searchParams.get("propertyId") || "").trim();
    if (!propertyId) {
      return NextResponse.json({ error: "A propertyId is required for the depreciation schedule." }, { status: 400 });
    }
    const year = (searchParams.get("year") || "").trim();
    if (!year) {
      return NextResponse.json({ error: "A year is required for the depreciation schedule." }, { status: 400 });
    }
    const { data, error } = await authenticated.supabaseClient
      .from("rental_depreciation_assets")
      .select("id, property_id, description, category, placed_in_service, cost_basis_cents, method, useful_life_months, salvage_value_cents, notes, created_at, updated_at")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .eq("property_id", propertyId)
      .order("placed_in_service", { ascending: true });
    if (error) throw error;
    let report;
    try {
      // The report engine takes the DB-shaped (snake_case) asset rows; it
      // returns camelCase report rows.
      report = computePropertyDepreciationReport({ assets: data || [], year });
    } catch (caught) {
      return NextResponse.json({ error: caught.message || "Unable to compute the depreciation schedule." }, { status: 400 });
    }
    return NextResponse.json({ success: true, propertyId, report });
  } catch (error) {
    console.error("Depreciation schedule report error", error);
    return NextResponse.json({ error: "Unable to build the depreciation schedule." }, { status: 500 });
  }
}
