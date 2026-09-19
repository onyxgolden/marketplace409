import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { DEBT_PAYOFF_SUGGESTIONS_PREFERENCE } from "@/domains/ledger/brain/debtPayoff.js";

// Owner toggle for the proactive debt-payoff suggestions (digest + inbox
// "top move"). Same persistence mechanism as debt_terms: an owner-scoped row
// in brain_preferences, RLS-enforced, fully reversible. Absence of a row
// means the default: ON.
export async function PUT(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body?.suggestionsEnabled !== "boolean") {
    return NextResponse.json({ error: "suggestionsEnabled must be a boolean." }, { status: 400 });
  }

  try {
    const { error } = await authenticated.supabaseClient.from("brain_preferences").upsert(
      {
        owner_id: authenticated.effectiveOwnerId,
        preference_key: DEBT_PAYOFF_SUGGESTIONS_PREFERENCE,
        enabled: body.suggestionsEnabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,preference_key" },
    );
    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          { error: "Preference storage is not available yet (migration pending)." },
          { status: 503 },
        );
      }
      throw error;
    }
    return NextResponse.json({
      success: true,
      data: { suggestionsEnabled: body.suggestionsEnabled },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not save the preference." },
      { status: 500 },
    );
  }
}
