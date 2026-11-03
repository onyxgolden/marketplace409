// GET/PATCH /api/brain/preferences — owner preferences (Q1 icon position,
// Q3 decay window). GET returns stored values merged over defaults, so the
// panel always has a position even before the owner ever drags the icon.

import { NextResponse } from "next/server";
import { requireBrainOwner } from "@/domains/brain-conversation/requireBrainOwner";
import { isBrainHarnessEnabled } from "@/domains/brain-conversation/config";
import {
  PREFERENCE_DEFAULTS,
  validatePreference,
} from "@/domains/brain-conversation/preferences";

const DISABLED = { error: "Brain conversation harness is not activated." };

export async function GET() {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  try {
    const preferences = { ...PREFERENCE_DEFAULTS };
    for (const key of Object.keys(PREFERENCE_DEFAULTS)) {
      const stored = await authed.store.getPreference(authed.ownerId, key);
      if (stored !== null && stored !== undefined) preferences[key] = stored;
    }
    return NextResponse.json({ success: true, preferences });
  } catch {
    return NextResponse.json({ error: "Unable to load your Brain preferences." }, { status: 500 });
  }
}

export async function PATCH(request) {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  let value;
  try {
    value = validatePreference(body?.key, body?.value);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  try {
    await authed.store.setPreference(authed.ownerId, body.key, value);
    return NextResponse.json({ success: true, key: body.key, value });
  } catch {
    return NextResponse.json({ error: "Unable to save your Brain preference." }, { status: 500 });
  }
}
