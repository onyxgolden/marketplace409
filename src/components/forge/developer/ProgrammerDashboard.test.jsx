import {
  renderToStaticMarkup,
} from "react-dom/server";

import {
  describe,
  expect,
  it,
} from "vitest";

import ProgrammerDashboard, {
  calculateProgrammerCommandProgress,
} from "./ProgrammerDashboard";

const commands = [
  {
    id:
      "repository-status",
    label:
      "Check repository",
    category:
      "Repository",
    risk:
      "read-only",
    expectedDurationSeconds:
      5,
    description:
      "Shows repository status and synchronization information.",
    commandPreview: [
      "git status --short --branch",
      "git log -8 --oneline --decorate",
    ],
    confirmationRequired:
      false,
  },
  {
    id:
      "complete-session-closeout",
    label:
      "Complete session closeout",
    category:
      "AI helpers",
    risk:
      "shadow-write",
    expectedDurationSeconds:
      95,
    description:
      "Runs validation and generates the next-session bootstrap.",
    commandPreview: [
      "node scripts/governance/generateValidationEvidence.mjs --full --build",
      "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
    ],
    confirmationRequired:
      true,
  },
];

describe(
  "ProgrammerDashboard",
  () => {
    it(
      "renders compact approved actions with descriptions",
      () => {
        const markup =
          renderToStaticMarkup(
            <ProgrammerDashboard
              commands={
                commands
              }
              programmerEmail="jasonmorgan99@gmail.com"
            />,
          );

        expect(markup).toContain(
          "FORGE Programmer Dashboard",
        );

        expect(markup).toContain(
          "Check repository",
        );

        expect(markup).toContain(
          "Shows repository status",
        );

        expect(markup).toContain(
          "Command preview",
        );

        expect(markup).toContain(
          "git status --short --branch",
        );

        expect(markup).toContain(
          "Complete session closeout",
        );

        expect(markup).toContain(
          "Confirmation required",
        );
      },
    );

    it(
      "identifies the authorized programmer and local restriction",
      () => {
        const markup =
          renderToStaticMarkup(
            <ProgrammerDashboard
              commands={
                commands
              }
              programmerEmail="jasonmorgan99@gmail.com"
            />,
          );

        expect(markup).toContain(
          "Authorized as jasonmorgan99@gmail.com",
        );

        expect(markup).toContain(
          "disabled on Vercel",
        );
      },
    );
    it(
      "calculates capped estimated command progress",
      () => {
        expect(
          calculateProgrammerCommandProgress({
            elapsedSeconds: 15,
            expectedDurationSeconds: 30,
          }),
        ).toBe(50);

        expect(
          calculateProgrammerCommandProgress({
            elapsedSeconds: 45,
            expectedDurationSeconds: 30,
          }),
        ).toBe(90);

        expect(
          calculateProgrammerCommandProgress({
            elapsedSeconds: 5,
            expectedDurationSeconds: 0,
          }),
        ).toBe(0);
      },
    );
  },
);
