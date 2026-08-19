import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  renderToStaticMarkup,
} from "react-dom/server";

vi.mock(
  "@/components/forge/workspace/ForgeWorkspaceTile",
  () => ({
    default: ({
      children,
      href,
      actionLabel,
      status,
    }) => (
      <section
        data-workspace-tile
        data-href={href}
        data-action-label={
          actionLabel
        }
        data-status={status}
      >
        {children}
      </section>
    ),
  }),
);

import {
  SchedulingWorkspaceModule,
} from "../SchedulingWorkspaceModule.jsx";

import {
  PROJECT_TEMPLATES,
} from "@/components/forge/scheduling/schedulingBoardState";

describe(
  "SchedulingWorkspaceModule",
  () => {
    it(
      "composes a launch-only Scheduling application tile, reporting the live template count",
      () => {
        const markup =
          renderToStaticMarkup(
            SchedulingWorkspaceModule
              .renderTile({}),
          );

        expect(markup).toContain(
          "data-workspace-tile",
        );

        expect(markup).toContain(
          'data-href="/forge/scheduling"',
        );

        expect(markup).toContain(
          'data-action-label="Open scheduling workspace"',
        );

        expect(markup).toContain(
          `data-status="${PROJECT_TEMPLATES.length} templates"`,
        );
      },
    );
  },
);
