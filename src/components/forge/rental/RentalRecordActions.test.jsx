import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalRecordActions from "./RentalRecordActions.jsx";

describe("RentalRecordActions", () => {
  it("renders one reusable contextual action menu", () => {
    const markup = renderToStaticMarkup(<RentalRecordActions label="Property actions" actions={[{ label: "Manage lease", onSelect: vi.fn() }, { label: "Inspections", onSelect: vi.fn() }]} />);
    expect(markup).toContain("Property actions");
    expect(markup).toContain("Manage lease");
    expect(markup).toContain("Inspections");
    expect(markup).toContain("data-rental-record-actions");
  });
});
