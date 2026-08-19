import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ActivitiesPage from "./ActivitiesPage";

describe("ActivitiesPage", () => {
  it("renders the nav tabs with Activities active, and points to the WBS page before anything loads", () => {
    const markup = renderToStaticMarkup(<ActivitiesPage projectId="p1" />);
    expect(markup).toContain("data-scheduling-activities");
    expect(markup).toContain("data-scheduling-wbs-nav");
    expect(markup).toContain("Gantt Chart");
    expect(markup).toContain("WBS");
    // No WBS elements yet on a fresh board -- the add-activity form is hidden in favor of
    // pointing the user at the WBS page first, since an activity always needs one to belong to.
    expect(markup).toContain("Add one on the WBS page");
    expect(markup).not.toContain("+ Add activity");
  });

  it("does not render the load-error screen or read-only badge before the API load effect has run", () => {
    const markup = renderToStaticMarkup(<ActivitiesPage projectId="p1" />);
    expect(markup).not.toContain("data-scheduling-load-error");
    expect(markup).not.toContain("data-scheduling-readonly-badge");
  });
});
