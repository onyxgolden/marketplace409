export const PROGRAMMER_COMMANDS =
  Object.freeze([
    Object.freeze({
      id: "repository-status",
      label: "Check repository",
      category: "Repository",
      risk: "read-only",
      description:
        "Shows the current branch, synchronization with origin/main, working-tree changes, and latest commits.",
      confirmationRequired: false,
    }),
    Object.freeze({
      id: "full-tests",
      label: "Run full test suite",
      category: "Validation",
      risk: "read-only",
      description:
        "Runs every Vitest test and reports whether the complete automated test suite passes.",
      confirmationRequired: false,
    }),
    Object.freeze({
      id: "production-build",
      label: "Run production build",
      category: "Validation",
      risk: "local-build",
      description:
        "Compiles the complete Next.js production application and verifies TypeScript and route generation.",
      confirmationRequired: false,
    }),
    Object.freeze({
      id: "generate-validation-evidence",
      label: "Create validation evidence",
      category: "Governance",
      risk: "generated-file",
      description:
        "Runs the full tests and production build, then creates a validated governance evidence artifact.",
      confirmationRequired: true,
    }),
    Object.freeze({
      id: "prepare-next-session",
      label: "Prepare next AI session",
      category: "AI helpers",
      risk: "shadow-write",
      description:
        "Uses the newest eligible validation evidence, runs shadow governance synchronization, and generates the next-session bootstrap.",
      confirmationRequired: true,
    }),
    Object.freeze({
      id: "complete-session-closeout",
      label: "Complete session closeout",
      category: "AI helpers",
      risk: "shadow-write",
      description:
        "Runs full validation, creates evidence, synchronizes shadow governance documents, and generates a continuation bootstrap in one operation.",
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
