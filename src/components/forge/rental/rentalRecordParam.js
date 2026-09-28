// Pure URL-param resolvers for the rental manager route. This module has no
// "use client" marker so both the server page (src/app/forge/rental/page.jsx)
// and client components can import it.

// Record types the app actually navigates with (see onNavigate call sites).
export const KNOWN_RECORD_TYPES = new Set(["property", "tenant", "unit"]);

// Maps `?recordType=`/`?recordId=`/`?propertyId=` URL values back to the record
// context shape RentalPageClient holds in state, so a reload on a property page
// restores the selected record instead of dropping to the dashboard. Unknown
// types, missing ids, and overlong values resolve to null (no context).
export function resolveRentalRecordContextParam({ recordType, recordId, propertyId }) {
  const type = String(recordType || "").trim().toLowerCase();
  const id = String(recordId || "").trim();
  if (!KNOWN_RECORD_TYPES.has(type) || !id || id.length > 200) return null;
  const context = { recordType: type, recordId: id };
  const pid = String(propertyId || "").trim();
  if (pid && pid.length <= 200) context.propertyId = pid;
  return context;
}
