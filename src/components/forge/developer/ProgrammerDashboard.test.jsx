import {
  renderToStaticMarkup,
} from "react-dom/server";

import {
  describe,
  expect,
  it,
} from "vitest";

import ProgrammerDashboard from "./ProgrammerDashboard";

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
    description:
      "Shows repository status and synchronization information.",
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
    description:
      "Runs validation and generates the next-session bootstrap.",
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
  },
);
