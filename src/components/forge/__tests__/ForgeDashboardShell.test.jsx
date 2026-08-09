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
  "@/components/forge/ForgeSidebar",
  () => ({
    default: function MockSidebar() {
      return (
        <aside data-forge-sidebar>
          Sidebar
        </aside>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeTopBar",
  () => ({
    default: function MockTopBar() {
      return (
        <header data-forge-top-bar>
          Top bar
        </header>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/workspace/ForgeWorkspaceDesktop",
  () => ({
    default: function MockWorkspace() {
      return (
        <section data-workspace-desktop>
          Workspace
        </section>
      );
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeExecutiveHero",
  () => ({
    default: function MockHero() {
      return <section>Hero</section>;
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeKpiCards",
  () => ({
    default: function MockKpis() {
      return <section>KPIs</section>;
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeExecutiveBriefing",
  () => ({
    default: function MockBriefing() {
      return <section>Briefing</section>;
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeAuditPanel",
  () => ({
    default: function MockAudit() {
      return <section>Audit</section>;
    },
  }),
);

vi.mock(
  "@/components/forge/ForgeNetWorthPanel",
  () => ({
    default: function MockNetWorth() {
      return <section>Net worth</section>;
    },
  }),
);

import ForgeDashboardShell from "../ForgeDashboardShell.jsx";

describe(
  "ForgeDashboardShell",
  () => {
    it(
      "gives the workspace the full screen without duplicate navigation",
      () => {
        const markup =
          renderToStaticMarkup(
            <ForgeDashboardShell
              view="dashboard"
            />,
          );

        expect(markup).toContain(
          "data-workspace-desktop",
        );

        expect(markup).toContain(
          "max-w-[1800px]",
        );

        expect(markup).not.toContain(
          "data-forge-sidebar",
        );

        expect(markup).not.toContain(
          "data-forge-top-bar",
        );
      },
    );

    it(
      "preserves legacy focused views until they are migrated",
      () => {
        const markup =
          renderToStaticMarkup(
            <ForgeDashboardShell
              view="audit"
            />,
          );

        expect(markup).toContain(
          "data-forge-sidebar",
        );

        expect(markup).toContain(
          "data-forge-top-bar",
        );

        expect(markup).toContain(
          "Audit",
        );

        expect(markup).not.toContain(
          "data-workspace-desktop",
        );
      },
    );
  },
);
