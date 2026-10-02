import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getEfilePartnerStatus } from "@/application/rental/efilePartner1099";

// R23 — e-filing partner status. Always "not connected" (design-only stub,
// HARD GATE per the spend decision). Read-only members may read — the panel
// is informational, not an action.

export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;

    return NextResponse.json({ success: true, efile: getEfilePartnerStatus() });
  } catch {
    return NextResponse.json({ error: "Unable to load e-filing status." }, { status: 500 });
  }
}
