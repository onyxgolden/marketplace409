import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("fetch", vi.fn());
import BrainHealthDashboard, { HandoffDraftBuilder } from "./BrainHealthDashboard";

const FINDINGS = [
  {
    id: "coverage:dark-cap",
    kind: "coverage-gap",
    what: 'Runtime capability "Dark" is uncovered.',
    subsystem: "cron3",
    whyItMatters: "No monitoring evidence exists.",
    confidence: "high",
    lastSeen: null,
    evidenceLinks: [{ label: "registry", ref: "registry.mjs" }],
    nextStep: "Verify manually.",
  },
];

describe("BrainHealthDashboard", () => {
  it("shows a loading state before the health fetch resolves", () => {
    const markup = renderToStaticMarkup(<BrainHealthDashboard />);
    expect(markup).toContain("Loading engineering health");
  });

  it("never claims the watchdog is actively monitoring in any rendered state", () => {
    const markup = renderToStaticMarkup(<BrainHealthDashboard />);
    // Even the loading shell must not imply active monitoring.
    expect(markup.toLowerCase()).not.toMatch(/actively monitoring/);
  });
});

describe("HandoffDraftBuilder", () => {
  it("renders findings into a previewable draft", () => {
    const markup = renderToStaticMarkup(<HandoffDraftBuilder findings={FINDINGS} />);
    expect(markup).toContain("Review handoff draft");
    expect(markup.toLowerCase()).toContain("capability");
    expect(markup).toContain("Copy draft to clipboard");
  });

  it("states explicitly that nothing is posted or assigned", () => {
    const markup = renderToStaticMarkup(<HandoffDraftBuilder findings={FINDINGS} />);
    expect(markup).toMatch(/Nothing is posted or assigned automatically/);
  });

  it("handles zero findings without crashing", () => {
    const markup = renderToStaticMarkup(<HandoffDraftBuilder findings={[]} />);
    expect(markup).toContain("Review handoff draft");
  });
});
