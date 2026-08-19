import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WbsPage from "./WbsPage";

describe("WbsPage", () => {
  it("renders the nav tabs with WBS active, and an empty state before anything loads", () => {
    const markup = renderToStaticMarkup(<WbsPage projectId="p1" />);
    expect(markup).toContain("data-scheduling-wbs");
    expect(markup).toContain("data-scheduling-wbs-nav");
    expect(markup).toContain("Gantt Chart");
    expect(markup).toContain("WBS");
    expect(markup).toContain("Activities");
    expect(markup).toContain("No WBS elements yet");
    expect(markup).toContain("+ Add WBS element");
  });

  it("does not render the load-error screen or read-only badge before the API load effect has run", () => {
    // renderToStaticMarkup never runs effects, so isOwner/loadError sit at their initial
    // defaults (true / null) here, same convention as SchedulingBoard's own pre-fetch render.
    const markup = renderToStaticMarkup(<WbsPage projectId="p1" />);
    expect(markup).not.toContain("data-scheduling-load-error");
    expect(markup).not.toContain("data-scheduling-readonly-badge");
  });
});
