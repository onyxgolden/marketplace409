import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { requestEfileSubmission } from "@/application/rental/efilePartner1099";

// R23 — e-filing submission: HARD GATE. Per Jason's build-spend motto, e-filing
// partners charge per-filing fees, so this endpoint NEVER contacts a partner.
// It always refuses with the gate message (409) and performs no network call —
// the stub contract in efilePartner1099.js is the only implementation until
// Jason approves a partner choice and per-filing cost.

async function requireWriter(authenticated) {
  if ((await getActiveWorkspaceRole({ supabaseClient: authenticated.supabaseClient, actorUserId: authenticated.user.id })) === "read_only") {
    return NextResponse.json({ error: "Read-only members cannot submit e-filings." }, { status: 403 });
  }
  return null;
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const writerBlock = await requireWriter(authenticated);
    if (writerBlock) return writerBlock;

    const body = await request.json().catch(() => ({}));
    const result = requestEfileSubmission({ taxYear: body.taxYear ?? null });

    // 409: the action is understood but gated — not a server error, not a
    // client bug. The message tells Brandy exactly what to do instead.
    return NextResponse.json(
      { success: false, submitted: result.submitted, error: result.error },
      { status: 409 },
    );
  } catch {
    return NextResponse.json({ error: "Unable to process the e-filing request." }, { status: 500 });
  }
}
