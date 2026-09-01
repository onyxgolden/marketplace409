// Local-filesystem-only proposal store. FB-UI-2 has no Supabase-persisted findings table -- adding
// one would need a migration, and a migration is a permanently protected operation this checkpoint
// was not asked to add (see the FB-UI-2 report's deferred-scope section). Findings and their
// owner-set status live in a single JSON file the finding engine writes and the review UI's API route
// reads/updates directly off disk -- which also means this whole review surface only works when
// running locally (the API route gates on the same `process.env.VERCEL === "1"` refusal
// executeProgrammerCommand.js already uses), never on a deployed Preview or Production.
//
// Every action here only ever changes a `status` string on a local file. Nothing in this module can
// commit, push, open a PR, merge, deploy, migrate, or touch Production -- there is no code path to any
// of those here at all, which is what makes "Approve preview" safe to expose as a button: it changes a
// label, not a permission.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { validateFindingsManifest, PROPOSAL_STATUS } from "./findingContracts.mjs";

export class ProposalStoreError extends Error {
  constructor(reasonCode, detail) {
    super(detail);
    this.name = "ProposalStoreError";
    this.reasonCode = reasonCode;
  }
}

// The four review actions this checkpoint's UI exposes. "review" maps to the REVIEWED status (an
// acknowledgement, not a decision); the other three are terminal decisions. "new" is deliberately not
// a valid target here -- only the finding engine itself can (re-)create a finding in the "new" state.
const ACTION_TO_STATUS = Object.freeze({
  review: PROPOSAL_STATUS.REVIEWED, reject: PROPOSAL_STATUS.REJECTED,
  request_revision: PROPOSAL_STATUS.REVISION_REQUESTED, approve_preview: PROPOSAL_STATUS.PREVIEW_APPROVED,
});
export const PROPOSAL_ACTIONS = Object.freeze(Object.keys(ACTION_TO_STATUS));

function manifestPath(evidenceDir) {
  return `${evidenceDir}/findings-manifest.json`;
}

export function readProposals(evidenceDir) {
  const filePath = manifestPath(evidenceDir);
  if (!existsSync(filePath)) throw new ProposalStoreError("not_found", `No findings manifest at "${filePath}" -- run the finding-engine CLI first.`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    throw new ProposalStoreError("malformed", `Findings manifest is not valid JSON: ${cause.message}`);
  }
  return validateFindingsManifest(parsed);
}

// Applies one action to one finding by id and persists the result. Fails closed on an unknown action
// or an unknown findingId rather than silently no-op-ing -- a caller (the API route) must see an error
// if the update it asked for didn't actually happen.
export function applyProposalAction(evidenceDir, findingId, action) {
  if (!ACTION_TO_STATUS[action]) throw new ProposalStoreError("unknown_action", `Unknown review action "${action}" -- must be one of ${PROPOSAL_ACTIONS.join(", ")}`);
  const manifest = readProposals(evidenceDir);
  const index = manifest.findings.findIndex((finding) => finding.findingId === findingId);
  if (index === -1) throw new ProposalStoreError("not_found", `No finding with id "${findingId}" in the current manifest.`);

  const updatedFindings = manifest.findings.map((finding, i) => (i === index ? { ...finding, status: ACTION_TO_STATUS[action] } : finding));
  const updatedManifest = validateFindingsManifest({ schemaVersion: manifest.schemaVersion, findings: updatedFindings });
  writeFileSync(manifestPath(evidenceDir), JSON.stringify(updatedManifest, null, 2));
  return updatedManifest.findings.find((finding) => finding.findingId === findingId);
}
