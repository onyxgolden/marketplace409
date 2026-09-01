import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { parseBulkInventoryCsv } from "@/domains/reservations/bulkInventoryImport";
import { decodeBulkImportPreview, digestBulkInventoryRows, encodeBulkImportPreview } from "@/domains/reservations/bulkImportPreviewToken";

const bad = (message, status = 400) => NextResponse.json({ error: message }, { status });
const secret = () => process.env.RESERVATION_PREVIEW_TOKEN_SECRET || process.env.PRIVATE_FINANCING_PREVIEW_TOKEN_SECRET;

function buildPlan(rows, importId) {
  const effectiveStartDate = new Date().toISOString().slice(0, 10);
  return rows.map((row, index) => ({
    unitId: `rental_unit_reservation_import_${importId}_${index + 1}`,
    ratePlanId: `reservation_rate_import_${importId}_${index + 1}`,
    propertyId: row.propertyId, unitLabel: row.unitLabel,
    inventoryType: row.inventory.inventoryType, bookingStatus: row.inventory.bookingStatus,
    publicName: row.inventory.publicName, publicDescription: row.inventory.publicDescription,
    timezone: row.inventory.timezone, maximumGuests: row.inventory.maximumGuests,
    minimumNights: row.inventory.minimumNights, maximumNights: row.inventory.maximumNights,
    turnoverBufferHours: row.inventory.turnoverBufferHours, amenities: row.inventory.amenities,
    nightlyRateCents: row.inventory.nightlyRateCents, cleaningFeeCents: row.inventory.cleaningFeeCents,
    securityDepositCents: row.inventory.securityDepositCents,
    lodgingTaxBasisPoints: row.inventory.lodgingTaxBasisPoints, effectiveStartDate,
  }));
}

async function loadUnits(authenticated) {
  const { data, error } = await authenticated.supabaseClient.from("rental_units")
    .select("id,property_id,label,status").eq("owner_id", authenticated.effectiveOwnerId);
  if (error) throw error;
  return data || [];
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    if (body?.operation === "preview") {
      const reconciliation = parseBulkInventoryCsv(body.csvText, { existingUnits: await loadUnits(authenticated) });
      const valid = reconciliation.rows.filter((row) => row.errors.length === 0);
      let previewToken = null; let planDigest = null;
      if (reconciliation.totalRows > 0 && reconciliation.errorRows === 0) {
        const importId = crypto.randomUUID(); const plan = buildPlan(valid, importId);
        planDigest = digestBulkInventoryRows(plan);
        previewToken = encodeBulkImportPreview({ ownerId: authenticated.effectiveOwnerId,
          actingUserId: authenticated.user.id, importId, planDigest, rows: plan }, { secret: secret() });
      }
      return NextResponse.json({ success: true, reconciliation, planDigest, previewToken });
    }
    if (body?.operation !== "confirm" || body.acknowledged !== true || body.confirmationText !== "IMPORT") {
      return bad("Preview acknowledgement and typed IMPORT confirmation are required.");
    }
    const preview = decodeBulkImportPreview(body.previewToken, { secret: secret() });
    if (preview.ownerId !== authenticated.effectiveOwnerId || preview.actingUserId !== authenticated.user.id
      || digestBulkInventoryRows(preview.rows) !== preview.planDigest) return bad("Reservation import plan changed after preview. Preview again.", 409);
    const { data, error } = await authenticated.supabaseClient.rpc("import_reservation_inventory_bulk", {
      p_owner_id: authenticated.effectiveOwnerId, p_import_id: preview.importId,
      p_plan_digest: preview.planDigest, p_rows: preview.rows,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, result: data });
  } catch (error) {
    if (/CSV|column|row|duplicate|required|invalid|expired|supported|drivable|dollar|percentage|whole number|between|already exists/i.test(error?.message || "")) {
      return bad(error.message, /already exists/i.test(error.message) ? 409 : 400);
    }
    console.error("Reservation inventory bulk import failed", { name: error?.name || "Error" });
    return bad("Unable to process the reservation inventory import.", 500);
  }
}
