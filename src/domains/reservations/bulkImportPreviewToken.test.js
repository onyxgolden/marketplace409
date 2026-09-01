import { describe, expect, it } from "vitest";
import { decodeBulkImportPreview, digestBulkInventoryRows, encodeBulkImportPreview } from "./bulkImportPreviewToken";
const secret = "reservation-import-test-secret-that-is-at-least-32-characters";
describe("reservation bulk import preview token", () => {
  it("binds normalized rows, owner, actor, import id, and expiry", () => {
    const rows = [{ unitId: "unit-1", nightlyRateCents: 5000 }]; const planDigest = digestBulkInventoryRows(rows);
    const token = encodeBulkImportPreview({ ownerId: "owner-1", actingUserId: "actor-1", importId: "import-1", planDigest, rows }, { secret, now: 1000 });
    expect(decodeBulkImportPreview(token, { secret, now: 2000 })).toMatchObject({ ownerId: "owner-1", actingUserId: "actor-1", importId: "import-1", planDigest, rows });
  });
  it("rejects tampering and expiry", () => {
    const token = encodeBulkImportPreview({ rows: [] }, { secret, now: 1000, ttlMs: 10 });
    expect(() => decodeBulkImportPreview(`${token}x`, { secret, now: 1001 })).toThrow(/invalid/i);
    expect(() => decodeBulkImportPreview(token, { secret, now: 1011 })).toThrow(/expired/i);
  });
});
