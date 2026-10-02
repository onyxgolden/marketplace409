import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import {
  getMailProviderStatus,
  sendLetterViaProvider,
} from "@/domains/rental-mailing/mailProvider";

export const runtime = "nodejs";

// Rentec parity R20 — the paid-send layer, HARD-GATED.
//
// GET  → provider status (always "not connected" in this slice).
// POST → attempt a provider send. It NEVER succeeds in this slice: the stub
//        refuses with 409 and no outbound request is ever constructed. The
//        gate lifts only when Jason approves the provider, its per-piece
//        cost, and who pays (see src/domains/rental-mailing/mailProvider.js).

async function ownerOnlyWriteBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  return NextResponse.json({ success: true, provider: getMailProviderStatus() });
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await ownerOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Only the owner or co-owner can send mailings." }, { status: 403 });
  }
  try {
    await sendLetterViaProvider();
    // Unreachable while the stub is in place — kept so the success shape is
    // defined for the day a real adapter lands behind Jason's approval.
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.code === "PROVIDER_NOT_CONNECTED") {
      return NextResponse.json(
        { error: error.message, provider: getMailProviderStatus() },
        { status: 409 },
      );
    }
    console.error("Mailing provider send error", error);
    return NextResponse.json({ error: "The provider send failed." }, { status: 500 });
  }
}
