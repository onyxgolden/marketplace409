export const PROGRAMMER_COMMANDS =
  Object.freeze([
    Object.freeze({
      id: "repository-status",
      label: "Check repository",
      category: "Repository",
      risk: "read-only",
      expectedDurationSeconds: 5,
      description:
        "Shows the current branch, synchronization with origin/main, working-tree changes, and latest commits.",
      commandPreview:
        Object.freeze([
          "git status --short --branch",
          "git log -8 --oneline --decorate",
        ]),
      confirmationRequired: false,
    }),
    Object.freeze({
      id: "full-tests",
      label: "Run full test suite",
      category: "Validation",
      risk: "read-only",
      expectedDurationSeconds: 45,
      description:
        "Runs every Vitest test and reports whether the complete automated test suite passes.",
      commandPreview:
        Object.freeze([
          "NODE_ENV=test npx vitest run",
        ]),
      confirmationRequired: false,
    }),
    Object.freeze({
      id: "production-build",
      label: "Run production build",
      category: "Validation",
      risk: "local-build",
      expectedDurationSeconds: 30,
      description:
        "Compiles the complete Next.js production application and verifies TypeScript and route generation.",
      commandPreview:
        Object.freeze([
          "NODE_ENV=production npm run build",
        ]),
      confirmationRequired: false,
    }),
    Object.freeze({
      id: "generate-validation-evidence",
      label: "Create validation evidence",
      category: "Governance",
      risk: "generated-file",
      expectedDurationSeconds: 75,
      description:
        "Runs the full tests and production build, then creates a validated governance evidence artifact.",
      commandPreview:
        Object.freeze([
          "node scripts/governance/generateValidationEvidence.mjs --full --build",
        ]),
      confirmationRequired: true,
    }),
    Object.freeze({
      id: "prepare-next-session",
      label: "Prepare next AI session",
      category: "AI helpers",
      risk: "shadow-write",
      expectedDurationSeconds: 20,
      description:
        "Uses the newest eligible validation evidence, runs shadow governance synchronization, and generates the next-session bootstrap.",
      commandPreview:
        Object.freeze([
          "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
        ]),
      confirmationRequired: true,
    }),
    Object.freeze({
      id: "complete-session-closeout",
      label: "Complete session closeout",
      category: "AI helpers",
      risk: "shadow-write",
      expectedDurationSeconds: 95,
      description:
        "Runs full validation, creates evidence, synchronizes shadow governance documents, and generates a continuation bootstrap in one operation.",
      commandPreview:
        Object.freeze([
          "node scripts/governance/generateValidationEvidence.mjs --full --build",
          "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
        ]),
      confirmationRequired: true,
    }),
  ]);

const commandsById =
  new Map(
    PROGRAMMER_COMMANDS.map(
      (command) => [
        command.id,
        command,
      ],
    ),
  );

export function listProgrammerCommands() {
  return PROGRAMMER_COMMANDS;
}

export function getProgrammerCommand(
  commandId,
) {
  return commandsById.get(
    commandId,
  ) || null;
}
