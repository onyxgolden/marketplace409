import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import SimplifiImportPanel, { approvableRowCount } from "../SimplifiImportPanel.jsx";

describe("SimplifiImportPanel", () => {
  it("presents a preview-first, bounded approval workflow", () => {
    const markup = renderToStaticMarkup(<SimplifiImportPanel />);
    expect(markup).toContain("Import Quicken Simplifi history");
    expect(markup).toContain("never stored");
    expect(markup).toContain("at most 500 transactions at a time");
    expect(markup).toContain('accept=".csv,text/csv"');
    expect(markup).not.toContain("Create and map missing FORGE accounts");
    expect(markup).not.toContain("Import next 500 reviewed rows");
  });
});

describe("approvableRowCount", () => {
  it("counts personal rows alongside safe_missing, not safe_missing alone", () => {
    // Regression: the import button used to read preview.totals.safe_missing.count only, so once
    // every business row was consumed across earlier batches it would disable itself while
    // approvable personal rows still remained.
    const rows = [
      { classification: "safe_missing", approvable: true },
      { classification: "personal", approvable: true },
      { classification: "personal", approvable: true },
      { classification: "transfer_pair", approvable: false },
      { classification: "unsupported", approvable: false },
    ];
    expect(approvableRowCount(rows)).toBe(3);
  });

  it("returns 0 for an empty or missing row list", () => {
    expect(approvableRowCount([])).toBe(0);
    expect(approvableRowCount(undefined)).toBe(0);
  });

  it("counts only personal rows once every business row is exhausted", () => {
    const rows = [
      { classification: "personal", approvable: true },
      { classification: "already_imported", approvable: false },
    ];
    expect(approvableRowCount(rows)).toBe(1);
  });
});
