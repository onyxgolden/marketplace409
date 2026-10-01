import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { resolveTermMap, validateTermMap } from "@/domains/rental-terminology/rentalTerminology";

export const runtime = "nodejs";

// Rentec parity R25: terminology customization (Settings → Terminology).
// GET is readable by every workspace member (read-only included) — reading
// the term map is not a write; an absent row resolves to the defaults.
// POST is owner/co-owner only: manager, bookkeeper, and read_only members
// get 403 (a workspace-wide rename is a household decision, never staff's).
// The map is validated by the shared domain validator before it is stored,
// and the shell/panels always resolve through resolveTermMap so a missing
// row or a partially-stored map degrades to the baseline terms.

async function ownerOrCoOwnerOnly(authenticated) {
  return isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  });
}

export async function GET() {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { data, error } = await authenticated.supabaseClient
      .from("rental_terminology_settings")
      .select("terms, updated_at")
      .eq("owner_id", authenticated.effectiveOwnerId)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({
      success: true,
      terms: resolveTermMap(data?.terms ?? null),
      updatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    console.error("Terminology load error", error);
    return NextResponse.json({ error: "Unable to load terminology settings." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (!(await ownerOrCoOwnerOnly(authenticated))) {
    return NextResponse.json({ error: "Only the owner or co-owner can change terminology." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const validation = validateTermMap(body.terms);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  try {
    const { data, error } = await authenticated.supabaseClient
      .from("rental_terminology_settings")
      .upsert(
        {
          owner_id: authenticated.effectiveOwnerId,
          terms: validation.clean,
          updated_by: authenticated.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" },
      )
      .select("terms, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({
      success: true,
      terms: resolveTermMap(data?.terms ?? null),
      updatedAt: data?.updated_at ?? null,
    });
  } catch (error) {
    console.error("Terminology save error", error);
    return NextResponse.json({ error: "Unable to save terminology settings." }, { status: 500 });
  }
}
