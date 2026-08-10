import {
  renderToStaticMarkup,
} from "react-dom/server";

import {
  describe,
  expect,
  it,
} from "vitest";

import ProgrammerDashboard, {
  buildReadableProgrammerResultText,
  calculateProgrammerCommandProgress,
} from "./ProgrammerDashboard";

const commands = [
  {
    id: "repository-status",
    label: "Check repository",
    category: "Repository",
    risk: "read-only",
    expectedDurationSeconds: 5,
    description:
      "Shows repository status and synchronization information.",
    commandPreview: [
      "git status --short --branch",
      "git log -8 --oneline --decorate",
    ],
    confirmationRequired: false,
  },
  {
    id: "complete-session-closeout",
    label: "Complete session closeout",
    category: "AI helpers",
    risk: "shadow-write",
    expectedDurationSeconds: 95,
    description:
      "Runs validation and generates the next-session bootstrap.",
    commandPreview: [
      "node scripts/governance/generateValidationEvidence.mjs --full --build",
      "node scripts/orchestration/runEngineeringConversationSession.mjs <newest-validation-evidence.json>",
    ],
    confirmationRequired: true,
  },
];

describe("ProgrammerDashboard", () => {
  it("renders compact approved actions with descriptions", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain("FORGE Programmer Dashboard");
    expect(markup).toContain("Check repository");
    expect(markup).toContain("Shows repository status");
    expect(markup).toContain("Command preview");
    expect(markup).toContain("git status --short --branch");
    expect(markup).toContain("Complete session closeout");
    expect(markup).toContain("Confirmation required");
  });

  it("identifies the authorized programmer and local restriction", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain(
      "Authorized as jasonmorgan99@gmail.com",
    );
    expect(markup).toContain("disabled on Vercel");
  });

  it("calculates capped estimated command progress", () => {
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
  });
});

describe("ProgrammerDashboard layout", () => {
  it("renders a persistent two-column layout with commands and results columns", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain("data-programmer-commands-column");
    expect(markup).toContain("data-programmer-results-panel");
  });

  it("shows guidance in the results panel before any command runs", () => {
    const markup = renderToStaticMarkup(
      <ProgrammerDashboard
        commands={commands}
        programmerEmail="jasonmorgan99@gmail.com"
      />,
    );

    expect(markup).toContain(
      "Results will appear here after you run an action.",
    );
  });
});

describe("buildReadableProgrammerResultText", () => {
  it("formats a successful execution as readable plain text", () => {
    const text = buildReadableProgrammerResultText({
      execution: {
        label: "Check repository",
        status: "passing",
        startedAt: "2026-08-10T10:00:00.000Z",
        completedAt: "2026-08-10T10:00:05.000Z",
        steps: [
          {
            status: "passing",
            command: "git status --short --branch",
            output: "## main...origin/main",
          },
        ],
      },
      error: "",
    });

    expect(text).toContain("FORGE PROGRAMMER COMMAND RESULT");
    expect(text).toContain("Action: Check repository");
    expect(text).toContain("Status: passing");
    expect(text).toContain("Step 1 · passing");
    expect(text).toContain(
      "Command: git status --short --branch",
    );
    expect(text).toContain("## main...origin/main");
  });

  it("formats a failed execution as readable plain text", () => {
    const text = buildReadableProgrammerResultText({
      execution: null,
      error: "Programmer command failed.",
    });

    expect(text).toContain("FORGE PROGRAMMER COMMAND RESULT");
    expect(text).toContain("Status: Error");
    expect(text).toContain(
      "Error: Programmer command failed.",
    );
  });

  it("contains no HTML or JSX markup in the readable text", () => {
    const text = buildReadableProgrammerResultText({
      execution: {
        label: "Check repository",
        status: "passing",
        startedAt: "2026-08-10T10:00:00.000Z",
        completedAt: "2026-08-10T10:00:05.000Z",
        steps: [
          {
            status: "passing",
            command: "git status",
            output: "clean",
          },
        ],
      },
      error: "",
    });

    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });

  it("returns an empty string when there is no execution or error", () => {
    expect(
      buildReadableProgrammerResultText({
        execution: null,
        error: "",
      }),
    ).toBe("");
  });
});
