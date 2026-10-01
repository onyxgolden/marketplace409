import { describe, expect, it } from "vitest";
import {
  CUSTOM_FIELD_TARGET_TABLES,
  customFieldRecordExists,
  isKnownCustomFieldEntity,
} from "../customFieldTargets";

function stubClient({ data = null, error = null, capture } = {}) {
  const chain = {
    select() { return chain; },
    eq(column, value) { capture?.push([column, value]); return chain; },
    limit() { return chain; },
    async maybeSingle() { return { data, error }; },
  };
  return { from: (table) => { if (capture) capture.table = table; return chain; } };
}

describe("customFieldTargets", () => {
  it("maps each entity to its owning table", () => {
    expect(CUSTOM_FIELD_TARGET_TABLES.tenant).toEqual({ table: "rental_tenants", idColumn: "id" });
    expect(CUSTOM_FIELD_TARGET_TABLES.lease).toEqual({ table: "rental_leases", idColumn: "id" });
    expect(CUSTOM_FIELD_TARGET_TABLES.unit).toEqual({ table: "rental_units", idColumn: "id" });
    // Property identity lives on the unit's property_id; there is no
    // standalone properties table.
    expect(CUSTOM_FIELD_TARGET_TABLES.property).toEqual({ table: "rental_units", idColumn: "property_id" });
  });

  it("isKnownCustomFieldEntity accepts only the four entities", () => {
    for (const entity of ["tenant", "lease", "unit", "property"]) {
      expect(isKnownCustomFieldEntity(entity)).toBe(true);
    }
    for (const entity of ["", "owner", "TENANT", "charge", null, undefined]) {
      expect(isKnownCustomFieldEntity(entity)).toBe(false);
    }
  });

  it("checks the tenant table scoped to the effective owner", async () => {
    const capture = [];
    const supabaseClient = stubClient({ data: { id: "t1" }, capture });
    await expect(
      customFieldRecordExists({ supabaseClient, ownerId: "owner_1", entity: "tenant", recordId: "t1" }),
    ).resolves.toBe(true);
    expect(capture.table).toBe("rental_tenants");
    expect(capture).toContainEqual(["owner_id", "owner_1"]);
    expect(capture).toContainEqual(["id", "t1"]);
  });

  it("checks property_id on rental_units for the property entity", async () => {
    const capture = [];
    const supabaseClient = stubClient({ data: { property_id: "p9" }, capture });
    await expect(
      customFieldRecordExists({ supabaseClient, ownerId: "owner_1", entity: "property", recordId: "p9" }),
    ).resolves.toBe(true);
    expect(capture.table).toBe("rental_units");
    expect(capture).toContainEqual(["property_id", "p9"]);
  });

  it("returns false when no row exists (including cross-workspace ids)", async () => {
    const supabaseClient = stubClient({ data: null });
    await expect(
      customFieldRecordExists({ supabaseClient, ownerId: "owner_1", entity: "tenant", recordId: "someone-elses-tenant" }),
    ).resolves.toBe(false);
  });

  it("returns false for unknown entities", async () => {
    const supabaseClient = stubClient({ data: { id: "x" } });
    await expect(
      customFieldRecordExists({ supabaseClient, ownerId: "owner_1", entity: "charge", recordId: "x" }),
    ).resolves.toBe(false);
  });

  it("throws on query errors instead of silently treating the record as missing", async () => {
    const supabaseClient = stubClient({ error: { message: "db down" } });
    await expect(
      customFieldRecordExists({ supabaseClient, ownerId: "owner_1", entity: "tenant", recordId: "t1" }),
    ).rejects.toThrow();
  });
});
