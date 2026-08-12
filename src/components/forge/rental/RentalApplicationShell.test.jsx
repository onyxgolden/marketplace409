import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalApplicationShell, { buildRentalSurface, RENTAL_FUNCTIONS } from "./RentalApplicationShell.jsx";
describe("RentalApplicationShell", () => {
  it("offers the complete first-tenant operating functions", () => {
    expect(RENTAL_FUNCTIONS.map(({ id }) => id)).toEqual(["overview", "setup", "tenants", "leases", "charges", "insurance", "maintenance"]);
  });
  it("renders the Kent Avenue launch overview", () => {
    const markup = renderToStaticMarkup(<RentalApplicationShell activeFunctionId="overview" onFunctionChange={() => {}} />);
    expect(markup).toContain("4800 Kent Avenue");
    expect(markup).toContain("First production rental");
  });
  it("renders one selected function surface", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Record lease and rent schedule");
    expect(markup).not.toContain("4800 Kent Avenue");
  });
  it("renders functional tenant and lease setup surfaces", () => {
    expect(renderToStaticMarkup(buildRentalSurface("tenants"))).toContain("Create the Kent Avenue tenant");
    expect(renderToStaticMarkup(buildRentalSurface("leases"))).toContain("Record lease and rent schedule");
  });
  it("requires persisted unit and tenant selections instead of manual ids", () => {
    const markup = renderToStaticMarkup(buildRentalSurface("leases"));
    expect(markup).toContain("Select a saved unit");
    expect(markup).toContain("Select a saved tenant");
    expect(markup).not.toContain("Tenant ID");
  });
});
