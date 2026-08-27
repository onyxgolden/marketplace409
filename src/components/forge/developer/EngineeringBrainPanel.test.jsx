import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.stubGlobal("fetch", vi.fn());
import EngineeringBrainPanel from "./EngineeringBrainPanel";

describe("EngineeringBrainPanel", () => {
  it("presents the search surface and its initial loading state", () => {
    const markup = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(markup).toContain("FORGE Engineering Brain");
    expect(markup).toContain("Search");
    expect(markup).toContain("Searching");
  });

  it("explains upfront that this view has no inline excerpts, rather than silently omitting them", () => {
    const markup = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(markup).toContain("does not show inline content excerpts");
  });

  it("does not render results or conflicts before the first fetch resolves", () => {
    const markup = renderToStaticMarkup(<EngineeringBrainPanel />);
    expect(markup).not.toContain("unresolved conflict");
    expect(markup).not.toContain("Insufficient evidence");
  });
});
