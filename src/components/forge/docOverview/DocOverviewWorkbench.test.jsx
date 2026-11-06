// FORGE Doc-to-Overview — slice B: workbench component test.
// Renders to static markup with a draft fixture and verifies the
// draft rows, status badges, stale flag, and generation form render.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DocOverviewWorkbench from "./DocOverviewWorkbench.jsx";

const FIXTURES = [
  { id: "artifact_explainer1", type: "explainer", status: "draft", version: 1, stale: false },
  { id: "artifact_info1", type: "infographic", status: "needs_review", version: 1, stale: true },
];

describe("DocOverviewWorkbench", () => {
  it("renders draft rows with status and stale flag", () => {
    const html = renderToStaticMarkup(<DocOverviewWorkbench initialArtifacts={FIXTURES} />);
    expect(html).toContain("Generate drafts");
    expect(html).toContain("explainer");
    expect(html).toContain("infographic");
    expect(html).toContain("needs review");
    expect(html).toContain("STALE");
    expect(html).toContain("Source-set manifest id");
  });

  it("renders the empty state when there are no drafts", () => {
    const html = renderToStaticMarkup(<DocOverviewWorkbench initialArtifacts={[]} />);
    expect(html).toContain("No drafts yet");
  });
});
