import path from "node:path";
import { NextResponse } from "next/server";
import { loadProgrammerAuthorization } from "@/lib/supabase/loadProgrammerAuthorization";
import { applyProposalAction, ProposalStoreError, readProposals } from "../../../../../../../scripts/ui-improvement-manager/finding-engine/proposalStore.mjs";

// Same closed evidence-directory convention the FB-UI-1/FB-UI-2 CLIs write to when the owner runs
// them with `--output-dir`/`--evidence-dir ui-improvement-manager/evidence/latest`. Not caller-
// supplied -- this route only ever reads/writes this one fixed local path, never an arbitrary
// filesystem location a request could point it at.
const EVIDENCE_DIR = path.join(process.cwd(), "ui-improvement-manager", "evidence", "latest");

// Same two-gate boundary as every other developer-only surface in this app
// (ProgrammerAuthorizationApplication's single-owner-email check, plus an unconditional refusal on
// Vercel) -- see executeProgrammerCommand.js for the precedent this mirrors. This route can only ever
// change a `status` string in a local JSON file (proposalStore.mjs); there is no code path here to
// commit, push, open a PR, merge, deploy, migrate, or touch Production, regardless of who calls it.
async function requireLocalProgrammerAuthorization() {
  if (process.env.VERCEL === "1") {
    return NextResponse.json({ error: "The UI Improvement Manager review panel is disabled on Vercel. Run it from the authorized local FORGE workstation." }, { status: 403 });
  }
  const authorization = await loadProgrammerAuthorization();
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.message || "Programmer authorization failed." }, { status: 500 });
  }
  if (!authorization.authorized) {
    return NextResponse.json({ error: "Programmer authorization is required." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireLocalProgrammerAuthorization();
  if (denied) return denied;

  try {
    const manifest = readProposals(EVIDENCE_DIR);
    return NextResponse.json({ success: true, schemaVersion: manifest.schemaVersion, findings: manifest.findings });
  } catch (error) {
    if (error instanceof ProposalStoreError && error.reasonCode === "not_found") {
      return NextResponse.json({ success: true, schemaVersion: "1.0", findings: [] });
    }
    console.error("UI Improvement Manager proposals read error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read UI improvement proposals." }, { status: 500 });
  }
}

export async function POST(request) {
  const denied = await requireLocalProgrammerAuthorization();
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const findingId = typeof body?.findingId === "string" ? body.findingId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!findingId || !action) {
    return NextResponse.json({ error: "findingId and action are required." }, { status: 400 });
  }

  try {
    const updated = applyProposalAction(EVIDENCE_DIR, findingId, action);
    return NextResponse.json({ success: true, finding: updated });
  } catch (error) {
    if (error instanceof ProposalStoreError) {
      return NextResponse.json({ error: error.message }, { status: error.reasonCode === "not_found" ? 404 : 400 });
    }
    console.error("UI Improvement Manager proposal action error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update this proposal." }, { status: 500 });
  }
}
