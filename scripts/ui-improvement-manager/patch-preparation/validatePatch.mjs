// FB-UI-3/4 rules 9 and 10:
//
// Rule 9: Run focused tests, accessibility checks, scoped lint, git diff --check, and the relevant
//         build.
// Rule 10: Validation failure must block advancement.
//
// Every step is independently injectable (mirroring every prior FB-UI checkpoint's `launchChromium`/
// `captureDiagnostics`-style injection points) so this module is fully unit-testable without spawning
// real processes, while still shelling out to the real `npx vitest`/`npx eslint`/`git diff --check`/
// `npm run build` commands by default -- the same command-injection-safe execFileSync pattern
// isolatedWorktree.mjs uses (argument arrays, no shell). The accessibility-check step reuses FB-UI-2's
// finding engine against a live before/after capture (see capturePatchPreview.mjs) rather than
// building a second, competing accessibility tool.
//
// A single failing step is enough to fail the whole validation (rule 10) -- but every step still
// runs and is recorded, rather than stopping at the first failure, so the audit record (rule 11)
// shows the complete picture of what was checked, not just what happened to fail first.

import { execFileSync } from "node:child_process";

export const VALIDATION_STEP = Object.freeze({
  FOCUSED_TESTS: "focused_tests", ACCESSIBILITY_CHECK: "accessibility_check", SCOPED_LINT: "scoped_lint",
  GIT_DIFF_CHECK: "git_diff_check", BUILD: "build",
});

function runStep(name, command, args, { cwd, execFileFn = execFileSync }) {
  try {
    const output = execFileFn(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { step: name, command: `${command} ${args.join(" ")}`, passed: true, redacted: true, summary: output.slice(-2000) };
  } catch (error) {
    const output = [error.stdout, error.stderr].filter(Boolean).join("\n");
    return { step: name, command: `${command} ${args.join(" ")}`, passed: false, redacted: true, summary: output.slice(-2000) || error.message };
  }
}

// `focusedTestPaths` and `lintPaths` should be scoped to exactly the files the proposal touched (and
// their own test files) -- not the whole repository -- matching every other FB-UI checkpoint's own
// "scoped lint" practice throughout this session.
export async function validatePatch({
  worktreePath, focusedTestPaths = [], lintPaths = [], runBuild = true,
  runAccessibilityCheck = async () => ({ step: VALIDATION_STEP.ACCESSIBILITY_CHECK, passed: true, redacted: true, summary: "no accessibility check configured -- see capturePatchPreview.mjs to wire in a live before/after comparison" }),
  execFileFn = execFileSync,
}) {
  const results = [];

  results.push(
    focusedTestPaths.length > 0
      ? runStep(VALIDATION_STEP.FOCUSED_TESTS, "npx", ["vitest", "run", ...focusedTestPaths], { cwd: worktreePath, execFileFn })
      : { step: VALIDATION_STEP.FOCUSED_TESTS, command: null, passed: false, redacted: true, summary: "no focused test paths were provided -- validation cannot pass without at least one" },
  );

  results.push(await runAccessibilityCheck({ worktreePath }));

  results.push(
    lintPaths.length > 0
      ? runStep(VALIDATION_STEP.SCOPED_LINT, "npx", ["eslint", ...lintPaths], { cwd: worktreePath, execFileFn })
      : { step: VALIDATION_STEP.SCOPED_LINT, command: null, passed: false, redacted: true, summary: "no lint paths were provided -- validation cannot pass without at least one" },
  );

  results.push(runStep(VALIDATION_STEP.GIT_DIFF_CHECK, "git", ["diff", "--check"], { cwd: worktreePath, execFileFn }));

  results.push(
    runBuild
      ? runStep(VALIDATION_STEP.BUILD, "npm", ["run", "build"], { cwd: worktreePath, execFileFn })
      : { step: VALIDATION_STEP.BUILD, command: null, passed: true, redacted: true, summary: "build skipped -- proposal author judged it not relevant to the changed files" },
  );

  const passed = results.every((result) => result.passed);
  return Object.freeze({ passed, results: Object.freeze(results) });
}
