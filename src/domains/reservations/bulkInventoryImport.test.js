import { describe, expect, it } from "vitest";
import { BULK_INVENTORY_TEMPLATE, parseBulkInventoryCsv } from "./bulkInventoryImport";

describe("reservation inventory bulk CSV", () => {
  it("normalizes RV sites and cabins with exact cents and shared properties", () => {
    const result = parseBulkInventoryCsv(BULK_INVENTORY_TEMPLATE);
    expect(result).toMatchObject({ totalRows: 2, validRows: 2, errorRows: 0 });
    expect(result.rows[0]).toMatchObject({ propertyId: "Pine Lake RV Park", unitLabel: "Site 01", inventory: { inventoryType: "rv_site", bookingStatus: "draft", nightlyRateCents: 5500, lodgingTaxBasisPoints: 825 } });
    expect(result.rows[1].inventory.amenities).toEqual(["Wi-Fi", "fire pit", "kitchen"]);
  });
  it("supports quoted CSV values and friendly RV spot aliases", () => {
    const csv = 'property_name,unit_name,space_type,public_name,maximum_guests,minimum_nights,nightly_rate,amenities\n"Lake, South",Spot 1,RV spot,Premium Spot,6,1,75.50,"50 amp|water"\n';
    const result = parseBulkInventoryCsv(csv);
    expect(result.rows[0]).toMatchObject({ propertyId: "Lake, South", inventory: { inventoryType: "rv_site", nightlyRateCents: 7550 } });
  });
  it("reconciles duplicates, existing units, and excluded drivable RVs without producing a confirmable row", () => {
    const csv = "property_name,unit_name,space_type,public_name,maximum_guests,minimum_nights,nightly_rate\nPark,Site 1,drivable rv,Site 1,4,1,50\nPark,Site 1,cabin,Cabin,4,1,80\n";
    const result = parseBulkInventoryCsv(csv, { existingUnits: [{ property_id: "Park", label: "Site 1", status: "available" }] });
    expect(result).toMatchObject({ totalRows: 2, validRows: 0, errorRows: 2 });
    expect(result.rows[0].errors.join(" ")).toMatch(/already exists|drivable/i);
    expect(result.rows[1].errors.join(" ")).toMatch(/Duplicate|already exists/i);
  });
  it("requires the documented columns and caps imports at 500 rows", () => {
    expect(() => parseBulkInventoryCsv("property_name,unit_name\nPark,Site 1\n")).toThrow(/missing required columns/i);
    const header = "property_name,unit_name,space_type,public_name,maximum_guests,minimum_nights,nightly_rate\n";
    const rows = Array.from({ length: 501 }, (_, index) => `Park,Site ${index},rv_site,Site ${index},4,1,50`).join("\n");
    expect(() => parseBulkInventoryCsv(header + rows)).toThrow(/500 rows/i);
  });
  it("rejects an explicit unsupported booking status", () => {
    const csv = "property_name,unit_name,space_type,booking_status,public_name,maximum_guests,minimum_nights,nightly_rate\nPark,Site 1,rv_site,published,Site 1,4,1,50\n";
    const result = parseBulkInventoryCsv(csv);
    expect(result).toMatchObject({ validRows: 0, errorRows: 1 });
    expect(result.rows[0].errors.join(" ")).toMatch(/booking_status/i);
  });
});
