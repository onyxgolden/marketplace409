#!/usr/bin/env node
// FB-UI-3/4 CLI entry point. Owner-invoked only, mirroring every prior FB-UI checkpoint's CLI
// pattern (a testable exported `runCli`, an `import.meta.url` auto-invocation guard). Subcommands:
//
//   create-proposal --evidence-dir <dir> --proposal <path-to-proposal-draft.json>
//   request-review  --evidence-dir <dir> --proposal-id <id>
//   approve         --evidence-dir <dir> --proposal-id <id> --approver <email>
//   reject          --evidence-dir <dir> --proposal-id <id>
//   request-revision --evidence-dir <dir> --proposal-id <id>
//   prepare         --evidence-dir <dir> --proposal-id <id> --repo-root <path> --base-sha <sha> --caller <email>
//   validate        --evidence-dir <dir> --proposal-id <id> --worktree-path <path> --focused-test <path> [...] --lint-path <path> [...]
//   close           --evidence-dir <dir> --proposal-id <id>
//
// No subcommand here ever calls `git commit`, `git push`, opens a GitHub PR, merges, or deploys --
// confirmed by grep against every module this CLI imports (rule 7; see the FB-UI-3/4 checkpoint
// report for the exact grep used).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  advanceProposal, createProposal, generateAuditId, grantPreviewApproval, readLatestApproval,
  readProposal, recordPatchPrepared, recordValidationResult,
} from "./proposalWorkflowStore.mjs";
import { PROPOSAL_STATE } from "./proposalContracts.mjs";
import { preparePatch } from "./preparePatch.mjs";
import { validatePatch } from "./validatePatch.mjs";
import { buildAuditRecord, validateAuditRecord } from "./auditRecord.mjs";

export class PatchPreparationCliError extends Error {
  constructor(message) {
    super(message);
    this.name = "PatchPreparationCliError";
  }
}

function parseArgs(argv) {
  const [subcommand, ...rest] = argv;
  const args = { subcommand, focusedTestPaths: [], lintPaths: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === "--evidence-dir") args.evidenceDir = rest[++i];
    else if (flag === "--proposal") args.proposalPath = rest[++i];
    else if (flag === "--proposal-id") args.proposalId = rest[++i];
    else if (flag === "--approver") args.approver = rest[++i];
    else if (flag === "--repo-root") args.repoRoot = rest[++i];
    else if (flag === "--base-sha") args.baseSha = rest[++i];
    else if (flag === "--caller") args.caller = rest[++i];
    else if (flag === "--worktree-path") args.worktreePath = rest[++i];
    else if (flag === "--focused-test") args.focusedTestPaths.push(rest[++i]);
    else if (flag === "--lint-path") args.lintPaths.push(rest[++i]);
  }
  return args;
}

function auditPath(evidenceDir, proposalId) {
  return path.join(evidenceDir, "audit-records", `${proposalId}.json`);
}

export async function runCli(argv) {
  const args = parseArgs(argv);
  if (!args.evidenceDir) throw new PatchPreparationCliError("Usage: runPatchPreparationCli.mjs <subcommand> --evidence-dir <dir> ...");
  mkdirSync(args.evidenceDir, { recursive: true });

  switch (args.subcommand) {
    case "create-proposal": {
      if (!args.proposalPath) throw new PatchPreparationCliError("create-proposal requires --proposal <path-to-draft.json>");
      const draft = JSON.parse(readFileSync(args.proposalPath, "utf8"));
      return createProposal(args.evidenceDir, draft);
    }
    case "request-review":
      return advanceProposal(args.evidenceDir, args.proposalId, PROPOSAL_STATE.REVIEW_REQUESTED);
    case "reject":
      return advanceProposal(args.evidenceDir, args.proposalId, PROPOSAL_STATE.REJECTED);
    case "request-revision":
      return advanceProposal(args.evidenceDir, args.proposalId, PROPOSAL_STATE.REVISION_REQUESTED);
    case "close":
      return advanceProposal(args.evidenceDir, args.proposalId, PROPOSAL_STATE.CLOSED);
    case "approve": {
      if (!args.approver) throw new PatchPreparationCliError("approve requires --approver <email>");
      return grantPreviewApproval(args.evidenceDir, args.proposalId, { approverId: args.approver });
    }
    case "prepare": {
      if (!args.repoRoot || !args.baseSha || !args.caller) throw new PatchPreparationCliError("prepare requires --repo-root, --base-sha, and --caller");
      const proposal = readProposal(args.evidenceDir, args.proposalId);
      const approval = readLatestApproval(args.evidenceDir, args.proposalId);
      const patchResult = await preparePatch({ proposal, approval, callerEmail: args.caller, repoRoot: args.repoRoot, baseSha: args.baseSha, keepWorktree: true });
      recordPatchPrepared(args.evidenceDir, args.proposalId);
      writeFileSync(path.join(args.evidenceDir, `patch-result-${args.proposalId}.json`), JSON.stringify(patchResult, null, 2));
      return patchResult;
    }
    case "validate": {
      if (!args.worktreePath) throw new PatchPreparationCliError("validate requires --worktree-path (from a prior `prepare` run)");
      const validationResult = await validatePatch({ worktreePath: args.worktreePath, focusedTestPaths: args.focusedTestPaths, lintPaths: args.lintPaths });
      recordValidationResult(args.evidenceDir, args.proposalId, validationResult);

      const proposal = readProposal(args.evidenceDir, args.proposalId);
      const approval = readLatestApproval(args.evidenceDir, args.proposalId);
      const patchResultPath = path.join(args.evidenceDir, `patch-result-${args.proposalId}.json`);
      if (existsSync(patchResultPath)) {
        const patchResult = JSON.parse(readFileSync(patchResultPath, "utf8"));
        const record = buildAuditRecord({
          auditId: generateAuditId(), proposal, approval, actingUserId: approval.approverId, patchResult, validationResult,
        });
        mkdirSync(path.dirname(auditPath(args.evidenceDir, args.proposalId)), { recursive: true });
        writeFileSync(auditPath(args.evidenceDir, args.proposalId), JSON.stringify(validateAuditRecord(record), null, 2));
      }
      return validationResult;
    }
    default:
      throw new PatchPreparationCliError(`Unknown subcommand "${args.subcommand}". See this file's header for the supported list.`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(`${error.name}: ${error.message}`);
      process.exitCode = 1;
    });
}
