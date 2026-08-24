import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import SimplifiImportPanel from "../SimplifiImportPanel.jsx";

describe("SimplifiImportPanel", () => {
  it("presents a preview-first, bounded approval workflow", () => {
    const markup = renderToStaticMarkup(<SimplifiImportPanel />);
    expect(markup).toContain("Import Quicken Simplifi history");
    expect(markup).toContain("never stored");
    expect(markup).toContain("at most 500 transactions at a time");
    expect(markup).toContain('accept=".csv,text/csv"');
    expect(markup).not.toContain("Create and map missing FORGE accounts");
    expect(markup).not.toContain("Import next 500 safe rows");
  });
});
