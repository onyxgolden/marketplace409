// GET/POST /api/brain/memories — owner memory controls (view + create).
// Disabled until activation: 503 when the harness flag is off. Signed-out
// callers get a plain-words 401. Errors never carry raw ids.

import { NextResponse } from "next/server";
import { requireBrainOwner } from "@/domains/brain-conversation/requireBrainOwner";
import { isBrainHarnessEnabled } from "@/domains/brain-conversation/config";

const DISABLED = { error: "Brain conversation harness is not activated." };

export async function GET() {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  try {
    const entries = await authed.store.listSemanticEntries(authed.ownerId);
    return NextResponse.json({ success: true, entries });
  } catch {
    return NextResponse.json({ error: "Unable to load your memories." }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isBrainHarnessEnabled()) {
    return NextResponse.json(DISABLED, { status: 503 });
  }
  const authed = await requireBrainOwner();
  if (authed.response) return authed.response;

  const body = await request.json().catch(() => ({}));
  const content = String(body?.content ?? "").trim();
  if (!content) {
    return NextResponse.json({ error: "Memory text must not be empty." }, { status: 400 });
  }
  // "verified" is earned only via consolidation, never claimed on create.
  const salience = body?.salience ?? "inferred";
  if (salience !== "owner_stated" && salience !== "inferred") {
    return NextResponse.json(
      { error: "Salience must be owner-stated or inferred; verified is earned by consolidation." },
      { status: 400 },
    );
  }

  try {
    const entry = await authed.store.createSemanticEntry(authed.ownerId, {
      content,
      factKey: body?.factKey ?? null,
      salience,
      provenanceSource: "owner note",
      provenanceAt: new Date().toISOString(),
      recordType: body?.recordType ?? null,
      recordId: body?.recordId ?? null,
    });
    return NextResponse.json({ success: true, entry }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to save your memory." }, { status: 500 });
  }
}
