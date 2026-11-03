// POST /api/brain/consolidate — run the nightly consolidation on demand.
// Scheduling wiring is activation-time work, not part of this build; the
// route itself is owner-scoped and uses the owner's effective decay window.

import { NextResponse } from "next/server";
import { requireBrainOwner } from "@/domains/brain-conversation/requireBrainOwner";
import {
  DEFAULT_ARCHIVE_WINDOW_DAYS,
  DEFAULT_INFERRED_DECAY_DAYS,
  isBrainHarnessEnabled,
} from "@/domains/brain-conversation/config";
import { runConsolidation } from "@/domains/brain-conversation/consolidation";

const DISABLED = { error: "Brain conversation harness is not activated." };

export async function POST() {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  try {
    const storedDecay = await authed.store.getPreference(authed.ownerId, "inferred_decay_days");
    const decayDays =
      Number.isInteger(storedDecay) && storedDecay >= 1 && storedDecay <= 90
        ? storedDecay
        : DEFAULT_INFERRED_DECAY_DAYS;
    const result = await runConsolidation(authed.store, authed.ownerId, {
      decayDays,
      archiveWindowDays: DEFAULT_ARCHIVE_WINDOW_DAYS,
    });
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ error: "Unable to run consolidation." }, { status: 500 });
  }
}
