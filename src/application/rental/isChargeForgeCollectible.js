// Shared read-model classifier: a rent charge is FORGE-collectible only when its own schedule row
// (raw snake_case, as returned by Supabase — these report builders never map to the domain type)
// is collection_mode='forge' with an arrived cutover date, and the charge's own due date is on or
// after that cutover. Fails safe: any missing or ambiguous evidence (no schedule row, no cutover
// date) classifies as NOT FORGE-collectible, never the reverse — an unresolved charge must default
// to "externally managed / reconciliation required," never to "FORGE overdue."
export function isChargeForgeCollectible(charge, schedule, asOfDate) {
  if (!schedule) return false;
  if (schedule.collection_mode !== "forge") return false;
  if (schedule.forge_cutover_date === null || schedule.forge_cutover_date === undefined) return false;
  if (schedule.forge_cutover_date > asOfDate) return false;
  if (charge.due_date < schedule.forge_cutover_date) return false;
  return true;
}
