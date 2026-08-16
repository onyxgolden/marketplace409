import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RentalRecordBrowser from "./RentalRecordBrowser";

describe("RentalRecordBrowser", () => {
  it("renders a compact record list beside selected detail", () => {
    const records = [{ id: "one", name: "Main residence" }, { id: "two", name: "Second unit" }];
    const markup = renderToStaticMarkup(<RentalRecordBrowser title="Rental units" records={records} selectedId="one" onSelect={() => {}} getTitle={(item) => item.name} getSubtitle={(item) => item.id}><p>Focused detail</p></RentalRecordBrowser>);
    expect(markup).toContain("2 records");
    expect(markup).toContain("Main residence");
    expect(markup).toContain("Second unit");
    expect(markup).toContain("Focused detail");
    expect(markup).toContain('aria-current="true"');
  });
  it("renders a table with column headers when columns is provided", () => {
    const records = [{ id: "one", name: "Main residence", tenant: "Ashley George" }, { id: "two", name: "Second unit", tenant: null }];
    const markup = renderToStaticMarkup(<RentalRecordBrowser title="Rental units" records={records} selectedId="one" onSelect={() => {}}
      columns={[{ header: "Property", render: (item) => item.name }, { header: "Tenant", render: (item) => item.tenant || "Vacant" }]}>
      <p>Focused detail</p>
    </RentalRecordBrowser>);
    expect(markup).toContain("<table");
    expect(markup).toContain(">Property<");
    expect(markup).toContain(">Tenant<");
    expect(markup).toContain("Ashley George");
    expect(markup).toContain(">Vacant<");
    expect(markup).toContain('role="button"');
  });
});
