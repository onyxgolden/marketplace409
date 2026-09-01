// FB-UI-3/4 rules 5 and 6, combined into one fail-closed gate every file edit must pass before it is
// ever written to an isolated worktree:
//
// Rule 5: File access is limited to the proposal's approved allowlist.
// Rule 6: Database migrations, API authorization, RLS, payments, accounting calculations, secrets,
//         and Production configuration are always outside this authority.
//
// Rule 6 reuses scripts/repair-controller/protectedOperationClassifier.mjs's classifyProtectedPath
// unchanged -- the exact same deny-leaning, case/traversal-hardened classifier AR-1 already has
// tested, including the financial_logic/contractual_workflow rules fixed alongside this checkpoint
// (see that file's own changelog note). Rule 6 is checked even for a path that IS on the proposal's
// own allowlist -- an approved allowlist can never override a permanently protected domain; the
// owner cannot approve their way past rule 6 by simply listing a protected path in allowedPaths.

import { classifyProtectedPath } from "../../repair-controller/protectedOperationClassifier.mjs";

export class FileOutOfScopeError extends Error {
  constructor(filePath, reasonCode) {
    super(`File "${filePath}" is outside this proposal's approved scope: ${reasonCode}`);
    this.name = "FileOutOfScopeError";
    this.filePath = filePath;
    this.reasonCode = reasonCode;
  }
}

function pathMatchesAny(filePath, patterns) {
  return patterns.some((pattern) => filePath === pattern || filePath.startsWith(`${pattern.replace(/\/$/, "")}/`));
}

// Pure classification, no throw -- returns a full decision object so a caller (preparePatch.mjs) can
// log every reason rather than only the first one encountered. assertFileInScope below is the
// fail-closed entry point most callers actually want.
export function classifyFileScope(proposal, filePath) {
  const protectedResult = classifyProtectedPath(filePath);
  if (protectedResult.protected) {
    return Object.freeze({ filePath, allowed: false, reasonCode: "protected_domain", protectedReasons: protectedResult.reasons });
  }
  if (pathMatchesAny(filePath, proposal.forbiddenPaths)) {
    return Object.freeze({ filePath, allowed: false, reasonCode: "explicitly_forbidden_by_proposal", protectedReasons: [] });
  }
  if (!pathMatchesAny(filePath, proposal.allowedPaths)) {
    return Object.freeze({ filePath, allowed: false, reasonCode: "not_on_approved_allowlist", protectedReasons: [] });
  }
  return Object.freeze({ filePath, allowed: true, reasonCode: "within_approved_scope", protectedReasons: [] });
}

export function assertFileInScope(proposal, filePath) {
  const result = classifyFileScope(proposal, filePath);
  if (!result.allowed) throw new FileOutOfScopeError(filePath, result.reasonCode);
  return result;
}
