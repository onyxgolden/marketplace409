import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getInsurancePartnerStatus } from "@/application/rental/insurancePartnerProducts";

// R24 — insurance partner products: DESIGN ONLY, HARD GATE.
// GET /api/rental/insurance/partner-status always reports "not connected".
// No partner is signed up for, contacted, or paid. Read-only members may read
// (it is a read of the gate state, not a write).
export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    return NextResponse.json({ status: getInsurancePartnerStatus() });
  } catch (error) {
    console.error("Insurance partner status error", error);
    return NextResponse.json({ error: "Unable to load the partner status." }, { status: 500 });
  }
}
