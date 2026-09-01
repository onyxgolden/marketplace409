// FB-UI-3/4 top-level patch-preparation orchestrator. Wires together every gate in this directory in
// the order the checkpoint's rules require:
//
//   1. evaluatePatchPreparationAuthority (rules 1-3: canonical owner, digest bound, scope-invalidated)
//   2. createIsolatedWorktree (rule 4: fresh branch/worktree only, dirty-worktree protection)
//   3. assertFileInScope per edit (rules 5-6: allowlist only, permanently protected domains excluded --
//      checked again here even though proposalContracts.mjs already required every fileEdits path to
//      be within allowedPaths at proposal-creation time, because rule 6's protected-domain check is
//      independent of the proposal's own allowlist and must never be skippable by an approved scope)
//   4. write each edit's content into the worktree
//   5. capture the diff (rule 7: never commits, never pushes -- there is no git-add/commit/push call
//      anywhere in this module)
//
// Every step's outcome is recorded into the returned result so auditRecord.mjs has everything rule 11
// requires without needing to re-derive it.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { evaluatePatchPreparationAuthority, AUTHORITY_DECISION } from "./evaluatePatchPreparationAuthority.mjs";
import { createIsolatedWorktree, captureWorktreeDiff, removeIsolatedWorktree } from "./isolatedWorktree.mjs";
import { assertFileInScope } from "./fileScopeGuard.mjs";
import { hashContent } from "../../engineering-brain/hashContent.mjs";

export class PatchPreparationAuthorityDeniedError extends Error {
  constructor(reasonCodes) {
    super(`Patch preparation authority denied: ${reasonCodes.join(", ")}`);
    this.name = "PatchPreparationAuthorityDeniedError";
    this.reasonCodes = reasonCodes;
  }
}

function readBeforeContent(worktreePath, relativePath) {
  const absolute = path.join(worktreePath, relativePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null; // null: a genuinely new file
}

// `keepWorktree` defaults to false: the worktree is removed after the diff is captured, since the
// diff text + file hashes recorded in the result (and, via auditRecord.mjs, the audit record) are the
// durable evidence -- not a growing pile of on-disk worktrees. Pass true to inspect the worktree
// directly (e.g. for the synthetic end-to-end demonstration).
export async function preparePatch({
  proposal, approval, callerEmail, repoRoot, baseSha, now = new Date().toISOString(),
  worktreeRoot, keepWorktree = false, execFileFn, canonicalOwnerEmail, delegatedApproverEmails,
}) {
  const authority = evaluatePatchPreparationAuthority({
    proposal, approval, callerEmail, now, canonicalOwnerEmail, delegatedApproverEmails,
  });
  if (authority.decision !== AUTHORITY_DECISION.APPROVE) {
    throw new PatchPreparationAuthorityDeniedError(authority.reasonCodes);
  }

  const worktree = createIsolatedWorktree({ repoRoot, baseSha, proposalId: proposal.proposalId, worktreeRoot, execFileFn });

  const commands = [
    { command: `git worktree add -b ${worktree.branchName} ${worktree.worktreePath} ${baseSha}`, exitCode: 0, redacted: true },
  ];

  try {
    const fileResults = proposal.fileEdits.map((edit) => {
      // Scope re-checked here, independently of proposalContracts.mjs's own creation-time check --
      // see module header for why this must never be skippable.
      assertFileInScope(proposal, edit.path);
      const absolutePath = path.join(worktree.worktreePath, edit.path);
      const beforeContent = readBeforeContent(worktree.worktreePath, edit.path);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, edit.content, "utf8");
      return {
        path: edit.path,
        beforeHash: beforeContent === null ? null : `sha256:${hashContent(beforeContent)}`,
        afterHash: `sha256:${hashContent(edit.content)}`,
        isNewFile: beforeContent === null,
      };
    });

    const diffText = captureWorktreeDiff({ worktreePath: worktree.worktreePath, execFileFn });
    commands.push({ command: "git diff --no-color", exitCode: 0, redacted: true });

    const result = Object.freeze({
      proposalId: proposal.proposalId, worktreePath: worktree.worktreePath, branchName: worktree.branchName,
      baseSha, files: Object.freeze(fileResults), diffText, diffHash: `sha256:${hashContent(diffText)}`,
      commands: Object.freeze(commands), preparedAt: now,
    });

    if (!keepWorktree) removeIsolatedWorktree({ repoRoot, worktreePath: worktree.worktreePath, execFileFn });
    return result;
  } catch (error) {
    // Fail closed by cleaning up regardless of where preparation failed -- an isolated worktree is
    // never left behind in a half-edited state for a later run to collide with or accidentally reuse.
    removeIsolatedWorktree({ repoRoot, worktreePath: worktree.worktreePath, execFileFn, force: true });
    throw error;
  }
}
