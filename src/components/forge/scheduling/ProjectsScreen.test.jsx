import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import ProjectsScreen from "./ProjectsScreen";
import { PROJECT_TEMPLATES } from "./schedulingBoardState";

describe("ProjectsScreen", () => {
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
});
