import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";

// Read-only, and never calls Rentec — this only reads FORGE's own already-imported linkage data,
// so the Rentec Payment Import picker can list an owner's Rentec-linked properties by a
// recognizable label instead of requiring the landlord to type Rentec's internal numeric property
// id. A unit not linked to Rentec (no source_system='rentec'/source_record_id) is never returned —
// the picker can only ever offer a property this owner has actually imported from Rentec.
export async function GET() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const ownerId = authenticated.user.id;
    const { data, error } = await authenticated.supabaseClient
      .from("rental_units")
      .select("id, label, property_id")
      .eq("owner_id", ownerId)
      .eq("source_system", "rentec")
      .not("source_record_id", "is", null)
      .order("label", { ascending: true });
    if (error) throw error;

    const rows = data || [];
    const labelCounts = new Map();
    for (const row of rows) labelCounts.set(row.label, (labelCounts.get(row.label) || 0) + 1);

    const properties = rows.map((row) => ({
      id: row.id,
      // Only disambiguated with the FORGE property grouping when two linked units would otherwise
      // share the exact same label — keeps the common case (one entry per label) clean.
      label: labelCounts.get(row.label) > 1 && row.property_id ? `${row.label} (${row.property_id})` : row.label,
    }));

    return NextResponse.json({ success: true, properties });
  } catch (error) {
    console.error("Rentec linked properties list error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load linked properties." }, { status: 500 });
  }
}
