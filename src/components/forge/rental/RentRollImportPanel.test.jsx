import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentRollImportPanel from "./RentRollImportPanel";

describe("RentRollImportPanel", () => {
  it("starts collapsed behind an import button", () => {
    const markup = renderToStaticMarkup(<RentRollImportPanel units={[]} tenants={[]} leases={[]} onImported={() => {}} />);
    expect(markup).toContain("Import rent roll from CSV");
    expect(markup).not.toContain("Upload Rentec's Rent Roll export");
  });
});
