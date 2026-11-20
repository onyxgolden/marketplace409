import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The hook is mocked so the with-data render (cards + table) can be
// asserted without a network fetch. The factory reads a hoisted mutable
// cell, so each test picks its own hook state; the default is the
// loading state the pre-fetch tests rely on.
const mockHookState = vi.hoisted(() => ({
  current: { data: null, error: null, isLoading: true, isRefreshing: false, refresh: () => {} },
}));
vi.mock("@/hooks/useStaleWhileRevalidate", () => ({
  useStaleWhileRevalidate: () => mockHookState.current,
}));

import ProjectsScreen from "./ProjectsScreen";
import { PROJECT_TEMPLATES } from "./schedulingBoardState";

const LOADING_STATE = { data: null, error: null, isLoading: true, isRefreshing: false, refresh: () => {} };

const FIXTURE_PROJECTS = [
  {
    id: "p-long-name",
    // Long name + September dates: the longest month name exercises the
    // card's full-date rendering (Slice 3 acceptance: dates with long
    // localized month strings must read in full, never clipped).
    name: "FCCU Turnaround — Fall 2026 Shutdown and Revamp",
    startDate: "2026-09-30",
    endDate: "2026-12-31",
    createdAt: "2026-08-01T12:00:00Z",
    updatedAt: "2026-11-10T14:00:00Z",
    isPublic: true,
    isOwner: false,
  },
  {
    id: "p-owner",
    name: "Crude Unit Revamp",
    startDate: "2026-11-02",
    endDate: "2026-11-20",
    createdAt: "2026-09-15T12:00:00Z",
    updatedAt: "2026-11-12T08:00:00Z",
    isPublic: false,
    isOwner: true,
  },
];

function withProjects() {
  mockHookState.current = { data: FIXTURE_PROJECTS, error: null, isLoading: false, isRefreshing: false, refresh: () => {} };
}

describe("ProjectsScreen", () => {
  beforeEach(() => {
    mockHookState.current = LOADING_STATE;
  });

  it("renders the header and a New Project button", () => {
    const markup = renderToStaticMarkup(<ProjectsScreen />);
    expect(markup).toContain("data-scheduling-projects");
    expect(markup).toContain("Projects");
    expect(markup).toContain("+ New Project");
  });

  it("renders a template dropdown offering every template, defaulting to the first one", () => {
    const markup = renderToStaticMarkup(<ProjectsScreen />);
    for (const template of PROJECT_TEMPLATES) expect(markup).toContain(template.name);
    expect(markup).toMatch(new RegExp(`<option[^>]*value="${PROJECT_TEMPLATES[0].id}"[^>]*selected`));
  });

  it("does not render the table or empty-state before the client has fetched the project list", () => {
    // renderToStaticMarkup never runs the mount effect that fetches /api/forge/scheduling --
    // this just documents that the initial (server) render intentionally shows neither, so a
    // real page load doesn't flash an incorrect "no projects" message before hydration.
    const markup = renderToStaticMarkup(<ProjectsScreen />);
    expect(markup).not.toContain("No projects yet");
    expect(markup).not.toContain("<table");
  });

  it("renders one stacked card per project with full start/finish dates and a direct Open link", () => {
    withProjects();
    const markup = renderToStaticMarkup(<ProjectsScreen />);
    expect(markup).toContain("data-projects-cards");
    expect(markup.match(/<article[^>]*data-project-card/g)).toHaveLength(2);
    expect(markup).toContain("FCCU Turnaround — Fall 2026 Shutdown and Revamp");
    expect(markup).toContain("Crude Unit Revamp");
    // Full dates, never truncated: September is the longest month name.
    expect(markup).toContain("Sep 30, 2026");
    expect(markup).toContain("Dec 31, 2026");
    expect(markup).toContain("Nov 2, 2026");
    expect(markup).toContain("Nov 20, 2026");
    expect(markup).toContain('href="/forge/scheduling/p-long-name"');
    expect(markup).toContain('href="/forge/scheduling/p-owner"');
    expect(markup.match(/>Open</g)).toHaveLength(2);
  });

  it("shows the SHARED EXAMPLE badge on the public non-owner card and the owner-only delete only on the owner's card", () => {
    withProjects();
    const markup = renderToStaticMarkup(<ProjectsScreen />);
    expect(markup.match(/SHARED EXAMPLE/g)).toHaveLength(2); // once per card, once per table row
    expect(markup.match(/title="Delete project"/g)).toHaveLength(2); // once per card, once per table row
    expect(markup).toContain('aria-label="Delete Crude Unit Revamp"');
    expect(markup).not.toContain('aria-label="Delete FCCU Turnaround');
  });

  it("keeps the desktop table with all six columns and the same project order", () => {
    withProjects();
    const markup = renderToStaticMarkup(<ProjectsScreen />);
    const table = markup.split("<table")[1];
    expect(table).toBeTruthy();
    for (const header of ["Name", "Start Date", "Finish Date", "Created", "Last Modified", "Actions"]) {
      expect(table).toContain(header);
    }
    expect(table.indexOf("FCCU Turnaround")).toBeLessThan(table.indexOf("Crude Unit Revamp"));
    expect(table).toContain("Sep 30, 2026");
    expect(table).toContain("Dec 31, 2026");
  });

  it("puts Created / Last Modified in a details disclosure on each card", () => {
    withProjects();
    const markup = renderToStaticMarkup(<ProjectsScreen />);
    expect(markup.match(/<details/g)).toHaveLength(2);
    expect(markup).toContain("Created");
    expect(markup).toContain("Last modified");
  });
});
