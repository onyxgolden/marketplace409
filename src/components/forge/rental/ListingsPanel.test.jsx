import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ListingsPanel from "./ListingsPanel";
import ApplicationsPanel from "./ApplicationsPanel";

describe("listings panel", () => {
  it("renders the four leasing tabs and the loading state", () => {
    const markup = renderToStaticMarkup(<ListingsPanel />);
    expect(markup).toContain("Listings &amp; applications");
    expect(markup).toContain("Vacant units");
    expect(markup).toContain("Application forms");
    expect(markup).toContain("Syndication");
    expect(markup).toContain("Loading…");
  });
});

describe("applications panel", () => {
  it("renders the review queue shell with status filters", () => {
    const markup = renderToStaticMarkup(<ApplicationsPanel />);
    expect(markup).toContain("Applications");
    expect(markup).toContain("Pending");
    expect(markup).toContain("Approved");
    expect(markup).toContain("Denied");
    expect(markup).toContain("Loading…");
  });
});
