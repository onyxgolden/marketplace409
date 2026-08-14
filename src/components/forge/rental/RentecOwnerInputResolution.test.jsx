import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentecOwnerInputResolution from "./RentecOwnerInputResolution.jsx";

describe("RentecOwnerInputResolution", () => {
  it("renders bounded owner inputs without an import control", () => {
    const html = renderToStaticMarkup(<RentecOwnerInputResolution resolution={{
      requirements: [
        { type: "tenant_email", sourceId: "20", label: "A Tenant", prompt: "Renter email address" },
        { type: "rent_due_day", sourceId: "30", label: "1218 Wagner St", prompt: "Monthly rent due day (1–28)" },
      ],
    }}/>);
    expect(html).toContain("Resolve owner inputs");
    expect(html).toContain("A Tenant");
    expect(html).toContain("1218 Wagner St");
    expect(html).toContain('type="email"');
    expect(html).toContain('max="28"');
    expect(html).toContain("Validate inputs and regenerate preview");
    expect(html).toContain("does not import");
    expect(html).not.toContain("Commit import");
  });

  it("shows the resolved preview boundary", () => {
    const html = renderToStaticMarkup(<RentecOwnerInputResolution resolution={{ requirements: [] }}/>);
    expect(html).toContain("Owner inputs resolved");
    expect(html).toContain("No records were saved or imported");
  });
});
