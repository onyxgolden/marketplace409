// FORGE Doc-to-Overview — slice B: workbench component test.
// Renders to static markup with a draft fixture and verifies the
// draft rows, status badges, stale flag, and generation form render.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DocOverviewWorkbench from "./DocOverviewWorkbench.jsx";

const FIXTURES = [
  { id: "artifact_explainer1", type: "explainer", status: "draft", version: 1, stale: false },
  { id: "artifact_info1", type: "infographic", status: "needs_review", version: 1, stale: true },
  { id: "artifact_audio1", type: "audio", status: "draft", version: 1, stale: false },
];

function audioPreview(scriptStatus, audio) {
  return {
    artifact: {
      id: "artifact_audio1",
      type: "audio",
      status: "draft",
      version: 1,
      stale: false,
      content: {
        kind: "audio",
        title: "Energy in living cells",
        segments: [],
        references: [],
        scriptStatus,
        audio: audio ?? null,
        tts: { available: false, engine: null, checked: [] },
      },
    },
    stale: false,
    html: "<p>audio preview</p>",
  };
}

describe("DocOverviewWorkbench", () => {
  it("renders draft rows with status and stale flag", () => {
    const html = renderToStaticMarkup(<DocOverviewWorkbench initialArtifacts={FIXTURES} />);
    expect(html).toContain("Generate drafts");
    expect(html).toContain("explainer");
    expect(html).toContain("infographic");
    expect(html).toContain("audio");
    expect(html).toContain("needs review");
    expect(html).toContain("STALE");
    expect(html).toContain("Source-set manifest id");
    expect(html).toContain("audio overview");
  });

  it("shows Approve script for an audio draft whose script is unapproved", () => {
    const html = renderToStaticMarkup(
      <DocOverviewWorkbench
        initialArtifacts={FIXTURES}
        initialSelectedId="artifact_audio1"
        initialPreview={audioPreview("draft")}
      />,
    );
    expect(html).toContain("Approve script");
    expect(html).not.toContain("Synthesize audio");
  });

  it("shows Synthesize audio once the script is approved, and says plainly when no engine exists", () => {
    const html = renderToStaticMarkup(
      <DocOverviewWorkbench
        initialArtifacts={FIXTURES}
        initialSelectedId="artifact_audio1"
        initialPreview={audioPreview("approved")}
      />,
    );
    expect(html).toContain("Synthesize audio");
    expect(html).not.toContain("Approve script");
    expect(html).toContain("stays a script only");
  });

  it("renders the empty state when there are no drafts", () => {
    const html = renderToStaticMarkup(<DocOverviewWorkbench initialArtifacts={[]} />);
    expect(html).toContain("No drafts yet");
  });
});
