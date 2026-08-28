export const PROGRAMMER_COMMANDS =
  Object.freeze([
    Object.freeze({
      id: "repository-status",
      label: "Check repository",
      category: "Repository",
      risk: "read-only",
      expectedDurationSeconds: 5,
      description:
        "Looks at the project and reports back what's going on: any unsaved work in progress, whether it matches the shared online copy, and the most recent saved changes. This only looks -- it doesn't change anything.",
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
        "Runs thousands of small automated checks that each confirm one piece of the app still behaves correctly, and tells you if anything broke. This only checks -- it doesn't change anything.",
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
        "Builds the app exactly the way it would be built for the live website, as a practice run to catch errors before real users ever see them. Nothing goes live -- this is just a rehearsal.",
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
        "Runs the two checks above (tests and build) and saves a timestamped, tamper-evident record proving they passed -- a paper trail you or the AI assistant can point to later as proof the work was verified, not just claimed.",
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
        "Gets everything ready for the next time you start a new conversation with your AI assistant about this project, so it can pick up exactly where things left off instead of having to re-learn the project from scratch.",
      commandPreview:
        Object.freeze([
          "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
        ]),
      confirmationRequired: true,
      requiresSessionReview: true,
    }),
    Object.freeze({
      id: "complete-session-closeout",
      label: "Complete session closeout",
      category: "AI helpers",
      risk: "shadow-write",
      expectedDurationSeconds: 95,
      description:
        "Wraps up a work session in one step: runs the checks, saves proof they passed, and prepares the notes your AI assistant will read next time -- everything the commands above do, combined.",
      commandPreview:
        Object.freeze([
          "node scripts/governance/generateValidationEvidence.mjs --focused scripts/governance/__tests__/collectSessionEvidence.test.mjs --full --build",
          "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
        ]),
      confirmationRequired: true,
      requiresSessionReview: true,
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
