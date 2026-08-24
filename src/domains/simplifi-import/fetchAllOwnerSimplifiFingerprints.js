// Paginated fetch of every already-imported Simplifi source_record_id (fingerprint) for one owner.
// Supabase's PostgREST layer caps a plain .select() at a default page size (1000 rows) regardless
// of how many rows actually match. A truncated existingFingerprints set doesn't just produce a
// wrong preview: any already-imported row whose fingerprint falls outside the truncated page gets
// misclassified as newly approvable, and repeatedly "approving" it again is a harmless no-op
// thanks to financial_events' own uniqueness constraint, but the preview can never converge or
// report real remaining-row counts correctly once an owner has more than 1000 imported rows.
const PAGE_SIZE = 1000;

export async function fetchAllOwnerSimplifiFingerprints(database, ownerId) {
  const fingerprints = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await database
      .from("financial_events")
      .select("source_record_id")
      .eq("owner_id", ownerId)
      .eq("source_system", "quicken_simplifi_csv")
      .not("source_record_id", "is", null)
      .range(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data || [];
    for (const row of page) if (row.source_record_id) fingerprints.push(row.source_record_id);
    if (page.length < PAGE_SIZE) break;
  }
  return fingerprints;
}
