import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalRecordActions, { labelRentalRecordContext } from "./RentalRecordActions.jsx";

describe("RentalRecordActions", () => {
  it("renders one reusable contextual action menu", () => {
    const markup = renderToStaticMarkup(<RentalRecordActions label="Property actions" actions={[{ label: "Manage lease", onSelect: vi.fn() }, { label: "Inspections", onSelect: vi.fn() }]} />);
    expect(markup).toContain("Property actions");
    expect(markup).toContain("Manage lease");
    expect(markup).toContain("Inspections");
    expect(markup).toContain("data-rental-record-actions");
  });
  it("carries a human-readable record label into another workflow",()=>{expect(labelRentalRecordContext({recordType:"tenant",recordId:"tenant_1"},[{id:"tenant_1",display_name:"John Jones"}],"display_name")).toMatchObject({recordId:"tenant_1",recordLabel:"John Jones"})});
});
