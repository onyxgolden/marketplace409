import {
  describe,
  expect,
  it,
} from "vitest";

import {
  getProgrammerCommand,
  listProgrammerCommands,
  PROGRAMMER_COMMANDS,
} from "./ProgrammerCommandRegistry";

describe(
  "ProgrammerCommandRegistry",
  () => {
    it(
      "exposes the approved programmer commands",
      () => {
        expect(
          listProgrammerCommands(),
        ).toBe(
          PROGRAMMER_COMMANDS,
        );

        expect(
          PROGRAMMER_COMMANDS.map(
            (command) =>
              command.id,
          ),
        ).toEqual([
          "repository-status",
          "full-tests",
          "production-build",
          "generate-validation-evidence",
          "prepare-next-session",
          "complete-session-closeout",
        ]);
      },
    );

    it(
      "provides a short description and risk classification for every command",
      () => {
        for (
          const command
          of PROGRAMMER_COMMANDS
        ) {
          expect(
            command.label.length,
          ).toBeGreaterThan(0);

          expect(
            command.description.length,
          ).toBeGreaterThan(20);

          expect(
            command.risk.length,
          ).toBeGreaterThan(0);

          expect(
            command.expectedDurationSeconds,
          ).toBeGreaterThan(0);

          expect(
            command.commandPreview.length,
          ).toBeGreaterThan(0);

          expect(
            Object.isFrozen(
              command.commandPreview,
            ),
          ).toBe(true);
        }
      },
    );

    it(
      "resolves only allowlisted command identifiers",
      () => {
        expect(
          getProgrammerCommand(
            "full-tests",
          ),
        ).toMatchObject({
          label:
            "Run full test suite",
        });

        expect(
          getProgrammerCommand(
            "rm-everything",
          ),
        ).toBeNull();
      },
    );

    it(
      "requires an owner-reviewed session-closeout form for commands that write shadow governance documents",
      () => {
        expect(
          getProgrammerCommand(
            "prepare-next-session",
          ).requiresSessionReview,
        ).toBe(true);

        expect(
          getProgrammerCommand(
            "complete-session-closeout",
          ).requiresSessionReview,
        ).toBe(true);

        expect(
          getProgrammerCommand(
            "repository-status",
          ).requiresSessionReview,
        ).toBeUndefined();
      },
    );

    it(
      "keeps the command catalog immutable",
      () => {
        expect(
          Object.isFrozen(
            PROGRAMMER_COMMANDS,
          ),
        ).toBe(true);

        for (
          const command
          of PROGRAMMER_COMMANDS
        ) {
          expect(
            Object.isFrozen(
              command,
            ),
          ).toBe(true);
        }
      },
    );
  },
);
