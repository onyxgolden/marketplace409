import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentecImportManifestPreview from "./RentecImportManifestPreview.jsx";

describe("RentecImportManifestPreview", () => {
  it("shows checksum, dependency order, mappings, and blockers without import controls", () => {
    const html = renderToStaticMarkup(<RentecImportManifestPreview manifest={{
      readiness: { units: { ready: 20, blocked: 0 }, tenants: { ready: 35, blocked: 2 }, leases: { ready: 0, blocked: 8 } },
      checksum: "a".repeat(64),
      dependencyOrder: ["properties_and_units", "renters", "leases_and_memberships"],
      blockers: [{ label: "Rent due day requires owner input", count: 8 }],
      fieldMappings: {
        units: [{ source: "property_id", target: "id", rule: "stable" }],
        tenants: [{ source: "email", target: "email", rule: "lowercase" }],
        leases: [{ source: "not supplied", target: "rent_due_day", rule: "never inferred" }],
      },
    }}/>);
    expect(html).toContain("Controlled import manifest");
    expect(html).toContain("Approval checksum");
    expect(html).toContain("properties_and_units");
    expect(html).toContain("Rent due day requires owner input");
    expect(html).toContain("nothing was persisted or written");
    expect(html).not.toContain("Commit import");
  });
});
