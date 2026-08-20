import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { resolveSmartMoveDestination } from "@/lib/rental/screeningProviderConfig";

// Provider-neutral by design: the destination is chosen server-side from an allowlisted set of
// known provider keys, never from a URL supplied by the caller. Adding a future provider means
// adding a case here, not trusting a browser-supplied redirect target.
const SUPPORTED_PROVIDERS = Object.freeze({
  smartmove: () => resolveSmartMoveDestination(),
});

export async function GET(request) {
  const authenticated = await createAuthenticatedForgeApplication();
  if (authenticated.response) return authenticated.response;

  const provider = new URL(request.url).searchParams.get("provider");
  const resolve = SUPPORTED_PROVIDERS[provider];
  if (!resolve) return NextResponse.json({ error: "Unsupported or missing screening provider." }, { status: 400 });

  const destination = resolve();
  return NextResponse.redirect(destination.url, 302);
}
