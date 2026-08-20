import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { resolveSmartMoveDestination } from "@/lib/rental/screeningProviderConfig";

// Exposes only whether an affiliate link is active — never the destination URL itself — so the
// UI can show or hide the commission disclosure without ever handling a raw redirect target.
export async function GET() {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const destination = resolveSmartMoveDestination();
  return NextResponse.json({ smartMove: { affiliateActive: destination.affiliateActive } });
}
